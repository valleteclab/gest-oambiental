// Cabeçalhos HTTP da rota autenticada de arquivo. PURO (testado em tests/unit/ged-documentos-outros.test.ts).
const removerAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Content-Disposition seguro: filename ASCII (sem aspas/controle/barras) + filename* (RFC 5987) com o nome UTF-8. */
export function cabecalhoDisposicao(tipo: "inline" | "attachment", nome: string): string {
  const limpo = nome.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/[\\/]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 150);
  const base = limpo || "documento";
  const ascii = removerAcentos(base).replace(/[^\x20-\x7e]/g, "_").replace(/["%;]/g, "_");
  const utf8 = encodeURIComponent(base).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${tipo}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

/** Cabeçalhos fixos da resposta de arquivo (sem cache, sem sniffing, fora de buscadores). */
export function cabecalhosArquivo(o: { mime: string; tamanho: number; sha256: string; tipo: "inline" | "attachment"; nome: string }): Record<string, string> {
  return {
    "Content-Type": o.mime,
    "Content-Length": String(o.tamanho),
    "Content-Disposition": cabecalhoDisposicao(o.tipo, o.nome),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Content-SHA256": o.sha256,
    "X-Robots-Tag": "noindex",
  };
}
