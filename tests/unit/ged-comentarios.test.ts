import { describe, expect, it } from "vitest";
import { excedeuLimite, LIMITE_COMENTARIOS, MAX_COMENTARIO, normalizarTextoComentario, validarContexto } from "@/lib/ged/comentarios/regras";

describe("comentários – validação", () => {
  it("normaliza quebras, controle e espaços", () => {
    expect(normalizarTextoComentario("  oi\r\nmundo\u0000  ")).toBe("oi\nmundo");
    expect(normalizarTextoComentario("a\n\n\n\n\nb")).toBe("a\n\nb");
  });
  it("rejeita vazio e longo demais", () => {
    expect(() => normalizarTextoComentario("   ")).toThrow();
    expect(() => normalizarTextoComentario("a".repeat(MAX_COMENTARIO + 1))).toThrow();
    expect(normalizarTextoComentario("a".repeat(MAX_COMENTARIO))).toHaveLength(MAX_COMENTARIO);
  });
  it("mantém HTML como texto (a saída é escapada na tela)", () => {
    expect(normalizarTextoComentario("<script>alert(1)</script>")).toBe("<script>alert(1)</script>");
  });
  it("contextos válidos", () => {
    for (const c of ["GERAL", "ASSINATURA", "RECUSA", "TRAMITE"]) expect(validarContexto(c)).toBe(c);
    expect(() => validarContexto("OUTRO")).toThrow();
  });
  it("limite de ritmo", () => {
    expect(excedeuLimite(LIMITE_COMENTARIOS.max - 1)).toBe(false);
    expect(excedeuLimite(LIMITE_COMENTARIOS.max)).toBe(true);
  });
});
