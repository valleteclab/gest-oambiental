// Modelo: Auto de infração ambiental.
import { blocoEmpreendimento, blocoTitular, esc, fmtDataHora, linhas, pagina, textoLivre } from "./base";
import type { ContextoDocumento } from "./tipos";
import { fmtMoeda } from "@/lib/format";

const PENALIDADE: Record<string, string> = { ADVERTENCIA: "Advertência", MULTA: "Multa", EMBARGO: "Embargo", INTERDICAO: "Interdição", OUTRA: "Outra" };

export function renderAutoInfracao(ctx: ContextoDocumento): string {
  const a = ctx.auto;
  const d = ctx.dados;
  const f = ctx.fiscalizacao;
  const prazo = a?.prazo_defesa_dias ?? Number(d.prazo_defesa_dias ?? 20);
  return pagina(
    ctx,
    `<p class="texto">No exercício do poder de polícia ambiental, o(a) <b>${esc(ctx.municipio.orgao)}</b> lavra o presente AUTO DE INFRAÇÃO em desfavor do(a) autuado(a) abaixo identificado(a), pelos fatos e fundamentos a seguir.</p>
${blocoTitular(ctx, "Autuado(a)")}
${blocoEmpreendimento(ctx)}
<h2>Fiscalização</h2>
${linhas([
  ["Data/hora da constatação", f ? fmtDataHora(f.data_hora) : ""],
  ["Coordenadas do local", f?.latitude && f?.longitude ? `Lat. ${f.latitude} · Long. ${f.longitude}` : ""],
  ["Constatação", f?.constatacao],
])}
<h2>Infração</h2>
${linhas([
  ["Descrição da infração", a?.descricao_infracao ?? d.descricao_infracao],
  ["Enquadramento legal", a?.enquadramento_legal ?? d.enquadramento_legal],
  ["Penalidade", PENALIDADE[String(a?.penalidade ?? d.penalidade ?? "")] ?? a?.penalidade ?? d.penalidade],
  ["Valor da multa", a?.valor_multa ? fmtMoeda(a.valor_multa) : d.valor_multa ? fmtMoeda(String(d.valor_multa)) : ""],
])}
${textoLivre(d, "observacoes")}
<div class="alerta"><b>Prazo para defesa:</b> o(a) autuado(a) dispõe de <b>${esc(prazo)} dias</b>, contados da ciência deste auto, para apresentar defesa ou impugnação ao órgão ambiental municipal, nos termos do art. 71 da Lei nº 9.605/1998.</div>
<p class="pequeno">A lavratura deste auto não isenta o(a) autuado(a) da obrigação de reparar o dano ambiental, nem de outras sanções civis e penais cabíveis.</p>
<div style="margin-top:22px"><div style="border-top:1px solid #111;width:60%;margin:0 auto 4px"></div><div style="text-align:center" class="pequeno">Ciência do(a) autuado(a) – nome, documento e data</div></div>`,
  );
}
