import { describe, expect, it } from "vitest";
import {
  enviosSemCiencia, ehDestinatarioAtual, entregaMaisRecente, exigirStatusPermite, fmtDataHoraBR, novaPosse, resolverRemetenteAnterior,
  statusAposTramite, validarEntradaTramite, type LinhaTramite,
} from "@/lib/ged/tramite/regras";

const l = (id: string, tipo: LinhaTramite["tipo"], p: Partial<LinhaTramite> = {}): LinhaTramite => ({
  id, tipo, de_usuario_id: null, de_setor_id: null, para_usuario_id: null, para_setor_id: null, referencia_id: null, ...p,
});

describe("validarEntradaTramite", () => {
  it("ENVIO exige exatamente um destinatário", () => {
    expect(() => validarEntradaTramite({ tipo: "ENVIO" })).toThrow(/destinat/i);
    expect(() => validarEntradaTramite({ tipo: "ENVIO", para_usuario_id: "u", para_setor_id: "s" })).toThrow();
    expect(validarEntradaTramite({ tipo: "ENVIO", para_usuario_id: "u", despacho: "  oi  " }).despacho).toBe("oi");
    expect(validarEntradaTramite({ tipo: "ENVIO", para_setor_id: "s" }).despacho).toBeNull();
  });
  it("prazo no passado é recusado", () => {
    const agora = new Date("2026-10-07T12:00:00Z");
    expect(() => validarEntradaTramite({ tipo: "ENVIO", para_usuario_id: "u", prazo_em: new Date("2026-10-01T00:00:00Z") }, agora)).toThrow(/prazo/i);
    expect(() => validarEntradaTramite({ tipo: "ENVIO", para_usuario_id: "u", prazo_em: new Date("2026-10-10T00:00:00Z") }, agora)).not.toThrow();
  });
  it("DESPACHO e DEVOLUCAO exigem texto e não têm destinatário", () => {
    expect(() => validarEntradaTramite({ tipo: "DESPACHO" })).toThrow();
    expect(() => validarEntradaTramite({ tipo: "DESPACHO", despacho: "x", para_usuario_id: "u" })).toThrow();
    expect(() => validarEntradaTramite({ tipo: "DEVOLUCAO" })).toThrow();
    expect(() => validarEntradaTramite({ tipo: "DEVOLUCAO", despacho: "faltou anexo" })).not.toThrow();
  });
  it("CIENCIA/ARQUIVAMENTO/RECUSA não têm destinatário nem prazo; só ciência referencia", () => {
    for (const tipo of ["CIENCIA", "ARQUIVAMENTO", "RECUSA"] as const) {
      expect(() => validarEntradaTramite({ tipo, para_usuario_id: "u" })).toThrow();
      expect(() => validarEntradaTramite({ tipo, prazo_em: new Date(Date.now() + 1e9) })).toThrow();
    }
    expect(() => validarEntradaTramite({ tipo: "CIENCIA", referencia_id: "x" })).not.toThrow();
    expect(() => validarEntradaTramite({ tipo: "DESPACHO", despacho: "x", referencia_id: "x" })).toThrow();
  });
  it("despacho longo demais", () => {
    expect(() => validarEntradaTramite({ tipo: "DESPACHO", despacho: "a".repeat(4001) })).toThrow(/4000/);
  });
});

describe("remetente anterior (pilha de envios)", () => {
  it("sem envio: null", () => expect(resolverRemetenteAnterior([])).toBeNull());
  it("A→B: devolve a A", () => {
    const h = [l("1", "ENVIO", { de_usuario_id: "A", para_usuario_id: "B" })];
    expect(resolverRemetenteAnterior(h)).toMatchObject({ usuario_id: "A", envio_id: "1" });
  });
  it("A→B→C: C devolve a B; depois B devolve a A", () => {
    const h: LinhaTramite[] = [
      l("1", "ENVIO", { de_usuario_id: "A", para_usuario_id: "B" }),
      l("2", "ENVIO", { de_usuario_id: "B", para_usuario_id: "C" }),
    ];
    expect(resolverRemetenteAnterior(h)?.usuario_id).toBe("B");
    h.push(l("3", "DEVOLUCAO", { de_usuario_id: "C", para_usuario_id: "B" }));
    expect(resolverRemetenteAnterior(h)?.usuario_id).toBe("A");
    h.push(l("4", "DEVOLUCAO", { de_usuario_id: "B", para_usuario_id: "A" }));
    expect(resolverRemetenteAnterior(h)).toBeNull();
  });
  it("despacho/ciência não alteram a pilha; remetente por setor", () => {
    const h = [l("1", "ENVIO", { de_usuario_id: "A", de_setor_id: "S1", para_setor_id: "S2" }), l("2", "DESPACHO"), l("3", "CIENCIA", { referencia_id: "1" })];
    expect(resolverRemetenteAnterior(h)).toMatchObject({ usuario_id: "A", setor_id: "S1" });
  });
});

describe("posse, status e ciência", () => {
  it("destinatário atual por usuário ou setor", () => {
    expect(ehDestinatarioAtual({ responsavel_id: "u1", setor_atual_id: null }, "u1", [])).toBe(true);
    expect(ehDestinatarioAtual({ responsavel_id: null, setor_atual_id: "s1" }, "u1", ["s1"])).toBe(true);
    expect(ehDestinatarioAtual({ responsavel_id: "u2", setor_atual_id: "s9" }, "u1", ["s1"])).toBe(false);
    expect(ehDestinatarioAtual({ responsavel_id: null, setor_atual_id: null }, "u1", ["s1"])).toBe(false);
  });
  it("só ENVIO/DEVOLUCAO movem", () => {
    const atual = { responsavel_id: "x", setor_atual_id: "y" };
    expect(novaPosse({ usuario_id: "u", setor_id: null }, "ENVIO", atual)).toEqual({ responsavel_id: "u", setor_atual_id: null });
    expect(novaPosse({ usuario_id: null, setor_id: "s" }, "ENVIO", atual)).toEqual({ responsavel_id: null, setor_atual_id: "s" });
    for (const t of ["DESPACHO", "CIENCIA", "ARQUIVAMENTO", "RECUSA"] as const) expect(novaPosse({ usuario_id: "u", setor_id: null }, t, atual)).toEqual(atual);
  });
  it("arquivamento define ARQUIVADO; demais mantêm", () => {
    expect(statusAposTramite("ARQUIVAMENTO", "PUBLICADO")).toBe("ARQUIVADO");
    expect(statusAposTramite("ENVIO", "PUBLICADO")).toBe("PUBLICADO");
  });
  it("status que não admitem trâmite", () => {
    expect(() => exigirStatusPermite("ENVIO", "ARQUIVADO")).toThrow();
    expect(() => exigirStatusPermite("ARQUIVAMENTO", "EM_ASSINATURA")).toThrow();
    expect(() => exigirStatusPermite("RECUSA", "EM_ASSINATURA")).not.toThrow();
    expect(() => exigirStatusPermite("ENVIO", "EM_ASSINATURA")).not.toThrow();
  });
  it("entrega mais recente e envios sem ciência", () => {
    const h = [
      l("1", "ENVIO", { de_usuario_id: "A", para_usuario_id: "B" }),
      l("2", "ENVIO", { de_usuario_id: "B", para_setor_id: "S" }),
      l("3", "CIENCIA", { referencia_id: "1" }),
    ];
    expect(entregaMaisRecente(h, "B", [])?.id).toBe("1");
    expect(entregaMaisRecente(h, "Z", ["S"])?.id).toBe("2");
    expect(entregaMaisRecente(h, "Q", [])).toBeNull();
    expect(enviosSemCiencia(h).map((x) => x.id)).toEqual(["2"]);
  });
  it("formata data/hora em Brasília", () => {
    expect(fmtDataHoraBR(new Date("2026-10-07T17:05:00Z"))).toBe("07/10/2026 14:05");
    expect(fmtDataHoraBR(null)).toBe("—");
    expect(fmtDataHoraBR(new Date("2026-01-01T02:30:00Z"))).toBe("31/12/2025 23:30");
  });
});
