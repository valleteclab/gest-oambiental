import "server-only";
import type { EstadoConversa, Prisma, TipoCanal } from "@prisma/client";
import { prisma } from "../db";
import { auditar } from "../audit";
import { decifrar } from "../crypto";
import { invalido, naoEncontrado, proibido } from "../http";
import { can, escopoMunicipios, isSomenteLeitura, temEscopoOrganizacao, UUID_NENHUM, type UsuarioSessao } from "../rbac";
import { carregarCanal } from "../canais";
import { formatarTelefone, mascararTelefone } from "../canais/telefone";
import { criarDenunciaCanal } from "../fiscalizacao/servico";
import { dadosDe, jsonDados } from "./conversas";
import { enviarRespostas } from "./envio";
import { PAUSA_HUMANO_MS, urlsPublicas } from "./orquestrador";
import { canalDaDenuncia, faltandoParaRegistro, textoDenuncia } from "./registro";
import * as T from "./textos";
import { hashContato } from "../canais/contato";

// Back-office do atendimento (/atendimento): escopo por município (e conversas ainda sem município da organização
// só para papéis de escopo organização). SEMA_INEMA e GESTOR: somente leitura.

export const podeVerAtendimento = (u: UsuarioSessao) => can(u, "ver", "denuncia");
export function podeAtender(u: UsuarioSessao, conv: { municipio_id: string | null; organizacao_id: string }) {
  if (isSomenteLeitura(u)) return false;
  if (conv.municipio_id) return can(u, "editar", "denuncia", conv.municipio_id);
  return temEscopoOrganizacao(u) && u.organizacao_id === conv.organizacao_id && can(u, "editar", "denuncia");
}

export function whereConversas(u: UsuarioSessao, municipioPedido?: string | null): Prisma.ConversaWhereInput {
  const escopo = escopoMunicipios(u);
  if (municipioPedido) return { municipio_id: escopo.includes(municipioPedido) ? municipioPedido : UUID_NENHUM };
  const or: Prisma.ConversaWhereInput[] = [{ municipio_id: { in: escopo } }];
  if (temEscopoOrganizacao(u) && u.organizacao_id) or.push({ municipio_id: null, organizacao_id: u.organizacao_id });
  return { OR: or };
}

export type FiltroConversas = { municipio_id?: string | null; estado?: EstadoConversa | null; canal?: TipoCanal | null };

export async function listarConversas(u: UsuarioSessao, f: FiltroConversas, pag: { skip: number; take: number }) {
  const where: Prisma.ConversaWhereInput = { AND: [whereConversas(u, f.municipio_id), f.estado ? { estado: f.estado } : {}, f.canal ? { canal: { tipo: f.canal } } : {}] };
  const [total, itens] = await Promise.all([
    prisma.conversa.count({ where }),
    prisma.conversa.findMany({
      where, orderBy: { ultima_msg_em: "desc" }, skip: pag.skip, take: pag.take,
      select: {
        id: true, estado: true, nome: true, ultima_msg_em: true, created_at: true, ia_pausada_ate: true, contato_cifrado: true,
        canal: { select: { tipo: true, nome: true } }, municipio: { select: { nome: true, sigla: true } }, denuncia: { select: { id: true, protocolo: true, status: true } },
        mensagens: { orderBy: { created_at: "desc" }, take: 1, select: { texto: true, tipo: true, direcao: true } },
      },
    }),
  ]);
  const leitura = isSomenteLeitura(u);
  return {
    total,
    itens: itens.map(({ contato_cifrado, ...c }) => {
      const contato = decifrar(contato_cifrado);
      return { ...c, contato: contato ? (contato.includes("@") ? (leitura ? contato.replace(/^(.).*(@.*)$/, "$1***$2") : contato) : leitura ? mascararTelefone(contato) : formatarTelefone(contato)) : null };
    }),
  };
}

export async function obterConversaAtendimento(u: UsuarioSessao, id: string) {
  const c = await prisma.conversa.findUnique({
    where: { id },
    include: {
      canal: { select: { id: true, tipo: true, nome: true, ativo: true } },
      municipio: { select: { id: true, nome: true, sigla: true, latitude: true, longitude: true } },
      denuncia: { select: { id: true, protocolo: true, status: true } },
      mensagens: { orderBy: { created_at: "asc" }, take: 500 },
    },
  });
  if (!c) throw naoEncontrado("Conversa não encontrada.");
  const visivel = c.municipio_id ? escopoMunicipios(u).includes(c.municipio_id) : temEscopoOrganizacao(u) && u.organizacao_id === c.organizacao_id;
  if (!visivel || !podeVerAtendimento(u)) throw proibido();
  const contato = decifrar(c.contato_cifrado);
  const leitura = isSomenteLeitura(u);
  const atendentes = [...new Set(c.mensagens.map((m) => m.autor_usuario_id).filter(Boolean) as string[])];
  const nomes = atendentes.length ? await prisma.usuario.findMany({ where: { id: { in: atendentes } }, select: { id: true, nome: true } }) : [];
  return {
    ...c,
    destino_cifrado: undefined,
    contato_cifrado: undefined,
    contato: contato ? (contato.includes("@") ? contato : leitura ? mascararTelefone(contato) : formatarTelefone(contato)) : null,
    dados: dadosDe(c),
    podeAtender: podeAtender(u, c),
    mensagens: c.mensagens.map((m) => ({ ...m, latitude: m.latitude ? Number(m.latitude) : null, longitude: m.longitude ? Number(m.longitude) : null, atendente: nomes.find((n) => n.id === m.autor_usuario_id)?.nome ?? null })),
  };
}

async function conversaParaAtuar(u: UsuarioSessao, id: string) {
  const c = await prisma.conversa.findUnique({ where: { id } });
  if (!c) throw naoEncontrado("Conversa não encontrada.");
  if (!podeAtender(u, c)) throw proibido();
  const canal = await carregarCanal(c.canal_id);
  if (!canal) throw naoEncontrado("Canal não encontrado.");
  return { c, canal };
}

/** "Assumir atendimento": pausa a IA por 3 h (HUMANO). */
export async function assumirAtendimento(u: UsuarioSessao, id: string) {
  const { c } = await conversaParaAtuar(u, id);
  if (c.estado === "ENCERRADA") throw invalido("Conversa encerrada.");
  const d = dadosDe(c);
  const r = await prisma.conversa.update({
    where: { id },
    data: { estado: "HUMANO", atendente_id: u.id, ia_pausada_ate: new Date(Date.now() + PAUSA_HUMANO_MS), dados_coletados: jsonDados({ ...d, estado_anterior: c.estado === "HUMANO" ? d.estado_anterior : c.estado }) },
  });
  await auditar({ usuario_id: u.id, acao: "ASSUMIR_ATENDIMENTO", entidade: "conversa", entidade_id: id, antes: { estado: c.estado }, depois: { estado: "HUMANO", ia_pausada_ate: r.ia_pausada_ate } });
  return r;
}

/** "Devolver para IA": volta ao estado anterior. */
export async function devolverParaIa(u: UsuarioSessao, id: string) {
  const { c } = await conversaParaAtuar(u, id);
  if (c.estado !== "HUMANO") throw invalido("A conversa não está com um atendente.");
  const d = dadosDe(c);
  const estado = ((d.estado_anterior as EstadoConversa | undefined) && d.estado_anterior !== "HUMANO" ? d.estado_anterior : "COLETANDO") as EstadoConversa;
  await prisma.conversa.update({ where: { id }, data: { estado, ia_pausada_ate: null, atendente_id: null } });
  await auditar({ usuario_id: u.id, acao: "DEVOLVER_ATENDIMENTO_IA", entidade: "conversa", entidade_id: id, antes: { estado: "HUMANO" }, depois: { estado } });
}

/** Resposta do atendente pelo painel (assume automaticamente). */
export async function responderComoAtendente(u: UsuarioSessao, id: string, texto: string) {
  const t = texto.trim();
  if (!t) throw invalido("Digite a mensagem.");
  if (t.length > 4000) throw invalido("Mensagem muito longa (máx. 4000).");
  const { c, canal } = await conversaParaAtuar(u, id);
  if (c.estado === "ENCERRADA") throw invalido("Conversa encerrada – o cidadão precisa enviar uma nova mensagem.");
  if (c.estado !== "HUMANO") await assumirAtendimento(u, id);
  else await prisma.conversa.update({ where: { id }, data: { ia_pausada_ate: new Date(Date.now() + PAUSA_HUMANO_MS), atendente_id: u.id } });
  const [m] = await enviarRespostas(canal, c, [{ texto: t }], "ATENDENTE", u.id);
  await auditar({ usuario_id: u.id, acao: "RESPONDER_ATENDIMENTO", entidade: "conversa", entidade_id: id, depois: { mensagem_id: m?.id, status_envio: m?.status_envio } });
  return m;
}

export async function encerrarConversa(u: UsuarioSessao, id: string) {
  const { c } = await conversaParaAtuar(u, id);
  await prisma.conversa.update({ where: { id }, data: { estado: "ENCERRADA", ia_pausada_ate: null } });
  await auditar({ usuario_id: u.id, acao: "ENCERRAR_ATENDIMENTO", entidade: "conversa", entidade_id: id, antes: { estado: c.estado }, depois: { estado: "ENCERRADA" } });
}

/** "Criar denúncia manualmente" a partir do que foi coletado (o atendente completa a descrição/local se preciso). */
export async function criarDenunciaManual(u: UsuarioSessao, id: string, complemento: { descricao?: string | null; endereco?: string | null; municipio_id?: string | null }) {
  const { c, canal } = await conversaParaAtuar(u, id);
  if (c.denuncia_id) throw invalido("Esta conversa já tem denúncia registrada.");
  const d = { ...dadosDe(c) };
  if (complemento.descricao?.trim()) d.descricao = complemento.descricao.trim();
  if (complemento.endereco?.trim()) d.endereco = complemento.endereco.trim();
  const municipioId = c.municipio_id ?? canal.municipio_id ?? complemento.municipio_id ?? d.municipio_id ?? null;
  const faltando = faltandoParaRegistro(d, municipioId);
  if (faltando.length) throw invalido(`Informe: ${faltando.join(", ")}.`);
  if (!municipioId || !can(u, "criar", "denuncia", municipioId)) throw proibido();
  const { descricao, endereco } = textoDenuncia(d, canal.tipo);
  const den = await criarDenunciaCanal({
    municipio_id: municipioId, canal: canalDaDenuncia(canal.tipo), descricao, endereco, latitude: d.latitude ?? null, longitude: d.longitude ?? null,
    anonima: d.anonima !== false, denunciante_nome: d.anonima === false ? d.nome ?? c.nome : null,
    contato: decifrar(c.contato_cifrado) ?? d.contato_informado ?? null, contato_hash: c.contato_hash ?? hashContato(d.contato_informado),
    conversa_id: c.id, fotos: (d.fotos ?? []).map((f) => ({ storage_key: f.key, nome: f.nome, mime: f.mime, tamanho: f.tamanho, sha256: f.sha256 })),
  });
  await prisma.conversa.update({ where: { id }, data: { denuncia_id: den.id, municipio_id: municipioId, estado: c.estado === "HUMANO" ? "HUMANO" : "REGISTRADA", dados_coletados: jsonDados({ ...d, estado_anterior: "REGISTRADA" }) } });
  await auditar({ usuario_id: u.id, acao: "CRIAR_DENUNCIA_ATENDIMENTO", entidade: "denuncia", entidade_id: den.id, depois: { protocolo: den.protocolo, conversa_id: id } });
  const conv = await prisma.conversa.findUniqueOrThrow({ where: { id } });
  await enviarRespostas(canal, conv, [T.registrada(den.protocolo, `${urlsPublicas().acompanhar}?protocolo=${encodeURIComponent(den.protocolo)}`)], "ATENDENTE", u.id);
  return den;
}

/** Mídia de uma mensagem (somente com escopo na conversa). */
export async function midiaDaMensagem(u: UsuarioSessao, mensagemId: string) {
  const m = await prisma.mensagemConversa.findUnique({ where: { id: mensagemId }, select: { midia_key: true, midia_mime: true, conversa_id: true } });
  if (!m?.midia_key) throw naoEncontrado("Arquivo não encontrado.");
  await obterConversaAtendimento(u, m.conversa_id);
  const { lerArquivo } = await import("../storage");
  return { dados: await lerArquivo(m.midia_key), mime: m.midia_mime ?? "application/octet-stream" };
}
