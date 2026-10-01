// Modelo: Ofício (padrão: comunicação de indeferimento – dados.motivo / dados.fundamentacao; ou dados.assunto + dados.texto).
import { blocoEmpreendimento, blocoProcesso, esc, pagina, textoLivre } from "./base";
import type { ContextoDocumento } from "./tipos";

export function renderOficio(ctx: ContextoDocumento): string {
  const d = ctx.dados;
  const indeferimento = !d.assunto || d.indeferimento === true;
  const assunto = String(d.assunto ?? `Indeferimento do requerimento – processo nº ${ctx.processo?.numero ?? ""}`);
  const corpoPadrao = indeferimento
    ? `<p>Comunicamos que o requerimento de <b>${esc(ctx.processo?.tipo_ato_nome ?? "licenciamento ambiental")}</b> referente ao processo em epígrafe foi <b>INDEFERIDO</b> pela autoridade competente, pelos motivos expostos a seguir.</p>`
    : "";
  return pagina(
    ctx,
    `<p><b>Ao(À) Sr(a).</b><br>${ctx.titular ? `${esc(ctx.titular.nome)}${ctx.titular.endereco ? `<br>${esc(ctx.titular.endereco)}` : ""}` : "—"}</p>
<p><b>Assunto:</b> ${esc(assunto)}</p>
${blocoProcesso(ctx)}
${blocoEmpreendimento(ctx)}
<div class="texto">${corpoPadrao}</div>
${d.motivo ? `<h2>Motivo</h2>${textoLivre(d, "motivo")}` : ""}
${d.fundamentacao ? `<h2>Fundamentação</h2>${textoLivre(d, "fundamentacao")}` : ""}
${textoLivre(d, "texto")}
${indeferimento ? `<p class="texto">Da presente decisão cabe recurso administrativo, no prazo de <b>15 (quinze) dias</b> contados da ciência, dirigido à autoridade que proferiu a decisão. O interessado poderá apresentar novo requerimento, sanadas as razões do indeferimento.</p>` : ""}
<p>Atenciosamente,</p>`,
  );
}
