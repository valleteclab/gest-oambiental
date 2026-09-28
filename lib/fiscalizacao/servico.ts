import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma, StatusDenuncia } from "@prisma/client";
import { prisma } from "../db";
import { auditar } from "../audit";
import { cifrar, decifrar, formatarCpfCnpj, hashBusca, mascararCpfCnpj, sha256, somenteDigitos } from "../crypto";
import { numeroDocumento } from "../numeracao";
import { nomeSeguro, removerArquivo, salvarArquivo, validarUpload } from "../storage";
import { emitirDocumento } from "../documentos";
import { invalido, naoEncontrado, proibido } from "../http";
import { podeVerMunicipio, whereMunicipio, type UsuarioSessao } from "../rbac";
import {
  LIMITE_FOTO_SERVIDOR, MAX_FOTOS, ROTULO_PENALIDADE, origemFiscalizacao, podeCriarDenuncia, podeEditarDenuncia,
  podeEmitirFiscalizacao, podeRegistrarVistoria, podeTransicionarDenuncia, prazoAteNotificacao, tipoImagem,
} from "./regras";
import type { AutoInfracaoInput, DenunciaPublicaInput, FiscalizacaoInput, NotificacaoInput, PessoaRapidaInput } from "./schemas";
import { z } from "zod";
import type { DenunciaInternaSchema } from "./schemas";

type Tx = Prisma.TransactionClient;
const num = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? null : Number(v.toString()));

async function municipioOu404(id: string) {
  const m = await prisma.municipio.findUnique({ where: { id }, select: { id: true, sigla: true, nome: true, organizacao_id: true, ativo: true } });
  if (!m || !m.ativo) throw invalido("Município inválido.");
  return m;
}

// ───────────────────────── Denúncias ─────────────────────────

/** Denúncia pelo portal público (canal PORTAL, status NOVA). Contato cifrado. */
export async function criarDenunciaPublica(d: DenunciaPublicaInput) {
  const mun = await municipioOu404(d.municipio_id);
  return prisma.$transaction(async (tx) => {
    const protocolo = await numeroDocumento(tx, mun, "DEN");
    const den = await tx.denuncia.create({
      data: {
        organizacao_id: mun.organizacao_id, municipio_id: mun.id, protocolo, canal: "PORTAL", status: "NOVA",
        anonima: d.anonima, denunciante_nome: d.anonima ? null : d.denunciante_nome, contato: !d.anonima && d.contato ? cifrar(d.contato) : null,
        descricao: d.descricao, endereco: d.endereco, latitude: d.latitude ?? null, longitude: d.longitude ?? null,
      },
    });
    await auditar({ usuario_id: null, acao: "CRIAR_DENUNCIA_PUBLICA", entidade: "denuncia", entidade_id: den.id, depois: { protocolo, municipio_id: mun.id, anonima: d.anonima, canal: "PORTAL" } }, tx);
    return { id: den.id, protocolo };
  });
}

/** Denúncia registrada internamente (presencial/telefone/outro). */
export async function criarDenunciaInterna(u: UsuarioSessao, d: z.infer<typeof DenunciaInternaSchema>) {
  if (!podeCriarDenuncia(u, d.municipio_id)) throw proibido();
  const mun = await municipioOu404(d.municipio_id);
  return prisma.$transaction(async (tx) => {
    const protocolo = await numeroDocumento(tx, mun, "DEN");
    const den = await tx.denuncia.create({
      data: {
        organizacao_id: mun.organizacao_id, municipio_id: mun.id, protocolo, canal: d.canal, status: "NOVA", created_by: u.id,
        anonima: d.anonima, denunciante_nome: d.anonima ? null : d.denunciante_nome, contato: !d.anonima && d.contato ? cifrar(d.contato) : null,
        descricao: d.descricao, endereco: d.endereco ?? null, latitude: d.latitude ?? null, longitude: d.longitude ?? null,
      },
    });
    await auditar({ usuario_id: u.id, acao: "CRIAR_DENUNCIA", entidade: "denuncia", entidade_id: den.id, depois: { protocolo, canal: d.canal, municipio_id: mun.id, anonima: d.anonima } }, tx);
    return { id: den.id, protocolo };
  });
}

export async function obterDenuncia(u: UsuarioSessao, id: string) {
  const d = await prisma.denuncia.findUnique({
    where: { id },
    include: { municipio: { select: { nome: true, sigla: true } }, fiscalizacoes: { orderBy: { data_hora: "desc" }, select: { id: true, data_hora: true, constatacao: true, status: true } } },
  });
  if (!d) throw naoEncontrado("Denúncia não encontrada.");
  if (!podeVerMunicipio(u, d.municipio_id)) throw proibido();
  const historico = await prisma.logAuditoria.findMany({
    where: { entidade: "denuncia", entidade_id: id },
    orderBy: { created_at: "asc" },
    include: { usuario: { select: { nome: true } } },
  });
  return {
    ...d,
    latitude: num(d.latitude),
    longitude: num(d.longitude),
    contato: decifrar(d.contato),
    historico: historico.map((h) => ({ id: h.id, acao: h.acao, em: h.created_at, usuario: h.usuario?.nome ?? "Cidadão (portal)", depois: h.depois as Record<string, unknown> | null })),
  };
}

export async function alterarStatusDenuncia(u: UsuarioSessao, id: string, status: StatusDenuncia, despacho: string) {
  const d = await prisma.denuncia.findUnique({ where: { id } });
  if (!d) throw naoEncontrado("Denúncia não encontrada.");
  if (!podeVerMunicipio(u, d.municipio_id) || !podeEditarDenuncia(u, d.municipio_id)) throw proibido();
  if (!podeTransicionarDenuncia(d.status, status)) throw invalido(`Não é possível mudar de ${d.status} para ${status}.`);
  return prisma.$transaction(async (tx) => {
    const r = await tx.denuncia.update({ where: { id }, data: { status } });
    await auditar({ usuario_id: u.id, acao: "ALTERAR_STATUS_DENUNCIA", entidade: "denuncia", entidade_id: id, antes: { status: d.status }, depois: { status, despacho } }, tx);
    return r;
  });
}

export type FiltroDenuncias = { municipio_id?: string | null; status?: StatusDenuncia | null; q?: string | null };

export function whereDenuncias(u: UsuarioSessao, f: FiltroDenuncias): Prisma.DenunciaWhereInput {
  return {
    ...whereMunicipio(u, f.municipio_id),
    ...(f.status ? { status: f.status } : {}),
    ...(f.q ? { OR: [{ protocolo: { contains: f.q, mode: "insensitive" } }, { descricao: { contains: f.q, mode: "insensitive" } }, { endereco: { contains: f.q, mode: "insensitive" } }] } : {}),
  };
}

export async function listarDenuncias(u: UsuarioSessao, f: FiltroDenuncias, pag: { skip: number; take: number }) {
  const where = whereDenuncias(u, f);
  const [total, itens] = await Promise.all([
    prisma.denuncia.count({ where }),
    prisma.denuncia.findMany({
      where, orderBy: { created_at: "desc" }, skip: pag.skip, take: pag.take,
      select: { id: true, protocolo: true, canal: true, status: true, anonima: true, descricao: true, endereco: true, latitude: true, longitude: true, created_at: true, municipio: { select: { nome: true, sigla: true } }, _count: { select: { fiscalizacoes: true } } },
    }),
  ]);
  return { total, itens: itens.map((d) => ({ ...d, latitude: num(d.latitude), longitude: num(d.longitude) })) };
}

// ───────────────────────── Fiscalizações ─────────────────────────

export type FotoUpload = { nome: string; dados: Buffer; latitude?: number | null; longitude?: number | null };

function validarFotos(fotos: FotoUpload[]) {
  if (fotos.length > MAX_FOTOS) throw invalido(`Máximo de ${MAX_FOTOS} fotos por envio.`);
  return fotos.map((f, i) => {
    const mime = tipoImagem(new Uint8Array(f.dados.subarray(0, 16)));
    if (!mime) throw invalido(`Foto ${i + 1}: formato não suportado (use JPEG ou PNG).`);
    const ext = mime === "image/png" ? "png" : "jpg";
    let nome = nomeSeguro(f.nome || `foto-${i + 1}.${ext}`);
    if (!/\.(jpe?g|png)$/i.test(nome)) nome = `${nome.replace(/\.[^.]*$/, "")}.${ext}`;
    const erro = validarUpload(nome, f.dados.length);
    if (erro) throw invalido(`Foto ${i + 1}: ${erro}`);
    if (f.dados.length > LIMITE_FOTO_SERVIDOR) throw invalido(`Foto ${i + 1}: excede ${LIMITE_FOTO_SERVIDOR / 1024 / 1024} MB.`);
    return { ...f, nome, mime };
  });
}

/** Grava fotos no storage (antes da transação) e devolve dados para as linhas de `anexo`. */
async function gravarFotos(sigla: string, fiscalizacaoId: string, fotos: ReturnType<typeof validarFotos>, padrao: { latitude: number | null; longitude: number | null }) {
  const gravadas: { id: string; storage_key: string; nome: string; mime: string; tamanho: number; sha256: string; latitude: number | null; longitude: number | null }[] = [];
  try {
    for (const f of fotos) {
      const id = randomUUID();
      const storage_key = `${sigla}/fiscalizacoes/${fiscalizacaoId}/${id}-${f.nome}`;
      await salvarArquivo(storage_key, f.dados, f.mime);
      gravadas.push({ id, storage_key, nome: f.nome, mime: f.mime, tamanho: f.dados.length, sha256: sha256(f.dados), latitude: f.latitude ?? padrao.latitude, longitude: f.longitude ?? padrao.longitude });
    }
  } catch (e) {
    await Promise.all(gravadas.map((g) => removerArquivo(g.storage_key)));
    throw e;
  }
  return gravadas;
}

/**
 * Registra vistoria (+ fotos). Município derivado da denúncia/processo/empreendimento.
 * Não altera o status do processo (a transição AGUARDANDO_VISTORIA → EM_ANALISE é do módulo de processos);
 * denúncia NOVA passa automaticamente a EM_APURACAO.
 */
export async function criarFiscalizacao(u: UsuarioSessao, d: FiscalizacaoInput, fotosEntrada: FotoUpload[] = []) {
  const [den, proc, emp] = await Promise.all([
    d.denuncia_id ? prisma.denuncia.findUnique({ where: { id: d.denuncia_id }, select: { id: true, municipio_id: true, status: true } }) : null,
    d.processo_id ? prisma.processo.findUnique({ where: { id: d.processo_id }, select: { id: true, municipio_id: true, empreendimento_id: true, status: true } }) : null,
    d.empreendimento_id ? prisma.empreendimento.findUnique({ where: { id: d.empreendimento_id }, select: { id: true, municipio_id: true } }) : null,
  ]);
  if (d.denuncia_id && !den) throw invalido("Denúncia não encontrada.");
  if (d.processo_id && !proc) throw invalido("Processo não encontrado.");
  if (d.empreendimento_id && !emp) throw invalido("Empreendimento não encontrado.");
  const municipios = [den?.municipio_id, proc?.municipio_id, emp?.municipio_id, d.municipio_id].filter(Boolean) as string[];
  if (!municipios.length) throw invalido("Informe o município da vistoria.");
  if (new Set(municipios).size > 1) throw invalido("Denúncia, processo e empreendimento devem ser do mesmo município.");
  const municipioId = municipios[0];
  if (!podeVerMunicipio(u, municipioId) || !podeRegistrarVistoria(u, municipioId)) throw proibido();
  const mun = await municipioOu404(municipioId);

  const fotos = validarFotos(fotosEntrada);
  const id = randomUUID();
  const gravadas = await gravarFotos(mun.sigla, id, fotos, { latitude: d.latitude, longitude: d.longitude });

  const equipe = [{ usuario_id: u.id, nome: u.nome }, ...d.equipe.filter((m) => m.usuario_id !== u.id)];
  try {
    return await prisma.$transaction(async (tx) => {
      const f = await tx.fiscalizacao.create({
        data: {
          id, organizacao_id: mun.organizacao_id, municipio_id: mun.id, origem: origemFiscalizacao(d),
          denuncia_id: den?.id ?? null, processo_id: proc?.id ?? null, empreendimento_id: emp?.id ?? proc?.empreendimento_id ?? null,
          data_hora: d.data_hora, latitude: d.latitude, longitude: d.longitude, precisao_m: d.precisao_m ?? null,
          equipe, relato: d.relato, constatacao: d.constatacao, status: "REALIZADA", created_by: u.id,
        },
      });
      if (gravadas.length) {
        await tx.anexo.createMany({
          data: gravadas.map((g) => ({ id: g.id, fiscalizacao_id: id, tipo: "FOTO", nome_arquivo: g.nome, storage_key: g.storage_key, mime: g.mime, tamanho: g.tamanho, sha256: g.sha256, latitude: g.latitude, longitude: g.longitude, enviado_por: u.id })),
        });
      }
      await auditar({ usuario_id: u.id, acao: "CRIAR_FISCALIZACAO", entidade: "fiscalizacao", entidade_id: id, depois: { ...f, fotos: gravadas.map((g) => ({ id: g.id, sha256: g.sha256 })) } }, tx);
      if (den && den.status === "NOVA") {
        await tx.denuncia.update({ where: { id: den.id }, data: { status: "EM_APURACAO" } });
        await auditar({ usuario_id: u.id, acao: "ALTERAR_STATUS_DENUNCIA", entidade: "denuncia", entidade_id: den.id, antes: { status: "NOVA" }, depois: { status: "EM_APURACAO", despacho: "Vistoria registrada.", fiscalizacao_id: id } }, tx);
      }
      return f;
    });
  } catch (e) {
    await Promise.all(gravadas.map((g) => removerArquivo(g.storage_key)));
    throw e;
  }
}

/** Adiciona fotos a uma vistoria existente. */
export async function adicionarFotos(u: UsuarioSessao, fiscalizacaoId: string, fotosEntrada: FotoUpload[]) {
  const f = await prisma.fiscalizacao.findUnique({ where: { id: fiscalizacaoId }, include: { municipio: { select: { sigla: true } } } });
  if (!f) throw naoEncontrado("Fiscalização não encontrada.");
  if (!podeVerMunicipio(u, f.municipio_id) || !podeRegistrarVistoria(u, f.municipio_id)) throw proibido();
  if (!fotosEntrada.length) throw invalido("Nenhuma foto enviada.");
  const gravadas = await gravarFotos(f.municipio.sigla, f.id, validarFotos(fotosEntrada), { latitude: num(f.latitude), longitude: num(f.longitude) });
  try {
    await prisma.$transaction(async (tx) => {
      await tx.anexo.createMany({ data: gravadas.map((g) => ({ id: g.id, fiscalizacao_id: f.id, tipo: "FOTO", nome_arquivo: g.nome, storage_key: g.storage_key, mime: g.mime, tamanho: g.tamanho, sha256: g.sha256, latitude: g.latitude, longitude: g.longitude, enviado_por: u.id })) });
      await auditar({ usuario_id: u.id, acao: "ADICIONAR_FOTOS", entidade: "fiscalizacao", entidade_id: f.id, depois: { fotos: gravadas.map((g) => ({ id: g.id, sha256: g.sha256 })) } }, tx);
    });
  } catch (e) {
    await Promise.all(gravadas.map((g) => removerArquivo(g.storage_key)));
    throw e;
  }
  return gravadas.map((g) => ({ id: g.id, nome: g.nome, sha256: g.sha256 }));
}

export async function obterFiscalizacao(u: UsuarioSessao, id: string) {
  const f = await prisma.fiscalizacao.findUnique({
    where: { id },
    include: {
      municipio: { select: { id: true, nome: true, sigla: true } },
      denuncia: { select: { id: true, protocolo: true, status: true, descricao: true } },
      processo: { select: { id: true, numero: true, status: true } },
      empreendimento: { select: { id: true, nome: true, requerente_id: true } },
      anexos: { where: { tipo: "FOTO" }, orderBy: { created_at: "asc" }, select: { id: true, nome_arquivo: true, tamanho: true, sha256: true, latitude: true, longitude: true, created_at: true } },
      autos: { orderBy: { created_at: "desc" }, include: { autuado: { select: { nome: true, cpf_cnpj_mascara: true } } } },
      notificacoes: { orderBy: { created_at: "desc" }, include: { notificado: { select: { nome: true, cpf_cnpj_mascara: true } } } },
    },
  });
  if (!f) throw naoEncontrado("Fiscalização não encontrada.");
  if (!podeVerMunicipio(u, f.municipio_id)) throw proibido();
  return {
    ...f,
    latitude: num(f.latitude), longitude: num(f.longitude), precisao_m: num(f.precisao_m),
    equipe: (Array.isArray(f.equipe) ? f.equipe : []) as { usuario_id?: string | null; nome: string }[],
    anexos: f.anexos.map((a) => ({ ...a, latitude: num(a.latitude), longitude: num(a.longitude) })),
    autos: f.autos.map((a) => ({ ...a, valor_multa: num(a.valor_multa) })),
  };
}

export type FiltroFiscalizacoes = { municipio_id?: string | null; constatacao?: "IRREGULAR" | "REGULAR" | "INCONCLUSIVA" | null; origem?: "DENUNCIA" | "PROCESSO" | "ROTINA" | null; q?: string | null };

export function whereFiscalizacoes(u: UsuarioSessao, f: FiltroFiscalizacoes): Prisma.FiscalizacaoWhereInput {
  return {
    ...whereMunicipio(u, f.municipio_id),
    ...(f.constatacao ? { constatacao: f.constatacao } : {}),
    ...(f.origem ? { origem: f.origem } : {}),
    ...(f.q ? { OR: [{ relato: { contains: f.q, mode: "insensitive" } }, { empreendimento: { nome: { contains: f.q, mode: "insensitive" } } }, { denuncia: { protocolo: { contains: f.q, mode: "insensitive" } } }] } : {}),
  };
}

export async function listarFiscalizacoes(u: UsuarioSessao, f: FiltroFiscalizacoes, pag: { skip: number; take: number }) {
  const where = whereFiscalizacoes(u, f);
  const [total, itens] = await Promise.all([
    prisma.fiscalizacao.count({ where }),
    prisma.fiscalizacao.findMany({
      where, orderBy: { data_hora: "desc" }, skip: pag.skip, take: pag.take,
      select: {
        id: true, origem: true, data_hora: true, latitude: true, longitude: true, precisao_m: true, constatacao: true, status: true, relato: true,
        municipio: { select: { nome: true, sigla: true } }, denuncia: { select: { id: true, protocolo: true } }, processo: { select: { id: true, numero: true } }, empreendimento: { select: { id: true, nome: true } },
        _count: { select: { anexos: true, autos: true, notificacoes: true } },
      },
    }),
  ]);
  return { total, itens: itens.map((x) => ({ ...x, latitude: num(x.latitude), longitude: num(x.longitude), precisao_m: num(x.precisao_m) })) };
}

// ───────────────────────── Pessoa (autuado/notificado) ─────────────────────────

async function resolverPessoa(tx: Tx, u: UsuarioSessao, ref: { pessoa_id?: string | null; nova_pessoa?: PessoaRapidaInput | null }, mun: { id: string; organizacao_id: string }) {
  if (ref.pessoa_id) {
    const p = await tx.pessoa.findUnique({ where: { id: ref.pessoa_id }, select: { id: true } });
    if (!p) throw invalido("Pessoa não encontrada.");
    return p.id;
  }
  const n = ref.nova_pessoa!;
  const doc = somenteDigitos(n.cpf_cnpj);
  const h = hashBusca(doc);
  const existe = await tx.pessoa.findUnique({ where: { cpf_cnpj_hash: h }, select: { id: true } });
  if (existe) return existe.id;
  const pf = n.tipo === "PF";
  const p = await tx.pessoa.create({
    data: {
      organizacao_id: mun.organizacao_id, municipio_id: mun.id, tipo: n.tipo, nome: n.nome,
      cpf_cnpj_cifrado: cifrar(doc), cpf_cnpj_hash: h, cpf_cnpj_mascara: mascararCpfCnpj(doc),
      email: n.email ? (pf ? cifrar(n.email) : n.email) : null, telefone: n.telefone ? (pf ? cifrar(n.telefone) : n.telefone) : null,
      endereco: n.logradouro ? { logradouro: n.logradouro } : undefined, created_by: u.id,
    },
  });
  await auditar({ usuario_id: u.id, acao: "CRIAR_PESSOA", entidade: "pessoa", entidade_id: p.id, depois: { tipo: p.tipo, nome: p.nome, cpf_cnpj_mascara: p.cpf_cnpj_mascara, origem: "fiscalizacao" } }, tx);
  return p.id;
}

/** Busca pessoas por nome (no escopo) ou CPF/CNPJ exato (via hash). */
export async function buscarPessoas(u: UsuarioSessao, q: string) {
  const termo = q.trim();
  if (termo.length < 3) return [];
  const digitos = somenteDigitos(termo);
  const porDoc = digitos.length === 11 || digitos.length === 14;
  const escopo = whereMunicipio(u);
  const itens = await prisma.pessoa.findMany({
    where: porDoc ? { cpf_cnpj_hash: hashBusca(digitos) } : { nome: { contains: termo, mode: "insensitive" }, OR: [escopo, { municipio_id: null }] },
    take: 10, orderBy: { nome: "asc" },
    select: { id: true, nome: true, tipo: true, cpf_cnpj_mascara: true },
  });
  return itens;
}

// ───────────────────────── Autos de infração ─────────────────────────

async function fiscalizacaoParaEmitir(u: UsuarioSessao, id: string) {
  const f = await prisma.fiscalizacao.findUnique({ where: { id }, select: { id: true, municipio_id: true, processo_id: true } });
  if (!f) throw invalido("Fiscalização não encontrada.");
  if (!podeVerMunicipio(u, f.municipio_id) || !podeEmitirFiscalizacao(u, f.municipio_id)) throw proibido();
  return { f, mun: await municipioOu404(f.municipio_id) };
}

export async function criarAutoInfracao(u: UsuarioSessao, d: AutoInfracaoInput) {
  const { f, mun } = await fiscalizacaoParaEmitir(u, d.fiscalizacao_id);
  const auto = await prisma.$transaction(async (tx) => {
    const autuado_id = await resolverPessoa(tx, u, d.autuado, mun);
    const numero = await numeroDocumento(tx, mun, "AI");
    const a = await tx.autoInfracao.create({
      data: {
        municipio_id: mun.id, fiscalizacao_id: f.id, numero, autuado_id, enquadramento_legal: d.enquadramento_legal, descricao_infracao: d.descricao_infracao,
        penalidade: d.penalidade, valor_multa: d.valor_multa ?? null, prazo_defesa_dias: d.prazo_defesa_dias, status: "LAVRADO", created_by: u.id,
      },
    });
    await auditar({ usuario_id: u.id, acao: "CRIAR_AUTO_INFRACAO", entidade: "auto_infracao", entidade_id: a.id, depois: a }, tx);
    return a;
  });
  const pdf = await emitirPdfAuto(u, auto.id);
  return { auto, ...pdf };
}

async function dadosFiscalizacaoDoc(fiscalizacaoId: string) {
  const f = await prisma.fiscalizacao.findUniqueOrThrow({
    where: { id: fiscalizacaoId },
    select: { id: true, data_hora: true, latitude: true, longitude: true, precisao_m: true, relato: true, constatacao: true, equipe: true, empreendimento: { select: { nome: true } }, denuncia: { select: { protocolo: true } }, _count: { select: { anexos: { where: { tipo: "FOTO" } } } } },
  });
  return {
    fiscalizacao_data_hora: f.data_hora.toISOString(),
    coordenadas: f.latitude != null && f.longitude != null ? { latitude: num(f.latitude), longitude: num(f.longitude), precisao_m: num(f.precisao_m) } : null,
    fotos: f._count.anexos,
    relato: f.relato,
    constatacao: f.constatacao,
    equipe: f.equipe,
    empreendimento: f.empreendimento?.nome ?? null,
    denuncia_protocolo: f.denuncia?.protocolo ?? null,
  };
}

function dadosPessoaDoc(p: { nome: string; tipo: string; cpf_cnpj_cifrado: string; cpf_cnpj_mascara: string; endereco: unknown }) {
  const doc = decifrar(p.cpf_cnpj_cifrado) ?? "";
  return { nome: p.nome, tipo: p.tipo, documento: formatarCpfCnpj(doc), documento_mascarado: p.cpf_cnpj_mascara, endereco: p.endereco ?? null };
}

/** Emite (ou reemite, se ainda não houver) o PDF do auto via lib/documentos. Falha não desfaz o auto. */
export async function emitirPdfAuto(u: UsuarioSessao, autoId: string): Promise<{ documento_id: string | null; erro_pdf: string | null }> {
  const a = await prisma.autoInfracao.findUnique({ where: { id: autoId }, include: { autuado: true } });
  if (!a) throw naoEncontrado("Auto de infração não encontrado.");
  if (!podeVerMunicipio(u, a.municipio_id) || !podeEmitirFiscalizacao(u, a.municipio_id)) throw proibido();
  if (a.documento_id) return { documento_id: a.documento_id, erro_pdf: null };
  try {
    const doc = await emitirDocumento({
      tipo: "AUTO_INFRACAO", numero: a.numero, municipio_id: a.municipio_id, fiscalizacao_id: a.fiscalizacao_id, titular_id: a.autuado_id, usuario: u,
      dados: {
        auto_infracao_id: a.id, numero: a.numero, autuado: dadosPessoaDoc(a.autuado), enquadramento_legal: a.enquadramento_legal, descricao_infracao: a.descricao_infracao,
        penalidade: a.penalidade, penalidade_rotulo: ROTULO_PENALIDADE[a.penalidade], valor_multa: num(a.valor_multa), prazo_defesa_dias: a.prazo_defesa_dias, status: a.status,
        ...(await dadosFiscalizacaoDoc(a.fiscalizacao_id)),
      },
    });
    await prisma.$transaction(async (tx) => {
      await tx.autoInfracao.update({ where: { id: a.id }, data: { documento_id: doc.id } });
      await auditar({ usuario_id: u.id, acao: "VINCULAR_DOCUMENTO", entidade: "auto_infracao", entidade_id: a.id, antes: { documento_id: null }, depois: { documento_id: doc.id } }, tx);
    });
    return { documento_id: doc.id, erro_pdf: null };
  } catch (e) {
    console.error("[fiscalizacao] falha ao emitir PDF do auto", a.numero, e);
    return { documento_id: null, erro_pdf: e instanceof Error ? e.message : String(e) };
  }
}

export type FiltroAutos = { municipio_id?: string | null; status?: string | null; penalidade?: string | null };

export async function listarAutos(u: UsuarioSessao, f: FiltroAutos, pag: { skip: number; take: number }) {
  const where: Prisma.AutoInfracaoWhereInput = { ...whereMunicipio(u, f.municipio_id), ...(f.status ? { status: f.status as never } : {}), ...(f.penalidade ? { penalidade: f.penalidade as never } : {}) };
  const [total, soma, itens] = await Promise.all([
    prisma.autoInfracao.count({ where }),
    prisma.autoInfracao.aggregate({ where: { ...where, status: f.status ? (f.status as never) : { not: "CANCELADO" } }, _sum: { valor_multa: true } }),
    prisma.autoInfracao.findMany({
      where, orderBy: { created_at: "desc" }, skip: pag.skip, take: pag.take,
      include: { autuado: { select: { nome: true, cpf_cnpj_mascara: true } }, fiscalizacao: { select: { id: true, municipio: { select: { nome: true, sigla: true } } } } },
    }),
  ]);
  return { total, valor_total_multas: num(soma._sum.valor_multa) ?? 0, itens: itens.map((a) => ({ ...a, valor_multa: num(a.valor_multa) })) };
}

export async function obterAuto(u: UsuarioSessao, id: string) {
  const a = await prisma.autoInfracao.findUnique({ where: { id }, include: { autuado: { select: { id: true, nome: true, tipo: true, cpf_cnpj_mascara: true } } } });
  if (!a) throw naoEncontrado("Auto de infração não encontrado.");
  if (!podeVerMunicipio(u, a.municipio_id)) throw proibido();
  return { ...a, valor_multa: num(a.valor_multa) };
}

// ───────────────────────── Notificações ─────────────────────────

export async function criarNotificacao(u: UsuarioSessao, d: NotificacaoInput) {
  let municipioId: string;
  let fiscalizacaoId: string | null = null;
  let processoId: string | null = d.processo_id ?? null;
  if (d.fiscalizacao_id) {
    const { f } = await fiscalizacaoParaEmitir(u, d.fiscalizacao_id);
    municipioId = f.municipio_id;
    fiscalizacaoId = f.id;
    processoId = processoId ?? f.processo_id;
  } else {
    const p = await prisma.processo.findUnique({ where: { id: d.processo_id! }, select: { municipio_id: true } });
    if (!p) throw invalido("Processo não encontrado.");
    municipioId = p.municipio_id;
  }
  if (!podeVerMunicipio(u, municipioId) || !podeEmitirFiscalizacao(u, municipioId)) throw proibido();
  const mun = await municipioOu404(municipioId);
  const notificacao = await prisma.$transaction(async (tx) => {
    const notificado_id = await resolverPessoa(tx, u, d.notificado, mun);
    const numero = await numeroDocumento(tx, mun, "NOT");
    const n = await tx.notificacao.create({
      data: { municipio_id: mun.id, fiscalizacao_id: fiscalizacaoId, processo_id: processoId, numero, notificado_id, exigencia: d.exigencia, prazo_dias: d.prazo_dias, prazo_ate: prazoAteNotificacao(d.prazo_dias), status: "EMITIDA", created_by: u.id },
    });
    await auditar({ usuario_id: u.id, acao: "CRIAR_NOTIFICACAO", entidade: "notificacao", entidade_id: n.id, depois: n }, tx);
    return n;
  });
  const pdf = await emitirPdfNotificacao(u, notificacao.id);
  return { notificacao, ...pdf };
}

export async function emitirPdfNotificacao(u: UsuarioSessao, id: string): Promise<{ documento_id: string | null; erro_pdf: string | null }> {
  const n = await prisma.notificacao.findUnique({ where: { id }, include: { notificado: true, processo: { select: { numero: true } } } });
  if (!n) throw naoEncontrado("Notificação não encontrada.");
  if (!podeVerMunicipio(u, n.municipio_id) || !podeEmitirFiscalizacao(u, n.municipio_id)) throw proibido();
  if (n.documento_id) return { documento_id: n.documento_id, erro_pdf: null };
  try {
    const doc = await emitirDocumento({
      tipo: "NOTIFICACAO", numero: n.numero, municipio_id: n.municipio_id, fiscalizacao_id: n.fiscalizacao_id, processo_id: n.processo_id, titular_id: n.notificado_id, usuario: u,
      dados: {
        notificacao_id: n.id, numero: n.numero, notificado: dadosPessoaDoc(n.notificado), exigencia: n.exigencia, prazo_dias: n.prazo_dias, prazo_ate: n.prazo_ate.toISOString(), status: n.status,
        processo_numero: n.processo?.numero ?? null,
        ...(n.fiscalizacao_id ? await dadosFiscalizacaoDoc(n.fiscalizacao_id) : {}),
      },
    });
    await prisma.$transaction(async (tx) => {
      await tx.notificacao.update({ where: { id: n.id }, data: { documento_id: doc.id } });
      await auditar({ usuario_id: u.id, acao: "VINCULAR_DOCUMENTO", entidade: "notificacao", entidade_id: n.id, antes: { documento_id: null }, depois: { documento_id: doc.id } }, tx);
    });
    return { documento_id: doc.id, erro_pdf: null };
  } catch (e) {
    console.error("[fiscalizacao] falha ao emitir PDF da notificação", n.numero, e);
    return { documento_id: null, erro_pdf: e instanceof Error ? e.message : String(e) };
  }
}

export type FiltroNotificacoes = { municipio_id?: string | null; status?: string | null };

export async function listarNotificacoes(u: UsuarioSessao, f: FiltroNotificacoes, pag: { skip: number; take: number }) {
  const where: Prisma.NotificacaoWhereInput = { ...whereMunicipio(u, f.municipio_id), ...(f.status ? { status: f.status as never } : {}) };
  const [total, itens] = await Promise.all([
    prisma.notificacao.count({ where }),
    prisma.notificacao.findMany({
      where, orderBy: { created_at: "desc" }, skip: pag.skip, take: pag.take,
      include: { notificado: { select: { nome: true, cpf_cnpj_mascara: true } }, processo: { select: { id: true, numero: true } }, fiscalizacao: { select: { id: true } } },
    }),
  ]);
  return { total, itens };
}

export async function obterNotificacao(u: UsuarioSessao, id: string) {
  const n = await prisma.notificacao.findUnique({ where: { id }, include: { notificado: { select: { id: true, nome: true, tipo: true, cpf_cnpj_mascara: true } } } });
  if (!n) throw naoEncontrado("Notificação não encontrada.");
  if (!podeVerMunicipio(u, n.municipio_id)) throw proibido();
  return n;
}

// ───────────────────────── Apoio (formulários) ─────────────────────────

/** Municípios em que o usuário pode registrar (ou ver) – para selects. */
export async function municipiosDoUsuario(u: UsuarioSessao) {
  return prisma.municipio.findMany({ where: { ativo: true, id: whereMunicipio(u).municipio_id }, orderBy: { nome: "asc" }, select: { id: true, nome: true, sigla: true, latitude: true, longitude: true } })
    .then((l) => l.map((m) => ({ ...m, latitude: num(m.latitude), longitude: num(m.longitude) })));
}

/** Usuários internos que podem compor a equipe (papéis no município ou escopo organização). */
export async function equipeDisponivel(municipioId: string) {
  const us = await prisma.usuario.findMany({
    // Só usuários da organização do município (isolamento por cliente).
    where: { ativo: true, organizacao: { municipios: { some: { id: municipioId } } }, papeis: { some: { OR: [{ municipio_id: municipioId, papel: { in: ["FISCAL", "TEC_MUNICIPAL", "GESTOR_MUNICIPAL"] } }, { municipio_id: null, papel: "TEC_CONSORCIO" }] } } },
    orderBy: { nome: "asc" }, select: { id: true, nome: true, cargo: true },
  });
  return us;
}

export async function buscarEmpreendimentos(u: UsuarioSessao, q: string, municipioId?: string | null) {
  if (q.trim().length < 2) return [];
  return prisma.empreendimento.findMany({
    where: { ...whereMunicipio(u, municipioId), nome: { contains: q.trim(), mode: "insensitive" } },
    take: 10, orderBy: { nome: "asc" },
    select: { id: true, nome: true, municipio_id: true, latitude: true, longitude: true, municipio: { select: { sigla: true } }, requerente: { select: { id: true, nome: true, cpf_cnpj_mascara: true, tipo: true } } },
  }).then((l) => l.map((e) => ({ ...e, latitude: num(e.latitude), longitude: num(e.longitude) })));
}
