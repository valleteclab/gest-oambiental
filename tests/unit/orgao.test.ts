import { describe, expect, it } from "vitest";
import type { Papel } from "@prisma/client";
import { filtroMunicipioPadrao, orgaosPermitidos, podeAcessarOrgao, type AcessoUsuario, type PapelVinculo, type UsuarioSessao } from "@/lib/rbac";

// Escolha do ÓRGÃO no login / "Trocar órgão" (podeAcessarOrgao) e filtro padrão pelo órgão ativo.
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
// Organização A: municípios A, B e C. Organização B (outro cliente): município R.
const R = "55555555-5555-4555-8555-555555555555";
const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MUN: Record<string, string[]> = { [ORG_A]: [A, B, C], [ORG_B]: [R] };

const lista = (...p: [Papel, string | null][]): PapelVinculo[] => p.map(([papel, municipio_id]) => ({ papel, municipio_id }));
/** Acesso de um usuário: internos na organização A (padrão); requerente puro sem organização. */
const papeis = (...p: [Papel, string | null][]): AcessoUsuario => {
  const v = lista(...p);
  const org = v.some((x) => x.papel !== "REQUERENTE") ? ORG_A : null;
  return { papeis: v, organizacao_id: org, municipios_org: org ? MUN[org] : [] };
};
const daOrg = (org: string, ...p: [Papel, string | null][]): AcessoUsuario => ({ papeis: lista(...p), organizacao_id: org, municipios_org: MUN[org] });
const usuario = (p: AcessoUsuario): UsuarioSessao => ({ id: "u", nome: "U", email: "u@x", cargo: null, pessoa_id: null, trocar_senha: false, ...p });

describe("podeAcessarOrgao", () => {
  it("papéis de organização (ADMIN, TEC_CONSORCIO, SEMA_INEMA) acessam os órgãos DA SUA organização", () => {
    for (const papel of ["ADMIN", "TEC_CONSORCIO", "SEMA_INEMA"] as Papel[]) {
      expect(podeAcessarOrgao(papeis([papel, null]), A), papel).toBe(true);
      expect(podeAcessarOrgao(papeis([papel, null]), B), papel).toBe(true);
      expect(podeAcessarOrgao(papeis([papel, null]), R), `${papel} → outro cliente`).toBe(false);
      expect(podeAcessarOrgao(daOrg(ORG_B, [papel, null]), R), papel).toBe(true);
      expect(podeAcessarOrgao(daOrg(ORG_B, [papel, null]), A), `${papel} B → A`).toBe(false);
    }
  });

  it("login: a lista de órgãos permitidos do admin de um cliente mostra só os órgãos dele", () => {
    const todos = [{ id: A }, { id: B }, { id: C }, { id: R }];
    expect(orgaosPermitidos(daOrg(ORG_B, ["ADMIN", null]), todos)).toEqual([{ id: R }]);
    expect(orgaosPermitidos(daOrg(ORG_A, ["ADMIN", null]), todos)).toEqual([{ id: A }, { id: B }, { id: C }]);
    expect(orgaosPermitidos(papeis(["REQUERENTE", null]), todos)).toHaveLength(4);
  });

  it("requerente escolhe qualquer órgão (de qualquer cliente)", () => {
    expect(podeAcessarOrgao(papeis(["REQUERENTE", null]), A)).toBe(true);
    expect(podeAcessarOrgao(papeis(["REQUERENTE", null]), C)).toBe(true);
    expect(podeAcessarOrgao(papeis(["REQUERENTE", null]), R)).toBe(true);
  });

  it("papéis municipais só acessam os municípios dos seus papéis", () => {
    for (const papel of ["TEC_MUNICIPAL", "GESTOR_MUNICIPAL", "FISCAL"] as Papel[]) {
      expect(podeAcessarOrgao(papeis([papel, A]), A), papel).toBe(true);
      expect(podeAcessarOrgao(papeis([papel, A]), B), papel).toBe(false);
    }
  });

  it("usuário com papéis em dois municípios acessa os dois e nenhum outro", () => {
    const p = papeis(["TEC_MUNICIPAL", A], ["FISCAL", B]);
    expect(podeAcessarOrgao(p, A)).toBe(true);
    expect(podeAcessarOrgao(p, B)).toBe(true);
    expect(podeAcessarOrgao(p, C)).toBe(false);
  });

  it("sem papéis ou sem órgão informado → negado", () => {
    expect(podeAcessarOrgao(papeis(), A)).toBe(false);
    expect(podeAcessarOrgao({ papeis: lista(["ADMIN", null]), organizacao_id: null, municipios_org: [] }, A)).toBe(false);
    expect(podeAcessarOrgao(papeis(["ADMIN", null]), "")).toBe(false);
    expect(podeAcessarOrgao(papeis(["ADMIN", null]), null)).toBe(false);
  });

  it("orgaosPermitidos filtra a lista de órgãos", () => {
    const lista = [{ id: A }, { id: B }, { id: C }];
    expect(orgaosPermitidos(papeis(["GESTOR_MUNICIPAL", B]), lista)).toEqual([{ id: B }]);
    expect(orgaosPermitidos(papeis(["TEC_CONSORCIO", null]), lista)).toHaveLength(3);
  });
});

describe("filtroMunicipioPadrao", () => {
  const admin = usuario(papeis(["ADMIN", null]));
  const tecA = usuario(papeis(["TEC_MUNICIPAL", A]));
  const multi = usuario(papeis(["TEC_MUNICIPAL", A], ["FISCAL", B]));

  it("sem parâmetro na URL: escopo amplo usa o órgão ativo", () => {
    expect(filtroMunicipioPadrao(admin, undefined, A)).toBe(A);
    expect(filtroMunicipioPadrao(multi, undefined, B)).toBe(B);
  });
  it("parâmetro presente prevalece – inclusive vazio (= Todos)", () => {
    expect(filtroMunicipioPadrao(admin, "", A)).toBe("");
    expect(filtroMunicipioPadrao(admin, B, A)).toBe(B);
    expect(filtroMunicipioPadrao(admin, [C, A], A)).toBe(C);
  });
  it("usuário de um único município ou órgão fora do escopo: sem padrão", () => {
    expect(filtroMunicipioPadrao(tecA, undefined, A)).toBeUndefined();
    expect(filtroMunicipioPadrao(multi, undefined, C)).toBeUndefined();
    expect(filtroMunicipioPadrao(admin, undefined, null)).toBeUndefined();
  });
});
