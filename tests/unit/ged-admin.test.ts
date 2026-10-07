import { describe, expect, it } from "vitest";
import { bytesDeGb, classificarEmail, gbDeBytes, manteraAdminAtivo, MENSAGEM_EMAIL, podeRedefinirSenha, zConfiguracoes, zNovoMembro } from "@/lib/ged/admin/regras";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OUTRA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("último administrador", () => {
  const ms = [
    { id: "1", papel: "GED_ADMIN" as const, ativo: true },
    { id: "2", papel: "GED_USUARIO" as const, ativo: true },
    { id: "3", papel: "GED_ADMIN" as const, ativo: false },
  ];
  it("não deixa rebaixar nem desativar o único admin ativo", () => {
    expect(manteraAdminAtivo(ms, "1", { papel: "GED_GESTOR" })).toBe(false);
    expect(manteraAdminAtivo(ms, "1", { ativo: false })).toBe(false);
  });
  it("admin inativo não conta; promover outro libera", () => {
    expect(manteraAdminAtivo(ms, "2", { papel: "GED_ADMIN" })).toBe(true);
    expect(manteraAdminAtivo([...ms.slice(0, 1), { id: "2", papel: "GED_ADMIN", ativo: true }], "1", { ativo: false })).toBe(true);
  });
  it("mudar quem não é admin não afeta", () => {
    expect(manteraAdminAtivo(ms, "2", { ativo: false })).toBe(true);
    expect(manteraAdminAtivo(ms, "1", {})).toBe(true);
  });
});

describe("situação do e-mail informado", () => {
  it("novo, adicionar ao GED, já membro, inativo", () => {
    expect(classificarEmail(null, ORG, null)).toBe("NOVO");
    expect(classificarEmail({ organizacao_id: ORG }, ORG, null)).toBe("ADICIONAR_AO_GED");
    expect(classificarEmail({ organizacao_id: ORG }, ORG, { ativo: true })).toBe("JA_MEMBRO");
    expect(classificarEmail({ organizacao_id: ORG }, ORG, { ativo: false })).toBe("JA_MEMBRO_INATIVO");
  });
  it("outra organização ou requerente (organizacao_id nulo) nunca é reaproveitado", () => {
    expect(classificarEmail({ organizacao_id: OUTRA }, ORG, null)).toBe("OUTRA_ORGANIZACAO");
    expect(classificarEmail({ organizacao_id: null }, ORG, null)).toBe("OUTRA_ORGANIZACAO");
    expect(classificarEmail({ organizacao_id: OUTRA }, ORG, { ativo: true })).toBe("OUTRA_ORGANIZACAO");
    expect(MENSAGEM_EMAIL.OUTRA_ORGANIZACAO).toMatch(/outra organização/);
  });
});

describe("redefinição de senha", () => {
  it("recusa a própria e quem usa o licenciamento", () => {
    expect(podeRedefinirSenha({ papeis_licenciamento: 0, usuario_id: "a" }, "a").ok).toBe(false);
    expect(podeRedefinirSenha({ papeis_licenciamento: 2, usuario_id: "b" }, "a").ok).toBe(false);
    expect(podeRedefinirSenha({ papeis_licenciamento: 0, usuario_id: "b" }, "a")).toEqual({ ok: true });
  });
});

describe("validações", () => {
  it("novo membro: e-mail em minúsculas, papel válido, setores uuid", () => {
    const r = zNovoMembro.parse({ nome: "  Maria Souza ", email: "  MARIA@Exemplo.TEST ", papel: "GED_LEITOR", cargo: "" });
    expect(r).toMatchObject({ nome: "Maria Souza", email: "maria@exemplo.test", cargo: null, setor_ids: [] });
    expect(() => zNovoMembro.parse({ nome: "Maria", email: "x", papel: "GED_LEITOR" })).toThrow();
    expect(() => zNovoMembro.parse({ nome: "Maria Souza", email: "m@x.test", papel: "ADMIN" })).toThrow();
    expect(() => zNovoMembro.parse({ nome: "Maria Souza", email: "m@x.test", papel: "GED_LEITOR", setor_ids: ["x"] })).toThrow();
  });
  it("configurações: lembretes ordenados, únicos; limites", () => {
    const ok = zConfiguracoes.parse({ assinatura_prazo_dias: "20", lembrete_dias: "1, 3;0 3", retencao_acesso_log_dias: "365", cota_gb: "" });
    expect(ok).toMatchObject({ assinatura_prazo_dias: 20, lembrete_dias: [3, 1, 0], retencao_acesso_log_dias: 365, cota_gb: null });
    expect(() => zConfiguracoes.parse({ assinatura_prazo_dias: 0, lembrete_dias: "1", retencao_acesso_log_dias: 365 })).toThrow();
    expect(() => zConfiguracoes.parse({ assinatura_prazo_dias: 10, lembrete_dias: "a", retencao_acesso_log_dias: 365 })).toThrow();
    expect(() => zConfiguracoes.parse({ assinatura_prazo_dias: 10, lembrete_dias: "-1", retencao_acesso_log_dias: 365 })).toThrow();
    expect(() => zConfiguracoes.parse({ assinatura_prazo_dias: 10, lembrete_dias: "1", retencao_acesso_log_dias: 30 })).toThrow();
    expect(zConfiguracoes.parse({ assinatura_prazo_dias: 10, lembrete_dias: "1", retencao_acesso_log_dias: 365, cota_gb: "2.5" }).cota_gb).toBe(2.5);
  });
  it("cota GB ↔ bytes", () => {
    expect(bytesDeGb(null)).toBeNull();
    expect(bytesDeGb(1)).toBe(BigInt(1073741824));
    expect(gbDeBytes(BigInt(1073741824))).toBe(1);
    expect(gbDeBytes(null)).toBeNull();
  });
});
