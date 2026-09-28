import { describe, expect, it } from "vitest";
import {
  compararContagens,
  dataDoNome,
  descreverDestino,
  lerConfig,
  maisRecente,
  nomeArquivoBackup,
  observacaoBackup,
  proximaExecucao,
  selecionarParaRemover,
  sha256DaObservacao,
  urlLibpq,
} from "@/lib/backup/nucleo";

const SHA = "a".repeat(64);

describe("nome do arquivo", () => {
  it("carimbo UTC e ida e volta", () => {
    const d = new Date("2026-09-28T06:15:07.123Z");
    const n = nomeArquivoBackup(d);
    expect(n).toBe("licenciagov-20260928T061507Z.dump.enc");
    expect(dataDoNome(n)?.toISOString()).toBe("2026-09-28T06:15:07.000Z");
    expect(dataDoNome(`pg/${n}`)?.toISOString()).toBe("2026-09-28T06:15:07.000Z");
  });
  it("ignora nomes fora do padrão", () => {
    expect(dataDoNome("licenciagov-20260928T061507Z.dump.enc.sha256")).toBeNull();
    expect(dataDoNome("backups/outro.zip")).toBeNull();
    expect(dataDoNome("licenciagov-2026.sql.gz.enc")).toBeNull();
  });
});

describe("retenção", () => {
  const agora = new Date("2026-09-28T12:00:00Z");
  const dias = (n: number) => nomeArquivoBackup(new Date(agora.getTime() - n * 86_400_000));
  it("remove só os mais antigos que o limite, com os .sha256", () => {
    const chaves = [dias(1), dias(29), dias(31), dias(45)].map((n) => `pg/${n}`);
    const todas = [...chaves, ...chaves.map((c) => `${c}.sha256`), "pg/LEIA-ME.txt"];
    const r = selecionarParaRemover(todas, agora, 30);
    expect(r.sort()).toEqual([`pg/${dias(31)}`, `pg/${dias(31)}.sha256`, `pg/${dias(45)}`, `pg/${dias(45)}.sha256`].sort());
  });
  it("nunca remove o dump mais recente, mesmo antigo", () => {
    expect(selecionarParaRemover([dias(90)], agora, 30)).toEqual([]);
    expect(selecionarParaRemover([dias(90), dias(60)], agora, 30)).toEqual([dias(90)]);
  });
  it("retenção inválida não remove nada", () => {
    expect(selecionarParaRemover([dias(1), dias(90)], agora, 0)).toEqual([]);
  });
  it("mais recente pelo carimbo", () => {
    expect(maisRecente([`x/${dias(3)}`, `x/${dias(1)}`, `x/${dias(1)}.sha256`, "x/lixo"])).toBe(`x/${dias(1)}`);
    expect(maisRecente(["x/lixo"])).toBeNull();
  });
});

describe("configuração", () => {
  it("offsite só com bucket e credenciais; padrões", () => {
    const c = lerConfig({ BACKUP_S3_BUCKET: "dr", BACKUP_S3_ACCESS_KEY_ID: "" });
    expect(c.offsite).toBeNull();
    expect(c.offsiteFaltando).toEqual(["BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY"]);
    expect(c.retencaoDias).toBe(30);
    expect(c.passphraseDerivada).toBe(true);
    expect(c.schemas).toEqual(["public"]);
    expect(c.cronBackup).toBe("15 3 * * *");
    const o = lerConfig({ BACKUP_S3_BUCKET: "dr", BACKUP_S3_ACCESS_KEY_ID: "k", BACKUP_S3_SECRET_ACCESS_KEY: "s", BACKUP_S3_ENDPOINT: "https://acc.r2.cloudflarestorage.com", BACKUP_S3_PREFIX: "lg", BACKUP_RETENCAO_DIAS: "45", BACKUP_PASSPHRASE: "x" });
    expect(o.offsite).toMatchObject({ bucket: "dr", region: "auto", prefixo: "lg/", endpoint: "https://acc.r2.cloudflarestorage.com" });
    expect(o.retencaoDias).toBe(45);
    expect(o.passphraseDerivada).toBe(false);
  });
  it("descrição do destino", () => {
    const o = lerConfig({ BACKUP_S3_BUCKET: "dr", BACKUP_S3_ACCESS_KEY_ID: "k", BACKUP_S3_SECRET_ACCESS_KEY: "s", BACKUP_S3_ENDPOINT: "https://acc.r2.cloudflarestorage.com" });
    expect(descreverDestino(o, "a.dump.enc")).toBe("s3://dr/pg/a.dump.enc (fora do provedor: acc.r2.cloudflarestorage.com)");
    expect(descreverDestino(lerConfig({}), "a.dump.enc", "s3")).toContain("cópia fora do provedor NÃO configurada");
  });
});

describe("registro", () => {
  it("observação traz o sha256 recuperável", () => {
    const obs = observacaoBackup({ sha256: SHA, pgDumpVersao: "pg_dump (PostgreSQL) 18.0", schemas: ["public"], duracaoMs: 1234, removidos: 2, retencaoDias: 30, origem: "agendado (worker)", passphraseDerivada: false });
    expect(obs).toContain(`sha256=${SHA}`);
    expect(obs).toContain("1.2 s");
    expect(obs).toContain("2 removido(s)");
    expect(sha256DaObservacao(obs)).toBe(SHA);
    expect(sha256DaObservacao("sem hash")).toBeNull();
  });
});

describe("comparação de contagens (teste de restauração)", () => {
  it("tolerância, tabelas só-inserção e migrações", () => {
    const c = compararContagens(
      { processo: 44, pessoa: 10, log_auditoria: 800, tramitacao: 234, usuario: 18, _prisma_migrations: 3 },
      { processo: 46, pessoa: 20, log_auditoria: 900, tramitacao: 233, usuario: 18, _prisma_migrations: 4 },
      0.1,
    );
    const ok = Object.fromEntries(c.map((x) => [x.tabela, x.ok]));
    expect(ok).toEqual({ processo: true, pessoa: false, log_auditoria: true, tramitacao: false, usuario: true, _prisma_migrations: false });
  });
  it("usuario vazio falha", () => {
    expect(compararContagens({ usuario: 0 }, { usuario: 0 })[0].ok).toBe(false);
  });
});

describe("próxima execução (cron)", () => {
  it("diário 03:15 America/Bahia (UTC−3)", () => {
    expect(proximaExecucao("15 3 * * *", "America/Bahia", new Date("2026-09-28T05:00:00Z"))?.toISOString()).toBe("2026-09-28T06:15:00.000Z");
    expect(proximaExecucao("15 3 * * *", "America/Bahia", new Date("2026-09-28T06:15:00Z"))?.toISOString()).toBe("2026-09-29T06:15:00.000Z");
  });
  it("mensal no dia 1 e cron inválido", () => {
    expect(proximaExecucao("45 4 1 * *", "America/Bahia", new Date("2026-09-28T12:00:00Z"))?.toISOString()).toBe("2026-10-01T07:45:00.000Z");
    expect(proximaExecucao("x y", "America/Bahia")).toBeNull();
  });
});

describe("URL para pg_dump", () => {
  it("remove parâmetros do Prisma e separa a senha", () => {
    const r = urlLibpq("postgresql://app:p%40ss@db.internal:5432/licenciagov?schema=public&sslmode=require&connection_limit=5");
    expect(r).toEqual({ url: "postgresql://app@db.internal:5432/licenciagov?sslmode=require", senha: "p@ss", banco: "licenciagov" });
    expect(urlLibpq("postgresql://app:x@h/prod", "licenciagov_restore_test").url).toBe("postgresql://app@h/licenciagov_restore_test");
  });
});
