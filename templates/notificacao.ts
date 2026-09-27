// Modelo: Notificação ambiental.
import { blocoEmpreendimento, blocoProcesso, blocoTitular, esc, fmtData, pagina, textoLivre, textoParaHtml } from "./base";
import type { ContextoDocumento } from "./tipos";

export function renderNotificacao(ctx: ContextoDocumento): string {
  const n = ctx.notificacao;
  const d = ctx.dados;
  const exigencia = n?.exigencia ?? String(d.exigencia ?? "");
  const prazoDias = n?.prazo_dias ?? (d.prazo_dias ? Number(d.prazo_dias) : null);
  const prazoAte = n?.prazo_ate ?? (d.prazo_ate ? new Date(String(d.prazo_ate)) : null);
  return pagina(
    ctx,
    `<p class="texto">O(A) <b>${esc(ctx.municipio.orgao)}</b>, no exercício de suas atribuições legais, <b>NOTIFICA</b> o(a) destinatário(a) abaixo identificado(a) a cumprir a(s) exigência(s) descrita(s), no prazo estabelecido.</p>
${blocoProcesso(ctx)}
${blocoTitular(ctx, "Notificado(a)")}
${blocoEmpreendimento(ctx)}
<h2>Exigência</h2>
<div class="texto">${textoParaHtml(exigencia) || "<p>—</p>"}</div>
<div class="alerta"><b>Prazo para atendimento:</b> ${prazoDias ? `${esc(prazoDias)} dias` : ""}${prazoAte ? ` (até ${esc(fmtData(prazoAte))})` : ""}, contados da ciência. O não atendimento poderá ensejar a lavratura de auto de infração e demais sanções previstas na Lei nº 9.605/1998 e no Decreto nº 6.514/2008.</div>
${textoLivre(d, "observacoes")}
<div style="margin-top:22px"><div style="border-top:1px solid #111;width:60%;margin:0 auto 4px"></div><div style="text-align:center" class="pequeno">Ciência do(a) notificado(a) – nome, documento e data</div></div>`,
  );
}
