import { describe, expect, it } from "vitest";
import type { StatusProcesso } from "@prisma/client";
import type { UsuarioSessao, PapelVinculo } from "@/lib/rbac";
import {
  ACOES_PROCESSO,
  TRANSICOES,
  acoesDisponiveis,
  destino,
  itensChecklistPendentes,
  lerItensChecklist,
  normalizarAcao,
  permitido,
  proximoDoRodizio,
  type ContextoAcao,
} from "@/lib/processo/maquina";
import { calcularPorte } from "@/lib/processo/porte";

const LOR = "11111111-1111-1111-1111-111111111111";
const CSE = "22222222-2222-2222-2222-222222222222";
const PESSOA = "33333333-3333-3333-3333-333333333333";

const usuario = (papeis: PapelVinculo[], pessoa_id: string | null = null): UsuarioSessao => ({ id: "u", nome: "U", email: "u@x", cargo: null, pessoa_id, trocar_senha: false, papeis });
const tecLor = usuario([{ papel: "TEC_MUNICIPAL", municipio_id: LOR }]);
const tecCse = usuario([{ papel: "TEC_MUNICIPAL", municipio_id: CSE }]);
const tecConsorcio = usuario([{ papel: "TEC_CONSORCIO", municipio_id: null }]);
const gestorLor = usuario([{ papel: "GESTOR_MUNICIPAL", municipio_id: LOR }]);
const admin = usuario([{ papel: "ADMIN", municipio_id: null }]);
const sema = usuario([{ papel: "SEMA_INEMA", municipio_id: null }]);
const fiscal = usuario([{ papel: "FISCAL", municipio_id: LOR }]);
const requerente = usuario([{ papel: "REQUERENTE", municipio_id: null }], PESSOA);
const outroRequerente = usuario([{ papel: "REQUERENTE", municipio_id: null }], "44444444-4444-4444-4444-444444444444");

const ctx = (status: StatusProcesso, extra: Partial<ContextoAcao> = {}): ContextoAcao => ({ status, municipio_id: LOR, requerente_id: PESSOA, exige_parecer: true, delega_decisao: false, ...extra });

describe("tabela de transições (SPEC 6)", () => {
  it.each([
    ["protocolar", "RASCUNHO", "PROTOCOLADO"],
    ["distribuir", "PROTOCOLADO", "EM_TRIAGEM"],
    ["pendencia", "EM_TRIAGEM", "AGUARDANDO_REQUERENTE"],
    ["pendencia", "EM_ANALISE", "AGUARDANDO_REQUERENTE"],
    ["aceitar", "EM_TRIAGEM", "EM_ANALISE"],
    ["agendar_vistoria", "EM_ANALISE", "AGUARDANDO_VISTORIA"],
    ["concluir_vistoria", "AGUARDANDO_VISTORIA", "EM_ANALISE"],
    ["parecer", "EM_ANALISE", "AGUARDANDO_DECISAO"],
    ["deferir", "AGUARDANDO_DECISAO", "DEFERIDO"],
    ["indeferir", "AGUARDANDO_DECISAO", "INDEFERIDO"],
    ["emitir_documento", "DEFERIDO", "CONCLUIDO"],
    ["emitir_documento", "INDEFERIDO", "CONCLUIDO"],
    ["arquivar", "EM_ANALISE", "ARQUIVADO"],
    ["arquivar", "AGUARDANDO_REQUERENTE", "ARQUIVADO"],
  ] as const)("%s: %s → %s", (acao, de, para) => {
    expect(destino(acao, de)).toBe(para);
  });

  it("responder volta à etapa de origem da pendência", () => {
    expect(destino("responder", "AGUARDANDO_REQUERENTE", "EM_TRIAGEM")).toBe("EM_TRIAGEM");
    expect(destino("responder", "AGUARDANDO_REQUERENTE", "EM_ANALISE")).toBe("EM_ANALISE");
  });

  it("redistribuir mantém o status", () => {
    expect(destino("distribuir", "EM_ANALISE")).toBe("EM_ANALISE");
  });

  it.each([
    ["protocolar", "PROTOCOLADO"],
    ["aceitar", "EM_ANALISE"],
    ["parecer", "EM_TRIAGEM"],
    ["deferir", "EM_TRIAGEM"],
    ["responder", "EM_ANALISE"],
    ["pendencia", "AGUARDANDO_DECISAO"],
    ["arquivar", "CONCLUIDO"],
    ["arquivar", "ARQUIVADO"],
    ["emitir_documento", "AGUARDANDO_DECISAO"],
  ] as const)("%s não é permitido em %s", (acao, de) => {
    expect(destino(acao, de)).toBeNull();
  });

  it("estados finais não têm saída", () => {
    for (const a of ACOES_PROCESSO) {
      expect(TRANSICOES[a].de).not.toContain("CONCLUIDO");
      expect(TRANSICOES[a].de).not.toContain("ARQUIVADO");
    }
  });

  it("normaliza apelidos de ação", () => {
    expect(normalizarAcao("concluir")).toBe("emitir_documento");
    expect(normalizarAcao("agendar-vistoria")).toBe("agendar_vistoria");
    expect(normalizarAcao("xpto")).toBeNull();
  });
});

describe("ações disponíveis por perfil", () => {
  it("requerente titular protocola o rascunho e responde pendência", () => {
    expect(acoesDisponiveis(ctx("RASCUNHO"), requerente)).toEqual(["protocolar", "arquivar"]);
    expect(acoesDisponiveis(ctx("AGUARDANDO_REQUERENTE"), requerente)).toEqual(["responder"]);
    expect(acoesDisponiveis(ctx("EM_ANALISE"), requerente)).toEqual([]);
  });

  it("requerente de outro processo não tem ações", () => {
    expect(acoesDisponiveis(ctx("RASCUNHO"), outroRequerente)).toEqual([]);
    expect(acoesDisponiveis(ctx("AGUARDANDO_REQUERENTE"), outroRequerente)).toEqual([]);
  });

  it("técnico do município tria, analisa e emite parecer, mas não decide", () => {
    expect(acoesDisponiveis(ctx("PROTOCOLADO"), tecLor)).toEqual(["distribuir", "arquivar"]);
    expect(acoesDisponiveis(ctx("EM_TRIAGEM"), tecLor)).toEqual(["distribuir", "pendencia", "aceitar", "arquivar"]);
    expect(acoesDisponiveis(ctx("EM_ANALISE"), tecLor)).toEqual(["distribuir", "pendencia", "agendar_vistoria", "parecer", "arquivar"]);
    expect(acoesDisponiveis(ctx("AGUARDANDO_DECISAO"), tecLor)).not.toContain("deferir");
  });

  it("técnico de outro município não tem ações (escopo)", () => {
    for (const s of ["PROTOCOLADO", "EM_TRIAGEM", "EM_ANALISE", "AGUARDANDO_DECISAO"] as const) expect(acoesDisponiveis(ctx(s), tecCse)).toEqual([]);
  });

  it("gestor decide; técnico do consórcio só decide com delegação", () => {
    expect(acoesDisponiveis(ctx("AGUARDANDO_DECISAO"), gestorLor)).toEqual(["distribuir", "deferir", "indeferir", "arquivar"]);
    expect(acoesDisponiveis(ctx("AGUARDANDO_DECISAO"), tecConsorcio)).not.toContain("deferir");
    expect(acoesDisponiveis(ctx("AGUARDANDO_DECISAO", { delega_decisao: true }), tecConsorcio)).toContain("deferir");
  });

  it("não deferir direto da análise quando o ato exige parecer", () => {
    expect(acoesDisponiveis(ctx("EM_ANALISE"), gestorLor)).not.toContain("deferir");
    expect(acoesDisponiveis(ctx("EM_ANALISE", { exige_parecer: false }), gestorLor)).toContain("deferir");
  });

  it("emitir documento disponível após decisão", () => {
    expect(acoesDisponiveis(ctx("DEFERIDO"), gestorLor)).toContain("emitir_documento");
    expect(acoesDisponiveis(ctx("DEFERIDO"), admin)).toContain("emitir_documento");
  });

  it("SEMA/INEMA e fiscal não têm ações de tramitação", () => {
    for (const s of ["RASCUNHO", "PROTOCOLADO", "EM_TRIAGEM", "EM_ANALISE", "AGUARDANDO_DECISAO", "DEFERIDO"] as const) {
      expect(acoesDisponiveis(ctx(s), sema)).toEqual([]);
      expect(acoesDisponiveis(ctx(s), fiscal)).toEqual([]);
    }
  });

  it("requerente nunca executa ações internas mesmo que forçadas", () => {
    expect(permitido(requerente, "aceitar", ctx("EM_TRIAGEM"))).toBe(false);
    expect(permitido(requerente, "deferir", ctx("AGUARDANDO_DECISAO"))).toBe(false);
    expect(permitido(requerente, "arquivar", ctx("EM_ANALISE"))).toBe(false);
  });
});

describe("checklist", () => {
  const itens = lerItensChecklist([
    { id: "c1", texto: "Docs", tipo: "SIM_NAO", obrigatorio: true },
    { id: "c2", texto: "Distância", tipo: "NUMERO", obrigatorio: false },
    { id: "c3", texto: "Obs", tipo: "TEXTO", obrigatorio: true },
    { texto: "sem id" },
  ]);
  it("lê itens válidos", () => expect(itens.map((i) => i.id)).toEqual(["c1", "c2", "c3"]));
  it("aponta obrigatórios pendentes e valores inválidos", () => {
    expect(itensChecklistPendentes(itens, {}).map((i) => i.id)).toEqual(["c1", "c3"]);
    expect(itensChecklistPendentes(itens, { c1: "SIM", c3: "ok", c2: "abc" }).map((i) => i.id)).toEqual(["c2"]);
    expect(itensChecklistPendentes(itens, { c1: "NAO", c3: "ok", c2: "12,5" })).toEqual([]);
  });
});

describe("rodízio de distribuição", () => {
  it("escolhe quem nunca recebeu, depois o mais antigo", () => {
    const a = { id: "a", nome: "Ana", ultima: new Date("2026-09-01") };
    const b = { id: "b", nome: "Bruno", ultima: null };
    const c = { id: "c", nome: "Carla", ultima: new Date("2026-08-01") };
    expect(proximoDoRodizio([a, b, c])?.id).toBe("b");
    expect(proximoDoRodizio([a, c])?.id).toBe("c");
    expect(proximoDoRodizio([])).toBeNull();
  });
});

describe("porte", () => {
  const faixas = [{ porte: "MICRO", ate: 5000 }, { porte: "PEQUENO", ate: 20000 }, { porte: "MEDIO", ate: 60000 }, { porte: "GRANDE", ate: 150000 }, { porte: "EXCEPCIONAL", ate: null }];
  it("calcula pelas faixas da tipologia", () => {
    expect(calcularPorte(faixas, 5000)).toBe("MICRO");
    expect(calcularPorte(faixas, 15000)).toBe("PEQUENO");
    expect(calcularPorte(faixas, 1e6)).toBe("EXCEPCIONAL");
    expect(calcularPorte(faixas, -1)).toBeNull();
  });
});
