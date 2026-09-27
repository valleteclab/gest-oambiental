import { describe, expect, it } from "vitest";
import type { Papel } from "@prisma/client";
import { can, escopoMunicipios, isInterno, isSomenteLeitura, podeVerMunicipio, UUID_NENHUM, whereMunicipio, whereProcessoEscopo, type Acao, type Recurso, type UsuarioSessao } from "@/lib/rbac";
import { whereEmpreendimentoEscopo, wherePessoaEscopo } from "@/lib/cadastros/escopo";

// Matriz de permissões e regras de escopo (SPEC 4 / T7).
const IAC = "11111111-1111-4111-8111-111111111111";
const ITB = "22222222-2222-4222-8222-222222222222";
const RUY = "33333333-3333-4333-8333-333333333333";
const PESSOA = "44444444-4444-4444-8444-444444444444";

function usuario(papeis: [Papel, string | null][], pessoa_id: string | null = null): UsuarioSessao {
  return { id: "u", nome: "U", email: "u@x", cargo: null, pessoa_id, trocar_senha: false, papeis: papeis.map(([papel, municipio_id]) => ({ papel, municipio_id })) };
}

const admin = usuario([["ADMIN", null]]);
const tecConsorcio = usuario([["TEC_CONSORCIO", null]]);
const tecIacu = usuario([["TEC_MUNICIPAL", IAC]]);
const gestorItb = usuario([["GESTOR_MUNICIPAL", ITB]]);
const fiscalItb = usuario([["FISCAL", ITB]]);
const sema = usuario([["SEMA_INEMA", null]]);
const requerente = usuario([["REQUERENTE", null]], PESSOA);
const requerenteSemPessoa = usuario([["REQUERENTE", null]]);
const multi = usuario([["TEC_MUNICIPAL", IAC], ["FISCAL", RUY]]);

const RECURSOS: Recurso[] = ["processo", "empreendimento", "pessoa", "fiscalizacao", "denuncia", "documento", "relatorio", "dashboard", "admin", "auditoria", "exportacao"];
const ESCRITA: Acao[] = ["criar", "editar", "triar", "analisar", "pendencia", "parecer", "decidir", "emitir_documento", "cancelar_documento", "fiscalizar", "configurar", "requerer"];

describe("escopo por município – técnico de Iaçu (T7)", () => {
  it("não vê Itaberaba", () => {
    expect(can(tecIacu, "ver", "processo", ITB)).toBe(false);
    expect(can(tecIacu, "ver", "empreendimento", ITB)).toBe(false);
    expect(podeVerMunicipio(tecIacu, ITB)).toBe(false);
  });
  it("vê e analisa Iaçu", () => {
    expect(can(tecIacu, "ver", "processo", IAC)).toBe(true);
    expect(can(tecIacu, "analisar", "processo", IAC)).toBe(true);
    expect(can(tecIacu, "editar", "empreendimento", IAC)).toBe(true);
    expect(podeVerMunicipio(tecIacu, IAC)).toBe(true);
  });
  it("não decide nem configura", () => {
    expect(can(tecIacu, "decidir", "processo", IAC)).toBe(false);
    expect(can(tecIacu, "configurar", "admin")).toBe(false);
  });
  it("whereMunicipio restringe aos municípios vinculados", () => {
    expect(escopoMunicipios(tecIacu)).toEqual([IAC]);
    expect(whereMunicipio(tecIacu)).toEqual({ municipio_id: { in: [IAC] } });
    expect(whereMunicipio(tecIacu, IAC)).toEqual({ municipio_id: IAC });
  });
  it("pedido de município fora do escopo vira filtro vazio com UUID válido (coluna @db.Uuid)", () => {
    const w = whereMunicipio(tecIacu, ITB);
    expect(w).toEqual({ municipio_id: UUID_NENHUM });
    expect(UUID_NENHUM).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
  it("pessoas e empreendimentos seguem o mesmo escopo", () => {
    expect(whereEmpreendimentoEscopo(tecIacu)).toEqual({ municipio_id: { in: [IAC] } });
    const wp = wherePessoaEscopo(tecIacu) as { OR: unknown[] };
    expect(wp.OR[0]).toEqual({ municipio_id: { in: [IAC] } });
    expect(JSON.stringify(wp)).not.toContain(ITB);
  });
  it("usuário com papéis em dois municípios soma os escopos, mas cada ação respeita o papel do município", () => {
    expect(escopoMunicipios(multi)).toEqual([IAC, RUY]);
    expect(can(multi, "analisar", "processo", IAC)).toBe(true);
    expect(can(multi, "analisar", "processo", RUY)).toBe(false); // em RUY é só FISCAL
    expect(can(multi, "fiscalizar", "fiscalizacao", RUY)).toBe(true);
    expect(can(multi, "ver", "processo", ITB)).toBe(false);
  });
});

describe("escopo organização", () => {
  it("ADMIN e TEC_CONSORCIO veem todos os municípios", () => {
    for (const u of [admin, tecConsorcio, sema]) {
      expect(escopoMunicipios(u)).toBe("TODOS");
      expect(whereMunicipio(u)).toEqual({});
      expect(whereMunicipio(u, ITB)).toEqual({ municipio_id: ITB });
      expect(podeVerMunicipio(u, ITB)).toBe(true);
    }
  });
  it("somente ADMIN configura e vê auditoria", () => {
    expect(can(admin, "configurar", "admin")).toBe(true);
    expect(can(admin, "ver", "auditoria")).toBe(true);
    for (const u of [tecConsorcio, tecIacu, gestorItb, fiscalItb, sema, requerente]) {
      expect(can(u, "configurar", "admin")).toBe(false);
      expect(can(u, "ver", "auditoria")).toBe(false);
    }
  });
  it("TEC_CONSORCIO analisa em qualquer município, mas não decide por padrão", () => {
    expect(can(tecConsorcio, "parecer", "processo", ITB)).toBe(true);
    expect(can(tecConsorcio, "decidir", "processo", ITB)).toBe(false);
  });
});

describe("SEMA_INEMA – somente leitura + exportação", () => {
  it("vê tudo", () => {
    for (const r of ["processo", "empreendimento", "pessoa", "fiscalizacao", "denuncia", "documento", "relatorio", "dashboard"] as Recurso[]) expect(can(sema, "ver", r, ITB)).toBe(true);
  });
  it("só possui as ações 'ver' e 'exportar'", () => {
    for (const r of RECURSOS) for (const a of ESCRITA) expect(can(sema, a, r), `${a} ${r}`).toBe(false);
    expect(can(sema, "exportar", "exportacao")).toBe(true);
    expect(can(sema, "exportar", "relatorio")).toBe(true);
    expect(can(sema, "ver", "admin")).toBe(false);
  });
  it("isSomenteLeitura", () => {
    expect(isSomenteLeitura(sema)).toBe(true);
    expect(isSomenteLeitura(admin)).toBe(false);
    expect(isSomenteLeitura(usuario([["SEMA_INEMA", null], ["TEC_MUNICIPAL", IAC]]))).toBe(false);
    expect(isSomenteLeitura(usuario([]))).toBe(false);
  });
});

describe("perfis municipais", () => {
  it("GESTOR decide no próprio município, não em outro", () => {
    expect(can(gestorItb, "decidir", "processo", ITB)).toBe(true);
    expect(can(gestorItb, "decidir", "processo", RUY)).toBe(false);
    expect(can(gestorItb, "cancelar_documento", "documento", ITB)).toBe(true);
    expect(can(gestorItb, "editar", "empreendimento", ITB)).toBe(false);
  });
  it("FISCAL fiscaliza e cadastra pessoa (autuado), mas não analisa processo", () => {
    expect(can(fiscalItb, "fiscalizar", "fiscalizacao", ITB)).toBe(true);
    expect(can(fiscalItb, "criar", "pessoa", ITB)).toBe(true);
    expect(can(fiscalItb, "editar", "pessoa", ITB)).toBe(false);
    expect(can(fiscalItb, "analisar", "processo", ITB)).toBe(false);
  });
});

describe("REQUERENTE – apenas os próprios registros", () => {
  it("não é interno e não tem escopo de município", () => {
    expect(isInterno(requerente)).toBe(false);
    expect(escopoMunicipios(requerente)).toEqual([]);
    expect(whereMunicipio(requerente)).toEqual({ municipio_id: { in: [] } });
  });
  it("processos filtrados por titularidade (requerente ou RT)", () => {
    expect(whereProcessoEscopo(requerente)).toEqual({ OR: [{ requerente_id: PESSOA }, { rt: { pessoa_id: PESSOA } }] });
    expect(whereProcessoEscopo(requerenteSemPessoa)).toEqual({ id: UUID_NENHUM });
  });
  it("pessoa: somente a própria; empreendimento: próprios ou como RT vigente", () => {
    expect(wherePessoaEscopo(requerente)).toEqual({ id: PESSOA });
    expect(wherePessoaEscopo(requerenteSemPessoa)).toEqual({ id: UUID_NENHUM });
    expect(whereEmpreendimentoEscopo(requerente)).toEqual({ OR: [{ requerente_id: PESSOA }, { rts: { some: { rt: { pessoa_id: PESSOA }, ate: null } } }] });
  });
  it("pode requerer e criar empreendimento; não edita cadastros nem vê áreas internas", () => {
    expect(can(requerente, "requerer", "processo")).toBe(true);
    expect(can(requerente, "criar", "empreendimento")).toBe(true);
    expect(can(requerente, "editar", "empreendimento")).toBe(false);
    expect(can(requerente, "ver", "pessoa")).toBe(false);
    expect(can(requerente, "ver", "fiscalizacao")).toBe(false);
    expect(can(requerente, "ver", "dashboard")).toBe(false);
    expect(can(requerente, "ver", "admin")).toBe(false);
  });
});

describe("visitante (sem sessão)", () => {
  it("não pode nada", () => {
    for (const r of RECURSOS) expect(can(null, "ver", r)).toBe(false);
  });
});
