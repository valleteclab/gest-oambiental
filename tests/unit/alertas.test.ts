import { describe, expect, it } from "vitest";
import {
  abaDoPrazo,
  chaveAlerta,
  classificarPrazo,
  destinatariosProcesso,
  deveArquivarAutomatico,
  etapaDoStatus,
  marcoPrazo,
  marcoRenovacao,
  mensagemPrazo,
} from "@/lib/alertas/regras";

const d = (a: number, m: number, dia: number, h = 12) => new Date(a, m - 1, dia, h);
const hoje = d(2026, 9, 27, 9);
const LO = { sigla: "LO", prazo_analise_dias: 60 };
const LS = { sigla: "LS", prazo_analise_dias: 30 };

describe("etapaDoStatus", () => {
  it("mapeia status → etapa de prazo_config", () => {
    expect(etapaDoStatus("PROTOCOLADO", LO)).toBe("TRIAGEM");
    expect(etapaDoStatus("EM_TRIAGEM", LO)).toBe("TRIAGEM");
    expect(etapaDoStatus("EM_ANALISE", LO)).toBe("ANALISE_LONGA");
    expect(etapaDoStatus("EM_ANALISE", LS)).toBe("ANALISE_CURTA");
    expect(etapaDoStatus("AGUARDANDO_VISTORIA", LO)).toBe("VISTORIA");
    expect(etapaDoStatus("AGUARDANDO_DECISAO", LO)).toBe("DECISAO");
    expect(etapaDoStatus("CONCLUIDO", LO)).toBeNull();
    expect(etapaDoStatus("RASCUNHO", LO)).toBeNull();
  });
});

describe("classificarPrazo", () => {
  it("vencendo em 3 dias com janela de 5 → VENCENDO", () => {
    expect(classificarPrazo(d(2026, 9, 30, 23), 5, false, hoje)).toEqual({ situacao: "VENCENDO", dias: 3 });
  });
  it("vencido ontem → VENCIDO", () => {
    expect(classificarPrazo(d(2026, 9, 26, 23), 5, false, hoje)).toEqual({ situacao: "VENCIDO", dias: -1 });
  });
  it("fora da janela → EM_DIA", () => {
    expect(classificarPrazo(d(2026, 10, 20), 5, false, hoje).situacao).toBe("EM_DIA");
  });
  it("pausado nunca alerta", () => {
    expect(classificarPrazo(d(2026, 9, 1), 5, true, hoje).situacao).toBe("PAUSADO");
    expect(classificarPrazo(null, 5, false, hoje).situacao).toBe("SEM_PRAZO");
  });
  it("janela do alerta respeita dias_alerta configurado", () => {
    expect(classificarPrazo(d(2026, 9, 30), 2, false, hoje).situacao).toBe("EM_DIA");
    expect(classificarPrazo(d(2026, 9, 29), 2, false, hoje).situacao).toBe("VENCENDO");
  });
});

describe("abaDoPrazo", () => {
  it("vencidos / vencem em 7 dias / em dia / pausados", () => {
    expect(abaDoPrazo(d(2026, 9, 20), false, hoje)).toBe("vencidos");
    expect(abaDoPrazo(d(2026, 10, 4), false, hoje)).toBe("vencendo");
    expect(abaDoPrazo(d(2026, 10, 5), false, hoje)).toBe("em-dia");
    expect(abaDoPrazo(d(2026, 9, 20), true, hoje)).toBe("pausados");
    expect(abaDoPrazo(null, false, hoje)).toBeNull();
  });
});

describe("marcoRenovacao (licenças 120/60/30)", () => {
  it("escolhe o menor marco ≥ dias restantes", () => {
    expect(marcoRenovacao(d(2027, 3, 1), hoje)).toBeNull(); // > 120 dias
    expect(marcoRenovacao(d(2027, 1, 20), hoje)).toBe(120); // 115 dias
    expect(marcoRenovacao(d(2026, 11, 11), hoje)).toBe(60); // 45 dias
    expect(marcoRenovacao(d(2026, 10, 27), hoje)).toBe(30); // 30 dias
    expect(marcoRenovacao(d(2026, 9, 20), hoje)).toBe("VENCIDA");
  });
});

describe("marcoPrazo (pendências, condicionantes, notificações)", () => {
  it("VENCENDO dentro da janela, VENCIDO após, null antes", () => {
    expect(marcoPrazo(d(2026, 10, 30), 5, hoje)).toBeNull();
    expect(marcoPrazo(d(2026, 10, 1), 5, hoje)).toBe("VENCENDO");
    expect(marcoPrazo(d(2026, 9, 26), 5, hoje)).toBe("VENCIDO");
  });
});

describe("destinatariosProcesso", () => {
  it("técnico + gestor do processo", () => {
    expect(destinatariosProcesso({ tecnico_id: "t", gestor_id: "g" }, ["g1", "g2"])).toEqual(["t", "g"]);
  });
  it("sem gestor no processo → gestores do município", () => {
    expect(destinatariosProcesso({ tecnico_id: "t", gestor_id: null }, ["g1", "g2"])).toEqual(["t", "g1", "g2"]);
  });
  it("sem técnico e sem duplicatas", () => {
    expect(destinatariosProcesso({ tecnico_id: null, gestor_id: null }, ["g1", "g1"])).toEqual(["g1"]);
    expect(destinatariosProcesso({ tecnico_id: "x", gestor_id: "x" }, [])).toEqual(["x"]);
  });
});

describe("chaveAlerta (idempotência)", () => {
  it("mesma entrada → mesma chave; prazo recalculado → chave nova", () => {
    const a = chaveAlerta("PRAZO_VENCENDO", "p1", "u1", "EM_ANALISE", new Date("2026-09-30T23:59:59Z"));
    expect(a).toBe(chaveAlerta("PRAZO_VENCENDO", "p1", "u1", "EM_ANALISE", new Date("2026-09-30T23:59:59Z")));
    expect(a).not.toBe(chaveAlerta("PRAZO_VENCENDO", "p1", "u1", "EM_ANALISE", new Date("2026-10-15T23:59:59Z")));
    expect(a).not.toBe(chaveAlerta("PRAZO_VENCIDO", "p1", "u1", "EM_ANALISE", new Date("2026-09-30T23:59:59Z")));
    expect(a).not.toBe(chaveAlerta("PRAZO_VENCENDO", "p1", "u2", "EM_ANALISE", new Date("2026-09-30T23:59:59Z")));
  });
});

describe("mensagemPrazo", () => {
  it("textos em português", () => {
    expect(mensagemPrazo("VENCENDO", "ITB-2026-000001", "análise", 3)).toContain("vence em 3 dia(s)");
    expect(mensagemPrazo("VENCENDO", "ITB-2026-000001", "análise", 0)).toContain("vence hoje");
    expect(mensagemPrazo("VENCIDO", "ITB-2026-000001", "análise", -2)).toContain("vencido há 2 dia(s)");
  });
});

describe("deveArquivarAutomatico", () => {
  const venc = { status: "VENCIDA", prazo_ate: d(2026, 9, 10) };
  it("só AGUARDANDO_REQUERENTE com todas as pendências vencidas além da carência", () => {
    expect(deveArquivarAutomatico({ status: "AGUARDANDO_REQUERENTE", pendencias: [venc] }, hoje, 0)).toBe(true);
    expect(deveArquivarAutomatico({ status: "AGUARDANDO_REQUERENTE", pendencias: [venc] }, hoje, 30)).toBe(false);
    expect(deveArquivarAutomatico({ status: "EM_ANALISE", pendencias: [venc] }, hoje, 0)).toBe(false);
    expect(deveArquivarAutomatico({ status: "AGUARDANDO_REQUERENTE", pendencias: [venc, { status: "ABERTA", prazo_ate: d(2026, 10, 30) }] }, hoje, 0)).toBe(false);
    expect(deveArquivarAutomatico({ status: "AGUARDANDO_REQUERENTE", pendencias: [{ status: "RESPONDIDA", prazo_ate: d(2026, 9, 1) }] }, hoje, 0)).toBe(false);
  });
});
