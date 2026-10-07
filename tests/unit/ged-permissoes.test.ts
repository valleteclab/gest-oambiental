import { describe, expect, it } from "vitest";
import type { GedAcao, GedPapel } from "@prisma/client";
import { acoesQueConcedem, aclVigente, decidirAcoesDocumento, decidirAcoesPasta, type FatosDocumento } from "@/lib/ged/permissoes";
import { CAPACIDADES_POR_PAPEL, isSomenteLeituraGed, podeAdministrarGed, podeCriarDocumento, podeGed, podeGerirEstruturaGed, podeVerLogs, podeSolicitarAssinatura, TETO_ACOES } from "@/lib/ged/papeis";
import { calcularCaminhos } from "@/lib/ged/pastas-caminho";

const ME = "u-eu";
const OUTRO = "u-outro";

function fatos(p: Partial<FatosDocumento> & { papel: GedPapel }, doc: Partial<FatosDocumento["doc"]> = {}): FatosDocumento {
  return {
    usuario_id: ME,
    doc: { criado_por_id: OUTRO, status: "PUBLICADO", sensibilidade: "RESTRITO", acl_propria: false, ...doc },
    acl_direta: [],
    acl_pasta: [],
    signatario: { ver: false, assinar: false },
    destinatario: false,
    ...p,
  };
}
const acoes = (p: Partial<FatosDocumento> & { papel: GedPapel }, doc?: Partial<FatosDocumento["doc"]>) => decidirAcoesDocumento(fatos(p, doc));

describe("matriz de papéis", () => {
  it("tetos", () => {
    expect(TETO_ACOES.GED_USUARIO).toEqual(["VER", "EDITAR", "ASSINAR", "TRAMITAR"]);
    expect(TETO_ACOES.GED_LEITOR).toEqual(["VER", "ASSINAR"]);
    expect(TETO_ACOES.GED_AUDITOR).toEqual(["VER"]);
    expect(TETO_ACOES.GED_ADMIN).toContain("ADMINISTRAR");
    expect(TETO_ACOES.GED_GESTOR).toContain("ADMINISTRAR");
    expect(TETO_ACOES.GED_USUARIO).not.toContain("ADMINISTRAR");
  });
  it("capacidades administrativas", () => {
    const c = (papel: GedPapel) => ({ membro: { papel } });
    expect(podeAdministrarGed(c("GED_ADMIN"))).toBe(true);
    expect(podeAdministrarGed(c("GED_GESTOR"))).toBe(false);
    expect(podeGerirEstruturaGed(c("GED_GESTOR"))).toBe(true);
    expect(podeGerirEstruturaGed(c("GED_USUARIO"))).toBe(false);
    expect(podeVerLogs(c("GED_AUDITOR"))).toBe(true);
    expect(podeVerLogs(c("GED_ADMIN"))).toBe(true);
    expect(podeVerLogs(c("GED_GESTOR"))).toBe(false);
    expect(podeCriarDocumento(c("GED_LEITOR"))).toBe(false);
    expect(podeCriarDocumento(c("GED_USUARIO"))).toBe(true);
    expect(podeSolicitarAssinatura(c("GED_AUDITOR"))).toBe(false);
    expect(podeGed(c("GED_GESTOR"), "membros")).toBe(false);
    expect(isSomenteLeituraGed(c("GED_LEITOR"))).toBe(true);
    expect(isSomenteLeituraGed(c("GED_USUARIO"))).toBe(false);
  });
  it("toda capacidade tem ao menos o admin", () => {
    for (const papeis of Object.values(CAPACIDADES_POR_PAPEL)) expect(papeis).toContain("GED_ADMIN");
  });
});

describe("regra 1 – criador", () => {
  it("VER, EDITAR, TRAMITAR, ADMINISTRAR (gestor); nunca ASSINAR", () => {
    expect(acoes({ papel: "GED_GESTOR" }, { criado_por_id: ME })).toEqual(["VER", "EDITAR", "TRAMITAR", "ADMINISTRAR"]);
  });
  it("criador com papel Usuário fica limitado ao teto (sem ADMINISTRAR)", () => {
    expect(acoes({ papel: "GED_USUARIO" }, { criado_por_id: ME })).toEqual(["VER", "EDITAR", "TRAMITAR"]);
  });
  it("sem relação com o documento: nada", () => {
    expect(acoes({ papel: "GED_USUARIO" })).toEqual([]);
  });
});

describe("regras 2 e 3 – ACL direta e herdada de pasta", () => {
  it("ACL direta soma; EDITAR implica VER", () => {
    expect(acoes({ papel: "GED_USUARIO", acl_direta: ["EDITAR"] })).toEqual(["VER", "EDITAR"]);
  });
  it("ACL de pasta vale quando não há acl_propria nem sigilo", () => {
    expect(acoes({ papel: "GED_USUARIO", acl_pasta: ["VER", "EDITAR"] })).toEqual(["VER", "EDITAR"]);
  });
  it("acl_propria desliga a herança de pasta", () => {
    expect(acoes({ papel: "GED_USUARIO", acl_pasta: ["VER", "EDITAR"] }, { acl_propria: true })).toEqual([]);
  });
  it("acl_propria mantém a ACL direta", () => {
    expect(acoes({ papel: "GED_USUARIO", acl_pasta: ["EDITAR"], acl_direta: ["VER"] }, { acl_propria: true })).toEqual(["VER"]);
  });
  it("regra 7: SIGILOSO desliga a herança de pasta", () => {
    expect(acoes({ papel: "GED_USUARIO", acl_pasta: ["VER", "EDITAR"] }, { sensibilidade: "SIGILOSO" })).toEqual([]);
    expect(acoes({ papel: "GED_USUARIO", acl_pasta: ["VER"], acl_direta: ["VER"] }, { sensibilidade: "SIGILOSO" })).toEqual(["VER"]);
  });
});

describe("regra 4 – signatário", () => {
  it("assinar (solicitação aberta): VER + ASSINAR, inclusive para Leitor", () => {
    expect(acoes({ papel: "GED_LEITOR", signatario: { ver: true, assinar: true } })).toEqual(["VER", "ASSINAR"]);
  });
  it("já decidiu: só VER", () => {
    expect(acoes({ papel: "GED_USUARIO", signatario: { ver: true, assinar: false } })).toEqual(["VER"]);
  });
  it("Auditor (teto VER) não assina nem como signatário", () => {
    expect(acoes({ papel: "GED_AUDITOR", signatario: { ver: true, assinar: true } })).toEqual(["VER"]);
  });
  it("signatário vê documento SIGILOSO a ele enviado", () => {
    expect(acoes({ papel: "GED_USUARIO", signatario: { ver: true, assinar: true } }, { sensibilidade: "SIGILOSO" })).toEqual(["VER", "ASSINAR"]);
  });
});

describe("regra 5 – destinatário do trâmite", () => {
  it("VER + TRAMITAR", () => {
    expect(acoes({ papel: "GED_USUARIO", destinatario: true })).toEqual(["VER", "TRAMITAR"]);
  });
  it("Leitor recebe só VER (teto)", () => {
    expect(acoes({ papel: "GED_LEITOR", destinatario: true })).toEqual(["VER"]);
  });
});

describe("regra 6 – GED_ADMIN", () => {
  it("documento comum: VER + ADMINISTRAR + ANONIMIZAR (sem EDITAR/ASSINAR/TRAMITAR implícitos)", () => {
    expect(acoes({ papel: "GED_ADMIN" })).toEqual(["VER", "ADMINISTRAR", "ANONIMIZAR"]);
  });
  it("SIGILOSO sem ACL: só ADMINISTRAR (não vê)", () => {
    const a = acoes({ papel: "GED_ADMIN" }, { sensibilidade: "SIGILOSO" });
    expect(a).toEqual(["ADMINISTRAR"]);
    expect(a).not.toContain("VER");
  });
  it("SIGILOSO com ACL explícita: passa a ver", () => {
    expect(acoes({ papel: "GED_ADMIN", acl_direta: ["VER"] }, { sensibilidade: "SIGILOSO" })).toEqual(["VER", "ADMINISTRAR"]);
  });
  it("SIGILOSO criado pelo próprio admin: vê (autoria)", () => {
    expect(acoes({ papel: "GED_ADMIN" }, { sensibilidade: "SIGILOSO", criado_por_id: ME })).toContain("VER");
  });
  it("Gestor NÃO tem poder automático sobre tudo", () => {
    expect(acoes({ papel: "GED_GESTOR" })).toEqual([]);
  });
});

describe("regra 8 – selado/ASSINADO nega EDITAR", () => {
  it("criador não edita documento ASSINADO, mas vê", () => {
    expect(acoes({ papel: "GED_GESTOR" }, { criado_por_id: ME, status: "ASSINADO" })).toEqual(["VER", "TRAMITAR", "ADMINISTRAR"]);
  });
  it("ACL só com EDITAR em ASSINADO ainda concede VER", () => {
    expect(acoes({ papel: "GED_USUARIO", acl_direta: ["EDITAR"] }, { status: "ASSINADO" })).toEqual(["VER"]);
  });
  it("EM_ASSINATURA ainda permite EDITAR (editar cancela a solicitação)", () => {
    expect(acoes({ papel: "GED_USUARIO", acl_direta: ["EDITAR"] }, { status: "EM_ASSINATURA" })).toContain("EDITAR");
  });
});

describe("teto do papel limita a permissão efetiva", () => {
  const todas: GedAcao[] = ["VER", "EDITAR", "ASSINAR", "TRAMITAR", "ADMINISTRAR", "ANONIMIZAR"];
  it("Leitor com ACL total: VER + ASSINAR", () => {
    expect(acoes({ papel: "GED_LEITOR", acl_direta: todas })).toEqual(["VER", "ASSINAR"]);
  });
  it("Auditor com ACL total: só VER", () => {
    expect(acoes({ papel: "GED_AUDITOR", acl_direta: todas })).toEqual(["VER"]);
  });
  it("Usuário com ACL total: sem ADMINISTRAR/ANONIMIZAR", () => {
    expect(acoes({ papel: "GED_USUARIO", acl_direta: todas })).toEqual(["VER", "EDITAR", "ASSINAR", "TRAMITAR"]);
  });
  it("Gestor com ACL total mantém tudo (exceto EDITAR se ASSINADO)", () => {
    expect(acoes({ papel: "GED_GESTOR", acl_direta: todas })).toEqual(todas);
  });
});

describe("utilitários", () => {
  it("acoesQueConcedem: VER é concedida por EDITAR/ASSINAR/TRAMITAR", () => {
    expect(acoesQueConcedem("VER")).toEqual(["VER", "EDITAR", "ASSINAR", "TRAMITAR"]);
    expect(acoesQueConcedem("EDITAR")).toEqual(["EDITAR"]);
    expect(acoesQueConcedem("ADMINISTRAR")).toEqual(["ADMINISTRAR"]);
  });
  it("aclVigente respeita expira_em", () => {
    const agora = new Date("2026-06-01T12:00:00Z");
    expect(aclVigente({ expira_em: null }, agora)).toBe(true);
    expect(aclVigente({ expira_em: new Date("2026-06-02T00:00:00Z") }, agora)).toBe(true);
    expect(aclVigente({ expira_em: new Date("2026-05-31T00:00:00Z") }, agora)).toBe(false);
    expect(aclVigente({ expira_em: agora }, agora)).toBe(false);
  });
});

describe("pastas", () => {
  it("admin: VER, EDITAR, ADMINISTRAR em qualquer pasta", () => {
    expect(decidirAcoesPasta({ papel: "GED_ADMIN", acl_pasta: [] })).toEqual(["VER", "EDITAR", "ADMINISTRAR"]);
  });
  it("gestor sem ACL: nada; com ACL ADMINISTRAR: administra", () => {
    expect(decidirAcoesPasta({ papel: "GED_GESTOR", acl_pasta: [] })).toEqual([]);
    expect(decidirAcoesPasta({ papel: "GED_GESTOR", acl_pasta: ["ADMINISTRAR"] })).toEqual(["ADMINISTRAR"]);
  });
  it("ACL de pasta com EDITAR implica VER; leitor fica no teto", () => {
    expect(decidirAcoesPasta({ papel: "GED_USUARIO", acl_pasta: ["EDITAR"] })).toEqual(["VER", "EDITAR"]);
    expect(decidirAcoesPasta({ papel: "GED_LEITOR", acl_pasta: ["EDITAR", "VER"] })).toEqual(["VER"]);
  });
});

describe("caminhos de pasta (herança)", () => {
  const raiz = calcularCaminhos({ id: "R", nome: "Raiz", herda_acl: true }, null);
  it("raiz", () => {
    expect(raiz).toEqual({ caminho_ids: ["R"], caminho_heranca: ["R"], caminho_nome: "Raiz" });
  });
  it("filha que herda estende a cadeia de herança", () => {
    const f = calcularCaminhos({ id: "F", nome: "Filha", herda_acl: true }, raiz);
    expect(f).toEqual({ caminho_ids: ["R", "F"], caminho_heranca: ["R", "F"], caminho_nome: "Raiz/Filha" });
  });
  it("herda_acl=false recomeça a cadeia (corta ancestrais)", () => {
    const g = calcularCaminhos({ id: "G", nome: "Isolada", herda_acl: false }, raiz);
    expect(g.caminho_heranca).toEqual(["G"]);
    expect(g.caminho_ids).toEqual(["R", "G"]);
    const n = calcularCaminhos({ id: "N", nome: "Neta", herda_acl: true }, g);
    expect(n.caminho_heranca).toEqual(["G", "N"]);
    expect(n.caminho_nome).toBe("Raiz/Isolada/Neta");
  });
});
