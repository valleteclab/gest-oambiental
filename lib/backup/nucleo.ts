// Funções puras do backup real (sem banco, sem I/O) – testadas em tests/unit/backup.test.ts.
// Execução: lib/backup/executar.ts (worker `backup` / `restore-test` e botões em /admin/backup).

/** Prefixo e extensão dos dumps: licenciagov-AAAAMMDDTHHMMSSZ.dump.enc (pg_dump -Fc cifrado com openssl AES-256-CBC/PBKDF2). */
export const PREFIXO_ARQUIVO = "licenciagov-";
export const EXTENSAO_ARQUIVO = ".dump.enc";
const RE_NOME = /^licenciagov-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.dump\.enc$/;

export function nomeArquivoBackup(quando: Date): string {
  const carimbo = quando.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");
  return `${PREFIXO_ARQUIVO}${carimbo}${EXTENSAO_ARQUIVO}`;
}

/** Data (UTC) embutida no nome do arquivo; null se o nome não é de um dump nosso. Aceita caminho/chave com prefixo. */
export function dataDoNome(nomeOuChave: string): Date | null {
  const nome = nomeOuChave.split("/").pop() ?? "";
  const m = nome.match(RE_NOME);
  if (!m) return null;
  const [, a, mo, d, h, mi, s] = m;
  const dt = new Date(Date.UTC(+a, +mo - 1, +d, +h, +mi, +s));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/**
 * Retenção: chaves de dumps (e seus .sha256) mais antigos que `dias`. O dump mais recente NUNCA é
 * removido, mesmo que antigo (se o backup parou de rodar, não apagamos a última cópia boa).
 * Chaves que não seguem o padrão de nome são ignoradas.
 */
export function selecionarParaRemover(chaves: string[], agora: Date, dias: number): string[] {
  const dumps = chaves
    .map((k) => ({ k, d: dataDoNome(k) }))
    .filter((x): x is { k: string; d: Date } => x.d !== null)
    .sort((a, b) => b.d.getTime() - a.d.getTime());
  if (dumps.length <= 1 || !(dias > 0)) return [];
  const limite = agora.getTime() - dias * 86_400_000;
  const velhos = dumps.slice(1).filter((x) => x.d.getTime() < limite).map((x) => x.k);
  const sidecars = velhos.map((k) => `${k}.sha256`).filter((s) => chaves.includes(s));
  return [...velhos, ...sidecars];
}

/** Chave do dump mais recente (pelo carimbo do nome). */
export function maisRecente(chaves: string[]): string | null {
  let melhor: { k: string; t: number } | null = null;
  for (const k of chaves) {
    const d = dataDoNome(k);
    if (d && (!melhor || d.getTime() > melhor.t)) melhor = { k, t: d.getTime() };
  }
  return melhor?.k ?? null;
}

// ───────────────────────── Configuração (variáveis de ambiente) ─────────────────────────

export type ConfigOffsite = { endpoint?: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string; prefixo: string; forcePathStyle: boolean };
export type ConfigBackup = {
  offsite: ConfigOffsite | null;
  /** motivo pelo qual o offsite não está ativo (variáveis ausentes) */
  offsiteFaltando: string[];
  prefixoLocal: string;
  retencaoDias: number;
  passphraseDerivada: boolean;
  schemas: string[];
  cronBackup: string;
  cronRestore: string;
  tz: string;
  tolerancia: number;
};

const vazio = (v: string | undefined) => v === undefined || v.trim() === "";

export function lerConfig(env: Record<string, string | undefined> = process.env): ConfigBackup {
  const obrig = ["BACKUP_S3_BUCKET", "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY"] as const;
  const faltando = obrig.filter((k) => vazio(env[k]));
  const prefixo = (env.BACKUP_S3_PREFIX ?? "pg/").replace(/^\/+/, "");
  const offsite: ConfigOffsite | null =
    faltando.length === 0
      ? {
          endpoint: vazio(env.BACKUP_S3_ENDPOINT) ? undefined : env.BACKUP_S3_ENDPOINT!.trim(),
          bucket: env.BACKUP_S3_BUCKET!.trim(),
          region: vazio(env.BACKUP_S3_REGION) ? "auto" : env.BACKUP_S3_REGION!.trim(),
          accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID!.trim(),
          secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY!.trim(),
          prefixo: prefixo && !prefixo.endsWith("/") ? `${prefixo}/` : prefixo,
          forcePathStyle: env.BACKUP_S3_FORCE_PATH_STYLE === "true",
        }
      : null;
  const ret = Number(env.BACKUP_RETENCAO_DIAS);
  const tol = Number(env.BACKUP_RESTORE_TOLERANCIA);
  return {
    offsite,
    offsiteFaltando: offsite ? [] : [...faltando],
    prefixoLocal: "backups/",
    retencaoDias: Number.isFinite(ret) && ret > 0 ? Math.floor(ret) : 30,
    passphraseDerivada: vazio(env.BACKUP_PASSPHRASE),
    schemas: (env.BACKUP_SCHEMAS ?? "public").split(",").map((s) => s.trim()).filter(Boolean),
    cronBackup: vazio(env.BACKUP_CRON) ? "15 3 * * *" : env.BACKUP_CRON!.trim(),
    cronRestore: vazio(env.BACKUP_RESTORE_CRON) ? "45 4 1 * *" : env.BACKUP_RESTORE_CRON!.trim(),
    tz: vazio(env.JOBS_TZ) ? "America/Bahia" : env.JOBS_TZ!.trim(),
    tolerancia: Number.isFinite(tol) && tol >= 0 && tol < 1 ? tol : 0.1,
  };
}

/** Host do bucket offsite (endpoint S3-compatível ou AWS na região). */
export function hostOffsite(o: Pick<ConfigOffsite, "endpoint" | "region">): string {
  if (!o.endpoint) return `s3.${o.region}.amazonaws.com`;
  try {
    return new URL(o.endpoint).host;
  } catch {
    return o.endpoint;
  }
}

/** Descrição legível do destino gravada em backup_registro.destino. */
export function descreverDestino(cfg: Pick<ConfigBackup, "offsite" | "prefixoLocal">, nome: string, storageDriver = "local"): string {
  if (cfg.offsite) {
    return `s3://${cfg.offsite.bucket}/${cfg.offsite.prefixo}${nome} (fora do provedor: ${hostOffsite(cfg.offsite)})`;
  }
  return `storage da aplicação (${storageDriver}): ${cfg.prefixoLocal}${nome} – cópia fora do provedor NÃO configurada`;
}

// ───────────────────────── Registro (observação) ─────────────────────────

export type InfoBackup = { sha256: string; pgDumpVersao: string; schemas: string[]; duracaoMs: number; removidos: number; retencaoDias: number; origem: string; passphraseDerivada: boolean };

export function observacaoBackup(i: InfoBackup): string {
  return [
    `sha256=${i.sha256}`,
    `${i.pgDumpVersao} -Fc (schemas: ${i.schemas.join(",")})`,
    `AES-256-CBC/PBKDF2 (openssl)${i.passphraseDerivada ? " – chave derivada da DATA_KEY (BACKUP_PASSPHRASE não definida)" : ""}`,
    `${(i.duracaoMs / 1000).toFixed(1)} s`,
    `retenção ${i.retencaoDias} d: ${i.removidos} removido(s)`,
    `origem: ${i.origem}`,
  ].join("; ");
}

/** Extrai o sha256 gravado na observação do registro de backup. */
export function sha256DaObservacao(obs: string | null | undefined): string | null {
  return obs?.match(/sha256=([0-9a-f]{64})/)?.[1] ?? null;
}

// ───────────────────────── Teste de restauração: contagens ─────────────────────────

export const TABELAS_CONFERIDAS = ["organizacao", "municipio", "usuario", "pessoa", "empreendimento", "processo", "tramitacao", "documento_oficial", "anexo", "log_auditoria", "_prisma_migrations"] as const;
/** Tabelas só de inserção (imutáveis): o restaurado nunca pode ter MAIS linhas que a produção, e crescer é normal. */
export const TABELAS_SO_CRESCEM = ["tramitacao", "log_auditoria"];

export type Comparacao = { tabela: string; restaurado: number; producao: number | null; ok: boolean; motivo?: string };

/**
 * Compara contagens restaurado × produção. Tolerância relativa (padrão 10%, mín. 2 linhas) para tabelas
 * mutáveis (a produção muda desde o dump); tabelas só-inserção só falham se o restaurado tiver mais linhas.
 * `_prisma_migrations` precisa ser igual. `usuario` e `municipio` precisam ter linhas.
 */
export function compararContagens(restaurado: Record<string, number>, producao: Record<string, number | null>, tolerancia = 0.1): Comparacao[] {
  return Object.keys(restaurado).map((tabela) => {
    const r = restaurado[tabela];
    const p = producao[tabela] ?? null;
    if ((tabela === "usuario" || tabela === "municipio") && r === 0) return { tabela, restaurado: r, producao: p, ok: false, motivo: "vazia no restaurado" };
    if (p === null) return { tabela, restaurado: r, producao: p, ok: true };
    if (tabela === "_prisma_migrations") return { tabela, restaurado: r, producao: p, ok: r === p, motivo: r === p ? undefined : "migrações diferentes" };
    if (TABELAS_SO_CRESCEM.includes(tabela)) return { tabela, restaurado: r, producao: p, ok: r <= p, motivo: r <= p ? undefined : "restaurado maior que a produção" };
    const limite = Math.max(2, Math.ceil(tolerancia * Math.max(p, r)));
    const ok = Math.abs(p - r) <= limite;
    return { tabela, restaurado: r, producao: p, ok, motivo: ok ? undefined : `diferença ${p - r} > ${limite}` };
  });
}

export function resumoComparacao(c: Comparacao[]): string {
  return c.map((x) => `${x.tabela}=${x.restaurado}/${x.producao ?? "?"}${x.ok ? "" : `(!${x.motivo})`}`).join(" ");
}

// ───────────────────────── Próxima execução (cron de 5 campos) ─────────────────────────

function campo(expr: string, min: number, max: number): Set<number> {
  const s = new Set<number>();
  for (const parte of expr.split(",")) {
    const [base, passoTxt] = parte.split("/");
    const passo = passoTxt ? Number(passoTxt) : 1;
    let [ini, fim] = [min, max];
    if (base !== "*") {
      const [a, b] = base.split("-").map(Number);
      ini = a;
      fim = b === undefined ? (passoTxt ? max : a) : b;
    }
    if (![ini, fim, passo].every(Number.isInteger) || passo < 1) throw new Error(`cron inválido: ${expr}`);
    for (let v = ini; v <= fim; v += passo) if (v >= min && v <= max) s.add(v);
  }
  return s;
}

/** Deslocamento (min) do fuso `tz` em relação ao UTC no instante `t` (ex.: America/Bahia → −180). */
function deslocamento(t: Date, tz: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(t).map((x) => [x.type, x.value]));
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round((local - Math.floor(t.getTime() / 60000) * 60000) / 60000);
}

/** Próxima ocorrência (estritamente depois de `apos`) de um cron "min hora dia mês diaSemana" no fuso `tz`. */
export function proximaExecucao(cron: string, tz: string, apos = new Date()): Date | null {
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return null;
  let mins: Set<number>, horas: Set<number>, dias: Set<number>, meses: Set<number>, sems: Set<number>;
  try {
    [mins, horas, dias, meses, sems] = [campo(f[0], 0, 59), campo(f[1], 0, 23), campo(f[2], 1, 31), campo(f[3], 1, 12), campo(f[4].replace(/7/g, "0"), 0, 6)];
  } catch {
    return null;
  }
  const diaLivre = f[2] === "*";
  const semLivre = f[4] === "*";
  const off0 = deslocamento(apos, tz);
  const baseLocal = new Date(apos.getTime() + off0 * 60000); // "relógio de parede" em UTC
  for (let d = 0; d < 400; d++) {
    const dia = new Date(Date.UTC(baseLocal.getUTCFullYear(), baseLocal.getUTCMonth(), baseLocal.getUTCDate() + d));
    if (!meses.has(dia.getUTCMonth() + 1)) continue;
    const casaDia = dias.has(dia.getUTCDate());
    const casaSem = sems.has(dia.getUTCDay());
    const ok = diaLivre && semLivre ? true : diaLivre ? casaSem : semLivre ? casaDia : casaDia || casaSem;
    if (!ok) continue;
    for (const h of [...horas].sort((a, b) => a - b)) {
      for (const m of [...mins].sort((a, b) => a - b)) {
        const parede = Date.UTC(dia.getUTCFullYear(), dia.getUTCMonth(), dia.getUTCDate(), h, m);
        let utc = parede - off0 * 60000;
        utc = parede - deslocamento(new Date(utc), tz) * 60000;
        if (utc > apos.getTime()) return new Date(utc);
      }
    }
  }
  return null;
}

// ───────────────────────── Conexão para pg_dump / pg_restore ─────────────────────────

const PARAMS_LIBPQ = new Set(["sslmode", "sslcert", "sslkey", "sslrootcert", "connect_timeout", "application_name", "options", "target_session_attrs"]);

/**
 * Converte a DATABASE_URL do Prisma em URL aceita pela libpq (remove ?schema=, connection_limit… que o
 * pg_dump rejeita) e separa a senha (vai em PGPASSWORD, fora da linha de comando). `banco` troca o nome do banco.
 */
export function urlLibpq(databaseUrl: string, banco?: string): { url: string; senha: string; banco: string } {
  const u = new URL(databaseUrl);
  const senha = decodeURIComponent(u.password);
  u.password = "";
  for (const k of [...u.searchParams.keys()]) if (!PARAMS_LIBPQ.has(k)) u.searchParams.delete(k);
  if (banco) u.pathname = `/${encodeURIComponent(banco)}`;
  const nome = decodeURIComponent(u.pathname.replace(/^\//, ""));
  return { url: u.toString(), senha, banco: nome };
}
