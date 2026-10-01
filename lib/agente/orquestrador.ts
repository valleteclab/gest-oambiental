import "server-only";
import { randomUUID } from "node:crypto";
import type { Conversa, EstadoConversa, MensagemConversa } from "@prisma/client";
import { prisma } from "../db";
import { decifrar, sha256 } from "../crypto";
import { hashContato } from "../canais/contato";
import { nomeSeguro, salvarUpload } from "../storage";
import { ErroApi } from "../http";
import { tipoImagem } from "../fiscalizacao/regras";
import { criarDenunciaCanal } from "../fiscalizacao/servico";
import { fmtData } from "../format";
import { urlBase } from "../canais";
import type { CanalRuntime, InboundEvent } from "../canais/tipos";
import { consentimentoAnterior, dadosDe, jsonDados } from "./conversas";
import { enviarRespostas } from "./envio";
import { decidir, proximoCampo, type Decisao } from "./maquina";
import { ehEmergencia, interpretarTexto, protocoloNoTexto, resolverBotao } from "./interpretar";
import { entenderMensagem, iaHabilitada, redigirResposta, transcreverAudio, type HistoricoItem } from "./llm";
import { podeConsultarProtocolo, excedeuLimiteContato, LIMITE_MENSAGENS } from "./privacidade";
import { canalDaDenuncia, textoDenuncia } from "./registro";
import * as T from "./textos";
import { MAX_FOTOS_CONVERSA, type DadosColetados, type Extracao, type FotoColetada } from "./tipos";

// Orquestrador: recebe UMA mensagem normalizada (já deduplicada e serializada por chat) e conduz a conversa.

const ROTULOS_BOTOES = Object.fromEntries(Object.values(T.B).map((b) => [b.id, b.rotulo]));
export const PAUSA_HUMANO_MS = 3 * 3600 * 1000;

export const urlsPublicas = () => ({ privacidade: `${urlBase()}/privacidade`, acompanhar: `${urlBase()}/denuncia/acompanhar` });

type Conv = Conversa;

/** Grava mídia recebida no storage: {sigla}/conversas/{conversa}/{uuid}-{nome} (passa pelo antivírus opcional). */
async function gravarMidia(conv: Conv, sigla: string, dados: Buffer, mime: string, nome: string) {
  const id = randomUUID();
  const key = `${sigla}/conversas/${conv.id}/${id}-${nomeSeguro(nome)}`;
  await salvarUpload(key, dados, mime, { nome, contexto: "midia_conversa", entidade_id: conv.id });
  return { key, sha: sha256(dados) };
}

async function siglaDe(conv: Conv, canal: CanalRuntime) {
  const munId = conv.municipio_id ?? canal.municipio_id;
  if (munId) {
    const m = await prisma.municipio.findUnique({ where: { id: munId }, select: { sigla: true } });
    if (m) return m.sigla;
  }
  const o = await prisma.organizacao.findUnique({ where: { id: canal.organizacao_id }, select: { sigla: true } });
  return nomeSeguro(o?.sigla ?? "ORG");
}

export type ResultadoProcessamento = "PROCESSADA" | "DUPLICADA" | "IGNORADA" | "HUMANO" | "LIMITE";

/** Mensagem do cidadão já gravada (IN) → mídia, transcrição, interpretação, máquina de estados, ações, respostas. */
export async function processarMensagemCidadao(canal: CanalRuntime, convInicial: Conv, msg: MensagemConversa, ev: InboundEvent): Promise<ResultadoProcessamento> {
  let conv = convInicial;
  const agora = new Date();
  const sigla = await siglaDe(conv, canal);
  let dados = dadosDe(conv);
  let texto = (ev.text ?? "").trim();
  let foto: FotoColetada | null = null;
  const imagensIa: { mime: string; dados: Buffer }[] = [];
  const extras: T.Resposta[] = [];

  // ── Mídia: baixa imediatamente (URLs expiram) e grava no storage ──
  if (ev.media && (ev.kind === "image" || ev.kind === "audio" || ev.kind === "document")) {
    try {
      const m = await ev.media.fetch();
      if (m.dados.length > 16 * 1024 * 1024) throw new Error("Arquivo muito grande.");
      if (ev.kind === "image") {
        const mime = tipoImagem(new Uint8Array(m.dados.subarray(0, 16)));
        if (!mime) extras.push({ texto: "📷 Não consegui abrir essa imagem. Envie a foto em JPG ou PNG, por favor." });
        else if ((dados.fotos?.length ?? 0) >= MAX_FOTOS_CONVERSA) extras.push(T.limiteFotos());
        else {
          const nome = `foto-${(dados.fotos?.length ?? 0) + 1}.${mime === "image/png" ? "png" : "jpg"}`;
          const g = await gravarMidia(conv, sigla, m.dados, mime, nome);
          await prisma.mensagemConversa.update({ where: { id: msg.id }, data: { midia_key: g.key, midia_mime: mime } });
          foto = { key: g.key, mime, nome, tamanho: m.dados.length, sha256: g.sha };
          imagensIa.push({ mime, dados: m.dados });
        }
      } else if (ev.kind === "audio") {
        const mime = (m.mime || "audio/ogg").split(";")[0];
        const g = await gravarMidia(conv, sigla, m.dados, mime, `audio.${mime.includes("mpeg") ? "mp3" : "ogg"}`);
        const transcricao = await transcreverAudio({ organizacao_id: canal.organizacao_id, conversa_id: conv.id }, { dados: m.dados, mime });
        await prisma.mensagemConversa.update({ where: { id: msg.id }, data: { midia_key: g.key, midia_mime: mime, texto: transcricao ? `🎙️ ${transcricao}` : null } });
        if (transcricao) texto = transcricao;
        else {
          await enviarRespostas(canal, conv, [T.audioSemTranscricao()], "IA");
          return "PROCESSADA";
        }
      } else if (ev.kind === "document" && (m.mime === "application/pdf" || ev.media.mime === "application/pdf")) {
        const g = await gravarMidia(conv, sigla, m.dados, "application/pdf", ev.media.nome || "documento.pdf");
        await prisma.mensagemConversa.update({ where: { id: msg.id }, data: { midia_key: g.key, midia_mime: "application/pdf" } });
      }
    } catch (e) {
      console.error(`[agente] mídia conversa ${conv.id}:`, (e as Error).message);
      extras.push({ texto: e instanceof ErroApi && e.code === "ARQUIVO_INFECTADO" ? "O arquivo enviado foi recusado pela verificação de segurança (antivírus). Envie outro arquivo, por favor." : "Não consegui baixar o arquivo enviado. 😕 Pode tentar de novo?" });
    }
  }

  // ── Avaliação (1 a 5) pedida na notificação de conclusão ──
  if (/^[1-5]$/.test(texto) && (conv.estado === "INICIO" || conv.estado === "REGISTRADA")) {
    const pend = await prisma.conversa.findFirst({ where: { canal_id: canal.id, chat_hash: conv.chat_hash, dados_coletados: { path: ["avaliacao_pendente"], equals: true }, updated_at: { gte: new Date(Date.now() - 7 * 86400000) } }, orderBy: { updated_at: "desc" } });
    if (pend) {
      const n = Number(texto);
      await prisma.conversa.update({ where: { id: pend.id }, data: { dados_coletados: jsonDados({ ...dadosDe(pend), avaliacao_pendente: false, avaliacao: n }) } });
      if (pend.id !== conv.id && conv.estado === "INICIO") await prisma.conversa.update({ where: { id: conv.id }, data: { estado: "ENCERRADA" } });
      await enviarRespostas(canal, conv, [T.avaliacaoObrigado(n)], "IA");
      return "PROCESSADA";
    }
  }

  // ── Município / municípios possíveis (canal da organização) ──
  const municipiosOrg = canal.municipio_id ? [] : await prisma.municipio.findMany({ where: { organizacao_id: canal.organizacao_id, ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true } });
  const munId = conv.municipio_id ?? canal.municipio_id ?? dados.municipio_id ?? (municipiosOrg.length === 1 ? municipiosOrg[0].id : null);
  const municipioNome = munId ? (await prisma.municipio.findUnique({ where: { id: munId }, select: { nome: true } }))?.nome ?? null : null;
  const municipios = canal.municipio_id ? [] : municipiosOrg;

  // ── Interpretação: botão → regras determinísticas → IA (se houver chave e o texto for livre) ──
  const botao = ev.buttonId ?? resolverBotao(texto, dados, ROTULOS_BOTOES);
  let extracao: Extracao = {};
  if (texto && !botao) {
    const det = interpretarTexto(texto, dados, { municipios });
    const resolvido = Object.values(det).some((v) => v !== undefined && v !== null && v !== false);
    const coletando = conv.estado === "COLETANDO" || conv.estado === "CONFIRMANDO";
    if (iaHabilitada() && coletando && (!resolvido || dados.perguntou === "descricao" || dados.perguntou === "tipo_ocorrencia" || dados.perguntou === "localizacao")) {
      const r = await entenderMensagem({ organizacao_id: canal.organizacao_id, conversa_id: conv.id, municipio: municipioNome, estado: conv.estado, perguntou: dados.perguntou, dados, historico: await historico(conv.id), texto, imagens: imagensIa });
      if (r?.suspeita) console.warn(`[agente] possível prompt injection na conversa ${conv.id}`);
      extracao = r ? { ...det, ...r.extracao } : det;
      // quem decide "confirmar" é o estado; resposta numérica de menus segue a regra determinística
      if (det.municipio_indice != null) extracao.municipio_indice = det.municipio_indice;
    } else extracao = det;
  } else if (foto && iaHabilitada() && (conv.estado === "COLETANDO" || conv.estado === "CONFIRMANDO")) {
    const r = await entenderMensagem({ organizacao_id: canal.organizacao_id, conversa_id: conv.id, municipio: municipioNome, estado: conv.estado, perguntou: dados.perguntou, dados, historico: [], texto: texto || "(foto enviada)", imagens: imagensIa });
    if (r?.extracao.descricao_imagem) foto.descricao_ia = r.extracao.descricao_imagem.slice(0, 600);
    if (r?.extracao.tipo_ocorrencia && !dados.tipo_ocorrencia) extracao.tipo_ocorrencia = r.extracao.tipo_ocorrencia;
  }
  if (texto && ehEmergencia(texto)) extracao.emergencia = true;
  const prot = texto ? protocoloNoTexto(texto) : null;
  if (prot) extracao.quer_consultar_protocolo = prot;
  if (foto && extracao.descricao_imagem) foto.descricao_ia = extracao.descricao_imagem.slice(0, 600);

  const consentPrevio = conv.estado === "INICIO" ? await consentimentoAnterior(canal.id, conv.contato_hash) : null;
  let protocolo: string | null = null;
  if (conv.estado === "REGISTRADA" && conv.denuncia_id) protocolo = (await prisma.denuncia.findUnique({ where: { id: conv.denuncia_id }, select: { protocolo: true } }))?.protocolo ?? null;

  const dec: Decisao = decidir({
    estado: conv.estado, dados, extracao, municipioNome, municipios, webchat: canal.tipo === "WEBCHAT", consentimentoPrevio: !!consentPrevio,
    entrada: { kind: ev.kind, texto: texto || null, botao, location: ev.location ?? null, foto }, urls: urlsPublicas(), protocolo,
  });
  const respostas: (T.Resposta & { redigir?: string | null })[] = [...extras, ...dec.respostas];
  dados = dec.dados;
  let estado: EstadoConversa = dec.estado;
  const upd: { lgpd_consentimento_em?: Date; municipio_id?: string | null; contato_hash?: string | null; denuncia_id?: string } = {};
  if (dados.municipio_id && !conv.municipio_id) upd.municipio_id = dados.municipio_id;
  if (dados.contato_informado && !conv.contato_hash) upd.contato_hash = hashContato(dados.contato_informado);

  for (const acao of dec.acoes) {
    if (acao === "CONSENTIR") upd.lgpd_consentimento_em = agora;
    if (acao === "REGISTRAR") {
      const faltando = proximoCampo(dados, { precisaMunicipio: municipios.length > 1, webchat: canal.tipo === "WEBCHAT" });
      const municipioFinal = conv.municipio_id ?? canal.municipio_id ?? dados.municipio_id ?? (municipiosOrg.length === 1 ? municipiosOrg[0].id : null);
      if (faltando || !municipioFinal) {
        estado = "COLETANDO";
        respostas.push({ ...T.perguntaCampo(faltando ?? "municipio", dados), redigir: null });
        dados = { ...dados, perguntou: faltando ?? "municipio" };
        continue;
      }
      const { descricao, endereco } = textoDenuncia(dados, canal.tipo);
      const contato = decifrar(conv.contato_cifrado) ?? dados.contato_informado ?? null;
      const den = await criarDenunciaCanal({
        municipio_id: municipioFinal, canal: canalDaDenuncia(canal.tipo), descricao, endereco,
        latitude: dados.latitude ?? null, longitude: dados.longitude ?? null, anonima: dados.anonima !== false,
        denunciante_nome: dados.anonima === false ? dados.nome ?? conv.nome ?? null : null,
        contato, contato_hash: upd.contato_hash ?? conv.contato_hash ?? hashContato(dados.contato_informado),
        conversa_id: conv.id, fotos: (dados.fotos ?? []).map((f) => ({ storage_key: f.key, nome: f.nome, mime: f.mime, tamanho: f.tamanho, sha256: f.sha256 })),
      });
      protocolo = den.protocolo;
      upd.denuncia_id = den.id;
      estado = "REGISTRADA";
      dados = { ...dados, perguntou: "nova", botoes: [] };
      respostas.push(T.registrada(den.protocolo, `${urlsPublicas().acompanhar}?protocolo=${encodeURIComponent(den.protocolo)}`));
    }
    if (acao === "ENCERRAR") estado = "ENCERRADA";
  }

  // ── Consulta de protocolo: SOMENTE do mesmo contato ──
  if (dec.consultarProtocolo) {
    const d = await prisma.denuncia.findUnique({ where: { protocolo: dec.consultarProtocolo }, select: { protocolo: true, status: true, created_at: true, contato_hash: true, organizacao_id: true } });
    const hashConv = upd.contato_hash ?? conv.contato_hash;
    if (d && d.organizacao_id === canal.organizacao_id && podeConsultarProtocolo(d.contato_hash, hashConv)) respostas.push(T.statusProtocolo(d.protocolo, T.ROTULO_STATUS_CIDADAO[d.status], fmtData(d.created_at)));
    else respostas.push(T.protocoloNaoEncontrado(urlsPublicas().acompanhar));
    if (conv.estado === "COLETANDO" && dados.perguntou && dados.perguntou !== "correcao" && dados.perguntou !== "confirmacao" && dados.perguntou !== "nova" && dados.perguntou !== "lgpd") {
      respostas.push({ texto: "Continuando a denúncia:" }, { ...T.perguntaCampo(dados.perguntou, dados, { webchat: canal.tipo === "WEBCHAT" }) });
    }
  }

  // ── IA redige a pergunta do próximo campo (texto determinístico se falhar) ──
  if (iaHabilitada() && texto) {
    for (const r of respostas) {
      if (!r.redigir) continue;
      const t = await redigirResposta({ organizacao_id: canal.organizacao_id, conversa_id: conv.id, municipio: municipioNome, campo: r.redigir as Parameters<typeof redigirResposta>[0]["campo"], dados, ultimaMensagem: texto, padrao: r.texto });
      if (t) r.texto = t;
    }
  }

  conv = await prisma.conversa.update({ where: { id: conv.id }, data: { ...upd, estado, dados_coletados: jsonDados(dados), ultima_msg_em: agora } });
  await enviarRespostas(canal, conv, respostas, "IA");

  if (dec.acoes.includes("NOVA_CONVERSA")) await iniciarNovaConversa(canal, conv);
  return "PROCESSADA";
}

/** "Nova denúncia" depois de registrada: encerra esta conversa e abre outra (mesmo chat, consentimento mantido). */
async function iniciarNovaConversa(canal: CanalRuntime, antiga: Conv) {
  const d = dadosDe(antiga);
  await prisma.conversa.update({ where: { id: antiga.id }, data: { estado: "ENCERRADA" } });
  const nova = await prisma.conversa.create({
    data: {
      canal_id: canal.id, organizacao_id: antiga.organizacao_id, municipio_id: antiga.municipio_id, chat_hash: antiga.chat_hash,
      destino_cifrado: antiga.destino_cifrado, contato_hash: antiga.contato_hash, contato_cifrado: antiga.contato_cifrado, nome: antiga.nome,
      estado: "COLETANDO", lgpd_consentimento_em: antiga.lgpd_consentimento_em ?? new Date(), ultima_msg_cidadao_em: antiga.ultima_msg_cidadao_em,
      dados_coletados: jsonDados({ municipio_id: d.municipio_id ?? null, assunto_email: d.assunto_email ?? null, contato_informado: d.contato_informado ?? null, contato_pulado: d.contato_pulado }),
    },
  });
  const dados: DadosColetados = { ...dadosDe(nova), perguntou: "tipo_ocorrencia", botoes: [] };
  await prisma.conversa.update({ where: { id: nova.id }, data: { dados_coletados: jsonDados(dados) } });
  await enviarRespostas(canal, nova, [{ texto: "Vamos registrar uma *nova denúncia*! 📝" }, T.perguntaCampo("tipo_ocorrencia", dados)], "IA");
}

async function historico(conversaId: string): Promise<HistoricoItem[]> {
  const msgs = await prisma.mensagemConversa.findMany({ where: { conversa_id: conversaId, texto: { not: null } }, orderBy: { created_at: "desc" }, take: 12, select: { direcao: true, texto: true } });
  return msgs.reverse().slice(0, -1).map((m) => ({ autor: m.direcao === "IN" ? "cidadao" : "assistente", texto: m.texto ?? "" }));
}

/** Limite por contato (conversa): mais de N mensagens em 10 min → não processa (avisa uma vez). */
export async function verificarLimite(canal: CanalRuntime, conv: Conv): Promise<boolean> {
  const qtd = await prisma.mensagemConversa.count({ where: { conversa_id: conv.id, direcao: "IN", created_at: { gte: new Date(Date.now() - LIMITE_MENSAGENS.janelaMs) } } });
  if (!excedeuLimiteContato(qtd)) return false;
  const d = dadosDe(conv);
  const avisado = d.limite_avisado_em ? Date.now() - new Date(d.limite_avisado_em).getTime() < LIMITE_MENSAGENS.janelaMs : false;
  if (!avisado) {
    await prisma.conversa.update({ where: { id: conv.id }, data: { dados_coletados: jsonDados({ ...d, limite_avisado_em: new Date().toISOString() }) } });
    await enviarRespostas(canal, conv, [T.limiteMensagens()], "SISTEMA");
  }
  return true;
}
