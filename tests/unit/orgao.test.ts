import { describe, expect, it } from "vitest";
import type { Papel } from "@prisma/client";
import { filtroMunicipioPadrao, orgaosPermitidos, podeAcessarOrgao, type PapelVinculo, type UsuarioSessao } from "@/lib/rbac";

// Escolha do ÓRGÃO no login / "Trocar órgão" (podeAcessarOrgao) e filtro padrão pelo órgão ativo.
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

const papeis = (...p: [Papel, string | null][]): PapelVinculo[] => p.map(([papel, municipio_id]) => ({ papel, municipio_id }));
const usuario = (p: PapelVinculo[]): UsuarioSessao => ({ id: "u", nome: "U", email: "u@x", cargo: null, pessoa_id: null, trocar_senha: false, papeis: p });

describe("podeAcessarOrgao", () => {
  it("papéis de organização (ADMIN, TEC_CONSORCIO, SEMA_INEMA) acessam qualquer órgão", () => {
    for (const papel of ["ADMIN", "TEC_CONSORCIO", "SEMA_INEMA"] as Papel[]) {
      expect(podeAcessarOrgao(papeis([papel, null]), A), papel).toBe(true);
      expect(podeAcessarOrgao(papeis([papel, null]), B), papel).toBe(true);
    }
  });

  it("requerente escolhe qualquer órgão", () => {
    expect(podeAcessarOrgao(papeis(["REQUERENTE", null]), A)).toBe(true);
    expect(podeAcessarOrgao(papeis(["REQUERENTE", null]), C)).toBe(true);
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
    expect(podeAcessarOrgao([], A)).toBe(false);
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
