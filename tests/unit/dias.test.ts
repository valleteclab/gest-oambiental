import { describe, expect, it } from "vitest";
import { conjuntoFeriados, diasRestantes, ehDiaUtil, rotuloDiasRestantes, semaforo, somarDias } from "@/lib/dias";

// Datas locais (sem fuso) para não depender do TZ do ambiente.
const d = (a: number, m: number, dia: number, h = 12) => new Date(a, m - 1, dia, h);
const ymd = (x: Date) => [x.getFullYear(), x.getMonth() + 1, x.getDate()];
// Feriados vêm do banco como DATE (meia-noite UTC)
const feriados = conjuntoFeriados([new Date("2026-09-07T00:00:00Z"), new Date("2026-10-12T00:00:00Z")]);

describe("ehDiaUtil", () => {
  it("fins de semana e feriados não são úteis", () => {
    expect(ehDiaUtil(d(2026, 9, 5), feriados)).toBe(false); // sábado
    expect(ehDiaUtil(d(2026, 9, 6), feriados)).toBe(false); // domingo
    expect(ehDiaUtil(d(2026, 9, 7), feriados)).toBe(false); // feriado (segunda)
    expect(ehDiaUtil(d(2026, 9, 8), feriados)).toBe(true);
  });
});

describe("somarDias", () => {
  it("dias corridos terminam no fim do dia", () => {
    const r = somarDias(d(2026, 9, 27), 30, false);
    expect(ymd(r)).toEqual([2026, 10, 27]);
    expect(r.getHours()).toBe(23);
  });
  it("dias úteis pulam fim de semana e feriado", () => {
    // sexta 04/09 + 1 útil: sáb, dom, 07/09 feriado → terça 08/09
    expect(ymd(somarDias(d(2026, 9, 4), 1, true, feriados))).toEqual([2026, 9, 8]);
    // quarta 30/09 + 5 úteis: 01,02,05,06,07/10
    expect(ymd(somarDias(d(2026, 9, 30), 5, true, feriados))).toEqual([2026, 10, 7]);
    // sexta 09/10 + 1 útil: 12/10 feriado → terça 13/10
    expect(ymd(somarDias(d(2026, 10, 9), 1, true, feriados))).toEqual([2026, 10, 13]);
  });
  it("0 dias úteis = fim do mesmo dia", () => {
    expect(ymd(somarDias(d(2026, 9, 4), 0, true, feriados))).toEqual([2026, 9, 4]);
  });
});

describe("diasRestantes", () => {
  const hoje = d(2026, 9, 27, 9);
  it("corridos: positivo, zero e negativo", () => {
    expect(diasRestantes(d(2026, 9, 30, 23), false, new Set(), hoje)).toBe(3);
    expect(diasRestantes(d(2026, 9, 27, 23), false, new Set(), hoje)).toBe(0);
    expect(diasRestantes(d(2026, 9, 25, 23), false, new Set(), hoje)).toBe(-2);
  });
  it("úteis: conta só dias úteis", () => {
    // dom 06/09 → qui 10/09: 08, 09, 10 (07 feriado) = 3
    expect(diasRestantes(d(2026, 9, 10), true, feriados, d(2026, 9, 6))).toBe(3);
    // vencido em dias úteis: sex 11/09 visto de ter 15/09 → -2 (14, 15 úteis; 12/13 fim de semana)
    expect(diasRestantes(d(2026, 9, 11), true, feriados, d(2026, 9, 15))).toBe(-2);
  });
});

describe("semaforo", () => {
  const hoje = d(2026, 9, 27, 9);
  it("vermelho vencido, amarelo na janela, verde em dia", () => {
    expect(semaforo(d(2026, 9, 26), 5, false, hoje)).toBe("vermelho");
    expect(semaforo(d(2026, 9, 27), 5, false, hoje)).toBe("amarelo");
    expect(semaforo(d(2026, 9, 30), 5, false, hoje)).toBe("amarelo");
    expect(semaforo(d(2026, 10, 2), 5, false, hoje)).toBe("amarelo");
    expect(semaforo(d(2026, 10, 3), 5, false, hoje)).toBe("verde");
  });
  it("cinza sem prazo ou pausado", () => {
    expect(semaforo(null)).toBe("cinza");
    expect(semaforo(d(2026, 9, 1), 5, true, hoje)).toBe("cinza");
  });
  it("assinatura antiga (sem hoje) continua funcionando", () => {
    expect(semaforo(new Date(Date.now() - 3 * 86400000))).toBe("vermelho");
    expect(semaforo(new Date(Date.now() + 30 * 86400000))).toBe("verde");
  });
});

describe("rotuloDiasRestantes", () => {
  it("formata", () => {
    expect(rotuloDiasRestantes(0)).toBe("vence hoje");
    expect(rotuloDiasRestantes(1)).toBe("1 dia");
    expect(rotuloDiasRestantes(3)).toBe("3 dias");
    expect(rotuloDiasRestantes(-1)).toBe("vencido há 1 dia");
    expect(rotuloDiasRestantes(null)).toBe("—");
  });
});
