// GED – dados de DEMONSTRAÇÃO FICTÍCIOS: dois clientes (tenants) para provar o isolamento. Nada é real: órgãos, pessoas,
// CNPJs (dígitos verificadores válidos, sem relação com empresas existentes), valores e textos são inventados.
//
// USO (sem npm, direto):
//   DATABASE_URL=… npx tsx --conditions=react-server prisma/seed/ged-demo.ts            # equivale a `npm run seed:ged-demo`
//   E2E_GED_IDS=1 …                                                                       # também grava tests/e2e/.ged-ids.json
//   CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome …                    # (assumido se existir) PDFs via htmlParaPdf
// Pré-requisitos: banco migrado (`npx prisma migrate deploy`). Não precisa de `seed:base`. Railway: SEED_GED_DEMO=true
// (scripts/predeploy.sh). NUNCA carregar no ambiente de produção de um cliente real.
//
// O que faz (idempotente: rodar de novo não duplica nada – documentos são reconhecidos por título dentro do cliente):
//   1. Onboarding dos dois clientes pelas MESMAS funções de `npm run onboard` (prisma/seed/clientes/ged-demo-a|b.json):
//      A = "Câmara Municipal de Vale das Acácias (DEMO)" (VAC), B = "Autarquia de Águas do Cerrado (DEMO)" (AAC), ambos modulos=["GED"].
//   2. Documentos com PDFs gerados (htmlParaPdf), versões, texto extraído (GedConteudoTexto), marcadores, ACLs, trâmite,
//      solicitações de assinatura, comentários, logs de acesso e de comunicação – por escritas diretas via gedDb(org) +
//      helpers do núcleo (storage por cliente e numeração). NÃO depende dos serviços das demais frentes (B–E).
//   3. Resumo de logins no final (senha de todos: Demo@2026licencia).
//
// Documentos de MESMO TÍTULO nos dois clientes ("Contrato 001/2026", "Ofício 12/2026") provam o isolamento; palavras que
// só existem no PDF de A ("iluminação pública", "aquisição de medicamentos") ou só no de B ("adutora") provam a busca por conteúdo.
//
// Documento ASSINADO/SELADO (item 12): "Termo de Cooperação 005/2026" em VAC é assinado pelo serviço REAL de assinaturas
//   (solicitação sequencial: vereador.vac → gestor.vac, senha de cada um) e selado com PAdES usando um certificado A1 de TESTE
//   ("CERTIFICADO DE TESTE – SEM VALOR LEGAL", e-CNPJ, titular ORGAO) criado para VAC. Esse passo roda em um processo filho SEM a condição
//   `react-server` (o serviço importa next/navigation): `npx tsx prisma/seed/ged-demo.ts --assinado` (o seed principal já o chama).
//   `--sem-assinatura` pula o passo. "Termo Aditivo 001/2026" continua aguardando assinatura para a demonstração ao vivo.
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import Module from "node:module";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import type { GedAcao, GedOrigemVersao, GedSensibilidade, GedStatusDocumento, GedStatusAssinante, GedStatusSolicitacao, GedTipoTramite, Prisma } from "@prisma/client";

// "server-only" lança fora do Next quando não há a condição react-server (passo assinado): usa o stub do pacote.
{
  const M = Module as unknown as { _resolveFilename: (req: string, ...rest: unknown[]) => string };
  const original = M._resolveFilename;
  M._resolveFilename = function (req: string, ...rest: unknown[]) {
    if (req === "server-only") return path.resolve(__dirname, "../../node_modules/server-only/empty.js");
    return original.call(this, req, ...rest);
  };
}
try {
  process.loadEnvFile(path.resolve(__dirname, "../../.env"));
} catch {
  /* variáveis já no ambiente */
}
const CHROMIUM_DEV = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
if (!process.env.CHROMIUM_PATH && existsSync(CHROMIUM_DEV)) process.env.CHROMIUM_PATH = CHROMIUM_DEV;

const RAIZ = path.resolve(__dirname, "../..");
const SENHA_DEMO = "Demo@2026licencia";
const DOMINIO = "gestaodocumentos.demo";
const UA_SEED = "Mozilla/5.0 (seed-ged-demo)";
const DIA = 86_400_000;

// ───────────────────────── Utilidades ─────────────────────────

function diasAtras(n: number, hora = 10, minuto = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hora, minuto, 0, 0);
  return d;
}
const depois = (n: number) => new Date(Date.now() + n * DIA);
const dataCivil = (n: number) => {
  const d = diasAtras(n, 12);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
};
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const escHtml = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** CNPJ fictício (dígitos verificadores válidos) a partir de 8 dígitos de raiz + filial 0001. */
function cnpj(raiz8: string): string {
  const d = (raiz8 + "0001").split("").map(Number);
  for (const pesos of [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]]) {
    const s = pesos.reduce((acc, p, i) => acc + d[i] * p, 0);
    const r = s % 11;
    d.push(r < 2 ? 0 : 11 - r);
  }
  const t = d.join("");
  return `${t.slice(0, 2)}.${t.slice(2, 5)}.${t.slice(5, 8)}/${t.slice(8, 12)}-${t.slice(12)}`;
}

const mascararEmail = (e: string) => e.replace(/^(.{2})[^@]*(@.*)$/, "$1***$2");

// PNG em tons de cinza (sem dependências) para o "documento digitalizado": só imagem, nenhuma camada de texto.
function crc32(buf: Buffer): number {
  let c: number;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunkPng(tipo: string, dados: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, "latin1"), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([len, corpo, crc]);
}
/** Página "escaneada": fundo claro com ruído e linhas de "texto" (blocos) – lembra um papel digitalizado. */
function pngEscaneado(w = 595, h = 842): Buffer {
  const linhas: Buffer[] = [];
  let semente = 12345;
  const rnd = () => ((semente = (semente * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < h; y++) {
    const linha = Buffer.alloc(1 + w);
    linha[0] = 0;
    const faixaTexto = y > 90 && y < h - 120 && y % 18 < 9;
    for (let x = 0; x < w; x++) {
      let v = 238 + Math.floor(rnd() * 12);
      if (faixaTexto && x > 60 && x < w - 60 && rnd() > 0.38 && (x + y * 7) % 23 < 17) v = 40 + Math.floor(rnd() * 50);
      if (y < 70 && y > 30 && x > 60 && x < 300 && rnd() > 0.3) v = 30;
      linha[1 + x] = v;
    }
    linhas.push(linha);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // profundidade
  ihdr[9] = 0; // cinza
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunkPng("IHDR", ihdr), chunkPng("IDAT", deflateSync(Buffer.concat(linhas))), chunkPng("IEND", Buffer.alloc(0))]);
}

// ───────────────────────── Especificação dos dados ─────────────────────────

type SpecDoc = {
  chave: string;
  titulo: string;
  tipo?: string;
  pasta?: string;
  remetente?: string;
  dias: number; // criado há N dias
  status?: GedStatusDocumento;
  criador: string; // chave do usuário (vide `usuarios` do tenant)
  sensibilidade?: GedSensibilidade;
  dadosPessoais?: boolean;
  anonimizacao?: "NAO_NECESSARIA" | "PENDENTE";
  marcadores?: string[];
  origem?: GedOrigemVersao;
  /** parágrafos do PDF (e do texto indexado) */
  texto?: string[];
  /** true = PDF só de imagem (sem camada de texto) → SEM_TEXTO, sem GedConteudoTexto */
  escaneado?: boolean;
  /** HTML do editor (rascunho) */
  html?: string;
  responsavel?: string;
  setorAtual?: string;
  extra?: (c: ContextoDoc) => Promise<void>;
};
type SpecTenant = { arquivo: string; sigla: string; usuarios: Record<string, string>; docs: SpecDoc[]; depois: (c: ContextoTenant) => Promise<void> };

type DbTenant = ReturnType<typeof import("../../lib/ged/db").gedDb>;
type ContextoTenant = {
  orgId: string;
  orgNome: string;
  db: DbTenant;
  user: Record<string, string>; // chave → usuario_id
  email: Record<string, string>; // chave → e-mail
  pasta: Record<string, string>; // caminho → id
  setor: Record<string, string>;
  marcador: Record<string, string>;
  tipo: Record<string, string>;
  doc: Record<string, { id: string; versao_id: string; numero: string; titulo: string; storage_key: string; criado: boolean }>;
  ids: IdsTenant;
};
type ContextoDoc = ContextoTenant & { d: { id: string; versao_id: string; numero: string; titulo: string; criador: string } };

type IdsTenant = {
  organizacao_id: string;
  sigla: string;
  usuarios: Record<string, string>;
  pastas: Record<string, string>;
  setores: Record<string, string>;
  documentos: Record<string, { id: string; numero: string; titulo: string; versao_id: string; storage_key: string; pasta: string | null; codigo_verificador?: string | null; sha256_final?: string | null; status?: string | null }>;
  comentarios: { id: string; documento: string }[];
  solicitacoes: Record<string, { id: string; documento: string; assinantes: { id: string; usuario: string; status: string }[] }>;
  tramites: { id: string; documento: string; tipo: string }[];
  acls: { id: string; documento: string | null; pasta: string | null }[];
  comunicacoes: string[];
  acessos: string[];
};

// ───────────────────────── Geração de PDFs ─────────────────────────

type Pdfs = {
  texto(orgNome: string, titulo: string, paragrafos: string[]): Promise<Buffer>;
  escaneado(orgNome: string): Promise<Buffer>;
  paginas(pdf: Buffer): Promise<number>;
};

async function criarPdfs(): Promise<Pdfs> {
  const { htmlParaPdf } = await import("../../lib/pdf");
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  let chromiumOk: boolean | null = null;

  async function fallback(titulo: string, linhas: string[]) {
    const doc = await PDFDocument.create();
    const fonte = await doc.embedFont(StandardFonts.Helvetica);
    const p = doc.addPage([595, 842]);
    p.drawText("DOCUMENTO FICTÍCIO – DEMONSTRAÇÃO", { x: 50, y: 800, size: 9, font: fonte });
    p.drawText(titulo, { x: 50, y: 770, size: 16, font: fonte });
    let y = 740;
    for (const l of linhas) {
      for (const parte of l.match(/.{1,92}(\s|$)/g) ?? [l]) {
        p.drawText(parte.trim(), { x: 50, y, size: 11, font: fonte });
        y -= 16;
      }
      y -= 8;
    }
    return Buffer.from(await doc.save());
  }

  const html = (orgNome: string, titulo: string, par: string[]) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
body{font-family:"DejaVu Sans",Arial,sans-serif;font-size:12px;line-height:1.55;color:#111}
.topo{border-bottom:2px solid #0f766e;padding-bottom:6px;margin-bottom:18px}.topo b{font-size:13px}.topo span{display:block;font-size:10px;color:#555}
h1{font-size:18px;margin:0 0 14px}p{margin:0 0 10px;text-align:justify}.rod{margin-top:26px;font-size:10px;color:#777;border-top:1px solid #ccc;padding-top:6px}
</style></head><body><div class="topo"><b>${escHtml(orgNome)}</b><span>Documento FICTÍCIO gerado para demonstração do módulo Gestão de Documentos</span></div>
<h1>${escHtml(titulo)}</h1>${par.map((p) => `<p>${escHtml(p)}</p>`).join("")}
<div class="rod">Dados, nomes, CNPJs e valores deste documento são inventados. Sem validade jurídica.</div></body></html>`;

  async function viaChromium(h: string, ...fb: Parameters<typeof fallback>) {
    if (chromiumOk !== false) {
      try {
        const buf = await htmlParaPdf(h);
        chromiumOk = true;
        return buf;
      } catch (e) {
        if (chromiumOk === null) console.warn(`[ged-demo] Chromium indisponível (${(e as Error).message.slice(0, 80)}) – usando PDF simples (pdf-lib). Defina CHROMIUM_PATH.`);
        chromiumOk = false;
      }
    }
    return fallback(...fb);
  }

  return {
    texto: (orgNome, titulo, par) => viaChromium(html(orgNome, titulo, par), titulo, par),
    async escaneado(orgNome) {
      const png = pngEscaneado().toString("base64");
      if (chromiumOk !== false) {
        try {
          const buf = await htmlParaPdf(`<!doctype html><html><body style="margin:0"><img alt="" style="width:100%;display:block" src="data:image/png;base64,${png}"></body></html>`, { margem: "0mm" });
          chromiumOk = true;
          return buf;
        } catch {
          chromiumOk = false;
        }
      }
      const doc = await PDFDocument.create();
      const img = await doc.embedPng(Buffer.from(png, "base64"));
      const p = doc.addPage([595, 842]);
      p.drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
      void orgNome;
      return Buffer.from(await doc.save());
    },
    async paginas(pdf) {
      return (await PDFDocument.load(pdf)).getPageCount();
    },
  };
}

// ───────────────────────── Criação de um documento ─────────────────────────

async function criarDocumentoDemo(c: ContextoTenant, pdfs: Pdfs, s: SpecDoc): Promise<void> {
  const { chaveGed, salvarArquivoGed } = await import("../../lib/ged/storage");
  const { proximoNumeroDocumentoGed } = await import("../../lib/ged/numeracao");
  const { registrarAuditoria } = await import("../../lib/audit");

  const existente = await c.db.gedDocumento.findFirst({ where: { titulo: s.titulo }, select: { id: true, numero: true, versao_atual_id: true } });
  if (existente) {
    const v = await c.db.gedVersaoDocumento.findFirst({ where: { documento_id: existente.id }, orderBy: { n: "asc" }, select: { id: true, storage_key: true } });
    c.doc[s.chave] = { id: existente.id, versao_id: v!.id, numero: existente.numero, titulo: s.titulo, storage_key: v!.storage_key, criado: false };
    return;
  }

  const criadoEm = diasAtras(s.dias, 9 + (s.dias % 8), (s.dias * 7) % 60);
  const documentoId = randomUUID();
  const versaoId = randomUUID();
  const origem: GedOrigemVersao = s.origem ?? (s.escaneado ? "SCAN" : "UPLOAD");
  const par = s.texto ?? [];
  const pdf = s.escaneado ? await pdfs.escaneado(c.orgNome) : await pdfs.texto(c.orgNome, s.titulo, par);
  const hash = sha256(pdf);
  const chave = chaveGed(c.orgId, { documentoId, n: 1, sha8: hash.slice(0, 8), ext: "pdf", ano: criadoEm.getFullYear() });
  await salvarArquivoGed(c.orgId, chave, pdf, "application/pdf", null); // gerado pelo sistema: sem antivírus
  const paginas = await pdfs.paginas(pdf);
  const nomeArquivo = `${s.titulo.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "")}.pdf`;
  const autor = c.user[s.criador];
  const sens = s.sensibilidade ?? "RESTRITO";

  const numero = await c.db.$transaction(async (tx) => {
    const n = await proximoNumeroDocumentoGed(tx, c.orgId, criadoEm.getFullYear());
    await tx.gedDocumento.create({
      data: {
        id: documentoId, organizacao_id: c.orgId, numero: n, titulo: s.titulo, pasta_id: s.pasta ? c.pasta[s.pasta] : null,
        tipo_id: s.tipo ? c.tipo[s.tipo] : null, remetente: s.remetente ?? null, data_documento: dataCivil(s.dias),
        status: s.status ?? "PUBLICADO", criado_por_id: autor, sensibilidade: sens,
        contem_dados_pessoais: !!s.dadosPessoais, anonimizacao_status: s.anonimizacao ?? "NAO_NECESSARIA",
        responsavel_id: s.responsavel ? c.user[s.responsavel] : null, setor_atual_id: s.setorAtual ? c.setor[s.setorAtual] : null,
        created_at: criadoEm,
      },
    });
    await tx.gedVersaoDocumento.create({
      data: {
        id: versaoId, organizacao_id: c.orgId, documento_id: documentoId, n: 1, origem, storage_key: chave, nome_arquivo: nomeArquivo, mime: "application/pdf",
        tamanho: pdf.length, sha256: hash, paginas, conteudo_html: s.html ?? null, texto_status: s.escaneado ? "SEM_TEXTO" : "EXTRAIDO", criado_por_id: autor, created_at: criadoEm,
      },
    });
    await tx.gedDocumento.update({ where: { id: documentoId }, data: { versao_atual_id: versaoId } });
    if (!s.escaneado) {
      await tx.gedConteudoTexto.create({
        data: { organizacao_id: c.orgId, versao_id: versaoId, documento_id: documentoId, texto: [s.titulo, ...par].join("\n"), metodo: origem === "EDITOR" ? "EDITOR" : "PDF_TEXTO", created_at: criadoEm },
      });
    }
    for (const m of s.marcadores ?? []) await tx.gedDocumentoMarcador.create({ data: { organizacao_id: c.orgId, documento_id: documentoId, marcador_id: c.marcador[m] } });
    await registrarAuditoria({ usuario_id: autor, organizacao_id: c.orgId, acao: "GED_DOCUMENTO_CRIADO", entidade: "ged_documento", entidade_id: documentoId, depois: { numero: n, titulo: s.titulo, origem } }, tx as unknown as Prisma.TransactionClient);
    return n;
  });

  c.doc[s.chave] = { id: documentoId, versao_id: versaoId, numero, titulo: s.titulo, storage_key: chave, criado: true };
  await s.extra?.({ ...c, d: { id: documentoId, versao_id: versaoId, numero, titulo: s.titulo, criador: s.criador } });
}

// Helpers de dados relacionados ----------------------------------------------------------------------------

async function comentar(c: ContextoTenant, doc: string, autor: string, contexto: "GERAL" | "ASSINATURA" | "RECUSA" | "TRAMITE", texto: string, dias: number, solicitacaoId?: string) {
  const d = c.doc[doc];
  const r = await c.db.gedComentario.create({
    data: { organizacao_id: c.orgId, documento_id: d.id, versao_id: d.versao_id, solicitacao_id: solicitacaoId ?? null, autor_id: c.user[autor], contexto, texto, created_at: diasAtras(dias, 11, 20) },
  });
  c.ids.comentarios.push({ id: r.id, documento: doc });
}

async function tramitar(c: ContextoTenant, doc: string, tipo: GedTipoTramite, de: string, p: { setorDe?: string; paraUsuario?: string; paraSetor?: string; despacho?: string; prazoDias?: number; referencia?: string }, dias: number) {
  const r = await c.db.gedTramite.create({
    data: {
      organizacao_id: c.orgId, documento_id: c.doc[doc].id, tipo, de_usuario_id: c.user[de], de_setor_id: p.setorDe ? c.setor[p.setorDe] : null,
      para_usuario_id: p.paraUsuario ? c.user[p.paraUsuario] : null, para_setor_id: p.paraSetor ? c.setor[p.paraSetor] : null,
      despacho: p.despacho ?? null, prazo_em: p.prazoDias ? depois(p.prazoDias) : null, referencia_id: p.referencia ?? null, created_at: diasAtras(dias, 14, 5),
    },
  });
  c.ids.tramites.push({ id: r.id, documento: doc, tipo });
  return r.id;
}

type SpecAssinante = { u: string; ordem: number; status: GedStatusAssinante; justificativa?: string; visualizouDias?: number; recusouDias?: number };
async function solicitarAssinatura(c: ContextoTenant, doc: string, p: { modo: "SEQUENCIAL" | "PARALELO"; status: GedStatusSolicitacao; criador: string; prazoDias: number; mensagem: string; dias: number; assinantes: SpecAssinante[] }) {
  const d = c.doc[doc];
  const v = await c.db.gedVersaoDocumento.findUnique({ where: { id: d.versao_id }, select: { sha256: true } });
  const sol = await c.db.gedSolicitacaoAssinatura.create({
    data: {
      organizacao_id: c.orgId, documento_id: d.id, versao_id: d.versao_id, sha256_alvo: v!.sha256, modo: p.modo, status: p.status, prazo_em: depois(p.prazoDias),
      mensagem: p.mensagem, criada_por_id: c.user[p.criador], created_at: diasAtras(p.dias, 15, 0),
    },
  });
  const ass: IdsTenant["solicitacoes"][string]["assinantes"] = [];
  for (const a of p.assinantes) {
    const r = await c.db.gedAssinante.create({
      data: {
        organizacao_id: c.orgId, solicitacao_id: sol.id, usuario_id: c.user[a.u], ordem: a.ordem, status: a.status,
        visualizou_em: a.visualizouDias !== undefined ? diasAtras(a.visualizouDias, 16, 10) : null,
        recusado_em: a.status === "RECUSADO" ? diasAtras(a.recusouDias ?? 1, 17, 30) : null,
        justificativa_recusa: a.status === "RECUSADO" ? (a.justificativa ?? null) : null,
        created_at: diasAtras(p.dias, 15, 0),
      },
    });
    ass.push({ id: r.id, usuario: a.u, status: a.status });
  }
  c.ids.solicitacoes[doc] = { id: sol.id, documento: doc, assinantes: ass };
  return sol.id;
}

async function conceder(c: ContextoTenant, p: { doc?: string; pasta?: string; usuario?: string; setor?: string; acoes: GedAcao[]; por: string; expiraDias?: number }) {
  // idempotente: uma entrada por (recurso, principal)
  const ja = await c.db.gedAcl.findFirst({
    where: { documento_id: p.doc ? c.doc[p.doc].id : null, pasta_id: p.pasta ? c.pasta[p.pasta] : null, usuario_id: p.usuario ? c.user[p.usuario] : null, setor_id: p.setor ? c.setor[p.setor] : null },
    select: { id: true },
  });
  if (ja) return;
  const r = await c.db.gedAcl.create({
    data: {
      organizacao_id: c.orgId, documento_id: p.doc ? c.doc[p.doc].id : null, pasta_id: p.pasta ? c.pasta[p.pasta] : null,
      principal_tipo: p.usuario ? "USUARIO" : "SETOR", usuario_id: p.usuario ? c.user[p.usuario] : null, setor_id: p.setor ? c.setor[p.setor] : null,
      acoes: [...new Set<GedAcao>(["VER", ...p.acoes])], expira_em: p.expiraDias ? depois(p.expiraDias) : null, concedido_por_id: c.user[p.por],
    },
  });
  c.ids.acls.push({ id: r.id, documento: p.doc ?? null, pasta: p.pasta ?? null });
}

const jaSemeado = async (c: ContextoTenant) => (await c.db.gedAcessoLog.count({ where: { user_agent: UA_SEED } })) > 0;

async function logsAcesso(c: ContextoTenant, itens: { u: string; doc?: string; acao: string; dias: number; hora?: number }[]) {
  if (await jaSemeado(c)) return;
  let n = 0;
  for (const i of itens) {
    const d = i.doc ? c.doc[i.doc] : null;
    const r = await c.db.gedAcessoLog.create({
      data: {
        organizacao_id: c.orgId, usuario_id: c.user[i.u], documento_id: d?.id ?? null, versao_id: d?.versao_id ?? null, acao: i.acao,
        ip: `203.0.113.${10 + (n % 40)}`, user_agent: UA_SEED, created_at: diasAtras(i.dias, i.hora ?? 9 + (n % 9), (n * 11) % 60),
      },
    });
    c.ids.acessos.push(r.id.toString());
    n++;
  }
}

type SpecCom = { evento: string; canal: "EMAIL" | "WHATSAPP"; para: string; doc?: string; status: "ENVIADA" | "SIMULADA" | "ERRO" | "IGNORADA" | "PENDENTE"; assunto?: string; erro?: string; dias: number };
async function logsComunicacao(c: ContextoTenant, itens: SpecCom[]) {
  if ((await c.db.gedComunicacao.count({})) > 0) return;
  for (const i of itens) {
    const quando = diasAtras(i.dias, 10, 42);
    const r = await c.db.gedComunicacao.create({
      data: {
        organizacao_id: c.orgId, documento_id: i.doc ? c.doc[i.doc].id : null, usuario_id: c.user[i.para], evento: i.evento, canal: i.canal,
        destinatario_mascarado: i.canal === "EMAIL" ? mascararEmail(c.email[i.para]) : "+55 (74) 9****-1234", assunto: i.assunto ?? null, status: i.status, erro: i.erro ?? null,
        provider_message_id: i.status === "ENVIADA" || i.status === "SIMULADA" ? `demo-${randomUUID().slice(0, 8)}` : null,
        enviado_em: i.status === "ENVIADA" || i.status === "SIMULADA" ? quando : null, created_at: quando,
      },
    });
    c.ids.comunicacoes.push(r.id);
  }
}

// ───────────────────────── Tenant A – Câmara Municipal de Vale das Acácias (DEMO) ─────────────────────────

const FORNECEDOR_A = { nome: "Luminar Soluções Elétricas Ltda. (DEMO)", cnpj: cnpj("98765401") };
const FARMA_A = { nome: "Farmacêutica Serra Azul Ltda. (DEMO)", cnpj: cnpj("98765402") };
const FORNECEDOR_B = { nome: "Hidrotec Engenharia Sanitária Ltda. (DEMO)", cnpj: cnpj("87654301") };

const tenantA: SpecTenant = {
  arquivo: "ged-demo-a",
  sigla: "VAC",
  usuarios: {
    admin: `admin.vac@${DOMINIO}`, gestor: `gestor.vac@${DOMINIO}`, s1: `servidor1.vac@${DOMINIO}`, s2: `servidor2.vac@${DOMINIO}`, vereador: `vereador.vac@${DOMINIO}`, auditor: `auditor.vac@${DOMINIO}`,
  },
  docs: [
    {
      chave: "oficio12", titulo: "Ofício 12/2026", tipo: "Ofício", pasta: "Documentação da licitação", remetente: "Secretaria Municipal de Educação (DEMO)", dias: 9, criador: "s1", marcadores: ["Urgente"],
      responsavel: "s2", setorAtual: "FIN",
      texto: [
        "Senhor Presidente da Câmara Municipal de Vale das Acácias (DEMO),",
        "Solicitamos a inclusão, na pauta da próxima sessão ordinária, do projeto de lei que dispõe sobre o reajuste da tarifa do transporte escolar rural para o exercício de 2026.",
        "Informamos que a matéria foi analisada pela Procuradoria e pela Comissão de Finanças, com parecer favorável, conforme documentos anexos ao processo.",
        "Atenciosamente, Secretaria Municipal de Educação (DEMO).",
      ],
      extra: async (c) => {
        // Trâmite: ENVIO ao setor de Licitações e DESPACHO ao servidor do Financeiro (linha do tempo imutável – item 7).
        const envio = await tramitar(c, "oficio12", "ENVIO", "s1", { setorDe: "PROT", paraSetor: "LIC", despacho: "Encaminho para manifestação da Comissão de Licitação." }, 8);
        await tramitar(c, "oficio12", "DESPACHO", "gestor", { setorDe: "LIC", paraUsuario: "s2", despacho: "Favor conferir a dotação orçamentária e devolver até sexta-feira.", prazoDias: 5 }, 7);
        await tramitar(c, "oficio12", "CIENCIA", "s2", { setorDe: "FIN", referencia: envio }, 7);
        await comentar(c, "oficio12", "s2", "TRAMITE", "Recebido. Dotação 3.3.90.39 confere; segue parecer amanhã.", 6);
      },
    },
    {
      chave: "contrato001", titulo: "Contrato 001/2026", tipo: "Contrato", pasta: "Documentação da licitação", remetente: FORNECEDOR_A.nome, dias: 6, criador: "s1", status: "EM_ASSINATURA", marcadores: ["Licitação"],
      texto: [
        `CONTRATO ADMINISTRATIVO Nº 001/2026 – que entre si celebram a Câmara Municipal de Vale das Acácias (DEMO) e a empresa ${FORNECEDOR_A.nome}, CNPJ ${FORNECEDOR_A.cnpj}.`,
        "Cláusula 1ª – Do objeto: prestação de serviços de manutenção preventiva e corretiva da iluminação pública das praças e do prédio-sede, com fornecimento de luminárias de LED.",
        "Cláusula 2ª – Do valor: R$ 184.500,00 (cento e oitenta e quatro mil e quinhentos reais), em doze parcelas mensais.",
        "Cláusula 3ª – Da vigência: 12 (doze) meses a contar da assinatura, prorrogável nos termos da Lei nº 14.133/2021.",
        "Cláusula 4ª – Do reajuste: anual, pelo índice oficial acumulado no período.",
      ],
      extra: async (c) => {
        const sol = await solicitarAssinatura(c, "contrato001", {
          modo: "SEQUENCIAL", status: "ABERTA", criador: "s1", prazoDias: 14, dias: 5, mensagem: "Solicito assinatura do contrato para publicação do extrato ainda esta semana.",
          assinantes: [{ u: "gestor", ordem: 1, status: "PENDENTE", visualizouDias: 4 }, { u: "vereador", ordem: 2, status: "AGUARDANDO" }],
        });
        await comentar(c, "contrato001", "s1", "GERAL", "Minuta revisada pela Procuradoria; a planilha de preços está em Documentação da licitação/Propostas.", 5);
        await comentar(c, "contrato001", "gestor", "ASSINATURA", "Conferi as cláusulas 2ª e 4ª (valor e reajuste). De acordo para assinatura.", 4, sol);
        await comentar(c, "contrato001", "vereador", "ASSINATURA", "Aguardo a assinatura do Secretário Geral para assinar na sequência.", 3, sol);
        await conceder(c, { doc: "contrato001", usuario: "s2", acoes: ["VER"], por: "gestor" });
      },
    },
    {
      chave: "aditivo001", titulo: "Termo Aditivo 001/2026", tipo: "Contrato", pasta: "Documentação da licitação", remetente: FORNECEDOR_A.nome, dias: 2, criador: "s1", status: "EM_ASSINATURA", marcadores: ["Licitação", "Urgente"],
      texto: [
        "TERMO ADITIVO Nº 001/2026 ao Contrato nº 001/2026 – RESERVADO PARA A DEMONSTRAÇÃO AO VIVO DA ASSINATURA (item 12 do roteiro).",
        "Cláusula única: prorrogam-se por mais 6 (seis) meses a vigência do contrato original e o fornecimento de luminárias, mantidas as demais cláusulas.",
        "Signatários: Vereador Presidente (1º) e Secretário Geral (2º) – assinatura eletrônica avançada, com selo do órgão ao final.",
      ],
      extra: async (c) => {
        await solicitarAssinatura(c, "aditivo001", {
          modo: "SEQUENCIAL", status: "ABERTA", criador: "s1", prazoDias: 14, dias: 1, mensagem: "Aditivo para assinatura – demonstração.",
          assinantes: [{ u: "vereador", ordem: 1, status: "PENDENTE" }, { u: "gestor", ordem: 2, status: "AGUARDANDO" }],
        });
      },
    },
    {
      chave: "parecer07", titulo: "Parecer 07/2026", tipo: "Parecer", pasta: "Controle interno/Relatórios", remetente: "Controle Interno", dias: 12, criador: "s2", status: "RECUSADO", marcadores: ["Controle interno"],
      texto: [
        "PARECER Nº 07/2026 – Controle Interno. Assunto: pagamento da 3ª parcela do contrato de manutenção da iluminação pública.",
        "Conclusão: opina-se pelo prosseguimento do pagamento, condicionado à apresentação da certidão de regularidade fiscal atualizada.",
      ],
      extra: async (c) => {
        const justificativa = "Discordo da conclusão do item 2: a certidão de regularidade fiscal da contratada está vencida e o pagamento não pode ser condicionado a posterior regularização.";
        const sol = await solicitarAssinatura(c, "parecer07", {
          modo: "SEQUENCIAL", status: "RECUSADA", criador: "s2", prazoDias: 3, dias: 10, mensagem: "Parecer para assinatura antes do pagamento.",
          assinantes: [{ u: "vereador", ordem: 1, status: "RECUSADO", recusouDias: 8, visualizouDias: 9, justificativa }, { u: "gestor", ordem: 2, status: "AGUARDANDO" }],
        });
        await comentar(c, "parecer07", "vereador", "RECUSA", justificativa, 8, sol);
        await tramitar(c, "parecer07", "RECUSA", "vereador", { paraUsuario: "s2", despacho: justificativa }, 8);
      },
    },
    {
      chave: "minuta15", titulo: "Minuta de Ofício 15/2026", tipo: "Ofício", pasta: "Controle interno/Relatórios", dias: 1, criador: "s1", status: "RASCUNHO", origem: "EDITOR",
      html: "<h1>Minuta de Ofício 15/2026</h1><p>Senhor Secretário,</p><p>Encaminhamos, para conhecimento, o relatório de acompanhamento das metas do primeiro semestre.</p><p><em>(rascunho em edição – ainda não finalizado)</em></p>",
      texto: ["Senhor Secretário,", "Encaminhamos, para conhecimento, o relatório de acompanhamento das metas do primeiro semestre.", "(rascunho em edição – ainda não finalizado)"],
    },
    {
      chave: "scan0045", titulo: "Ofício recebido nº 0045 (digitalizado)", tipo: "Ofício", pasta: "Digitalização/Lote mensal", remetente: "Secretaria Municipal de Obras (DEMO)", dias: 15, criador: "s1", escaneado: true, marcadores: ["Digitalizado"],
    },
    {
      chave: "ata018", titulo: "Ata da Sessão Ordinária 018/2026", tipo: "Ata", pasta: "Documentação da licitação/Atas", remetente: "Secretaria Legislativa", dias: 20, criador: "s1",
      dadosPessoais: true, anonimizacao: "PENDENTE", marcadores: ["Controle interno"],
      texto: [
        "ATA DA 18ª SESSÃO ORDINÁRIA – Aos vinte dias do mês de setembro de 2026, reuniu-se o Plenário da Câmara Municipal de Vale das Acácias (DEMO).",
        "Foi lido o requerimento da servidora Maria Aparecida Teixeira Lopes (DEMO), CPF 000.111.222-33 (fictício), solicitando licença para tratamento de saúde, telefone (74) 90000-1234.",
        "Aprovado por unanimidade. Nada mais havendo a tratar, encerrou-se a sessão.",
      ],
      extra: async (c) => {
        // Gancho do futuro motor de anonimização: detecções sugeridas (não guardam o dado detectado).
        for (const [tipo, oc] of [["CPF", 1], ["TELEFONE", 1], ["NOME_PESSOA", 2]] as const) {
          await c.db.gedDeteccaoDadoPessoal.create({ data: { organizacao_id: c.orgId, versao_id: c.d.versao_id, tipo, pagina: 1, ocorrencias: oc, status: "SUGERIDA" } });
        }
      },
    },
    {
      chave: "pad003", titulo: "Processo Administrativo Disciplinar 003/2026", tipo: "Parecer", pasta: "Pessoal", remetente: "Corregedoria (DEMO)", dias: 25, criador: "gestor", sensibilidade: "SIGILOSO", dadosPessoais: true,
      texto: [
        "PROCESSO ADMINISTRATIVO DISCIPLINAR Nº 003/2026 – SIGILOSO. Instauração de sindicância para apuração de fatos relativos a servidor (DEMO).",
        "O acesso a este documento é restrito aos membros da comissão e às pessoas expressamente autorizadas (ACL explícita).",
      ],
      extra: async (c) => {
        await conceder(c, { doc: "pad003", usuario: "s2", acoes: ["VER"], por: "gestor", expiraDias: 30 });
        await conceder(c, { doc: "pad003", usuario: "auditor", acoes: ["VER"], por: "gestor" });
      },
    },
    {
      chave: "edital03", titulo: "Edital do Pregão 03/2026", pasta: "Documentação da licitação/Editais", remetente: "Comissão de Licitação", dias: 30, criador: "gestor", sensibilidade: "PUBLICO", marcadores: ["Licitação"],
      texto: [
        "EDITAL DO PREGÃO ELETRÔNICO Nº 03/2026 – Objeto: aquisição de medicamentos de uso contínuo para o programa de saúde do servidor, conforme especificações do Termo de Referência.",
        "Valor estimado: R$ 96.300,00. Abertura das propostas: 10h do décimo dia útil após a publicação.",
        "Critério de julgamento: menor preço por item. Participação exclusiva de microempresas e empresas de pequeno porte.",
      ],
    },
    {
      chave: "ata03", titulo: "Ata do Pregão 03/2026", tipo: "Ata", pasta: "Documentação da licitação/Atas", remetente: "Comissão de Licitação", dias: 18, criador: "gestor", sensibilidade: "PUBLICO", marcadores: ["Licitação"],
      texto: [
        "ATA DE JULGAMENTO DO PREGÃO Nº 03/2026 – aquisição de medicamentos. Compareceram duas licitantes.",
        `Sagrou-se vencedora a empresa ${FARMA_A.nome}, CNPJ ${FARMA_A.cnpj}, com a proposta de R$ 89.940,00.`,
      ],
    },
    {
      chave: "empenho045", titulo: "Empenho 045/2026", tipo: "Empenho", pasta: "Processos de pagamento/2026/Empenhos", remetente: "Setor Financeiro", dias: 14, criador: "s2", marcadores: ["Pagamento"],
      texto: [
        `NOTA DE EMPENHO Nº 045/2026 – Favorecido: ${FORNECEDOR_A.nome}, CNPJ ${FORNECEDOR_A.cnpj}.`,
        "Histórico: manutenção da iluminação pública – 3ª parcela do Contrato nº 001/2026. Valor: R$ 15.375,00. Dotação 01.031.0001.2001 – 3.3.90.39.",
      ],
    },
    {
      chave: "nf1021", titulo: "Nota fiscal 1021", tipo: "Nota fiscal", pasta: "Processos de pagamento/2026/Notas fiscais", remetente: FORNECEDOR_A.nome, dias: 13, criador: "s2", marcadores: ["Pagamento"],
      texto: [`NOTA FISCAL DE SERVIÇOS Nº 1021 – Prestador: ${FORNECEDOR_A.nome}, CNPJ ${FORNECEDOR_A.cnpj}.`, "Descrição: serviços de manutenção da iluminação pública – competência setembro/2026. Valor: R$ 15.375,00."],
    },
    {
      chave: "termo005", titulo: "Termo de Cooperação 005/2026", tipo: "Contrato", pasta: "Documentação da licitação", remetente: "Secretaria Municipal de Educação (DEMO)", dias: 3, criador: "s1", marcadores: ["Licitação"],
      texto: [
        "TERMO DE COOPERAÇÃO Nº 005/2026 – entre a Câmara Municipal de Vale das Acácias (DEMO) e a Secretaria Municipal de Educação (DEMO).",
        "Objeto: cessão do plenário para as sessões do Parlamento Jovem, sem ônus para as partes, de agosto a dezembro de 2026.",
        "Este documento é ASSINADO e SELADO pelo seed de demonstração (certificado de TESTE, sem valor legal): use-o para conferir o QR em cada página e a página pública de verificação.",
      ],
    },
    {
      chave: "relCI", titulo: "Relatório de controle interno – 2º trimestre/2026", pasta: "Controle interno/Relatórios", remetente: "Controle Interno", dias: 40, criador: "gestor", marcadores: ["Controle interno"],
      texto: ["RELATÓRIO DE CONTROLE INTERNO – 2º trimestre de 2026.", "Foram examinados 38 processos de pagamento; 2 apresentaram impropriedades formais sanadas durante a auditoria."],
    },
  ],
  depois: async (c) => {
    // ACLs de pasta: por setor e por usuário (exemplos de herança – item 3 do roteiro).
    await conceder(c, { pasta: "Controle interno", setor: "CI", acoes: ["VER", "EDITAR"], por: "admin" });
    await conceder(c, { pasta: "Processos de pagamento/2026", setor: "FIN", acoes: ["VER", "EDITAR", "TRAMITAR"], por: "admin" });
    await conceder(c, { pasta: "Documentação da licitação", setor: "LIC", acoes: ["VER", "EDITAR", "TRAMITAR"], por: "admin" });
    await conceder(c, { pasta: "Documentação da licitação/Editais", usuario: "vereador", acoes: ["VER"], por: "admin" });
    await logsAcesso(c, [
      { u: "s1", acao: "LOGIN_GED", dias: 9 }, { u: "s1", doc: "oficio12", acao: "VISUALIZAR", dias: 9 }, { u: "gestor", doc: "oficio12", acao: "VISUALIZAR", dias: 7 },
      { u: "s2", doc: "oficio12", acao: "VISUALIZAR", dias: 7 }, { u: "s2", doc: "oficio12", acao: "BAIXAR", dias: 6 }, { u: "gestor", doc: "contrato001", acao: "VISUALIZAR", dias: 4 },
      { u: "vereador", doc: "contrato001", acao: "VISUALIZAR", dias: 3 }, { u: "vereador", doc: "contrato001", acao: "BAIXAR", dias: 3 }, { u: "admin", doc: "pad003", acao: "NEGADO", dias: 5 },
      { u: "s1", doc: "pad003", acao: "NEGADO", dias: 5 }, { u: "s2", doc: "pad003", acao: "VISUALIZAR", dias: 4 }, { u: "auditor", doc: "pad003", acao: "VISUALIZAR", dias: 2 },
      { u: "auditor", acao: "LOGIN_GED", dias: 2 }, { u: "s1", acao: "BUSCAR", dias: 2 }, { u: "gestor", acao: "BUSCAR", dias: 1 }, { u: "gestor", acao: "LISTAR", dias: 1 },
      { u: "vereador", acao: "LOGIN_GED", dias: 1 }, { u: "vereador", doc: "aditivo001", acao: "VISUALIZAR", dias: 1 }, { u: "s2", doc: "empenho045", acao: "VISUALIZAR", dias: 12 },
      { u: "admin", acao: "LOGIN_GED", dias: 0 }, { u: "s1", doc: "scan0045", acao: "VISUALIZAR", dias: 14 }, { u: "gestor", doc: "edital03", acao: "BAIXAR", dias: 28 },
    ]);
    await logsComunicacao(c, [
      { evento: "TRAMITE_RECEBIDO", canal: "EMAIL", para: "s2", doc: "oficio12", status: "ENVIADA", assunto: "Documento recebido para análise: Ofício 12/2026", dias: 7 },
      { evento: "ASSINATURA_SOLICITADA", canal: "EMAIL", para: "gestor", doc: "contrato001", status: "ENVIADA", assunto: "Assinatura solicitada: Contrato 001/2026", dias: 5 },
      { evento: "ASSINATURA_SOLICITADA", canal: "WHATSAPP", para: "gestor", doc: "contrato001", status: "SIMULADA", assunto: "Assinatura solicitada (modo simulado)", dias: 5 },
      { evento: "ASSINATURA_SOLICITADA", canal: "EMAIL", para: "vereador", doc: "aditivo001", status: "ENVIADA", assunto: "Assinatura solicitada: Termo Aditivo 001/2026", dias: 1 },
      { evento: "ASSINATURA_RECUSADA", canal: "EMAIL", para: "s2", doc: "parecer07", status: "ENVIADA", assunto: "Assinatura recusada: Parecer 07/2026", dias: 8 },
      { evento: "ASSINATURA_LEMBRETE", canal: "EMAIL", para: "gestor", doc: "contrato001", status: "ERRO", erro: "SMTP: conexão recusada (erro simulado para a demonstração)", assunto: "Lembrete: Contrato 001/2026", dias: 2 },
      { evento: "ASSINATURA_LEMBRETE", canal: "WHATSAPP", para: "gestor", doc: "contrato001", status: "IGNORADA", assunto: "Lembrete (fora da janela de 24 h do canal oficial)", dias: 2 },
    ]);
  },
};

// ───────────────────────── Tenant B – Autarquia de Águas do Cerrado (DEMO) ─────────────────────────

const tenantB: SpecTenant = {
  arquivo: "ged-demo-b",
  sigla: "AAC",
  usuarios: { admin: `admin.aac@${DOMINIO}`, gestor: `gestor.aac@${DOMINIO}`, s1: `servidor.aac@${DOMINIO}` },
  docs: [
    {
      chave: "contrato001", titulo: "Contrato 001/2026", tipo: "Contrato", pasta: "Documentação da licitação/Editais", remetente: FORNECEDOR_B.nome, dias: 11, criador: "gestor", marcadores: ["Licitação"],
      texto: [
        `CONTRATO Nº 001/2026 – Autarquia de Águas do Cerrado (DEMO) e ${FORNECEDOR_B.nome}, CNPJ ${FORNECEDOR_B.cnpj}.`,
        "Objeto: manutenção e recuperação de trechos da adutora de água bruta e da estação de tratamento de água, incluindo reposição de válvulas.",
        "Valor: R$ 412.800,00. Vigência: 12 meses.",
      ],
    },
    {
      chave: "oficio12", titulo: "Ofício 12/2026", tipo: "Ofício", pasta: "Documentação da licitação/Atas", remetente: "Gerência de Operações (DEMO)", dias: 8, criador: "s1", marcadores: ["Urgente"],
      extra: async (c) => {
        await tramitar(c, "oficio12", "ENVIO", "s1", { setorDe: "PROT", paraSetor: "OPE", despacho: "Para providências quanto ao racionamento do setor norte." }, 7);
      },
      texto: [
        "Senhor Diretor,",
        "Comunicamos a necessidade de manobra emergencial na adutora do setor norte, com interrupção do abastecimento por 6 horas, para reparo de vazamento.",
        "Solicitamos autorização para divulgação do aviso à população.",
      ],
    },
    {
      chave: "empenho112", titulo: "Empenho 112/2026", tipo: "Empenho", pasta: "Processos de pagamento/2026/Empenhos", remetente: "Setor Financeiro", dias: 6, criador: "s1", marcadores: ["Pagamento"],
      texto: [`NOTA DE EMPENHO Nº 112/2026 – Favorecido: ${FORNECEDOR_B.nome}, CNPJ ${FORNECEDOR_B.cnpj}.`, "Histórico: 1ª parcela da recuperação da adutora. Valor: R$ 34.400,00."],
    },
    {
      chave: "edital07", titulo: "Edital do Pregão 07/2026", pasta: "Documentação da licitação/Editais", remetente: "Comissão de Licitação", dias: 22, criador: "gestor", sensibilidade: "PUBLICO", marcadores: ["Licitação"],
      texto: ["EDITAL DO PREGÃO Nº 07/2026 – Objeto: aquisição de hidrômetros e conexões para ampliação da rede de abastecimento.", "Valor estimado: R$ 128.000,00."],
    },
    {
      chave: "relAgua", titulo: "Relatório de qualidade da água – 3º trimestre/2026", pasta: "Controle interno/Relatórios", remetente: "Laboratório (DEMO)", dias: 4, criador: "gestor", marcadores: ["Controle interno"],
      texto: ["RELATÓRIO DE QUALIDADE DA ÁGUA – 3º trimestre de 2026.", "Todos os parâmetros de potabilidade (cloro residual, turbidez, coliformes) ficaram dentro dos limites."],
    },
    {
      chave: "pessoalB", titulo: "Ficha funcional reservada (DEMO)", pasta: "Pessoal", remetente: "Recursos Humanos", dias: 30, criador: "gestor", sensibilidade: "SIGILOSO", dadosPessoais: true,
      texto: ["FICHA FUNCIONAL – SIGILOSA. Conteúdo fictício de demonstração; visível somente por ACL explícita."],
    },
  ],
  depois: async (c) => {
    await logsAcesso(c, [
      { u: "s1", acao: "LOGIN_GED", dias: 8 }, { u: "gestor", doc: "contrato001", acao: "VISUALIZAR", dias: 10 }, { u: "s1", doc: "oficio12", acao: "VISUALIZAR", dias: 7 },
      { u: "admin", acao: "LOGIN_GED", dias: 1 }, { u: "admin", doc: "pessoalB", acao: "NEGADO", dias: 1 },
    ]);
    await logsComunicacao(c, [{ evento: "TRAMITE_RECEBIDO", canal: "EMAIL", para: "gestor", doc: "oficio12", status: "ENVIADA", assunto: "Documento recebido: Ofício 12/2026", dias: 7 }]);
  },
};

/** Reconstrói o mapa de IDs a partir do banco (vale também quando os documentos já existiam – reexecução). */
async function coletarIds(c: ContextoTenant, spec: SpecTenant) {
  const chavePorId = new Map(Object.entries(c.doc).map(([k, d]) => [d.id, k]));
  const nome = (id: string | null) => (id ? chavePorId.get(id) ?? id : "");
  const ids = c.ids;
  ids.comentarios = (await c.db.gedComentario.findMany({ select: { id: true, documento_id: true }, orderBy: { created_at: "asc" } })).map((x) => ({ id: x.id, documento: nome(x.documento_id) }));
  ids.tramites = (await c.db.gedTramite.findMany({ select: { id: true, documento_id: true, tipo: true }, orderBy: { created_at: "asc" } })).map((x) => ({ id: x.id, documento: nome(x.documento_id), tipo: x.tipo }));
  ids.acls = (await c.db.gedAcl.findMany({ select: { id: true, documento_id: true, pasta_id: true } })).map((x) => ({ id: x.id, documento: x.documento_id ? nome(x.documento_id) : null, pasta: x.pasta_id ? (Object.entries(c.pasta).find(([, v]) => v === x.pasta_id)?.[0] ?? null) : null }));
  ids.comunicacoes = (await c.db.gedComunicacao.findMany({ select: { id: true } })).map((x) => x.id);
  ids.acessos = (await c.db.gedAcessoLog.findMany({ select: { id: true }, orderBy: { id: "asc" } })).map((x) => x.id.toString());
  const sols = await c.db.gedSolicitacaoAssinatura.findMany({ select: { id: true, documento_id: true, assinantes: { select: { id: true, usuario_id: true, status: true }, orderBy: { ordem: "asc" } } } });
  const emailPorUsuario = new Map(Object.entries(c.user).map(([k, id]) => [id, k]));
  ids.solicitacoes = Object.fromEntries(sols.map((s) => [nome(s.documento_id), { id: s.id, documento: nome(s.documento_id), assinantes: s.assinantes.map((a) => ({ id: a.id, usuario: emailPorUsuario.get(a.usuario_id) ?? a.usuario_id, status: a.status })) }]));
  void spec;
}

// ───────────────────────── Execução ─────────────────────────

async function semearTenant(spec: SpecTenant, pdfs: Pdfs): Promise<{ ids: IdsTenant; criados: number; reaproveitados: number; nome: string; c: ContextoTenant }> {
  const { PrismaClient } = await import("@prisma/client");
  const { onboarding, ClienteSchema, arquivoCliente } = await import("./onboarding");
  const { gedDb } = await import("../../lib/ged/db");

  const cliente = ClienteSchema.parse(JSON.parse(readFileSync(arquivoCliente(spec.arquivo), "utf8")));
  const prisma = new PrismaClient();
  let r: Awaited<ReturnType<typeof onboarding>>;
  try {
    r = await onboarding(prisma, cliente, { demo: true });
  } finally {
    await prisma.$disconnect();
  }
  const orgId = r.organizacao.id;
  const db = gedDb(orgId);
  const ged = r.ged!;

  const usuariosDb = await db.usuario.findMany({ where: { email: { in: Object.values(spec.usuarios) } }, select: { id: true, email: true } });
  const user: Record<string, string> = {};
  for (const [k, email] of Object.entries(spec.usuarios)) {
    const u = usuariosDb.find((x) => x.email === email);
    if (!u) throw new Error(`usuário ${email} não encontrado após o onboarding`);
    user[k] = u.id;
  }
  const ids: IdsTenant = { organizacao_id: orgId, sigla: spec.sigla, usuarios: { ...Object.fromEntries(Object.entries(spec.usuarios).map(([k, e]) => [e, user[k]])) }, pastas: ged.pastas, setores: ged.setores, documentos: {}, comentarios: [], solicitacoes: {}, tramites: [], acls: [], comunicacoes: [], acessos: [] };
  const c: ContextoTenant = { orgId, orgNome: r.organizacao.nome, db, user, email: spec.usuarios, pasta: ged.pastas, setor: ged.setores, marcador: ged.marcadores, tipo: ged.tipos, doc: {}, ids };

  let criados = 0;
  let reaproveitados = 0;
  for (const d of spec.docs) {
    await criarDocumentoDemo(c, pdfs, d);
    if (c.doc[d.chave].criado) criados++;
    else reaproveitados++;
  }
  await spec.depois(c); // ACLs de pasta e logs: idempotentes (verificam antes de gravar)
  await atualizarIds(c, spec);
  return { ids, criados, reaproveitados, nome: r.organizacao.nome, c };
}

/** (Re)monta o mapa de IDs a partir do banco: versão ATUAL (a selada, se houver) e código verificador de cada documento. */
async function atualizarIds(c: ContextoTenant, spec: SpecTenant) {
  await coletarIds(c, spec);
  for (const [chave, d] of Object.entries(c.doc)) {
    const doc = spec.docs.find((x) => x.chave === chave)!;
    const reg = await c.db.gedDocumento.findUnique({ where: { id: d.id }, select: { versao_atual_id: true, codigo_verificador: true, sha256_final: true, status: true } });
    const v = reg?.versao_atual_id ? await c.db.gedVersaoDocumento.findUnique({ where: { id: reg.versao_atual_id }, select: { id: true, storage_key: true } }) : null;
    c.ids.documentos[chave] = {
      id: d.id, numero: d.numero, titulo: d.titulo, versao_id: v?.id ?? d.versao_id, storage_key: v?.storage_key ?? d.storage_key, pasta: doc.pasta ?? null,
      codigo_verificador: reg?.codigo_verificador ?? null, sha256_final: reg?.sha256_final ?? null, status: reg?.status ?? null,
    };
  }
}

async function main() {
  const { prisma } = await import("../../lib/db");
  const pdfs = await criarPdfs();
  const resultados = [];
  for (const spec of [tenantA, tenantB]) resultados.push({ spec, ...(await semearTenant(spec, pdfs)) });

  // Documento assinado e selado (processo filho sem a condição react-server).
  if (!process.argv.includes("--sem-assinatura")) {
    const f = spawnSync("npx", ["tsx", __filename, "--assinado"], { stdio: "inherit", env: process.env });
    if (f.status !== 0) throw new Error("passo do documento assinado falhou (ver mensagens acima).");
    const a = resultados[0];
    await atualizarIds(a.c, a.spec);
  }

  // Mapa de IDs para os testes E2E (tests/e2e/ged-helpers.ts): E2E_GED_IDS=1 (ou --ids).
  if (process.env.E2E_GED_IDS === "1" || process.argv.includes("--ids")) {
    const arq = process.env.E2E_GED_IDS_FILE || path.join(RAIZ, "tests/e2e/.ged-ids.json");
    mkdirSync(path.dirname(arq), { recursive: true });
    writeFileSync(arq, JSON.stringify({ gerado_em: new Date().toISOString(), tenants: Object.fromEntries(resultados.map((r) => [r.spec.sigla, r.ids])) }, null, 2));
    console.log(`\nIDs para o E2E gravados em ${path.relative(RAIZ, arq)}`);
  }

  console.log("\n══════════ GED – demonstração pronta ══════════");
  for (const r of resultados) {
    console.log(`\n${r.nome} (${r.spec.sigla}) – ${r.criados} documento(s) novo(s), ${r.reaproveitados} já existente(s)`);
    for (const [k, email] of Object.entries(r.spec.usuarios)) console.log(`  ${email.padEnd(40)} ${SENHA_DEMO}   (${k})`);
  }
  console.log("\nAcesso: /login (deixe o campo Órgão em branco) → /ged. Documentos de mesmo título nos dois clientes provam o isolamento.");
  console.log("Busca por conteúdo: 'iluminação pública' e 'aquisição de medicamentos' só existem em VAC; 'adutora' só em AAC.");
  console.log("Documento assinado e selado: \"Termo de Cooperação 005/2026\" (VAC) – certificado A1 de TESTE, sem valor legal.");
  await prisma.$disconnect();
  process.exit(0);
}

/**
 * Assina e sela "Termo de Cooperação 005/2026" (VAC) pelo serviço real de assinaturas. Idempotente. Roda SEM a condição react-server.
 * Também garante o certificado A1 de TESTE do cliente VAC (e-CNPJ, titular ORGAO, município nulo), guardado cifrado como lib/assinatura faz.
 */
export async function criarDocumentoAssinadoDemo(): Promise<void> {
  const { PrismaClient } = await import("@prisma/client");
  const { gedDb } = await import("../../lib/ged/db");
  const { ctxGedDeUsuario } = await import("../../lib/ged/escopo");
  const { sessaoPorEmail } = await import("../../lib/sessao");
  const { assinar, solicitarAssinatura, tentarSelar } = await import("../../lib/ged/assinaturas/servico");
  const { cifrar } = await import("../../lib/crypto");
  const { gerarPfxTeste } = await import("../../lib/assinatura/teste");
  const { lerCertificado } = await import("../../lib/assinatura/certificado");
  const { registrarAuditoria } = await import("../../lib/audit");

  const prisma = new PrismaClient();
  try {
    const org = await prisma.organizacao.findFirst({ where: { sigla: tenantA.sigla } });
    if (!org) throw new Error("cliente VAC não encontrado – rode o seed principal.");
    const db = gedDb(org.id);
    const titulo = "Termo de Cooperação 005/2026";
    const doc = await db.gedDocumento.findFirst({ where: { titulo }, select: { id: true, status: true } });
    if (!doc) throw new Error(`documento "${titulo}" não encontrado – rode o seed principal.`);
    if (doc.status === "ASSINADO") {
      console.log(`[ged-demo] "${titulo}" já está assinado e selado.`);
      return;
    }

    // Certificado A1 de TESTE do cliente (idempotente)
    const agora = new Date();
    const cert = await prisma.certificadoDigital.findFirst({ where: { organizacao_id: org.id, titular: "ORGAO", municipio_id: null, ativo: true, valido_ate: { gt: agora } }, select: { id: true } });
    if (!cert) {
      const senha = randomUUID().replace(/-/g, "") + "Aa1!";
      const documento = cnpj("98765403").replace(/\D/g, "");
      const pfx = gerarPfxTeste({ nome: "CERTIFICADO DE TESTE – SEM VALOR LEGAL – CÂMARA MUNICIPAL DE VALE DAS ACÁCIAS (DEMO)", documento, senha, validadeDias: 730 });
      const lido = lerCertificado(pfx, senha);
      const c = await prisma.certificadoDigital.create({
        data: {
          organizacao_id: org.id, municipio_id: null, titular: "ORGAO", pfx_cifrado: cifrar(pfx.toString("base64")), senha_cifrada: cifrar(senha), nome_titular: lido.nome,
          documento_titular: lido.documento ? cifrar(lido.documento) : null, emissor: lido.emissor, serial: lido.serial, thumbprint_sha1: lido.thumbprint_sha1,
          valido_de: lido.valido_de, valido_ate: lido.valido_ate, icp_brasil: false, ativo: true,
        },
      });
      await registrarAuditoria({ usuario_id: null, organizacao_id: org.id, acao: "GED_CERTIFICADO_CADASTRADO", entidade: "ged_certificado", entidade_id: c.id, depois: { origem: "seed:ged-demo", nome_titular: lido.nome, icp_brasil: false } });
      console.log("[ged-demo] certificado A1 de TESTE criado para VAC (sem valor legal).");
    }

    const ctxDe = async (email: string) => {
      const r = await ctxGedDeUsuario(await sessaoPorEmail(email));
      if (!r.ok) throw new Error(`${email}: sem acesso ao GED (${r.motivo})`);
      return r.ctx;
    };
    const autor = await ctxDe(`servidor1.vac@${DOMINIO}`);
    const vereador = await ctxDe(`vereador.vac@${DOMINIO}`);
    const gestor = await ctxDe(`gestor.vac@${DOMINIO}`);

    let sol = await db.gedSolicitacaoAssinatura.findFirst({ where: { documento_id: doc.id, status: "ABERTA" }, select: { id: true } });
    if (!sol) {
      const r = await solicitarAssinatura(autor, { documento_id: doc.id, signatarios: [vereador.usuario.id, gestor.usuario.id], modo: "SEQUENCIAL", prazo_dias: 30, mensagem: "Termo para assinatura (demonstração do selo)." });
      sol = { id: r.id };
    }
    const meta = { ip: "203.0.113.77", user_agent: UA_SEED };
    for (const ctx of [vereador, gestor]) {
      const a = await db.gedAssinante.findFirst({ where: { solicitacao_id: sol.id, usuario_id: ctx.usuario.id }, select: { status: true } });
      if (a?.status === "PENDENTE") await assinar(ctx, { solicitacao_id: sol.id, senha: SENHA_DEMO, consentimento: true }, meta);
    }
    const fim = await db.gedDocumento.findUnique({ where: { id: doc.id }, select: { status: true } });
    if (fim?.status !== "ASSINADO") await tentarSelar(gestor, sol.id);
    const sel = await db.gedDocumento.findUnique({ where: { id: doc.id }, select: { status: true, codigo_verificador: true } });
    if (sel?.status !== "ASSINADO") throw new Error(`documento não ficou ASSINADO (status ${sel?.status}).`);
    console.log(`[ged-demo] "${titulo}" assinado e selado – código verificador ${sel.codigo_verificador}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (typeof require !== "undefined" && require.main === module && process.argv.includes("--assinado")) {
  criarDocumentoAssinadoDemo()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("[ged-demo] documento assinado falhou:", e);
      process.exit(1);
    });
} else if (typeof require !== "undefined" && require.main === module) {
  main().catch((e) => {
    console.error("[ged-demo] falhou:", e);
    process.exit(1);
  });
}
