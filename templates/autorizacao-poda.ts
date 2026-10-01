// Modelo: Autorização de Poda/Corte de Árvore (APC – demanda urbana). Usado quando tipo_ato.modelo_documento =
// AUTORIZACAO_PODA ou, para AUTORIZACAO, quando a sigla do ato é APC (templates/index.ts → modeloEspecifico).
// Dados específicos em ctx.dados.demanda (lib/processo/documentos.ts → dadosDemandaDocumento).
import { blocoProcesso, blocoTitular, esc, fmtData, linhas, pagina } from "./base";
import { listaCondicionantes } from "./licenca";
import type { ContextoDocumento } from "./tipos";

type Vistoria = { especie: string | null; dap_cm: number | null; altura_m: number | null; fitossanidade: string | null; risco: string | null; recomendacao: string | null; mudas: number | null; observacoes: string | null };

export type DemandaDoc = {
  sigla: string;
  campos: Record<string, string>;
  pares: [string, string][];
  descricao_livre: string | null;
  vistoria: Vistoria | null;
  limite_db: number | null;
};

/** Lê ctx.dados.demanda com segurança (documento emitido sem esses dados continua renderizando). */
export function demandaDe(ctx: ContextoDocumento): DemandaDoc {
  const d = (ctx.dados?.demanda ?? {}) as Partial<DemandaDoc>;
  return {
    sigla: String(d.sigla ?? ctx.processo?.tipo_ato_sigla ?? ""),
    campos: d.campos && typeof d.campos === "object" ? (d.campos as Record<string, string>) : {},
    pares: Array.isArray(d.pares) ? (d.pares as [string, string][]) : [],
    descricao_livre: typeof d.descricao_livre === "string" ? d.descricao_livre : null,
    vistoria: d.vistoria && typeof d.vistoria === "object" ? (d.vistoria as Vistoria) : null,
    limite_db: typeof d.limite_db === "number" && Number.isFinite(d.limite_db) ? d.limite_db : null,
  };
}

/** Bloco "Local" (imóvel urbano / local do evento / veículo) – sem tipologia/porte, que não se aplicam. */
export function blocoLocal(ctx: ContextoDocumento, titulo: string): string {
  const e = ctx.empreendimento;
  if (!e) return "";
  return `<h2>${esc(titulo)}</h2>${linhas([
    ["Identificação", e.nome],
    ["Endereço", e.endereco],
    ["Coordenadas (SIRGAS 2000)", e.latitude && e.longitude ? `Lat. ${e.latitude} · Long. ${e.longitude}` : ""],
  ])}`;
}

const num = (v: number | null | undefined, casas = 0) => (v === null || v === undefined || !Number.isFinite(v) ? "" : v.toLocaleString("pt-BR", { maximumFractionDigits: casas }));

export function renderAutorizacaoPoda(ctx: ContextoDocumento): string {
  const d = demandaDe(ctx);
  const v = d.vistoria;
  const intervencao = v?.recomendacao && v.recomendacao !== "Indeferir" ? v.recomendacao : (d.campos.intervencao ?? "Poda");
  const corte = /corte/i.test(intervencao);
  const mudas = v?.mudas ?? 0;
  const validade = ctx.validade_ate ? fmtData(ctx.validade_ate) : "indeterminada";
  return pagina(
    ctx,
    `<p class="texto">O(A) <b>${esc(ctx.municipio.orgao)}</b>, no uso de suas atribuições legais (Lei Complementar nº 140/2011, Lei Federal nº 12.651/2012 e legislação municipal de arborização urbana), com base no processo e na vistoria técnica abaixo identificados, <b>AUTORIZA</b> a <b>${esc(corte ? "supressão (corte)" : "poda")}</b> da(s) árvore(s) descrita(s) a seguir, nas condições estabelecidas neste documento.</p>
${blocoProcesso(ctx)}
${blocoTitular(ctx, "Autorizado(a)")}
${blocoLocal(ctx, "Local da intervenção (imóvel urbano)")}
<h2>Árvore(s) e intervenção autorizada</h2>
${linhas([
  ["Intervenção autorizada", intervencao],
  ["Espécie", v?.especie || d.campos.especie],
  ["Quantidade de árvores", d.campos.quantidade],
  ["Motivo do pedido", d.campos.motivo],
  ["Localização da árvore", d.campos.local_arvore],
  ["DAP (cm) / altura (m)", [num(v?.dap_cm, 1), num(v?.altura_m, 1)].filter(Boolean).join(" / ")],
  ["Estado fitossanitário", v?.fitossanidade],
  ["Risco avaliado na vistoria", v?.risco],
])}
<div class="destaque" data-compensacao="${esc(mudas)}"><b>Compensação ambiental:</b> ${
      mudas > 0
        ? `plantio de <b>${esc(num(mudas))} muda(s)</b> de espécie(s) nativa(s), conforme as condicionantes abaixo.`
        :"não exigida para esta intervenção (poda de manejo sem supressão)."
    }</div>
<div class="destaque"><b>Validade:</b> esta autorização é válida até <b>${esc(validade)}</b>. Após o vencimento sem execução, novo pedido deverá ser apresentado.</div>
${d.descricao_livre ? `<h2>Informações do requerente</h2><p class="texto">${esc(d.descricao_livre)}</p>` : ""}
<h2>Condicionantes</h2>
${listaCondicionantes(ctx)}
<p class="pequeno">Esta autorização refere-se exclusivamente à(s) árvore(s) vistoriada(s) e não autoriza intervenção em Área de Preservação Permanente, em espécies imunes ao corte ou ameaçadas de extinção, nem dispensa a anuência do proprietário do imóvel e da concessionária de energia, quando cabível. O descumprimento sujeita o autorizado às sanções da Lei nº 9.605/1998 e do Decreto nº 6.514/2008.</p>`,
  );
}
