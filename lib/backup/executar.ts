import "server-only";
// Backup REAL do PostgreSQL e teste de restauração REAL (SPEC 9.2 / T10).
//
//   executarBackup()            pg_dump -Fc (schema public) | openssl AES-256-CBC/PBKDF2 → arquivo temporário
//                               → bucket S3 fora do provedor (BACKUP_S3_*) ou, sem ele, storage da aplicação
//                               em backups/ → retenção (BACKUP_RETENCAO_DIAS) → backup_registro (tipo BACKUP)
//   executarTesteRestauracao()  baixa o dump mais recente do destino, confere o sha256, decifra, restaura
//                               com pg_restore num banco descartável, confere contagens/triggers e o apaga
//                               → backup_registro (tipo RESTORE_TESTE)
//
// Chamado pelo worker (filas `backup` e `restore-test`, jobs/worker.ts) e pelos botões de /admin/backup.
// Execuções concorrentes (worker × botão × outra réplica) são impedidas por advisory lock no Postgres.
// Falhas também são registradas e geram e-mail para BACKUP_ALERTA_EMAIL.
import { spawn } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import { enviarEmail } from "../email";
import { driverStorage, lerArquivo, listarArquivos, removerArquivo, salvarArquivo } from "../storage";
import { registrarBackup } from "./registrar";
import {
  TABELAS_CONFERIDAS,
  compararContagens,
  descreverDestino,
  lerConfig,
  maisRecente,
  nomeArquivoBackup,
  observacaoBackup,
  resumoComparacao,
  selecionarParaRemover,
  SQL_CRIAR_EXTENSOES,
  indiceSemSchemaPublic,
  sha256DaObservacao,
  urlLibpq,
  type ConfigBackup,
} from "./nucleo";

/** Chaves do advisory lock (pg_locks: classid = TRAVA, objid = 1 backup | 2 restauração). */
const TRAVA = 73_100;
const TRAVA_BACKUP = 1;
const TRAVA_RESTORE = 2;
export const BANCO_RESTORE_PADRAO = "licenciagov_restore_test";

export type ResultadoExecucao = { status: "ok" | "falha" | "em_andamento"; registro_id?: string; mensagem?: string };
type Opcoes = { origem: string; usuario_id?: string | null; onInicio?: () => void };

// ───────────────────────── utilidades ─────────────────────────

function databaseUrl() {
  const u = process.env.DATABASE_URL;
  if (!u) throw new Error("DATABASE_URL não definida");
  return u;
}

/** Senha da cifra: BACKUP_PASSPHRASE ou, na falta, HMAC-SHA256("licenciagov-backup") com a DATA_KEY (ver docs/restore.md). */
export function passphraseBackup(): string {
  const p = process.env.BACKUP_PASSPHRASE?.trim();
  if (p) return p;
  const k = process.env.DATA_KEY?.trim();
  if (!k) throw new Error("BACKUP_PASSPHRASE (ou DATA_KEY) não definida – o backup não pode ser cifrado");
  return createHmac("sha256", k).update("licenciagov-backup").digest("hex");
}

type Proc = { codigo: number; stdout: string; stderr: string };
function executar(cmd: string, args: string[], env: Record<string, string> = {}): Promise<Proc> {
  return new Promise((ok, falha) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", (e) => falha(new Error(`${cmd}: ${e.message}${(e as NodeJS.ErrnoException).code === "ENOENT" ? " (não instalado? – postgresql-client/openssl)" : ""}`)));
    p.on("close", (codigo) => ok({ codigo: codigo ?? -1, stdout, stderr }));
  });
}

async function exigir(cmd: string, args: string[], env: Record<string, string> = {}) {
  const r = await executar(cmd, args, env);
  if (r.codigo !== 0) throw new Error(`${cmd} saiu com código ${r.codigo}: ${r.stderr.trim().slice(-800)}`);
  return r;
}

async function sha256Arquivo(caminho: string) {
  const h = createHash("sha256");
  await pipeline(createReadStream(caminho), h);
  return h.digest("hex");
}

/** Executa `fn` com o advisory lock `objid`; se outra execução detém o lock, retorna null. */
async function comTrava<T>(objid: number, fn: () => Promise<T>): Promise<T | null> {
  return prisma.$transaction(
    async (tx) => {
      const [r] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${TRAVA}::int, ${objid}::int) AS ok`;
      if (!r?.ok) return null;
      return fn();
    },
    { maxWait: 15_000, timeout: 6 * 3600_000 },
  );
}

/** Execuções em andamento (qualquer processo/réplica), pelo advisory lock em pg_locks. */
export async function execucoesEmAndamento(): Promise<{ backup: boolean; restore: boolean }> {
  try {
    const r = await prisma.$queryRaw<{ objid: number }[]>`
      SELECT objid::int AS objid FROM pg_locks
      WHERE locktype = 'advisory' AND granted AND classid = ${TRAVA}::oid AND objsubid = 2
        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`;
    return { backup: r.some((x) => x.objid === TRAVA_BACKUP), restore: r.some((x) => x.objid === TRAVA_RESTORE) };
  } catch {
    return { backup: false, restore: false };
  }
}

async function alertar(assunto: string, texto: string) {
  const dest = (process.env.BACKUP_ALERTA_EMAIL ?? "").split(/[,;\s]+/).filter(Boolean);
  console.error(`[backup] ${assunto}: ${texto}`);
  const url = `${process.env.APP_URL ?? "http://localhost:3000"}/admin/backup`;
  for (const d of dest) await enviarEmail(d, `[LicenciaGov] ${assunto}`, `<p>${texto.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!)}</p><p><a href="${url}">${url}</a></p>`).catch((e) => console.error("[backup] e-mail de alerta", e));
}

// ───────────────────────── destinos ─────────────────────────

type Destino = {
  descricao: (nome: string) => string;
  prefixo: string;
  listar: () => Promise<string[]>;
  enviar: (chave: string, arquivo: string, tamanho: number, sha256: string) => Promise<void>;
  enviarTexto: (chave: string, texto: string) => Promise<void>;
  baixar: (chave: string, arquivo: string) => Promise<void>;
  lerTexto: (chave: string) => Promise<string | null>;
  remover: (chave: string) => Promise<void>;
};

function destino(cfg: ConfigBackup): Destino {
  const o = cfg.offsite;
  if (o) {
    const s3 = new S3Client({ region: o.region, endpoint: o.endpoint, forcePathStyle: o.forcePathStyle, credentials: { accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey } });
    return {
      descricao: (nome) => descreverDestino(cfg, nome),
      prefixo: o.prefixo,
      listar: async () => {
        const chaves: string[] = [];
        let token: string | undefined;
        do {
          const r = await s3.send(new ListObjectsV2Command({ Bucket: o.bucket, Prefix: o.prefixo, ContinuationToken: token }));
          for (const x of r.Contents ?? []) if (x.Key) chaves.push(x.Key);
          token = r.IsTruncated ? r.NextContinuationToken : undefined;
        } while (token);
        return chaves;
      },
      enviar: async (chave, arquivo, tamanho, sha256) => {
        await s3.send(new PutObjectCommand({ Bucket: o.bucket, Key: chave, Body: createReadStream(arquivo), ContentLength: tamanho, ContentType: "application/octet-stream", Metadata: { sha256 } }));
      },
      enviarTexto: async (chave, texto) => {
        await s3.send(new PutObjectCommand({ Bucket: o.bucket, Key: chave, Body: texto, ContentType: "text/plain" }));
      },
      baixar: async (chave, arquivo) => {
        const r = await s3.send(new GetObjectCommand({ Bucket: o.bucket, Key: chave }));
        await pipeline(r.Body as NodeJS.ReadableStream, createWriteStream(arquivo));
      },
      lerTexto: async (chave) => {
        try {
          const r = await s3.send(new GetObjectCommand({ Bucket: o.bucket, Key: chave }));
          return await r.Body!.transformToString();
        } catch {
          return null;
        }
      },
      remover: async (chave) => {
        await s3.send(new DeleteObjectCommand({ Bucket: o.bucket, Key: chave }));
      },
    };
  }
  // Fallback: storage da própria aplicação (mesmo provedor) em backups/
  return {
    descricao: (nome) => descreverDestino(cfg, nome, driverStorage()),
    prefixo: cfg.prefixoLocal,
    listar: () => listarArquivos(cfg.prefixoLocal),
    enviar: async (chave, arquivo) => salvarArquivo(chave, await readFile(arquivo), "application/octet-stream"),
    enviarTexto: (chave, texto) => salvarArquivo(chave, Buffer.from(texto), "text/plain"),
    baixar: async (chave, arquivo) => writeFile(arquivo, await lerArquivo(chave)),
    lerTexto: async (chave) => (await lerArquivo(chave).catch(() => null))?.toString("utf8") ?? null,
    remover: (chave) => removerArquivo(chave),
  };
}

// ───────────────────────── backup ─────────────────────────

export async function executarBackup(op: Opcoes): Promise<ResultadoExecucao> {
  const r = await comTrava(TRAVA_BACKUP, async () => {
    op.onInicio?.();
    return backupSemTrava(op);
  });
  return r ?? { status: "em_andamento", mensagem: "Já existe um backup em execução." };
}

async function backupSemTrava(op: Opcoes): Promise<ResultadoExecucao> {
  const cfg = lerConfig();
  const inicio = Date.now();
  const nome = nomeArquivoBackup(new Date(inicio));
  const dest = destino(cfg);
  const tmp = await mkdtemp(path.join(os.tmpdir(), "lg-backup-"));
  try {
    const conn = urlLibpq(databaseUrl());
    const versao = (await exigir("pg_dump", ["--version"])).stdout.trim();
    const arquivo = path.join(tmp, nome);
    const env = { PGPASSWORD: conn.senha, LG_BACKUP_PASS: passphraseBackup() };

    // pg_dump -Fc | openssl enc → arquivo (o dump nunca é gravado em claro)
    const dump = spawn("pg_dump", ["--format=custom", "--compress=6", "--no-owner", "--no-acl", ...cfg.schemas.map((s) => `--schema=${s}`), `--dbname=${conn.url}`], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    const cifra = spawn("openssl", ["enc", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-salt", "-pass", "env:LG_BACKUP_PASS"], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let errDump = "";
    let errCifra = "";
    dump.stderr.on("data", (d) => (errDump += d));
    cifra.stderr.on("data", (d) => (errCifra += d));
    const fim = (p: ReturnType<typeof spawn>, cmd: string) =>
      new Promise<number>((ok, falha) => {
        p.on("error", (e) => falha(new Error(`${cmd}: ${e.message} (postgresql-client/openssl instalados?)`)));
        p.on("close", (c) => ok(c ?? -1));
      });
    const [cDump, cCifra] = await Promise.all([fim(dump, "pg_dump"), fim(cifra, "openssl"), pipeline(dump.stdout!, cifra.stdin!), pipeline(cifra.stdout!, createWriteStream(arquivo))]);
    if (cDump !== 0) throw new Error(`pg_dump saiu com código ${cDump}: ${errDump.trim().slice(-800)}`);
    if (cCifra !== 0) throw new Error(`openssl saiu com código ${cCifra}: ${errCifra.trim().slice(-400)}`);

    const tamanho = (await stat(arquivo)).size;
    if (tamanho < 1024) throw new Error(`arquivo de backup muito pequeno (${tamanho} bytes)`);
    const sha256 = await sha256Arquivo(arquivo);

    const chave = `${dest.prefixo}${nome}`;
    await dest.enviar(chave, arquivo, tamanho, sha256);
    await dest.enviarTexto(`${chave}.sha256`, `${sha256}  ${nome}\n`);

    // Retenção (no mesmo destino)
    let removidos = 0;
    try {
      for (const k of selecionarParaRemover(await dest.listar(), new Date(), cfg.retencaoDias)) {
        await dest.remover(k);
        if (!k.endsWith(".sha256")) removidos++;
      }
    } catch (e) {
      console.error("[backup] retenção", e);
    }

    const reg = await registrarBackup({
      tipo: "BACKUP",
      tamanho,
      destino: dest.descricao(nome),
      sucesso: true,
      usuario_id: op.usuario_id ?? null,
      observacao: observacaoBackup({ sha256, pgDumpVersao: versao, schemas: cfg.schemas, duracaoMs: Date.now() - inicio, removidos, retencaoDias: cfg.retencaoDias, origem: op.origem, passphraseDerivada: cfg.passphraseDerivada }),
    });
    return { status: "ok" as const, registro_id: reg.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const reg = await registrarBackup({ tipo: "BACKUP", sucesso: false, tamanho: 0, destino: dest.descricao(nome), usuario_id: op.usuario_id ?? null, observacao: `Falha: ${msg.slice(0, 1500)}; origem: ${op.origem}` }).catch(() => null);
    await alertar("FALHA no backup do banco", `${new Date().toISOString()} – ${msg}`);
    return { status: "falha" as const, registro_id: reg?.id, mensagem: msg };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

// ───────────────────────── teste de restauração ─────────────────────────

export async function executarTesteRestauracao(op: Opcoes): Promise<ResultadoExecucao> {
  const r = await comTrava(TRAVA_RESTORE, async () => {
    op.onInicio?.();
    return restoreSemTrava(op);
  });
  return r ?? { status: "em_andamento", mensagem: "Já existe um teste de restauração em execução." };
}

async function restoreSemTrava(op: Opcoes): Promise<ResultadoExecucao> {
  const cfg = lerConfig();
  const inicio = Date.now();
  const dest = destino(cfg);
  const prod = urlLibpq(databaseUrl());
  const alvoExterno = process.env.BACKUP_RESTORE_DATABASE_URL?.trim();
  const alvo = alvoExterno ? urlLibpq(alvoExterno) : urlLibpq(databaseUrl(), BANCO_RESTORE_PADRAO);
  const descAlvo = alvoExterno ? `banco descartável ${alvo.banco} (BACKUP_RESTORE_DATABASE_URL)` : `banco descartável ${alvo.banco} (mesmo servidor, criado e apagado no teste)`;
  const tmp = await mkdtemp(path.join(os.tmpdir(), "lg-restore-"));
  let tamanho = 0;
  let criado = false;
  let cliente: PrismaClient | null = null;
  try {
    if (new URL(alvo.url).host === new URL(prod.url).host && alvo.banco === prod.banco) throw new Error("o banco de restauração não pode ser o banco de produção");

    // 1) Dump mais recente do destino + conferência do sha256
    const chaves = await dest.listar();
    const chave = maisRecente(chaves);
    if (!chave) throw new Error(`nenhum dump encontrado em ${dest.descricao("")}`);
    const nome = chave.split("/").pop()!;
    const cifrado = path.join(tmp, nome);
    await dest.baixar(chave, cifrado);
    tamanho = (await stat(cifrado)).size;
    const sha = await sha256Arquivo(cifrado);
    const sidecar = (await dest.lerTexto(`${chave}.sha256`))?.trim().split(/\s+/)[0] ?? null;
    const reg = await prisma.backupRegistro.findFirst({ where: { tipo: "BACKUP", sucesso: true, destino: { contains: nome } }, orderBy: { executado_em: "desc" } });
    const esperado = sidecar ?? sha256DaObservacao(reg?.observacao);
    if (!esperado) throw new Error(`sha256 de referência de ${nome} não encontrado (.sha256 ausente e sem registro)`);
    if (esperado !== sha) throw new Error(`sha256 não confere para ${nome}: arquivo ${sha} ≠ esperado ${esperado}`);

    // 2) Decifra
    const claro = path.join(tmp, "restaurar.dump");
    await exigir("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-pass", "env:LG_BACKUP_PASS", "-in", cifrado, "-out", claro], { LG_BACKUP_PASS: passphraseBackup() });

    // 3) Banco descartável
    if (alvoExterno) {
      await exigir("psql", ["-v", "ON_ERROR_STOP=1", "-qc", "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;", `--dbname=${alvo.url}`], { PGPASSWORD: alvo.senha });
    } else {
      await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${BANCO_RESTORE_PADRAO}" WITH (FORCE)`);
      await prisma.$executeRawUnsafe(`CREATE DATABASE "${BANCO_RESTORE_PADRAO}"`);
      criado = true;
    }

    // 3b) Extensões que o schema usa (o dump com --schema=public não as inclui – ver EXTENSOES_BANCO)
    await exigir("psql", ["-v", "ON_ERROR_STOP=1", "-qc", SQL_CRIAR_EXTENSOES, `--dbname=${alvo.url}`], { PGPASSWORD: alvo.senha });

    // 4) pg_restore (erro em qualquer objeto = falha). O banco de destino é novo e o schema public já existe (com as
    //    extensões acima): restaura pelo índice do dump SEM a entrada do schema e sem --clean (que tentaria
    //    `DROP SCHEMA public` e falharia pelas extensões que dependem dele).
    const indice = indiceSemSchemaPublic((await exigir("pg_restore", ["--list", claro])).stdout);
    const arquivoIndice = path.join(tmp, "restaurar.lst");
    await writeFile(arquivoIndice, indice);
    await exigir("pg_restore", ["--no-owner", "--no-acl", "--exit-on-error", "--use-list", arquivoIndice, `--dbname=${alvo.url}`, claro], { PGPASSWORD: alvo.senha });
    const duracaoRestore = (Date.now() - inicio) / 1000;

    // 5) Sanidade: contagens × produção, triggers de imutabilidade e UPDATE bloqueado
    const urlCliente = new URL(alvo.url);
    urlCliente.password = encodeURIComponent(alvo.senha);
    cliente = new PrismaClient({ datasourceUrl: urlCliente.toString() });
    const contar = async (c: PrismaClient, t: string) => {
      try {
        const [x] = await c.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "${t}"`);
        return Number(x.n);
      } catch {
        return null;
      }
    };
    const restaurado: Record<string, number> = {};
    const producao: Record<string, number | null> = {};
    for (const t of TABELAS_CONFERIDAS) {
      const r = await contar(cliente, t);
      if (r === null) throw new Error(`tabela ${t} ausente no banco restaurado`);
      restaurado[t] = r;
      producao[t] = await contar(prisma, t);
    }
    const comp = compararContagens(restaurado, producao, cfg.tolerancia);
    const triggers = await cliente.$queryRawUnsafe<{ tabela: string; n: bigint }[]>(
      `SELECT c.relname AS tabela, count(*)::bigint AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE NOT t.tgisinternal AND c.relname IN ('tramitacao','log_auditoria') GROUP BY c.relname`,
    );
    const nTrig = (t: string) => Number(triggers.find((x) => x.tabela === t)?.n ?? 0);
    let updateBloqueado: boolean | null = null;
    if (restaurado.tramitacao > 0) {
      try {
        await cliente.$executeRawUnsafe(`UPDATE tramitacao SET id = id WHERE id = (SELECT id FROM tramitacao LIMIT 1)`);
        updateBloqueado = false;
      } catch {
        updateBloqueado = true;
      }
    }
    await cliente.$disconnect();
    cliente = null;

    const problemas = [
      ...comp.filter((c) => !c.ok).map((c) => `${c.tabela}: ${c.motivo}`),
      ...(nTrig("tramitacao") === 0 ? ["trigger de imutabilidade de tramitacao ausente"] : []),
      ...(nTrig("log_auditoria") === 0 ? ["trigger de imutabilidade de log_auditoria ausente"] : []),
      ...(updateBloqueado === false ? ["UPDATE em tramitacao não foi bloqueado"] : []),
    ];
    const obs = [
      `dump ${nome} baixado de ${dest.descricao(nome)}`,
      `sha256 conferido (${sha.slice(0, 16)}…)`,
      `decifrado e restaurado (pg_restore --exit-on-error) em ${duracaoRestore.toFixed(1)} s`,
      `triggers imutabilidade: tramitacao=${nTrig("tramitacao")}, log_auditoria=${nTrig("log_auditoria")}; UPDATE em tramitacao ${updateBloqueado === null ? "não testado (vazia)" : updateBloqueado ? "bloqueado" : "NÃO bloqueado"}`,
      `contagens restaurado/produção (tolerância ${Math.round(cfg.tolerancia * 100)}%): ${resumoComparacao(comp)}`,
      `banco descartável ${alvoExterno ? "limpo" : "apagado"}`,
      `origem: ${op.origem}`,
    ];
    if (problemas.length) throw Object.assign(new Error(`verificações falharam: ${problemas.join("; ")}`), { detalhe: obs.join("; ") });
    await limparAlvo(alvoExterno, alvo, criado);
    criado = false;

    const r = await registrarBackup({ tipo: "RESTORE_TESTE", tamanho, destino: descAlvo, sucesso: true, usuario_id: op.usuario_id ?? null, observacao: `Restauração automática OK em ${((Date.now() - inicio) / 1000).toFixed(1)} s: ${obs.join("; ")}` });
    return { status: "ok" as const, registro_id: r.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const detalhe = (e as { detalhe?: string }).detalhe;
    await cliente?.$disconnect().catch(() => {});
    await limparAlvo(alvoExterno, alvo, criado).catch(() => {});
    const r = await registrarBackup({ tipo: "RESTORE_TESTE", tamanho, destino: descAlvo, sucesso: false, usuario_id: op.usuario_id ?? null, observacao: `Falha: ${msg.slice(0, 1500)}${detalhe ? ` | ${detalhe}` : ""}; origem: ${op.origem}` }).catch(() => null);
    await alertar("FALHA no teste de restauração do backup", `${new Date().toISOString()} – ${msg}`);
    return { status: "falha" as const, registro_id: r?.id, mensagem: msg };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

async function limparAlvo(externo: string | undefined, alvo: { url: string; senha: string }, criado: boolean) {
  if (process.env.BACKUP_RESTORE_MANTER === "true") return;
  if (externo) await exigir("psql", ["-qc", "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;", `--dbname=${alvo.url}`], { PGPASSWORD: alvo.senha });
  else if (criado) await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${BANCO_RESTORE_PADRAO}" WITH (FORCE)`);
}

// ───────────────────────── disparo pela interface ─────────────────────────

/**
 * Dispara em segundo plano (no processo atual) e resolve quando a execução começou (lock obtido) ou
 * terminou/foi recusada – o que vier primeiro. A página acompanha pelo lock (execucoesEmAndamento).
 */
export function dispararEmSegundoPlano(tipo: "backup" | "restore", op: Omit<Opcoes, "onInicio">): Promise<ResultadoExecucao | "iniciado"> {
  return new Promise((resolve) => {
    const fn = tipo === "backup" ? executarBackup : executarTesteRestauracao;
    fn({ ...op, onInicio: () => resolve("iniciado") })
      .then((r) => resolve(r))
      .catch((e) => {
        console.error(`[backup] ${tipo}`, e);
        resolve({ status: "falha", mensagem: e instanceof Error ? e.message : String(e) });
      });
  });
}
