// Modelo: Certidão (dispensa / não exigibilidade de licenciamento, ou outra certificação informada em dados.texto).
import { blocoEmpreendimento, blocoProcesso, blocoTitular, esc, fmtData, pagina, textoLivre } from "./base";
import type { ContextoDocumento } from "./tipos";

export function renderCertidao(ctx: ContextoDocumento): string {
  const texto = textoLivre(ctx.dados, "texto");
  const padrao = `<p class="texto">O(A) <b>${esc(ctx.municipio.orgao)}</b> <b>CERTIFICA</b>, para os devidos fins, que a atividade descrita abaixo, conforme informações prestadas pelo interessado e análise constante do processo, <b>não está sujeita ao licenciamento ambiental municipal</b>, nos termos da Resolução CEPRAM nº 4.327/2013 e da legislação municipal aplicável, sem prejuízo do atendimento às normas ambientais vigentes e às demais exigências legais.</p>`;
  return pagina(
    ctx,
    `${texto || padrao}
${blocoProcesso(ctx)}
${blocoTitular(ctx, "Interessado(a)")}
${blocoEmpreendimento(ctx)}
${ctx.validade_ate ? `<div class="destaque"><b>Validade:</b> até ${esc(fmtData(ctx.validade_ate))}.</div>` : ""}
${textoLivre(ctx.dados, "observacoes")}
<p class="pequeno">Esta certidão foi emitida com base nas informações declaradas pelo interessado, que responde civil, administrativa e penalmente pela sua veracidade. Alterações na atividade exigem nova manifestação do órgão ambiental.</p>`,
  );
}
