// Modelo: Recibo de protocolo do requerimento.
import { blocoEmpreendimento, blocoProcesso, blocoTitular, esc, fmtData, fmtDataHora, pagina, textoLivre } from "./base";
import type { ContextoDocumento } from "./tipos";

export function renderRecibo(ctx: ContextoDocumento): string {
  const d = ctx.dados;
  const prazo = d.prazo_previsto ? fmtData(String(d.prazo_previsto)) : "";
  return pagina(
    ctx,
    `<div class="destaque">Recebemos o requerimento abaixo em <b>${esc(fmtDataHora(ctx.processo?.data_protocolo ?? ctx.emitido_em))}</b>. Guarde este recibo: o número do processo permite acompanhar a tramitação em <b>${esc(ctx.dominio)}/consulta</b>.</div>
${blocoProcesso(ctx)}
${blocoTitular(ctx, "Requerente")}
${blocoEmpreendimento(ctx)}
<h2>Documentos entregues</h2>
${
  ctx.anexos.length
    ? `<table class="dados"><thead><tr><th>Documento</th><th>Tipo</th><th>SHA-256 (integridade)</th></tr></thead><tbody>${ctx.anexos
        .map((a) => `<tr><td>${esc(a.nome)}</td><td>${esc(a.tipo)}</td><td style="font-family:monospace;font-size:7pt;word-break:break-all">${esc(a.sha256)}</td></tr>`)
        .join("")}</tbody></table>`
    : "<p>Nenhum documento anexado.</p>"
}
${prazo ? `<p><b>Prazo previsto para a etapa atual:</b> ${esc(prazo)}.</p>` : ""}
${textoLivre(d, "observacoes")}
<p class="pequeno">Este recibo comprova apenas o protocolo do requerimento e não autoriza o início de qualquer atividade. A análise pode gerar pendências a serem respondidas no prazo indicado, sob pena de arquivamento.</p>`,
  );
}
