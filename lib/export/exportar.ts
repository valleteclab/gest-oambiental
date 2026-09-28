// Exportação completa / portabilidade (SPEC 9.2, T10).
// ZIP: tabelas/{tabela}.csv + tabelas/{tabela}.json (todas as tabelas do Prisma, em lotes),
//      dicionario_dados.md/.json, anexos/{storage_key} (anexos + PDFs oficiais + atas), manifest.json (sha256 de tudo), LEIA-ME.txt.
// Segredos (usuario.senha_hash) nunca saem; colunas cifradas saem cifradas (ver dicionario.ts).
//
// ISOLAMENTO POR ORGANIZAÇÃO: a exportação solicitada por um usuário (exportacao.organizacao_id) contém SOMENTE
// as linhas da organização dele – cada tabela tem uma regra em filtroTabela() (municípios da organização, processos
// desses municípios, pessoas vinculadas, usuários da organização…) e os anexos/PDFs seguem as mesmas linhas.
// Tabela nova sem regra → erro (nunca exporta "tudo" por omissão). Exportação sem organização (legado) = completa.
import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { registrarAuditoria } from "../audit";
import { lerArquivo, salvarArquivo } from "../storage";
import type { UsuarioSessao } from "../rbac";
import { camposExportados, dicionarioMarkdown, gerarDicionario, modelos, nomeTabela, COLUNAS_CIFRADAS, COLUNAS_EXCLUIDAS } from "./dicionario";

const LOTE = 1000;
export const NOME_APLICACAO_WORKER = "licenciagov-worker";
export const chaveExportacao = (id: string) => `exports/${id}.zip`;

// ───────────────────────── Serialização ─────────────────────────

function valorJson(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return v.toString();
  if (Prisma.Decimal.isDecimal(v)) return (v as Prisma.Decimal).toString();
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return Buffer.from(v).toString("base64");
  return v;
}

function valorCsv(v: unknown): string {
  const j = valorJson(v);
  if (j === null) return "";
  const s = typeof j === "object" ? JSON.stringify(j) : String(j);
  return /[";\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function escrever(ws: WriteStream, s: string): Promise<void> {
  return new Promise((res, rej) => {
    if (ws.write(s)) res();
    else ws.once("drain", res).once("error", rej);
  });
}
const fechar = (ws: WriteStream) => new Promise<void>((res, rej) => ws.end((e?: Error | null) => (e ? rej(e) : res())));

async function sha256Arquivo(p: string): Promise<string> {
  const h = createHash("sha256");
  await new Promise<void>((res, rej) => createReadStream(p).on("data", (c) => h.update(c)).on("end", () => res()).on("error", rej));
  return h.digest("hex");
}

async function listarArquivos(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listarArquivos(p, base)));
    else out.push(path.relative(base, p).split(path.sep).join("/"));
  }
  return out.sort();
}

// ───────────────────────── Geração ─────────────────────────

type Delegate = { findMany: (a: unknown) => Promise<Record<string, unknown>[]> };

// ───────────────────────── Escopo (organização) ─────────────────────────

export type EscopoExportacao = {
  organizacao: { id: string; nome: string; sigla: string };
  municipios: string[];
  usuarios: string[];
  emails: string[];
};

/** Pessoas da organização: cadastradas por ela ou vinculadas a registros dos seus municípios (= wherePessoaOrganizacao). */
function wherePessoasOrg(e: EscopoExportacao) {
  const m = { in: e.municipios };
  return {
    OR: [
      { organizacao_id: e.organizacao.id },
      { municipio_id: m },
      { empreendimentos: { some: { municipio_id: m } } },
      { processos: { some: { municipio_id: m } } },
      { responsavel_tecnico: { processos: { some: { municipio_id: m } } } },
      { responsavel_tecnico: { empreendimentos: { some: { empreendimento: { municipio_id: m } } } } },
    ],
  };
}

/** Carrega o escopo da organização (municípios, usuários internos + requerentes vinculados, e-mails). */
export async function escopoDaOrganizacao(organizacaoId: string): Promise<EscopoExportacao> {
  const org = await prisma.organizacao.findUniqueOrThrow({ where: { id: organizacaoId }, select: { id: true, nome: true, sigla: true, municipios: { select: { id: true } } } });
  const base: EscopoExportacao = { organizacao: { id: org.id, nome: org.nome, sigla: org.sigla }, municipios: org.municipios.map((m) => m.id), usuarios: [], emails: [] };
  const us = await prisma.usuario.findMany({ where: { OR: [{ organizacao_id: org.id }, { organizacao_id: null, pessoa: wherePessoasOrg(base) }] }, select: { id: true, email: true } });
  return { ...base, usuarios: us.map((u) => u.id), emails: us.map((u) => u.email) };
}

/** Regra de escopo (where Prisma) de cada tabela na exportação de uma organização. */
export function filtroTabela(modelo: string, e: EscopoExportacao): Record<string, unknown> {
  const mun = { municipio_id: { in: e.municipios } };
  const proc = { processo: mun };
  switch (modelo) {
    case "Organizacao": return { id: e.organizacao.id };
    case "Municipio": return { organizacao_id: e.organizacao.id };
    case "Usuario": return { id: { in: e.usuarios } };
    case "UsuarioPapel": return { usuario_id: { in: e.usuarios } };
    case "Tipologia":
    case "TipoAto":
    case "PrazoConfig":
    case "ChecklistModelo":
    case "Exportacao":
      return { organizacao_id: e.organizacao.id };
    case "ModeloDocumento": return { OR: [{ organizacao_id: e.organizacao.id }, { organizacao_id: null }] }; // próprios + globais da plataforma
    case "DocumentoExigido": return { tipo_ato: { organizacao_id: e.organizacao.id } };
    case "Feriado": return { OR: [{ municipio_id: null }, mun] }; // nacionais + dos municípios
    case "Pessoa": return wherePessoasOrg(e);
    case "ResponsavelTecnico": return { pessoa: wherePessoasOrg(e) };
    case "Sequencia":
    case "Empreendimento":
    case "Processo":
    case "DocumentoOficial":
    case "Denuncia":
    case "Fiscalizacao":
    case "AutoInfracao":
    case "Notificacao":
    case "Conselho":
    case "Alerta":
    case "ChamadoSuporte":
    case "AlertaDesmatamento":
    case "MonitoramentoSync":
      return mun;
    case "EmpreendimentoRt": return { empreendimento: mun };
    case "Tramitacao":
    case "Pendencia":
    case "ChecklistPreenchido":
    case "Parecer":
    case "Condicionante":
      return proc;
    case "Anexo": return { OR: [proc, { fiscalizacao: mun }, { denuncia: mun }] };
    case "ReuniaoConselho": return { conselho: mun };
    case "EmailEnviado": return { para: { in: e.emails } };
    case "LogAuditoria": return { usuario_id: { in: e.usuarios } };
    case "BackupRegistro": return {}; // registros de infraestrutura da plataforma (sem dados de negócio)
    // Agente de denúncias: canais (credenciais seguem CIFRADAS), conversas/mensagens e consumo de IA da organização.
    case "CanalAtendimento":
    case "Conversa":
    case "UsoIa":
      return { organizacao_id: e.organizacao.id };
    case "MensagemConversa": return { conversa: { organizacao_id: e.organizacao.id } };
    // Caixa bruta de webhooks: transitória (retenção CANAIS_RETENCAO_EVENTOS_DIAS), payloads de provedor com dados pessoais –
    // fora da exportação por organização (o conteúdo útil já está em mensagem_conversa).
    case "EventoWebhook": return { id: "00000000-0000-0000-0000-000000000000" };
    default:
      throw new Error(`Tabela ${modelo} sem regra de escopo na exportação por organização (lib/export/exportar.ts filtroTabela).`);
  }
}

/** Exporta uma tabela em lotes (cursor por id) para CSV + JSON. Retorna nº de linhas. */
async function exportarTabela(m: (typeof Prisma.dmmf.datamodel.models)[number], dir: string, escopo: EscopoExportacao | null = null): Promise<{ linhas: number; colunas: string[] }> {
  const campos = camposExportados(m);
  const nome = nomeTabela(m);
  const delegate = (prisma as unknown as Record<string, Delegate>)[m.name.charAt(0).toLowerCase() + m.name.slice(1)];
  if (!delegate) throw new Error(`Delegate Prisma não encontrado para ${m.name}`);
  const idCampo = m.fields.find((f) => f.isId)?.name ?? "id";
  const select = Object.fromEntries(campos.map((f) => [f.name, true]));
  const colunas = campos.map((f) => f.dbName ?? f.name);
  const where = escopo ? filtroTabela(m.name, escopo) : undefined;

  const csv = createWriteStream(path.join(dir, `${nome}.csv`), { encoding: "utf8" });
  const json = createWriteStream(path.join(dir, `${nome}.json`), { encoding: "utf8" });
  await escrever(csv, "﻿" + colunas.map(valorCsv).join(";") + "\r\n");
  await escrever(json, "[\n");
  let linhas = 0;
  let cursor: unknown = undefined;
  for (;;) {
    const lote: Record<string, unknown>[] = await delegate.findMany({
      where,
      select,
      orderBy: { [idCampo]: "asc" },
      take: LOTE,
      ...(cursor !== undefined ? { cursor: { [idCampo]: cursor }, skip: 1 } : {}),
    });
    if (lote.length === 0) break;
    let csvBuf = "";
    let jsonBuf = "";
    for (const r of lote) {
      csvBuf += campos.map((f) => valorCsv(r[f.name])).join(";") + "\r\n";
      const obj = Object.fromEntries(campos.map((f) => [f.dbName ?? f.name, valorJson(r[f.name])]));
      jsonBuf += (linhas === 0 ? "  " : ",\n  ") + JSON.stringify(obj);
      linhas++;
    }
    await escrever(csv, csvBuf);
    await escrever(json, jsonBuf);
    cursor = lote[lote.length - 1][idCampo];
    if (lote.length < LOTE) break;
  }
  await escrever(json, linhas ? "\n]\n" : "]\n");
  await Promise.all([fechar(csv), fechar(json)]);
  return { linhas, colunas };
}

/** Copia todos os arquivos referenciados no banco para anexos/{storage_key}. */
async function exportarAnexos(dir: string, escopo: EscopoExportacao | null = null): Promise<{ total: number; bytes: number; ausentes: { storage_key: string; origem: string; erro: string }[] }> {
  const chaves = new Map<string, string>();
  const add = (k: string | null | undefined, origem: string) => {
    if (k && !chaves.has(k)) chaves.set(k, origem);
  };
  // Em lotes para não carregar tudo de uma vez
  for (let skip = 0; ; skip += LOTE) {
    const l = await prisma.anexo.findMany({ where: escopo ? (filtroTabela("Anexo", escopo) as Prisma.AnexoWhereInput) : undefined, select: { storage_key: true }, orderBy: { id: "asc" }, skip, take: LOTE });
    l.forEach((x) => add(x.storage_key, "anexo"));
    if (l.length < LOTE) break;
  }
  for (let skip = 0; ; skip += LOTE) {
    const l = await prisma.documentoOficial.findMany({ where: escopo ? (filtroTabela("DocumentoOficial", escopo) as Prisma.DocumentoOficialWhereInput) : undefined, select: { storage_key: true }, orderBy: { id: "asc" }, skip, take: LOTE });
    l.forEach((x) => add(x.storage_key, "documento_oficial"));
    if (l.length < LOTE) break;
  }
  (await prisma.reuniaoConselho.findMany({ select: { ata_pdf_key: true }, where: { ata_pdf_key: { not: null }, ...(escopo ? (filtroTabela("ReuniaoConselho", escopo) as Prisma.ReuniaoConselhoWhereInput) : {}) } })).forEach((x) => add(x.ata_pdf_key, "reuniao_conselho"));

  let total = 0;
  let bytes = 0;
  const ausentes: { storage_key: string; origem: string; erro: string }[] = [];
  for (const [k, origem] of chaves) {
    const destino = path.resolve(dir, k);
    if (!destino.startsWith(dir + path.sep)) {
      ausentes.push({ storage_key: k, origem, erro: "storage_key inválida" });
      continue;
    }
    try {
      const buf = await lerArquivo(k);
      await mkdir(path.dirname(destino), { recursive: true });
      await writeFile(destino, buf);
      total++;
      bytes += buf.length;
    } catch (e) {
      ausentes.push({ storage_key: k, origem, erro: e instanceof Error ? e.message.slice(0, 200) : String(e) });
    }
  }
  return { total, bytes, ausentes };
}

async function zipar(dirOrigem: string, arquivoZip: string): Promise<void> {
  const { ZipArchive } = await import("archiver");
  const zip = new ZipArchive({ zlib: { level: 6 } });
  const out = createWriteStream(arquivoZip);
  const fim = new Promise<void>((res, rej) => {
    out.on("close", () => res());
    out.on("error", rej);
    zip.on("error", rej);
  });
  zip.pipe(out);
  zip.directory(dirOrigem, false);
  await zip.finalize();
  await fim;
}

export type ResultadoExportacao = { storage_key: string; tamanho: number; tabelas: number; linhas: number; anexos: number };

/** Gera o ZIP completo em disco temporário e grava no storage em exports/{id}.zip. */
export async function gerarZipExportacao(id: string, meta: { solicitada_por?: string | null; organizacao_id?: string | null } = {}): Promise<ResultadoExportacao> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "licenciagov-export-"));
  const raiz = path.join(tmp, "conteudo");
  const dirTabelas = path.join(raiz, "tabelas");
  const dirAnexos = path.join(raiz, "anexos");
  await mkdir(dirTabelas, { recursive: true });
  await mkdir(dirAnexos, { recursive: true });
  const geradoEm = new Date();
  const escopo = meta.organizacao_id ? await escopoDaOrganizacao(meta.organizacao_id) : null;
  try {
    const tabelas: Record<string, { modelo: string; linhas: number; colunas: string[]; csv: string; json: string }> = {};
    let linhasTotal = 0;
    for (const m of modelos()) {
      const r = await exportarTabela(m, dirTabelas, escopo);
      const nome = nomeTabela(m);
      tabelas[nome] = { modelo: m.name, linhas: r.linhas, colunas: r.colunas, csv: `tabelas/${nome}.csv`, json: `tabelas/${nome}.json` };
      linhasTotal += r.linhas;
    }

    const dic = gerarDicionario();
    await writeFile(path.join(raiz, "dicionario_dados.json"), JSON.stringify({ gerado_em: geradoEm.toISOString(), ...dic }, null, 2));
    await writeFile(path.join(raiz, "dicionario_dados.md"), dicionarioMarkdown(dic, geradoEm));

    const anexos = await exportarAnexos(dirAnexos, escopo);

    await writeFile(
      path.join(raiz, "LEIA-ME.txt"),
      [
        "LicenciaGov – Exportação completa de dados (portabilidade)",
        `Gerada em: ${geradoEm.toISOString()}  ·  Exportação: ${id}`,
        escopo ? `Escopo: somente os dados da organização ${escopo.organizacao.nome} (${escopo.organizacao.sigla}) – ${escopo.municipios.length} município(s).` : "Escopo: base completa (todas as organizações).",
        "",
        "Conteúdo:",
        "  tabelas/<tabela>.csv   – UTF-8 com BOM, separador ';', aspas duplas, fim de linha CRLF (abre direto no Excel/LibreOffice)",
        "  tabelas/<tabela>.json  – array JSON de objetos (mesmas colunas)",
        "  dicionario_dados.md / .json – tabelas, colunas, tipos, chaves, referências e descrições",
        "  anexos/<storage_key>   – arquivos enviados e PDFs dos documentos oficiais",
        "  manifest.json          – contagens e SHA-256 de cada arquivo (verifique com sha256sum)",
        "",
        "Segurança:",
        "  - usuario.senha_hash não é exportado.",
        "  - Dados pessoais cifrados (CPF/CNPJ, e-mail/telefone de PF, contato de denúncia) saem cifrados (AES-256-GCM);",
        "    a chave (DATA_KEY) é entregue ao órgão por canal separado, mediante termo.",
        "  - Este arquivo contém dados pessoais (LGPD): armazene e transmita com segurança.",
        "",
      ].join("\r\n"),
    );

    // manifest.json – sha256 de todos os arquivos (exceto o próprio manifest)
    const arquivos = [];
    for (const rel of await listarArquivos(raiz)) {
      const p = path.join(raiz, rel);
      arquivos.push({ caminho: rel, bytes: (await stat(p)).size, sha256: await sha256Arquivo(p) });
    }
    const manifest = {
      sistema: "LicenciaGov",
      exportacao_id: id,
      generated_at: geradoEm.toISOString(),
      solicitada_por: meta.solicitada_por ?? null,
      escopo: escopo ? { tipo: "ORGANIZACAO", organizacao: escopo.organizacao, municipios: escopo.municipios } : { tipo: "COMPLETA" },
      formato: { csv: { codificacao: "UTF-8 com BOM", separador: ";", aspas: '"', fim_de_linha: "CRLF" }, json: "array de objetos", datas: "ISO 8601 UTC" },
      contagens: { tabelas: Object.keys(tabelas).length, linhas: linhasTotal, anexos: anexos.total, anexos_bytes: anexos.bytes, anexos_ausentes: anexos.ausentes.length, arquivos: arquivos.length },
      tabelas,
      colunas_excluidas: COLUNAS_EXCLUIDAS,
      colunas_cifradas: COLUNAS_CIFRADAS,
      anexos_ausentes: anexos.ausentes,
      arquivos,
    };
    await writeFile(path.join(raiz, "manifest.json"), JSON.stringify(manifest, null, 2));

    const zipPath = path.join(tmp, `${id}.zip`);
    await zipar(raiz, zipPath);
    const buf = await readFile(zipPath);
    const key = chaveExportacao(id);
    await salvarArquivo(key, buf, "application/zip");
    return { storage_key: key, tamanho: buf.length, tabelas: Object.keys(tabelas).length, linhas: linhasTotal, anexos: anexos.total };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

// ───────────────────────── Ciclo de vida (tabela exportacao) ─────────────────────────

/** Processa uma exportação PENDENTE (PENDENTE→PROCESSANDO→CONCLUIDA|ERRO). Seguro contra execução dupla. */
export async function processarExportacao(id: string): Promise<void> {
  const tomada = await prisma.exportacao.updateMany({ where: { id, status: "PENDENTE" }, data: { status: "PROCESSANDO" } });
  if (tomada.count === 0) return; // já processada por outro executor
  const exp = await prisma.exportacao.findUniqueOrThrow({ where: { id } });
  try {
    const r = await gerarZipExportacao(id, { solicitada_por: exp.solicitada_por, organizacao_id: exp.organizacao_id });
    await prisma.exportacao.update({ where: { id }, data: { status: "CONCLUIDA", storage_key: r.storage_key, tamanho: r.tamanho, concluida_em: new Date(), erro: null } });
    await registrarAuditoria({ usuario_id: exp.solicitada_por, acao: "EXPORTACAO", entidade: "exportacao", entidade_id: id, depois: { status: "CONCLUIDA", ...r } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.exportacao.update({ where: { id }, data: { status: "ERRO", erro: msg.slice(0, 1000), concluida_em: new Date() } });
    await registrarAuditoria({ usuario_id: exp.solicitada_por, acao: "EXPORTACAO_ERRO", entidade: "exportacao", entidade_id: id, depois: { erro: msg } });
    throw e;
  }
}

/** Há um worker pg-boss conectado? (conexões com application_name do worker em pg_stat_activity) */
export async function workerOnline(): Promise<boolean> {
  try {
    const r = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM pg_stat_activity WHERE application_name = ${NOME_APLICACAO_WORKER} AND datname = current_database()`;
    return Number(r[0]?.n ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Cria a solicitação (PENDENTE) e dispara o processamento: se o worker estiver no ar, ele pega a
 * exportação na varredura da fila `exportacao` (≤ 1 min); senão processa em segundo plano neste processo.
 */
export async function solicitarExportacao(u: Pick<UsuarioSessao, "id" | "organizacao_id">, escopo = "COMPLETA", ctx: { ip?: string | null; user_agent?: string | null } = {}) {
  // Sempre restrita à organização de quem solicita (sem organização → recusada: nunca exporta outro cliente).
  if (!u.organizacao_id) throw Object.assign(new Error("Usuário sem organização não pode exportar."), { status: 403, code: "PROIBIDO" });
  const exp = await prisma.exportacao.create({ data: { solicitada_por: u.id, organizacao_id: u.organizacao_id, escopo, status: "PENDENTE" } });
  await registrarAuditoria({ usuario_id: u.id, acao: "EXPORTACAO_SOLICITADA", entidade: "exportacao", entidade_id: exp.id, depois: { escopo }, ip: ctx.ip ?? null, user_agent: ctx.user_agent ?? null });
  const viaWorker = process.env.EXPORTACAO_INLINE !== "true" && (await workerOnline());
  if (!viaWorker) {
    // fire-and-forget: a demo funciona sem o worker
    void processarExportacao(exp.id).catch((e) => console.error(`[exportacao ${exp.id}]`, e));
  }
  return { ...exp, via: viaWorker ? ("worker" as const) : ("inline" as const) };
}

/** Exportações PENDENTES (para a varredura do worker) e PROCESSANDO travadas há mais de `minutos` (voltam a PENDENTE). */
export async function exportacoesPendentes(minutosTravada = 60): Promise<string[]> {
  await prisma.exportacao.updateMany({
    where: { status: "PROCESSANDO", created_at: { lt: new Date(Date.now() - minutosTravada * 60000) }, concluida_em: null },
    data: { status: "PENDENTE" },
  });
  return (await prisma.exportacao.findMany({ where: { status: "PENDENTE" }, select: { id: true }, orderBy: { created_at: "asc" } })).map((x) => x.id);
}
