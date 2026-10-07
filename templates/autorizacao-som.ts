// Modelo: Autorização para Emissão Sonora – evento (ASE) e carro/propaganda de som (ACS) – demandas urbanas.
// Usado quando tipo_ato.modelo_documento = AUTORIZACAO_SOM ou, para AUTORIZACAO, quando a sigla do ato é ASE/ACS.
// Limites em dB(A) e horários vêm das condicionantes (texto editável na decisão) e do checklist (limite aplicável).
import { blocoProcesso, blocoTitular, esc, fmtData, linhas, pagina } from "./base";
import { listaCondicionantes } from "./licenca";
import { blocoLocal, demandaDe } from "./autorizacao-poda";
import type { ContextoDocumento } from "./tipos";

const dataBr = (iso: string | undefined) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : iso ?? "");

export function renderAutorizacaoSom(ctx: ContextoDocumento): string {
  const d = demandaDe(ctx);
  const c = d.campos;
  const veiculo = d.sigla === "ACS";
  const validade = ctx.validade_ate ? fmtData(ctx.validade_ate) : "indeterminada";
  const periodo = veiculo
    ? `${c.periodo_dias ?? ""}`.trim()
    : c.data_inicio
      ? c.data_fim && c.data_fim !== c.data_inicio
        ? `de ${dataBr(c.data_inicio)} a ${dataBr(c.data_fim)}`
        : `em ${dataBr(c.data_inicio)}`
      : "";
  const horario = !veiculo && c.horario_inicio ? `das ${c.horario_inicio} às ${c.horario_fim ?? ""}` : "";
  const limite = d.limite_db !== null ? `${d.limite_db.toLocaleString("pt-BR")} dB(A)` : "conforme condicionantes (ABNT NBR 10151:2019 e lei municipal)";
  return pagina(
    ctx,
    `<p class="texto">O(A) <b>${esc(ctx.municipio.orgao)}</b>, no uso de suas atribuições legais (Resolução CONAMA nº 01/1990, ABNT NBR 10151:2019 e legislação municipal de controle da poluição sonora), com base no processo abaixo identificado, <b>AUTORIZA</b> ${veiculo ? "a <b>veiculação de propaganda sonora em veículo</b>" : "a <b>emissão sonora no evento</b>"} descrito(a) a seguir, nas condições estabelecidas neste documento.</p>
${blocoProcesso(ctx)}
${blocoTitular(ctx, "Autorizado(a)")}
${veiculo ? "" : blocoLocal(ctx, "Local do evento")}
<h2>${veiculo ? "Veículo e equipamento autorizados" : "Evento autorizado"}</h2>
${linhas(
  veiculo
    ? [
        ["Placa do veículo", c.placa],
        ["Veículo", c.veiculo],
        ["Equipamento de som", c.equipamento],
        ["Finalidade da propaganda", c.finalidade],
        ["Período autorizado", periodo],
      ]
    : [
        ["Evento", c.evento],
        ["Data(s)", periodo],
        ["Horário da emissão sonora", horario],
        ["Público estimado", c.publico ? `${Number(c.publico).toLocaleString("pt-BR")} pessoas` : ""],
        ["Equipamento de som", c.equipamento],
      ],
)}
<div class="destaque"><b>Limite de pressão sonora:</b> ${esc(limite)}.${horario ? ` <b>Horário limite:</b> ${esc(c.horario_fim ?? "")}.` : ""}${veiculo && c.placa ? ` <b>Placa:</b> ${esc(c.placa)}.` : ""}</div>
<div class="destaque"><b>Validade:</b> esta autorização é válida até <b>${esc(validade)}</b>${veiculo ? "" : " (término do evento)"}.</div>
${d.descricao_livre ? `<h2>Informações do requerente</h2><p class="texto">${esc(d.descricao_livre)}</p>` : ""}
<h2>Condicionantes</h2>
${listaCondicionantes(ctx)}
<p class="pequeno">Esta autorização deve ser mantida no local${veiculo ? " (no veículo)" : " do evento"} e apresentada à fiscalização quando solicitada. Não dispensa alvarás e licenças de outros órgãos (posturas, trânsito, Corpo de Bombeiros). O descumprimento dos limites e horários sujeita o autorizado à apreensão do equipamento, à suspensão desta autorização e às sanções do art. 54 da Lei nº 9.605/1998 e do Decreto nº 6.514/2008.</p>`,
  );
}
