// Modelo: Licença ambiental (com condicionantes e validade) e Autorização ambiental.
import { blocoEmpreendimento, blocoProcesso, blocoTitular, esc, fmtData, pagina, textoLivre } from "./base";
import type { ContextoDocumento } from "./tipos";

export function listaCondicionantes(ctx: ContextoDocumento): string {
  if (!ctx.condicionantes.length) return `<p>Não foram estabelecidas condicionantes específicas, sem prejuízo do cumprimento da legislação ambiental vigente.</p>`;
  return `<ol class="cond">${ctx.condicionantes
    .map((c) => {
      const extra = [c.periodicidade ? `Periodicidade: ${c.periodicidade}` : "", c.prazo_ate ? `Prazo: ${fmtData(c.prazo_ate)}` : ""].filter(Boolean).join(" · ");
      return `<li>${esc(c.descricao)}${extra ? ` <span class="pequeno">(${esc(extra)})</span>` : ""}</li>`;
    })
    .join("")}</ol>`;
}

export function renderLicenca(ctx: ContextoDocumento): string {
  const ehAutorizacao = ctx.tipo === "AUTORIZACAO";
  const ato = ctx.processo?.tipo_ato_nome ?? (ehAutorizacao ? "Autorização Ambiental" : "Licença Ambiental");
  const verbo = ehAutorizacao ? "AUTORIZA" : "CONCEDE";
  const validade = ctx.validade_ate ? fmtData(ctx.validade_ate) : "indeterminada";
  return pagina(
    ctx,
    `<p class="texto">O(A) <b>${esc(ctx.municipio.orgao)}</b>, no uso das atribuições conferidas pela Lei Complementar nº 140/2011, pela Lei Estadual nº 10.431/2006 e pela legislação municipal de meio ambiente, com base no processo abaixo identificado e no parecer técnico favorável, <b>${verbo}</b> a presente <b>${esc(ato)}</b> nas condições a seguir.</p>
${blocoProcesso(ctx)}
${blocoTitular(ctx, ehAutorizacao ? "Autorizado(a)" : "Titular da licença")}
${blocoEmpreendimento(ctx)}
<div class="destaque"><b>Validade:</b> ${ehAutorizacao ? "esta autorização" : "esta licença"} é válida até <b>${esc(validade)}</b>, desde que cumpridas as condicionantes abaixo. A renovação deve ser requerida com antecedência mínima de 120 (cento e vinte) dias do vencimento.</div>
${textoLivre(ctx.dados, "texto")}
<h2>Condicionantes</h2>
${listaCondicionantes(ctx)}
${textoLivre(ctx.dados, "observacoes")}
<p class="pequeno">Este ato não dispensa nem substitui alvarás, licenças ou autorizações de outros órgãos exigidos pela legislação. O descumprimento das condicionantes sujeita o titular às sanções da Lei nº 9.605/1998 e do Decreto nº 6.514/2008, podendo ensejar a suspensão ou o cancelamento deste ato.</p>`,
  );
}
