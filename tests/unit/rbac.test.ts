import { describe, expect, it } from "vitest";
import type { Papel } from "@prisma/client";
import { can, escopoMunicipios, isInterno, isSomenteLeitura, podeProtocolarNoBalcao, podeVerMunicipio, temEscopoOrganizacao, UUID_NENHUM, whereMunicipio, whereOrganizacao, whereProcessoEscopo, whereTecnicosEscopo, type Acao, type Recurso, type UsuarioSessao } from "@/lib/rbac";
import { whereEmpreendimentoEscopo, wherePessoaEscopo, whereResponsavelEscopo } from "@/lib/cadastros/escopo";

// Matriz de permissões e regras de escopo (SPEC 4 / T7).
const CSE = "11111111-1111-4111-8111-111111111111";
const LOR = "22222222-2222-4222-8222-222222222222";
const SSR = "33333333-3333-4333-8333-333333333333";
const PESSOA = "44444444-4444-4444-8444-444444444444";
// Organização A (consórcio de demonstração): CSE, LOR, SSR. Organização B (outro cliente): RDN.
const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RDN = "55555555-5555-4555-8555-555555555555";
const MUNICIPIOS: Record<string, string[]> = { [ORG_A]: [CSE, LOR, SSR], [ORG_B]: [RDN] };

function usuario(papeis: [Papel, string | null][], pessoa_id: string | null = null, org: string | null = undefined as unknown as string | null): UsuarioSessao {
  // Internos pertencem à organização A por padrão; requerente puro não tem organização.
  const organizacao_id = org === undefined ? (papeis.some(([p]) => p !== "REQUERENTE") ? ORG_A : null) : org;
  return { id: "u", nome: "U", email: "u@x", cargo: null, pessoa_id, trocar_senha: false, papeis: papeis.map(([papel, municipio_id]) => ({ papel, municipio_id })), organizacao_id, municipios_org: organizacao_id ? MUNICIPIOS[organizacao_id] : [] };
}

const admin = usuario([["ADMIN", null]]);
const tecConsorcio = usuario([["TEC_CONSORCIO", null]]);
const tecCse = usuario([["TEC_MUNICIPAL", CSE]]);
const gestorLor = usuario([["GESTOR_MUNICIPAL", LOR]]);
const fiscalLor = usuario([["FISCAL", LOR]]);
const sema = usuario([["SEMA_INEMA", null]]);
const requerente = usuario([["REQUERENTE", null]], PESSOA);
const requerenteSemPessoa = usuario([["REQUERENTE", null]]);
const multi = usuario([["TEC_MUNICIPAL", CSE], ["FISCAL", SSR]]);

const RECURSOS: Recurso[] = ["processo", "empreendimento", "pessoa", "fiscalizacao", "denuncia", "documento", "relatorio", "dashboard", "admin", "auditoria", "exportacao"];
const ESCRITA: Acao[] = ["criar", "editar", "triar", "analisar", "pendencia", "parecer", "decidir", "emitir_documento", "cancelar_documento", "fiscalizar", "configurar", "requerer"];

describe("escopo por município – técnico de Campo das Seriemas (T7)", () => {
  it("não vê Lagoa do Orvalho", () => {
    expect(can(tecCse, "ver", "processo", LOR)).toBe(false);
    expect(can(tecCse, "ver", "empreendimento", LOR)).toBe(false);
    expect(podeVerMunicipio(tecCse, LOR)).toBe(false);
  });
  it("vê e analisa Campo das Seriemas", () => {
    expect(can(tecCse, "ver", "processo", CSE)).toBe(true);
    expect(can(tecCse, "analisar", "processo", CSE)).toBe(true);
    expect(can(tecCse, "editar", "empreendimento", CSE)).toBe(true);
    expect(podeVerMunicipio(tecCse, CSE)).toBe(true);
  });
  it("não decide nem configura", () => {
    expect(can(tecCse, "decidir", "processo", CSE)).toBe(false);
    expect(can(tecCse, "configurar", "admin")).toBe(false);
  });
  it("whereMunicipio restringe aos municípios vinculados", () => {
    expect(escopoMunicipios(tecCse)).toEqual([CSE]);
    expect(whereMunicipio(tecCse)).toEqual({ municipio_id: { in: [CSE] } });
    expect(whereMunicipio(tecCse, CSE)).toEqual({ municipio_id: CSE });
  });
  it("pedido de município fora do escopo vira filtro vazio com UUID válido (coluna @db.Uuid)", () => {
    const w = whereMunicipio(tecCse, LOR);
    expect(w).toEqual({ municipio_id: UUID_NENHUM });
    expect(UUID_NENHUM).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
  it("pessoas e empreendimentos seguem o mesmo escopo", () => {
    expect(whereEmpreendimentoEscopo(tecCse)).toEqual({ municipio_id: { in: [CSE] } });
    const wp = wherePessoaEscopo(tecCse) as { OR: unknown[] };
    expect(wp.OR[0]).toEqual({ municipio_id: { in: [CSE] } });
    expect(JSON.stringify(wp)).not.toContain(LOR);
  });
  it("usuário com papéis em dois municípios soma os escopos, mas cada ação respeita o papel do município", () => {
    expect(escopoMunicipios(multi)).toEqual([CSE, SSR]);
    expect(can(multi, "analisar", "processo", CSE)).toBe(true);
    expect(can(multi, "analisar", "processo", SSR)).toBe(false); // em SSR é só FISCAL
    expect(can(multi, "fiscalizar", "fiscalizacao", SSR)).toBe(true);
    expect(can(multi, "ver", "processo", LOR)).toBe(false);
  });
});

describe("escopo organização", () => {
  it("ADMIN, TEC_CONSORCIO e SEMA_INEMA veem todos os municípios DA SUA organização (lista explícita, nunca {})", () => {
    for (const u of [admin, tecConsorcio, sema]) {
      expect(escopoMunicipios(u)).toEqual([CSE, LOR, SSR]);
      expect(whereMunicipio(u)).toEqual({ municipio_id: { in: [CSE, LOR, SSR] } });
      expect(whereMunicipio(u, LOR)).toEqual({ municipio_id: LOR });
      expect(podeVerMunicipio(u, LOR)).toBe(true);
    }
  });
  it("somente ADMIN configura e vê auditoria", () => {
    expect(can(admin, "configurar", "admin")).toBe(true);
    expect(can(admin, "ver", "auditoria")).toBe(true);
    for (const u of [tecConsorcio, tecCse, gestorLor, fiscalLor, sema, requerente]) {
      expect(can(u, "configurar", "admin")).toBe(false);
      expect(can(u, "ver", "auditoria")).toBe(false);
    }
  });
  it("TEC_CONSORCIO analisa em qualquer município, mas não decide por padrão", () => {
    expect(can(tecConsorcio, "parecer", "processo", LOR)).toBe(true);
    expect(can(tecConsorcio, "decidir", "processo", LOR)).toBe(false);
  });
});

describe("SEMA_INEMA – somente leitura + exportação", () => {
  it("vê tudo", () => {
    for (const r of ["processo", "empreendimento", "pessoa", "fiscalizacao", "denuncia", "documento", "relatorio", "dashboard"] as Recurso[]) expect(can(sema, "ver", r, LOR)).toBe(true);
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
    expect(isSomenteLeitura(usuario([["SEMA_INEMA", null], ["TEC_MUNICIPAL", CSE]]))).toBe(false);
    expect(isSomenteLeitura(usuario([]))).toBe(false);
  });
});

describe("perfis municipais", () => {
  it("GESTOR decide no próprio município, não em outro", () => {
    expect(can(gestorLor, "decidir", "processo", LOR)).toBe(true);
    expect(can(gestorLor, "decidir", "processo", SSR)).toBe(false);
    expect(can(gestorLor, "cancelar_documento", "documento", LOR)).toBe(true);
    expect(can(gestorLor, "editar", "empreendimento", LOR)).toBe(false);
  });
  it("FISCAL fiscaliza e cadastra pessoa (autuado), mas não analisa processo", () => {
    expect(can(fiscalLor, "fiscalizar", "fiscalizacao", LOR)).toBe(true);
    expect(can(fiscalLor, "criar", "pessoa", LOR)).toBe(true);
    expect(can(fiscalLor, "editar", "pessoa", LOR)).toBe(false);
    expect(can(fiscalLor, "analisar", "processo", LOR)).toBe(false);
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

describe("protocolo no balcão (/processos/novo) – quem pode abrir processo em nome do requerente", () => {
  it("técnicos, gestor e admin podem, no(s) município(s) do papel", () => {
    expect(podeProtocolarNoBalcao(admin, LOR)).toBe(true);
    expect(podeProtocolarNoBalcao(tecConsorcio, LOR)).toBe(true);
    expect(podeProtocolarNoBalcao(tecConsorcio, SSR)).toBe(true);
    expect(podeProtocolarNoBalcao(tecCse, CSE)).toBe(true);
    expect(podeProtocolarNoBalcao(gestorLor, LOR)).toBe(true);
    expect(podeProtocolarNoBalcao(tecCse)).toBe(true); // em algum município (exibe o botão)
  });
  it("papéis municipais não protocolam fora do seu município", () => {
    expect(podeProtocolarNoBalcao(tecCse, LOR)).toBe(false);
    expect(podeProtocolarNoBalcao(gestorLor, SSR)).toBe(false);
    expect(podeProtocolarNoBalcao(multi, SSR)).toBe(false); // em SSR é só FISCAL
    expect(podeProtocolarNoBalcao(multi, CSE)).toBe(true);
  });
  it("FISCAL, SEMA_INEMA (somente leitura), REQUERENTE e visitante nunca", () => {
    for (const u of [fiscalLor, sema, requerente, requerenteSemPessoa]) {
      expect(podeProtocolarNoBalcao(u)).toBe(false);
      expect(podeProtocolarNoBalcao(u, LOR)).toBe(false);
    }
    expect(podeProtocolarNoBalcao(null)).toBe(false);
  });
  it("papel REQUERENTE não empresta escopo a um papel interno de outro município", () => {
    const tecCseRequerente = usuario([["TEC_MUNICIPAL", CSE], ["REQUERENTE", null]], PESSOA);
    expect(can(tecCseRequerente, "criar", "processo", LOR)).toBe(true); // via REQUERENTE (titularidade)
    expect(podeProtocolarNoBalcao(tecCseRequerente, LOR)).toBe(false);
    expect(podeProtocolarNoBalcao(tecCseRequerente, CSE)).toBe(true);
  });
});

describe("visitante (sem sessão)", () => {
  it("não pode nada", () => {
    for (const r of RECURSOS) expect(can(null, "ver", r)).toBe(false);
  });
});

describe("isolamento entre organizações (clientes SaaS)", () => {
  const adminB = usuario([["ADMIN", null]], null, ORG_B);
  const semaB = usuario([["SEMA_INEMA", null]], null, ORG_B);
  const tecB = usuario([["TEC_MUNICIPAL", RDN]], null, ORG_B);

  it("ADMIN da organização A não vê nem atua em município da organização B", () => {
    expect(escopoMunicipios(admin)).not.toContain(RDN);
    expect(podeVerMunicipio(admin, RDN)).toBe(false);
    expect(whereMunicipio(admin, RDN)).toEqual({ municipio_id: UUID_NENHUM });
    for (const a of ["ver", "criar", "editar", "decidir", "emitir_documento"] as Acao[]) expect(can(admin, a, "processo", RDN), a).toBe(false);
    expect(can(admin, "ver", "documento", RDN)).toBe(false);
    expect(can(admin, "fiscalizar", "fiscalizacao", RDN)).toBe(false);
  });

  it("ADMIN da organização B vê só os seus municípios", () => {
    expect(escopoMunicipios(adminB)).toEqual([RDN]);
    expect(whereMunicipio(adminB)).toEqual({ municipio_id: { in: [RDN] } });
    for (const m of [CSE, LOR, SSR]) {
      expect(podeVerMunicipio(adminB, m)).toBe(false);
      expect(can(adminB, "ver", "processo", m)).toBe(false);
      expect(whereMunicipio(adminB, m)).toEqual({ municipio_id: UUID_NENHUM });
    }
    expect(can(adminB, "decidir", "processo", RDN)).toBe(true);
  });

  it("SEMA_INEMA da organização A não vê a organização B (e vice-versa)", () => {
    expect(podeVerMunicipio(sema, RDN)).toBe(false);
    expect(can(sema, "ver", "processo", RDN)).toBe(false);
    expect(can(sema, "ver", "relatorio", RDN)).toBe(false);
    expect(escopoMunicipios(semaB)).toEqual([RDN]);
    expect(can(semaB, "ver", "processo", LOR)).toBe(false);
    expect(can(semaB, "ver", "processo", RDN)).toBe(true);
  });

  it("papel municipal apontando para município de outra organização não dá acesso (defesa em profundidade)", () => {
    const torto = usuario([["TEC_MUNICIPAL", RDN]], null, ORG_A);
    expect(escopoMunicipios(torto)).toEqual([]);
    expect(can(torto, "ver", "processo", RDN)).toBe(false);
    expect(escopoMunicipios(tecB)).toEqual([RDN]);
  });

  it("usuário interno sem organização não enxerga nada (nega por padrão)", () => {
    const orfao = usuario([["ADMIN", null]], null, null);
    expect(escopoMunicipios(orfao)).toEqual([]);
    expect(whereMunicipio(orfao)).toEqual({ municipio_id: { in: [] } });
    expect(can(orfao, "ver", "processo", LOR)).toBe(false);
    expect(whereOrganizacao(orfao)).toEqual({ organizacao_id: UUID_NENHUM });
  });

  it("configuração e técnicos filtrados pela organização", () => {
    expect(whereOrganizacao(admin)).toEqual({ organizacao_id: ORG_A });
    expect(whereOrganizacao(adminB)).toEqual({ organizacao_id: ORG_B });
    expect(whereTecnicosEscopo(adminB)).toMatchObject({ organizacao_id: ORG_B });
    expect(temEscopoOrganizacao(adminB)).toBe(true);
    expect(temEscopoOrganizacao(tecB)).toBe(false);
  });

  it("pessoas e responsáveis técnicos do escopo organização ficam na organização", () => {
    const w = wherePessoaEscopo(adminB) as { OR: Record<string, unknown>[] };
    expect(w.OR[0]).toEqual({ organizacao_id: ORG_B });
    expect(JSON.stringify(w)).not.toContain(LOR);
    expect(JSON.stringify(whereResponsavelEscopo(admin))).toContain(ORG_A);
    expect(JSON.stringify(whereResponsavelEscopo(admin))).not.toContain(ORG_B);
  });

  it("requerente continua global: filtrado por titularidade, não por organização", () => {
    expect(can(requerente, "criar", "processo", RDN)).toBe(true);
    expect(whereProcessoEscopo(requerente)).toEqual({ OR: [{ requerente_id: PESSOA }, { rt: { pessoa_id: PESSOA } }] });
  });
});
