// Formatação estilo WhatsApp (*negrito*, _itálico_) → HTML seguro (e-mail e chat do site).
export function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function textoParaHtml(texto: string): string {
  const html = escHtml(texto)
    .replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>")
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, "$1<em>$2</em>")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\n/g, "<br>");
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#0f172a">${html}</div>`;
}
