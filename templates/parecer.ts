// Modelo: Parecer técnico.
import { blocoEmpreendimento, blocoProcesso, blocoTitular, esc, pagina, sanitizarHtml, textoLivre } from "./base";
import { listaCondicionantes } from "./licenca";
import type { ContextoDocumento } from "./tipos";

const CONCLUSAO: Record<string, string> = {
  FAVORAVEL: "FAVORÁVEL",
  DESFAVORAVEL: "DESFAVORÁVEL",
  FAVORAVEL_COM_CONDICIONANTES: "FAVORÁVEL COM CONDICIONANTES",
};

export function renderParecer(ctx: ContextoDocumento): string {
  const p = ctx.parecer;
  const conclusao = p ? CONCLUSAO[p.conclusao] ?? p.conclusao : String(ctx.dados.conclusao ?? "");
  const corpo = p?.texto_html ? `<div class="texto">${sanitizarHtml(p.texto_html)}</div>` : textoLivre(ctx.dados, "texto");
  return pagina(
    ctx,
    `${blocoProcesso(ctx)}
${blocoTitular(ctx, "Requerente")}
${blocoEmpreendimento(ctx)}
<h2>Análise técnica</h2>
${corpo || "<p>—</p>"}
${p?.conclusao === "FAVORAVEL_COM_CONDICIONANTES" || ctx.condicionantes.length ? `<h2>Condicionantes propostas</h2>${listaCondicionantes(ctx)}` : ""}
<h2>Conclusão</h2>
<div class="${p?.conclusao === "DESFAVORAVEL" ? "alerta" : "destaque"}">Parecer <b>${esc(conclusao)}</b>${p?.autor ? `, elaborado por ${esc(p.autor)}` : ""}.</div>
<p class="pequeno">Parecer de caráter técnico e opinativo, que subsidia a decisão da autoridade competente.</p>`,
  );
}
