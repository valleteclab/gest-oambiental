// Painel do operador da plataforma (/plataforma, docs/plataforma.md): regras puras, geração de credenciais, máquina de status,
// elegibilidade de operador e o serviço de onboarding COMPARTILHADO (lib/plataforma/onboarding.ts) com banco em memória.
import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import * as seedOnboarding from "../../prisma/seed/onboarding";
import { ClienteSchema, onboarding } from "../../lib/plataforma/onboarding";
import {
  EdicaoClienteSchema, NovoClienteSchema, SLUGS_RESERVADOS, confirmacaoConfere, conviteUtilizavel, derivarSiglaMunicipio, erroIbge, erroSiglaOrg, erroSlug,
  gerarSenhaAdminCliente, gerarTokenConvite, hashTokenConvite, montarClienteOnboarding, motivoInelegivelOperador, normalizarSiglaOrg, normalizarSlug,
  parseOperadoresEnv, transicaoStatus, validarModulos, RE_TOKEN_CONVITE,
} from "../../lib/plataforma/regras";
import { licenciamentoAtivo, gedAtivo, orgAtiva } from "../../lib/plataforma/situacao";

vi.mock("../../prisma/seed/catalogo", () => ({ aplicarCatalogo: vi.fn(async () => ({ tipos_ato: 0, documentos: 0, tipologias: 0, checklist: false, checklists: 0, prazos: 0, feriados: 0 })) }));

describe("slug público", () => {
  it("normaliza acentos, espaços e símbolos", () => {
    expect(normalizarSlug("  Prefeitura de São João!  ")).toBe("prefeitura-de-sao-joao");
  });
  it("recusa reservados e formatos inválidos", () => {
    for (const r of ["admin", "api", "ged", "login", "plataforma", "protocolo", "definir-senha", "sair"]) expect(erroSlug(r), r).toMatch(/reservado/);
    expect(SLUGS_RESERVADOS).toContain("plataforma");
    expect(erroSlug("ab")).toMatch(/3 a 60/);
    expect(erroSlug("-abc")).toMatch(/3 a 60/);
    expect(erroSlug("Abc")).toMatch(/3 a 60/);
    expect(erroSlug("prefeitura-x")).toBeNull();
  });
});

describe("sigla, IBGE e UF", () => {
  it("sigla da organização", () => {
    expect(normalizarSiglaOrg(" pm rdn ")).toBe("PM-RDN");
    expect(erroSiglaOrg("PM-RDN")).toBeNull();
    expect(erroSiglaOrg("A")).not.toBeNull();
    expect(erroSiglaOrg("ab_c")).not.toBeNull();
  });
  it("código IBGE: 7 dígitos", () => {
    expect(erroIbge("2927408")).toBeNull();
    expect(erroIbge("292740")).not.toBeNull();
    expect(erroIbge("29274a8")).not.toBeNull();
  });
  it("deriva sigla de município de 3 letras sem colidir", () => {
    expect(derivarSiglaMunicipio("Lagoa do Orvalho", [])).toBe("LAG");
    expect(derivarSiglaMunicipio("Serra Serena", [])).toBe("SER");
    const s1 = derivarSiglaMunicipio("Serra Serena", ["SER"]);
    expect(s1).toMatch(/^[A-Z]{3}$/);
    expect(s1).not.toBe("SER");
    const usadas = new Set<string>();
    for (let i = 0; i < 40; i++) usadas.add(derivarSiglaMunicipio("Maracás", usadas));
    expect(usadas.size).toBe(40);
  });
});

describe("credenciais", () => {
  it("senha temporária do admin: 16 caracteres, com letra, dígito e símbolo, sem repetição entre gerações", () => {
    const vistas = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const s = gerarSenhaAdminCliente();
      expect(s).toHaveLength(16);
      expect(s).toMatch(/[A-Za-z]/);
      expect(s).toMatch(/[2-9]/);
      expect(s).toMatch(/[@#$%&*!]/);
      vistas.add(s);
    }
    expect(vistas.size).toBe(50);
  });
  it("token de convite: 256 bits base64url, só o hash é guardado; expira e é de uso único", () => {
    const a = gerarTokenConvite();
    const b = gerarTokenConvite();
    expect(a.token).toMatch(RE_TOKEN_CONVITE);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(hashTokenConvite(a.token));
    expect(a.hash).not.toContain(a.token);
    const agora = new Date("2026-10-13T12:00:00Z");
    expect(conviteUtilizavel({ usado_em: null, expira_em: new Date("2026-10-14T00:00:00Z") }, agora)).toBe(true);
    expect(conviteUtilizavel({ usado_em: null, expira_em: new Date("2026-10-13T11:59:59Z") }, agora)).toBe(false);
    expect(conviteUtilizavel({ usado_em: agora, expira_em: new Date("2026-10-14T00:00:00Z") }, agora)).toBe(false);
  });
});

describe("máquina de status do cliente", () => {
  it("suspender só de ATIVO; reativar só de SUSPENSO; não existe exclusão", () => {
    expect(transicaoStatus("ATIVO", "suspender")).toEqual({ ok: true, proximo: "SUSPENSO" });
    expect(transicaoStatus("SUSPENSO", "reativar")).toEqual({ ok: true, proximo: "ATIVO" });
    expect(transicaoStatus("SUSPENSO", "suspender").ok).toBe(false);
    expect(transicaoStatus("ATIVO", "reativar").ok).toBe(false);
    expect(transicaoStatus("ATIVO", "excluir" as never).ok).toBe(false);
  });
  it("confirmação digitada = sigla do cliente", () => {
    expect(confirmacaoConfere(" vac ", "VAC")).toBe(true);
    expect(confirmacaoConfere("VA", "VAC")).toBe(false);
    expect(confirmacaoConfere("", "")).toBe(false);
  });
  it("predicados de situação (sessão, portais, jobs)", () => {
    expect(orgAtiva({ status: "ATIVO" })).toBe(true);
    expect(orgAtiva({ status: "SUSPENSO" })).toBe(false);
    expect(licenciamentoAtivo({ status: "ATIVO", modulos: ["GED"] })).toBe(false);
    expect(licenciamentoAtivo({ status: "SUSPENSO", modulos: ["LICENCIAMENTO"] })).toBe(false);
    expect(gedAtivo({ status: "ATIVO", modulos: ["LICENCIAMENTO", "GED"] })).toBe(true);
  });
});

describe("elegibilidade de operador", () => {
  const livre = { ativo: true, organizacao_id: null, pessoa_id: null, papeis: 0, ged_membros: 0 };
  it("só usuário ativo, sem organização, papéis, pessoa ou GED", () => {
    expect(motivoInelegivelOperador(livre)).toBeNull();
    expect(motivoInelegivelOperador({ ...livre, organizacao_id: randomUUID() })).toMatch(/organização/);
    expect(motivoInelegivelOperador({ ...livre, pessoa_id: randomUUID() })).toMatch(/requerente/);
    expect(motivoInelegivelOperador({ ...livre, papeis: 1 })).toMatch(/papéis/);
    expect(motivoInelegivelOperador({ ...livre, ged_membros: 1 })).toMatch(/GED/);
    expect(motivoInelegivelOperador({ ...livre, ativo: false })).toMatch(/inativo/);
  });
  it("bootstrap por ambiente: e-mails válidos, únicos, minúsculos", () => {
    expect(parseOperadoresEnv("Dono@Exemplo.com, outro@exemplo.com;dono@exemplo.com  invalido, ")).toEqual(["dono@exemplo.com", "outro@exemplo.com"]);
    expect(parseOperadoresEnv(undefined)).toEqual([]);
    expect(parseOperadoresEnv("")).toEqual([]);
  });
});

describe("módulos e formulário de novo cliente", () => {
  it("validarModulos: ordem estável, sem duplicata, ao menos um, só conhecidos", () => {
    expect(validarModulos(["GED", "LICENCIAMENTO", "GED"])).toEqual({ ok: true, modulos: ["LICENCIAMENTO", "GED"] });
    expect(validarModulos([]).ok).toBe(false);
    expect(validarModulos(["FOO"]).ok).toBe(false);
  });
  const base = { nome: "Prefeitura de Teste", sigla: "pm-tst", cnpj: "", slug: "Prefeitura Teste", modulos: ["LICENCIAMENTO", "GED"], admin_nome: "Ana Teste", admin_email: "ANA@exemplo.com", municipios: [{ nome: "Teste do Norte", uf: "ba", codigo_ibge: "9900101" }] };
  it("normaliza e valida a entrada", () => {
    const r = NovoClienteSchema.parse(base);
    expect(r.sigla).toBe("PM-TST");
    expect(r.slug).toBe("prefeitura-teste");
    expect(r.admin_email).toBe("ana@exemplo.com");
    expect(r.municipios[0].uf).toBe("BA");
    expect(r.cnpj).toBeNull();
    expect(r.cota_gb).toBe(10);
  });
  it("recusa slug reservado, licenciamento sem órgão, GED-only com órgão, IBGE repetido e CNPJ curto", () => {
    expect(NovoClienteSchema.safeParse({ ...base, slug: "admin" }).success).toBe(false);
    expect(NovoClienteSchema.safeParse({ ...base, municipios: [] }).success).toBe(false);
    expect(NovoClienteSchema.safeParse({ ...base, modulos: ["GED"] }).success).toBe(false);
    expect(NovoClienteSchema.safeParse({ ...base, municipios: [base.municipios[0], base.municipios[0]] }).success).toBe(false);
    expect(NovoClienteSchema.safeParse({ ...base, cnpj: "123" }).success).toBe(false);
    expect(NovoClienteSchema.safeParse({ ...base, modulos: [] }).success).toBe(false);
    expect(NovoClienteSchema.safeParse({ ...base, municipios: [{ nome: "X", uf: "ZZ", codigo_ibge: "1" }] }).success).toBe(false);
    expect(EdicaoClienteSchema.safeParse({ nome: "Novo Nome", slug: "ged" }).success).toBe(false);
  });
  it("monta JSON aceito pelo ClienteSchema do onboarding (licenciamento + GED, ou só GED)", () => {
    const completo = ClienteSchema.parse(montarClienteOnboarding(NovoClienteSchema.parse(base), ["LDO"]));
    expect(completo.modulos).toEqual(["LICENCIAMENTO", "GED"]);
    expect(completo.municipios).toHaveLength(1);
    expect(completo.usuarios[0].papeis).toEqual([{ papel: "ADMIN" }]);
    expect(completo.ged?.usuarios[0].papel_ged).toBe("GED_ADMIN");
    expect(completo.ged?.setores.map((s) => s.sigla)).toContain("ADM");
    expect(completo.ged?.config.cota_bytes).toBe(10 * 1024 ** 3);
    const soGed = ClienteSchema.parse(montarClienteOnboarding(NovoClienteSchema.parse({ ...base, modulos: ["GED"], municipios: [] })));
    expect(soGed.municipios).toHaveLength(0);
    expect(soGed.usuarios).toHaveLength(0);
    expect(soGed.ged?.usuarios).toHaveLength(1);
  });
});

// ───────────── Serviço de onboarding compartilhado com banco em memória ─────────────

type Linha = Record<string, unknown> & { id: string };
function bancoFalso() {
  const tabelas = new Map<string, Linha[]>();
  const tab = (n: string) => (tabelas.get(n) ?? tabelas.set(n, []).get(n)!);
  const bate = (l: Linha, where: Record<string, unknown> | undefined): boolean =>
    !where || Object.entries(where).every(([k, v]) => {
      if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
        const o = v as Record<string, unknown>;
        if ("equals" in o) return String(l[k] ?? "").toLowerCase() === String(o.equals).toLowerCase();
        return bate(l, o); // chave composta (ex.: organizacao_id_sigla)
      }
      return l[k] === v;
    });
  const modelo = (nome: string) => ({
    findUnique: async (a: { where: Record<string, unknown> }) => tab(nome).find((l) => bate(l, a.where)) ?? null,
    findFirst: async (a: { where?: Record<string, unknown> } = {}) => tab(nome).find((l) => bate(l, a.where)) ?? null,
    create: async (a: { data: Record<string, unknown> }) => {
      const l = { id: randomUUID(), ...a.data } as Linha;
      if (nome === "organizacao") l.modulos = a.data.modulos ?? ["LICENCIAMENTO"];
      tab(nome).push(l);
      return l;
    },
    update: async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => Object.assign(tab(nome).find((l) => bate(l, a.where))!, a.data),
  });
  const prisma = new Proxy({}, { get: (_t, nome: string) => modelo(nome) }) as unknown as PrismaClient;
  return { prisma, tab };
}

describe("serviço de onboarding compartilhado (lib/plataforma/onboarding.ts)", () => {
  it("a CLI (prisma/seed/onboarding.ts) reexporta exatamente o mesmo serviço", () => {
    expect(seedOnboarding.onboarding).toBe(onboarding);
    expect(seedOnboarding.ClienteSchema).toBe(ClienteSchema);
  });

  const cliente = () => ClienteSchema.parse(montarClienteOnboarding(NovoClienteSchema.parse({ nome: "Cliente Só GED", sigla: "CSG", modulos: ["GED"], admin_nome: "Bia Teste", admin_email: "bia@exemplo.com" })));

  it("cria organização, GED padrão, administrador GED_ADMIN, senha forte emitida uma vez e auditoria do operador", async () => {
    const { prisma, tab } = bancoFalso();
    const ator = randomUUID();
    const r = await onboarding(prisma, cliente(), { ator_id: ator, gerarSenha: gerarSenhaAdminCliente, slug_publico: "cliente-so-ged" });
    expect(r.organizacao.modulos).toEqual(["GED"]);
    expect(tab("organizacao")[0].slug_publico).toBe("cliente-so-ged");
    expect(tab("gedSetor").map((s) => s.sigla)).toEqual(["ADM", "PROT", "JUR"]);
    expect(tab("gedTipoDocumento").length).toBeGreaterThanOrEqual(8);
    expect(tab("gedConfig")).toHaveLength(1);
    expect(tab("gedMembro")).toHaveLength(1);
    expect(tab("gedMembro")[0].papel).toBe("GED_ADMIN");
    expect(tab("usuario")[0].organizacao_id).toBe(r.organizacao.id);
    expect(tab("usuario")[0].trocar_senha).toBe(true);
    expect(tab("usuarioPapel")).toHaveLength(0);
    expect(r.senhas).toHaveLength(1);
    expect(r.senhas[0].senha).toHaveLength(16);
    expect(String(tab("usuario")[0].senha_hash)).toMatch(/^\$argon2id\$/);
    const log = tab("logAuditoria").find((l) => l.acao === "ONBOARDING")!;
    expect(log.usuario_id).toBe(ator);
    expect(log.organizacao_id).toBe(r.organizacao.id);
    expect(JSON.stringify(log)).not.toContain(r.senhas[0].senha);
  });

  it("é idempotente: segunda execução não duplica nem emite nova senha", async () => {
    const { prisma, tab } = bancoFalso();
    await onboarding(prisma, cliente(), {});
    const r2 = await onboarding(prisma, cliente(), {});
    expect(r2.senhas).toHaveLength(0);
    expect(tab("organizacao")).toHaveLength(1);
    expect(tab("gedSetor")).toHaveLength(3);
    expect(tab("gedMembro")).toHaveLength(1);
    expect(tab("usuario")).toHaveLength(1);
  });

  it("nunca vincula um operador da plataforma a uma organização", async () => {
    const { prisma, tab } = bancoFalso();
    const op = await (prisma as unknown as { usuario: { create: (a: { data: object }) => Promise<Linha> } }).usuario.create({ data: { email: "bia@exemplo.com", nome: "Op", organizacao_id: null } });
    tab("operadorPlataforma").push({ id: randomUUID(), usuario_id: op.id, ativo: true });
    await expect(onboarding(prisma, cliente(), {})).rejects.toThrow(/operador da plataforma/);
    expect(tab("organizacao")).toHaveLength(0);
  });
});
