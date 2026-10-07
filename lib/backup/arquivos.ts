import "server-only";
// Replicação dos ARQUIVOS (uploads) para o destino de backup – docs/ged-design.md §9, docs/backup.md §4.
//
// O dump do banco (lib/backup/executar.ts) NÃO leva os arquivos enviados. Este módulo copia, uma vez por dia (fila
// `storage-replicar`, jobs/ged-backup.ts), toda chave de storage referenciada por
//     Anexo.storage_key · DocumentoOficial.storage_key · GedVersaoDocumento.storage_key
// criada depois da última marca d'água, para  `arquivos/{storage_key}`  no destino de backup:
//   1. `BACKUP_ARQUIVOS_DIR` (diretório local/NAS – desenvolvimento, testes, ponto de montagem), ou
//   2. o bucket externo `BACKUP_S3_*` (outro provedor), prefixo `BACKUP_ARQUIVOS_PREFIX` (padrão `arquivos/`), ou
//   3. sem nenhum dos dois: o storage da própria aplicação em `backups/arquivos/` (MESMO provedor – o registro avisa).
//
// Garantias: confere tamanho + sha256 depois de copiar (sha256 vai no metadata do objeto S3 ou em sidecar
// `<arquivo>.sha256` no diretório); NUNCA apaga nada no destino (a interface DestinoArquivos nem tem "remover");
// reconciliação semanal compara o inventário do banco com a listagem do destino e copia o que faltar;
// cada execução vira uma linha em backup_registro (tipo REPLICACAO_ARQUIVOS) com contagens, bytes e erros.
// É código de PLATAFORMA (entre clientes): descobre as chaves de todos os clientes direto no Prisma – por isso vive
// em lib/backup e não em lib/ged. Restauração: restaurarArquivos() / `npm run backup:restore-arquivos`.
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { prisma } from "../db";
import { registrarAuditoria } from "../audit";
import { driverStorage, lerArquivo, salvarArquivo } from "../storage";
import { lerConfig, type ConfigOffsite } from "./nucleo";

export const TIPO_REPLICACAO = "REPLICACAO_ARQUIVOS";
export const PREFIXO_PADRAO = "arquivos/";
/** Sobreposição da marca d'água (relógios/commits atrasados); o "já está no destino" evita recopiar. */
export const MARGEM_MARCA_MS = 60 * 60 * 1000;
export const LOTE_PADRAO = 2000;
const TRAVA = 73_100;
const TRAVA_REPLICACAO = 3;

// ───────────────────────── Funções puras (testadas em tests/unit/backup-arquivos.test.ts) ─────────────────────────

/**
 * Chave de storage aceitável para replicar: relativa, sem `..`, barra invertida, `//`, `:` (URL/unidade), caracteres de
 * controle, até 512 caracteres. Lança Error com a regra violada (a chave nunca vem de entrada de usuário, mas o destino
 * é gravado em disco: defesa contra caminho fora do diretório).
 */
export function validarChave(chave: unknown): string {
  if (typeof chave !== "string" || chave.length === 0) throw new Error("chave vazia");
  if (chave.length > 512) throw new Error("chave longa demais");
  if (chave.startsWith("/") || chave.includes("..") || chave.includes("\\") || chave.includes("//") || chave.includes(":") || /[\u0000-\u001f]/.test(chave)) {
    throw new Error(`chave inválida: ${JSON.stringify(chave.slice(0, 80))}`);
  }
  return chave;
}

/** `ged/<org>/…` → `arquivos/ged/<org>/…` (prefixo configurável, sempre terminando em "/"). */
export function chaveDestino(chaveOrigem: string, prefixo = PREFIXO_PADRAO): string {
  return `${normalizarPrefixo(prefixo)}${validarChave(chaveOrigem)}`;
}

/** Inverso de chaveDestino; null se a chave não está sob o prefixo. */
export function chaveOrigemDe(chaveDest: string, prefixo = PREFIXO_PADRAO): string | null {
  const p = normalizarPrefixo(prefixo);
  return chaveDest.startsWith(p) && chaveDest.length > p.length ? chaveDest.slice(p.length) : null;
}

export function normalizarPrefixo(p: string): string {
  const s = p.replace(/^\/+/, "").replace(/\/+$/, "");
  return s ? `${s}/` : "";
}

/** Mantém só as chaves sob `prefixo` (ex.: `ged/<organizacao_id>/`). Prefixo vazio = todas. */
export function filtrarPrefixo<T extends string | { chave: string }>(itens: T[], prefixo?: string | null): T[] {
  if (!prefixo) return itens;
  const p = prefixo.replace(/^\/+/, "");
  return itens.filter((i) => (typeof i === "string" ? i : i.chave).startsWith(p));
}

export type ItemInventario = { chave: string; tamanho: number | null; sha256: string | null };
export type ItemListado = { chave: string; tamanho: number };
export type Diferenca = { faltando: ItemInventario[]; tamanhoDiferente: ItemInventario[]; sobrando: string[] };

/**
 * Compara inventário (banco) × listagem do destino, ambos por chave de ORIGEM. `faltando` = não está no destino;
 * `tamanhoDiferente` = está, mas com tamanho distinto do registrado (quando conhecido); `sobrando` = só no destino
 * (apenas informativo – nunca é apagado). Duplicatas no inventário são unificadas.
 */
export function diferenca(inventario: ItemInventario[], listagemDestino: ItemListado[]): Diferenca {
  const dest = new Map(listagemDestino.map((x) => [x.chave, x.tamanho]));
  const vistos = new Set<string>();
  const faltando: ItemInventario[] = [];
  const tamanhoDiferente: ItemInventario[] = [];
  for (const i of inventario) {
    if (vistos.has(i.chave)) continue;
    vistos.add(i.chave);
    const t = dest.get(i.chave);
    if (t === undefined) faltando.push(i);
    else if (i.tamanho !== null && i.tamanho !== t) tamanhoDiferente.push(i);
  }
  const sobrando = [...dest.keys()].filter((k) => !vistos.has(k)).sort();
  return { faltando, tamanhoDiferente, sobrando };
}

export type ConferenciaCopia = { ok: boolean; motivo?: string };
/** Confere o que ficou no destino contra o que foi enviado (tamanho e sha256, este quando o destino o devolve). */
export function conferirCopia(esperado: { tamanho: number; sha256: string }, obtido: { tamanho: number; sha256: string | null } | null): ConferenciaCopia {
  if (!obtido) return { ok: false, motivo: "objeto não encontrado no destino após a cópia" };
  if (obtido.tamanho !== esperado.tamanho) return { ok: false, motivo: `tamanho ${obtido.tamanho} ≠ ${esperado.tamanho}` };
  if (obtido.sha256 !== null && obtido.sha256.toLowerCase() !== esperado.sha256.toLowerCase()) return { ok: false, motivo: "sha256 do destino diverge" };
  return { ok: true };
}

/** O objeto já está no destino íntegro (mesmo tamanho; mesmo sha256 quando o destino o guarda)? Evita recopiar. */
export function jaReplicado(atual: { tamanho: number; sha256: string | null } | null, esperado: { tamanho: number; sha256: string }): boolean {
  return !!atual && conferirCopia(esperado, atual).ok && atual.sha256 !== null;
}

/** Marca d'água usada na próxima consulta: a anterior menos a margem (sem marca = época → copia tudo). */
export function inicioConsulta(marca: Date | null, margemMs = MARGEM_MARCA_MS): Date {
  return marca ? new Date(marca.getTime() - margemMs) : new Date(0);
}

/**
 * Nova marca d'água ao fim da execução: se houve ERRO, mantém a anterior (os itens com erro serão reconsultados);
 * se o lote foi truncado, o `created_at` do último item processado; senão o instante de INÍCIO da execução.
 */
export function novaMarca(p: { anterior: Date | null; inicio: Date; erros: number; ultimoProcessado: Date | null; truncado: boolean }): Date | null {
  if (p.erros > 0) return p.anterior;
  if (p.truncado && p.ultimoProcessado) return p.ultimoProcessado;
  return p.inicio;
}

export type InfoReplicacao = {
  modo: "INCREMENTAL" | "RECONCILIACAO";
  marca: Date | null;
  copiados: number;
  jaNoDestino: number;
  bytes: number;
  erros: number;
  divergencias: number;
  sobrando?: number;
  tamanhoDiferente?: number;
  duracaoMs: number;
  origem: string;
  amostraErros?: string[];
};

/** Texto de `backup_registro.observacao` – legível e com `marca=` para o próximo ciclo. */
export function observacaoReplicacao(i: InfoReplicacao): string {
  return [
    `modo=${i.modo}`,
    `marca=${i.marca ? i.marca.toISOString() : "-"}`,
    `copiados=${i.copiados}`,
    `ja_no_destino=${i.jaNoDestino}`,
    `bytes=${i.bytes}`,
    `erros=${i.erros}`,
    `divergencias=${i.divergencias}`,
    ...(i.sobrando !== undefined ? [`sobrando=${i.sobrando}`] : []),
    ...(i.tamanhoDiferente !== undefined ? [`tamanho_diferente=${i.tamanhoDiferente}`] : []),
    `${(i.duracaoMs / 1000).toFixed(1)} s`,
    `origem: ${i.origem}`,
    ...(i.amostraErros?.length ? [`erros(amostra): ${i.amostraErros.join(" | ").slice(0, 600)}`] : []),
  ].join("; ");
}

/** Marca d'água (`marca=ISO`) da observação; null se ausente ou "-". */
export function marcaDaObservacao(obs: string | null | undefined): Date | null {
  const m = obs?.match(/(?:^|; )marca=(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/);
  if (!m) return null;
  const d = new Date(m[1]);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function contagemDaObservacao(obs: string | null | undefined, campo: string): number | null {
  const m = obs?.match(new RegExp(`(?:^|; )${campo}=(\\d+)`));
  return m ? Number(m[1]) : null;
}

export const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

// ───────────────────────── Destinos ─────────────────────────

/** Destino de arquivos. SEM operação de remoção, de propósito. As chaves aqui são as de ORIGEM (sem o prefixo). */
export interface DestinoArquivos {
  descricao: string;
  /** true = fora do provedor do app (offsite real) */
  foraDoProvedor: boolean;
  head(chave: string): Promise<{ tamanho: number; sha256: string | null } | null>;
  put(chave: string, dados: Buffer, sha256: string): Promise<void>;
  get(chave: string): Promise<Buffer>;
  /** Todas as chaves de origem sob `prefixo` (recursivo), sem sidecars. */
  listar(prefixo?: string): Promise<ItemListado[]>;
}

const SUFIXO_SIDECAR = ".sha256";

/** Diretório (local/NAS): `<dir>/<prefixo><chave>` + sidecar `<arquivo>.sha256`. */
export function destinoDiretorio(dir: string, prefixo = PREFIXO_PADRAO, foraDoProvedor = false): DestinoArquivos {
  const raiz = path.resolve(dir);
  const pref = normalizarPrefixo(prefixo);
  const base = path.resolve(raiz, pref);
  const caminho = (chave: string) => {
    const p = path.resolve(base, validarChave(chave));
    if (!p.startsWith(base + path.sep)) throw new Error("chave fora do diretório de destino");
    return p;
  };
  return {
    descricao: `diretório ${base}`,
    foraDoProvedor,
    async head(chave) {
      const p = caminho(chave);
      const st = await stat(p).catch(() => null);
      if (!st?.isFile()) return null;
      const sc = await readFile(p + SUFIXO_SIDECAR, "utf8").catch(() => null);
      return { tamanho: st.size, sha256: sc?.trim().match(/^[0-9a-f]{64}/i)?.[0].toLowerCase() ?? null };
    },
    async put(chave, dados, hash) {
      const p = caminho(chave);
      await mkdir(path.dirname(p), { recursive: true });
      await writeFile(p, dados);
      await writeFile(p + SUFIXO_SIDECAR, `${hash}\n`);
    },
    get: (chave) => readFile(caminho(chave)),
    async listar(prefixoChave = "") {
      const res: ItemListado[] = [];
      const andar = async (d: string, rel: string) => {
        const itens = await readdir(d, { withFileTypes: true }).catch(() => []);
        for (const it of itens) {
          const r = rel ? `${rel}/${it.name}` : it.name;
          if (it.isDirectory()) await andar(path.join(d, it.name), r);
          else if (it.isFile() && !it.name.endsWith(SUFIXO_SIDECAR)) res.push({ chave: r, tamanho: (await stat(path.join(d, it.name))).size });
        }
      };
      await andar(base, "");
      return filtrarPrefixo(res, prefixoChave).sort((a, b) => a.chave.localeCompare(b.chave));
    },
  };
}

type ParamsS3 = { s3: S3Client; bucket: string; prefixo: string; descricao: string; foraDoProvedor: boolean };

/** Bucket S3-compatível: objeto `<prefixo><chave>`, sha256 em Metadata (`sha256`). */
export function destinoS3(p: ParamsS3): DestinoArquivos {
  const pref = normalizarPrefixo(p.prefixo);
  const chaveS3 = (c: string) => `${pref}${validarChave(c)}`;
  return {
    descricao: p.descricao,
    foraDoProvedor: p.foraDoProvedor,
    async head(chave) {
      try {
        const r = await p.s3.send(new HeadObjectCommand({ Bucket: p.bucket, Key: chaveS3(chave) }));
        return { tamanho: Number(r.ContentLength ?? 0), sha256: r.Metadata?.sha256?.toLowerCase() ?? null };
      } catch (e) {
        const x = e as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (x.name === "NotFound" || x.name === "NoSuchKey" || x.$metadata?.httpStatusCode === 404) return null;
        throw e;
      }
    },
    async put(chave, dados, hash) {
      const r = await p.s3.send(new PutObjectCommand({ Bucket: p.bucket, Key: chaveS3(chave), Body: dados, ContentLength: dados.length, ContentType: "application/octet-stream", Metadata: { sha256: hash } }));
      const etag = r.ETag?.replace(/"/g, "");
      if (etag && /^[0-9a-f]{32}$/.test(etag) && etag !== createHash("md5").update(dados).digest("hex")) throw new Error("ETag (MD5) do destino diverge do enviado");
    },
    async get(chave) {
      const r = await p.s3.send(new GetObjectCommand({ Bucket: p.bucket, Key: chaveS3(chave) }));
      return Buffer.from(await r.Body!.transformToByteArray());
    },
    async listar(prefixoChave = "") {
      const res: ItemListado[] = [];
      let token: string | undefined;
      do {
        const r = await p.s3.send(new ListObjectsV2Command({ Bucket: p.bucket, Prefix: `${pref}${prefixoChave}`, ContinuationToken: token }));
        for (const o of r.Contents ?? []) if (o.Key && o.Key.startsWith(pref)) res.push({ chave: o.Key.slice(pref.length), tamanho: Number(o.Size ?? 0) });
        token = r.IsTruncated ? r.NextContinuationToken : undefined;
      } while (token);
      return res;
    },
  };
}

const s3Offsite = (o: ConfigOffsite) =>
  new S3Client({ region: o.region, endpoint: o.endpoint, forcePathStyle: o.forcePathStyle, credentials: { accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey } });

/** Escolhe o destino (ver cabeçalho). `BACKUP_ARQUIVOS_PREFIX` ajusta o prefixo do bucket externo/diretório. */
export function resolverDestino(env: Record<string, string | undefined> = process.env): DestinoArquivos {
  const prefixo = normalizarPrefixo(env.BACKUP_ARQUIVOS_PREFIX?.trim() || PREFIXO_PADRAO);
  const dirExplicito = env.BACKUP_ARQUIVOS_DIR?.trim();
  if (dirExplicito) return destinoDiretorio(dirExplicito, prefixo, true);
  const cfg = lerConfig(env);
  if (cfg.offsite) {
    const o = cfg.offsite;
    return destinoS3({ s3: s3Offsite(o), bucket: o.bucket, prefixo, descricao: `s3://${o.bucket}/${prefixo} (fora do provedor)`, foraDoProvedor: true });
  }
  // Fallback: storage da aplicação em backups/arquivos/ (mesmo provedor – o registro avisa).
  const fb = `backups/${prefixo}`;
  if (driverStorage() === "s3") {
    const endpoint = env.S3_ENDPOINT || undefined;
    const s3 = new S3Client({
      region: env.S3_REGION || (endpoint ? "auto" : "sa-east-1"),
      endpoint,
      forcePathStyle: env.S3_FORCE_PATH_STYLE ? env.S3_FORCE_PATH_STYLE === "true" : !!endpoint,
    });
    const bucket = env.S3_BUCKET ?? "licenciagov";
    return destinoS3({ s3, bucket, prefixo: fb, descricao: `storage da aplicação (s3://${bucket}/${fb}) – cópia fora do provedor NÃO configurada`, foraDoProvedor: false });
  }
  const d = destinoDiretorio(path.resolve(env.STORAGE_LOCAL_DIR ?? "./storage"), fb, false);
  return { ...d, descricao: `storage da aplicação (local): ${d.descricao} – cópia fora do provedor NÃO configurada` };
}

// ───────────────────────── Origem (inventário no banco) ─────────────────────────

export type FonteArquivos = "anexo" | "documento_oficial" | "ged_versao";
export type ItemOrigem = ItemInventario & { fonte: FonteArquivos; criado_em: Date };

const FONTES: { fonte: FonteArquivos; buscar: (desde: Date, limite: number | undefined, inclusivo: boolean) => Promise<ItemOrigem[]> }[] = [
  {
    fonte: "anexo",
    buscar: async (desde, take, inc) =>
      (await prisma.anexo.findMany({ where: { created_at: inc ? { gte: desde } : { gt: desde } }, orderBy: [{ created_at: "asc" }, { id: "asc" }], take, select: { storage_key: true, tamanho: true, sha256: true, created_at: true } })).map(
        (r) => ({ fonte: "anexo" as const, chave: r.storage_key, tamanho: r.tamanho, sha256: r.sha256, criado_em: r.created_at }),
      ),
  },
  {
    fonte: "documento_oficial",
    buscar: async (desde, take, inc) =>
      (await prisma.documentoOficial.findMany({ where: { created_at: inc ? { gte: desde } : { gt: desde } }, orderBy: [{ created_at: "asc" }, { id: "asc" }], take, select: { storage_key: true, sha256_pdf: true, created_at: true } })).map(
        (r) => ({ fonte: "documento_oficial" as const, chave: r.storage_key, tamanho: null, sha256: r.sha256_pdf, criado_em: r.created_at }),
      ),
  },
  {
    fonte: "ged_versao",
    buscar: async (desde, take, inc) =>
      (await prisma.gedVersaoDocumento.findMany({ where: { created_at: inc ? { gte: desde } : { gt: desde } }, orderBy: [{ created_at: "asc" }, { id: "asc" }], take, select: { storage_key: true, tamanho: true, sha256: true, created_at: true } })).map(
        (r) => ({ fonte: "ged_versao" as const, chave: r.storage_key, tamanho: r.tamanho, sha256: r.sha256, criado_em: r.created_at }),
      ),
  },
];

/** Itens criados a partir de `desde` (os `limite` mais antigos entre as três tabelas, em ordem de criação). Plataforma: sem escopo de cliente. */
export async function inventarioDesde(desde: Date, limite?: number): Promise<{ itens: ItemOrigem[]; truncado: boolean }> {
  const todos = (await Promise.all(FONTES.map((f) => f.buscar(desde, limite, true)))).flat().sort((a, b) => a.criado_em.getTime() - b.criado_em.getTime());
  // Lote cheio (>= limite) pode ter mais itens atrás: quem chama continua a partir do último `created_at` (>= + "já no destino").
  return { itens: limite ? todos.slice(0, limite) : todos, truncado: !!limite && todos.length >= limite };
}

/** Inventário COMPLETO (para a reconciliação). Pagina por tabela para não estourar memória. */
export async function inventarioCompleto(): Promise<ItemOrigem[]> {
  const res: ItemOrigem[] = [];
  for (const f of FONTES) {
    let cursor = new Date(0);
    let ultimoCount = -1;
    for (;;) {
      const lote = await f.buscar(cursor, 5000, true);
      for (const i of lote) res.push(i);
      if (lote.length < 5000) break;
      const novo = lote[lote.length - 1].criado_em;
      if (novo.getTime() === cursor.getTime() && lote.length === ultimoCount) cursor = new Date(novo.getTime() + 1);
      else cursor = novo;
      ultimoCount = lote.length;
    }
  }
  return res;
}

// ───────────────────────── Execução ─────────────────────────

export type ResultadoReplicacao = {
  status: "ok" | "falha" | "em_andamento";
  registro_id?: string;
  modo: InfoReplicacao["modo"];
  copiados: number;
  jaNoDestino: number;
  bytes: number;
  erros: number;
  divergencias: number;
  sobrando?: number;
  tamanhoDiferente?: number;
  mensagem?: string;
};

export type OpcoesReplicacao = {
  origem: string;
  /** destino alternativo (testes); padrão resolverDestino() */
  destino?: DestinoArquivos;
  /** leitura alternativa da origem (testes); padrão lib/storage.lerArquivo */
  ler?: (chave: string) => Promise<Buffer>;
  lote?: number;
  /** orçamento de tempo da execução (padrão REPLICACAO_TEMPO_MAX_MIN = 50 min) */
  tempoMaxMs?: number;
  agora?: Date;
  /** não registra em backup_registro (testes) */
  semRegistro?: boolean;
};

async function comTrava<T>(fn: () => Promise<T>): Promise<T | null> {
  return prisma.$transaction(
    async (tx) => {
      const [r] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${TRAVA}::int, ${TRAVA_REPLICACAO}::int) AS ok`;
      if (!r?.ok) return null;
      return fn();
    },
    { maxWait: 15_000, timeout: 6 * 3600_000 },
  );
}

type Contadores = { copiados: number; jaNoDestino: number; bytes: number; erros: number; divergencias: number; amostra: string[] };

/** Copia um item (se faltar/estiver diferente), confere e conta. Nunca lança. */
async function replicarItem(i: ItemInventario, destino: DestinoArquivos, ler: (c: string) => Promise<Buffer>, c: Contadores) {
  const erro = (m: string) => {
    c.erros++;
    if (c.amostra.length < 8) c.amostra.push(`${i.chave}: ${m}`);
  };
  try {
    validarChave(i.chave);
    let dados: Buffer;
    try {
      dados = await ler(i.chave);
    } catch (e) {
      return erro(`origem ilegível (${(e as Error).message})`);
    }
    const hash = sha256(dados);
    const atual = await destino.head(i.chave);
    if (jaReplicado(atual, { tamanho: dados.length, sha256: hash })) {
      c.jaNoDestino++;
      return;
    }
    if (i.sha256 && i.sha256.toLowerCase() !== hash) {
      // O registro do banco diz outro hash: copia mesmo assim (é o que existe), mas sinaliza para investigação.
      c.divergencias++;
      if (c.amostra.length < 8) c.amostra.push(`${i.chave}: sha256 do arquivo difere do registro no banco`);
    }
    await destino.put(i.chave, dados, hash);
    const conf = conferirCopia({ tamanho: dados.length, sha256: hash }, await destino.head(i.chave));
    if (!conf.ok) return erro(conf.motivo ?? "verificação falhou");
    c.copiados++;
    c.bytes += dados.length;
  } catch (e) {
    erro((e as Error).message);
  }
}

async function ultimoRegistroOk() {
  return prisma.backupRegistro.findFirst({ where: { tipo: TIPO_REPLICACAO, sucesso: true }, orderBy: { executado_em: "desc" } });
}

async function gravarRegistro(info: InfoReplicacao, destino: DestinoArquivos, bytes: number, op: OpcoesReplicacao): Promise<string | undefined> {
  if (op.semRegistro) return undefined;
  const reg = await prisma.backupRegistro.create({
    data: {
      tipo: TIPO_REPLICACAO,
      tamanho: BigInt(bytes),
      destino: destino.descricao,
      sucesso: info.erros === 0,
      observacao: observacaoReplicacao(info),
      executado_em: op.agora ?? new Date(),
    },
  });
  await registrarAuditoria({ usuario_id: null, acao: "REPLICACAO_ARQUIVOS_REGISTRO", entidade: "backup_registro", entidade_id: reg.id, depois: { ...reg, tamanho: reg.tamanho?.toString() ?? null } });
  return reg.id;
}

/** Replicação INCREMENTAL: itens criados depois da última marca d'água (com sobreposição). */
export async function replicarArquivos(op: OpcoesReplicacao): Promise<ResultadoReplicacao> {
  const r = await comTrava(async () => {
    const inicio = op.agora ?? new Date();
    const t0 = Date.now();
    const destino = op.destino ?? resolverDestino();
    const ler = op.ler ?? lerArquivo;
    const lote = op.lote ?? (Number(process.env.REPLICACAO_LOTE) > 0 ? Number(process.env.REPLICACAO_LOTE) : LOTE_PADRAO);
    const tempoMax = op.tempoMaxMs ?? (Number(process.env.REPLICACAO_TEMPO_MAX_MIN) > 0 ? Number(process.env.REPLICACAO_TEMPO_MAX_MIN) * 60_000 : 50 * 60_000);
    const anterior = marcaDaObservacao((await ultimoRegistroOk())?.observacao);
    const c: Contadores = { copiados: 0, jaNoDestino: 0, bytes: 0, erros: 0, divergencias: 0, amostra: [] };
    let cursor = inicioConsulta(anterior);
    let ultimo: Date | null = null;
    let truncado = false;
    try {
      for (;;) {
        const { itens, truncado: t } = await inventarioDesde(cursor, lote);
        const unicos = new Map<string, ItemOrigem>();
        for (const i of itens) if (!unicos.has(i.chave)) unicos.set(i.chave, i);
        for (const i of unicos.values()) await replicarItem(i, destino, ler, c);
        if (itens.length) ultimo = itens[itens.length - 1].criado_em;
        if (!t) {
          truncado = false;
          break;
        }
        // lote cheio: avança (se o carimbo não andou, +1 ms para não repetir para sempre)
        cursor = ultimo && ultimo.getTime() > cursor.getTime() ? ultimo : new Date(cursor.getTime() + 1);
        if (Date.now() - t0 > tempoMax) {
          truncado = true;
          break;
        }
      }
    } catch (e) {
      c.erros++;
      c.amostra.push(`falha geral: ${(e as Error).message}`);
    }
    const marca = novaMarca({ anterior, inicio, erros: c.erros, ultimoProcessado: ultimo, truncado });
    const info: InfoReplicacao = { modo: "INCREMENTAL", marca, copiados: c.copiados, jaNoDestino: c.jaNoDestino, bytes: c.bytes, erros: c.erros, divergencias: c.divergencias, duracaoMs: Date.now() - t0, origem: op.origem, amostraErros: c.amostra };
    const registro_id = await gravarRegistro(info, destino, c.bytes, op);
    const res: ResultadoReplicacao = { status: c.erros ? "falha" : "ok", registro_id, modo: "INCREMENTAL", copiados: c.copiados, jaNoDestino: c.jaNoDestino, bytes: c.bytes, erros: c.erros, divergencias: c.divergencias };
    if (!destino.foraDoProvedor) res.mensagem = "destino NO MESMO provedor do app (BACKUP_S3_* ou BACKUP_ARQUIVOS_DIR não configurados)";
    return res;
  });
  return r ?? { status: "em_andamento", modo: "INCREMENTAL", copiados: 0, jaNoDestino: 0, bytes: 0, erros: 0, divergencias: 0, mensagem: "Já existe uma replicação em execução." };
}

/**
 * RECONCILIAÇÃO semanal: inventário completo do banco × listagem do destino. Copia o que faltar (ou estiver com
 * tamanho diferente) e informa `sobrando` (só no destino – nunca apagado). Não altera a marca d'água.
 */
export async function reconciliarArquivos(op: OpcoesReplicacao): Promise<ResultadoReplicacao> {
  const r = await comTrava(async () => {
    const t0 = Date.now();
    const destino = op.destino ?? resolverDestino();
    const ler = op.ler ?? lerArquivo;
    const anterior = marcaDaObservacao((await ultimoRegistroOk())?.observacao);
    const c: Contadores = { copiados: 0, jaNoDestino: 0, bytes: 0, erros: 0, divergencias: 0, amostra: [] };
    let dif: Diferenca = { faltando: [], tamanhoDiferente: [], sobrando: [] };
    let inventarioTotal = 0;
    try {
      const inv = await inventarioCompleto();
      inventarioTotal = new Set(inv.map((i) => i.chave)).size;
      dif = diferenca(inv, await destino.listar());
      for (const i of [...dif.faltando, ...dif.tamanhoDiferente]) await replicarItem(i, destino, ler, c);
      c.jaNoDestino = inventarioTotal - dif.faltando.length - dif.tamanhoDiferente.length;
    } catch (e) {
      c.erros++;
      c.amostra.push(`falha geral: ${(e as Error).message}`);
    }
    const info: InfoReplicacao = {
      modo: "RECONCILIACAO", marca: anterior, copiados: c.copiados, jaNoDestino: c.jaNoDestino, bytes: c.bytes, erros: c.erros, divergencias: c.divergencias,
      sobrando: dif.sobrando.length, tamanhoDiferente: dif.tamanhoDiferente.length, duracaoMs: Date.now() - t0, origem: op.origem, amostraErros: c.amostra,
    };
    const registro_id = await gravarRegistro(info, destino, c.bytes, op);
    return {
      status: c.erros ? ("falha" as const) : ("ok" as const), registro_id, modo: "RECONCILIACAO" as const, copiados: c.copiados, jaNoDestino: c.jaNoDestino, bytes: c.bytes, erros: c.erros,
      divergencias: c.divergencias, sobrando: dif.sobrando.length, tamanhoDiferente: dif.tamanhoDiferente.length,
    };
  });
  return r ?? { status: "em_andamento", modo: "RECONCILIACAO", copiados: 0, jaNoDestino: 0, bytes: 0, erros: 0, divergencias: 0, mensagem: "Já existe uma replicação em execução." };
}

// ───────────────────────── Situação (alerta no backup-check) ─────────────────────────

/**
 * Última replicação de arquivos. `atrasada` = nenhuma execução bem-sucedida há mais de 24 h (ou nunca).
 * Integração no jobs/backup-check.ts (uma linha, em `verificarBackup`):
 *   `const rep = await ultimaReplicacao(agora); if (rep.atrasada) problemas.push(rep.ultima ? `Última replicação de arquivos há ${Math.floor(rep.horas!)} h (limite 24 h).` : "Nenhuma replicação de arquivos registrada.");`
 */
export async function ultimaReplicacao(agora = new Date()) {
  const [ultima, falha] = await Promise.all([
    ultimoRegistroOk(),
    prisma.backupRegistro.findFirst({ where: { tipo: TIPO_REPLICACAO, sucesso: false }, orderBy: { executado_em: "desc" } }),
  ]);
  const horas = ultima ? (agora.getTime() - ultima.executado_em.getTime()) / 3600000 : null;
  return {
    ultima,
    ultimaFalha: falha && (!ultima || falha.executado_em > ultima.executado_em) ? falha : null,
    horas,
    atrasada: horas === null || horas > 24,
    marca: marcaDaObservacao(ultima?.observacao),
  };
}

// ───────────────────────── Restauração ─────────────────────────

export type OpcoesRestauracao = {
  /** de onde copiar (destino de backup) */
  origem: DestinoArquivos;
  /** para onde gravar – padrão: o storage da aplicação (lib/storage.salvarArquivo) */
  destino?: { gravar(chave: string, dados: Buffer): Promise<void>; existe?(chave: string): Promise<boolean> };
  /** prefixo de chave de origem, ex.: `ged/<organizacao_id>/` (restaura só um cliente) */
  prefixo?: string;
  /** só lista o que seria restaurado */
  simular?: boolean;
  /** sobrescreve arquivos já existentes no destino (padrão: preserva) */
  sobrescrever?: boolean;
};
export type ResultadoRestauracao = { total: number; restaurados: number; jaExistiam: number; bytes: number; erros: string[]; simulado: boolean };

/**
 * Restaura arquivos do destino de backup para o storage da aplicação, conferindo o sha256 do sidecar/metadata.
 * Ordem na recuperação de desastre: 1) banco (docs/restore.md §C)  2) arquivos (este comando).
 */
export async function restaurarArquivos(op: OpcoesRestauracao): Promise<ResultadoRestauracao> {
  const lista = filtrarPrefixo(await op.origem.listar(op.prefixo ?? ""), op.prefixo);
  const res: ResultadoRestauracao = { total: lista.length, restaurados: 0, jaExistiam: 0, bytes: 0, erros: [], simulado: !!op.simular };
  const gravar = op.destino?.gravar ?? ((k: string, d: Buffer) => salvarArquivo(k, d));
  const existe = op.destino?.existe ?? (async (k: string) => lerArquivo(k).then(() => true, () => false));
  for (const it of lista) {
    try {
      validarChave(it.chave);
      if (!op.sobrescrever && (await existe(it.chave))) {
        res.jaExistiam++;
        continue;
      }
      if (op.simular) {
        res.restaurados++;
        res.bytes += it.tamanho;
        continue;
      }
      const dados = await op.origem.get(it.chave);
      const h = sha256(dados);
      const meta = await op.origem.head(it.chave);
      const conf = conferirCopia({ tamanho: dados.length, sha256: h }, meta ? { tamanho: meta.tamanho, sha256: meta.sha256 } : null);
      if (!conf.ok) throw new Error(conf.motivo);
      await gravar(it.chave, dados);
      res.restaurados++;
      res.bytes += dados.length;
    } catch (e) {
      res.erros.push(`${it.chave}: ${(e as Error).message}`);
    }
  }
  return res;
}
