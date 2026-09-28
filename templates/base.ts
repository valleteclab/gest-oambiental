// Layout institucional comum a todos os documentos oficiais: cabeçalho com brasão, blocos e rodapé com QR Code.
import { esc, sanitizarHtml, textoParaHtml } from "@/lib/documentos/render";
import { fmtData, fmtDataHora } from "@/lib/format";
import type { ContextoDocumento } from "./tipos";

export { esc, sanitizarHtml, textoParaHtml, fmtData, fmtDataHora };

/** Brasão genérico (fallback quando o município não tem brasao_url resolvível). */
export const BRASAO_GENERICO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120" width="100" height="120"><path d="M50 4 L94 18 V60 C94 88 72 108 50 116 C28 108 6 88 6 60 V18 Z" fill="#065f46" stroke="#064e3b" stroke-width="3"/><path d="M50 22 C66 38 70 58 50 92 C30 58 34 38 50 22 Z" fill="#a7f3d0"/><path d="M50 30 V90" stroke="#065f46" stroke-width="2"/></svg>';
export const BRASAO_GENERICO_URI = `data:image/svg+xml;base64,${Buffer.from(BRASAO_GENERICO_SVG).toString("base64")}`;

const CSS = `
@page { size: A4; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: "Liberation Sans", Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.45; color: #111827; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.cab { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #065f46; padding-bottom: 8px; margin-bottom: 14px; }
.cab img { width: 56px; height: 67px; object-fit: contain; }
.cab img.logo { width: auto; max-width: 190px; height: 64px; }
.cab .inst { line-height: 1.25; }
.cab .inst .l1 { font-size: 9pt; text-transform: uppercase; letter-spacing: .04em; color: #374151; }
.cab .inst .l2 { font-size: 12.5pt; font-weight: 700; color: #064e3b; }
.cab .inst .l3 { font-size: 8.5pt; color: #4b5563; }
h1.titulo { text-align: center; font-size: 15pt; margin: 6px 0 2px; text-transform: uppercase; letter-spacing: .03em; }
.numero { text-align: center; font-size: 11.5pt; font-weight: 700; margin-bottom: 14px; color: #064e3b; }
h2 { font-size: 11pt; margin: 16px 0 6px; padding: 3px 6px; background: #ecfdf5; border-left: 4px solid #065f46; text-transform: uppercase; }
table.dados { width: 100%; border-collapse: collapse; margin: 4px 0 8px; }
table.dados th, table.dados td { border: 1px solid #d1d5db; padding: 4px 6px; vertical-align: top; text-align: left; font-size: 9.5pt; }
table.dados th { width: 30%; background: #f9fafb; font-weight: 600; }
ol.cond li, ul.lista li { margin-bottom: 4px; }
.destaque { border: 1px solid #065f46; background: #f0fdf4; padding: 8px 10px; margin: 10px 0; }
.alerta { border: 1px solid #b91c1c; background: #fef2f2; padding: 8px 10px; margin: 10px 0; }
.assinatura { margin-top: 28px; text-align: center; page-break-inside: avoid; }
.assinatura .linha { width: 60%; margin: 0 auto 4px; border-top: 1px solid #111827; }
.assinatura .nome { font-weight: 700; }
.assinatura .obs { font-size: 8pt; color: #4b5563; margin-top: 4px; }
.texto p { margin: 0 0 8px; text-align: justify; }
.pequeno { font-size: 8.5pt; color: #4b5563; }
table { page-break-inside: auto; } tr { page-break-inside: avoid; }
`;

export function linhas(pares: [string, unknown][]): string {
  return `<table class="dados"><tbody>${pares
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`)
    .join("")}</tbody></table>`;
}

export function cabecalho(ctx: ContextoDocumento): string {
  const m = ctx.municipio;
  return `<header class="cab">
  ${m.logo ? `<img class="logo" src="${esc(m.logo)}" alt="Logo – Prefeitura Municipal de ${esc(m.nome)}">` : `<img src="${esc(m.brasao)}" alt="Brasão do município de ${esc(m.nome)}">`}
  <div class="inst">
    <div class="l1">Estado da Bahia · Prefeitura Municipal de ${esc(m.nome)}</div>
    <div class="l2">${esc(m.orgao)}</div>
    <div class="l3">${esc([m.endereco, m.telefone, m.email].filter(Boolean).join(" · "))}${m.organizacao && m.organizacao !== `Prefeitura Municipal de ${m.nome}` ? `<br>${esc(m.organizacao)}` : ""}</div>
  </div>
</header>`;
}

export function blocoTitular(ctx: ContextoDocumento, rotulo = "Titular"): string {
  if (!ctx.titular) return "";
  const t = ctx.titular;
  return `<h2>${esc(rotulo)}</h2>${linhas([
    [t.tipo === "PJ" ? "Razão social" : "Nome", t.nome],
    [t.tipo === "PJ" ? "CNPJ" : "CPF", t.documento],
    ["Endereço", t.endereco],
  ])}`;
}

export function blocoEmpreendimento(ctx: ContextoDocumento): string {
  const e = ctx.empreendimento;
  if (!e) return "";
  return `<h2>Empreendimento</h2>${linhas([
    ["Denominação", e.nome],
    ["Localização", e.endereco],
    ["Coordenadas (SIRGAS 2000)", e.latitude && e.longitude ? `Lat. ${e.latitude} · Long. ${e.longitude}` : ""],
    ["Atividade (tipologia)", e.tipologia],
    ["Porte / potencial poluidor", [e.porte, e.potencial_poluidor].filter(Boolean).join(" / ")],
    ["Área (m²)", e.area_m2],
    ["Nº do CAR", e.numero_car],
    ["Descrição da atividade", ctx.processo?.descricao_atividade],
  ])}`;
}

export function blocoProcesso(ctx: ContextoDocumento): string {
  const p = ctx.processo;
  if (!p) return "";
  return linhas([
    ["Processo nº", p.numero],
    ["Data do protocolo", p.data_protocolo ? fmtData(p.data_protocolo) : ""],
    ["Modalidade", p.tipo_ato_nome ? `${p.tipo_ato_nome}${p.tipo_ato_sigla ? ` (${p.tipo_ato_sigla})` : ""}` : ""],
    ["Responsável técnico", ctx.rt ? `${ctx.rt.nome} – ${ctx.rt.registro}` : ""],
  ]);
}

export function assinatura(ctx: ContextoDocumento): string {
  return `<div class="assinatura">
  <div class="linha"></div>
  <div class="nome">${esc(ctx.signatario.nome)}</div>
  <div>${esc(ctx.signatario.cargo ?? "")}</div>
  <div class="obs">Documento assinado eletronicamente (assinatura eletrônica simples – usuário autenticado, com registro em trilha de auditoria) em ${esc(fmtDataHora(ctx.emitido_em))}.<br>
  ${esc(ctx.municipio.nome)}/BA, ${esc(fmtData(ctx.emitido_em))}.</div>
</div>`;
}

/** Texto livre enviado em `dados` (texto simples ou `*_html` sanitizado). */
export function textoLivre(dados: Record<string, unknown>, chave: string): string {
  const html = dados[`${chave}_html`];
  if (typeof html === "string" && html.trim()) return `<div class="texto">${sanitizarHtml(html)}</div>`;
  const t = dados[chave];
  return typeof t === "string" && t.trim() ? `<div class="texto">${textoParaHtml(t)}</div>` : "";
}

export function pagina(ctx: ContextoDocumento, corpo: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(ctx.titulo)} ${esc(ctx.numero)}</title><style>${CSS}</style></head>
<body>${cabecalho(ctx)}
<h1 class="titulo">${esc(ctx.titulo)}</h1>
<div class="numero">Nº ${esc(ctx.numero)}</div>
${corpo}
${assinatura(ctx)}
</body></html>`;
}

/** Rodapé repetido em todas as páginas (template de rodapé do Chromium – estilos inline, imagens em data URI). */
export function rodape(ctx: ContextoDocumento, qrDataUri: string): string {
  return `<div style="width:100%;padding:0 15mm;font-family:Arial,Helvetica,sans-serif;font-size:7.5px;color:#374151;-webkit-print-color-adjust:exact;">
  <div style="display:flex;align-items:center;gap:8px;border-top:1px solid #065f46;padding-top:4px;">
    <img src="${qrDataUri}" style="width:21mm;height:21mm;" alt="">
    <div style="flex:1;line-height:1.35;">
      <div style="font-size:8.5px;font-weight:bold;color:#064e3b;">${esc(ctx.titulo)} nº ${esc(ctx.numero)} · Código verificador: ${esc(ctx.codigo)}</div>
      <div>Verifique a autenticidade em <b>${esc(ctx.dominio)}/validar</b> informando o código <b>${esc(ctx.codigo)}</b>, ou leia o QR Code.</div>
      <div>Emitido em ${esc(fmtDataHora(ctx.emitido_em))} por ${esc(ctx.signatario.nome)}${ctx.signatario.cargo ? ` – ${esc(ctx.signatario.cargo)}` : ""} (assinatura eletrônica simples).</div>
      <div>${esc(ctx.municipio.orgao)} – ${esc(ctx.municipio.nome)}/BA</div>
    </div>
    <div style="white-space:nowrap;">Página <span class="pageNumber"></span> de <span class="totalPages"></span></div>
  </div>
</div>`;
}
