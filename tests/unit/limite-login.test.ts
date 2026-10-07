import { beforeEach, describe, expect, it } from "vitest";
import { _zerarLimites, ipBloqueado, ipDaRequisicao, limiteFalhasIp, limparExpirados, registrarFalhaIp, segundosParaLiberar } from "@/lib/limite-login";

const h = (v: Record<string, string>) => ({ get: (n: string) => v[n.toLowerCase()] ?? null });
const MIN = 60_000;

beforeEach(() => {
  _zerarLimites();
  delete process.env.LOGIN_LIMITE_IP;
  delete process.env.LOGIN_LIMITE_IP_JANELA_MIN;
});

describe("limite de falhas de login por IP", () => {
  it("IP: 1º item do X-Forwarded-For, depois X-Real-IP, senão 'desconhecido'", () => {
    expect(ipDaRequisicao(h({ "x-forwarded-for": "200.1.2.3, 10.0.0.1", "x-real-ip": "9.9.9.9" }))).toBe("200.1.2.3");
    expect(ipDaRequisicao(h({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(ipDaRequisicao(h({}))).toBe("desconhecido");
  });

  it("bloqueia ao atingir 20 falhas em 15 min (padrão) e libera após a janela", () => {
    expect(limiteFalhasIp()).toBe(20);
    const t0 = 1_000_000;
    for (let i = 0; i < 19; i++) registrarFalhaIp("login:1.1.1.1", t0 + i);
    expect(ipBloqueado("login:1.1.1.1", t0 + 100)).toBe(false);
    registrarFalhaIp("login:1.1.1.1", t0 + 200);
    expect(ipBloqueado("login:1.1.1.1", t0 + 300)).toBe(true);
    expect(segundosParaLiberar("login:1.1.1.1", t0 + 300)).toBeGreaterThan(14 * 60);
    // outro IP / outro prefixo não é afetado
    expect(ipBloqueado("login:2.2.2.2", t0 + 300)).toBe(false);
    expect(ipBloqueado("refresh:1.1.1.1", t0 + 300)).toBe(false);
    // janela deslizante: após 15 min da 1ª falha, sai uma e libera
    expect(ipBloqueado("login:1.1.1.1", t0 + 15 * MIN + 1)).toBe(false);
    expect(ipBloqueado("login:1.1.1.1", t0 + 16 * MIN)).toBe(false);
  });

  it("consultar não consome cota (só falhas contam)", () => {
    for (let i = 0; i < 100; i++) expect(ipBloqueado("login:3.3.3.3", 5_000 + i)).toBe(false);
  });

  it("limite e janela configuráveis por env", () => {
    process.env.LOGIN_LIMITE_IP = "3";
    process.env.LOGIN_LIMITE_IP_JANELA_MIN = "1";
    for (let i = 0; i < 3; i++) registrarFalhaIp("login:4.4.4.4", 10_000 + i);
    expect(ipBloqueado("login:4.4.4.4", 10_010)).toBe(true);
    expect(ipBloqueado("login:4.4.4.4", 10_000 + MIN + 5)).toBe(false);
  });

  it("limparExpirados remove chaves antigas", () => {
    registrarFalhaIp("login:5.5.5.5", 0);
    limparExpirados(20 * MIN);
    expect(segundosParaLiberar("login:5.5.5.5", 20 * MIN)).toBe(0);
  });
});
