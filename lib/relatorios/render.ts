import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { htmlParaPdf, esc } from "@/lib/pdf";
import { fmtData, fmtDataHora, fmtMoeda, fmtNumero } from "@/lib/format";
import type { Cabecalho, Celula, Coluna, Relatorio } from "./modelo";

// Renderização institucional dos relatórios (SPEC 11): PDF (Chromium) e XLSX (exceljs).

const COR_PRIMARIA = "065F46";

async function logoSvg(logoUrl: string | null | undefined): Promise<string | null> {
  const rel = (logoUrl && logoUrl.startsWith("/") ? logoUrl : "/brasao-generico.svg").replace(/^\/+/, "");
  try {
    return await readFile(path.join(process.cwd(), "public", path.normalize(rel).replace(/^(\.\.[/\\])+/, "")), "utf8");
  } catch {
    return null;
  }
}

/** Logo em PNG para o XLSX (exceljs não aceita SVG). Usa sharp quando disponível. */
async function logoPng(svg: string | null): Promise<Buffer | null> {
  if (!svg) return null;
  try {
    const sharp = (await import("sharp")).default;
    return await sharp(Buffer.from(svg), { density: 192 }).resize({ height: 96 }).png().toBuffer();
  } catch {
    return null;
  }
}

function fmtCelula(v: Celula, c: Coluna): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  switch (c.tipo) {
    case "inteiro":
      return typeof v === "number" ? fmtNumero(v) : String(v);
    case "decimal":
      return typeof v === "number" ? fmtNumero(v, 1) : String(v);
    case "moeda":
      return typeof v === "number" ? fmtMoeda(v) : String(v);
    case "percentual":
      return typeof v === "number" ? `${fmtNumero(v, 1)}%` : String(v);
    case "data":
      return v instanceof Date ? fmtData(v) : String(v);
    case "datahora":
      return v instanceof Date ? fmtDataHora(v) : String(v);
    default:
      return v instanceof Date ? fmtData(v) : String(v);
  }
}

const numerica = (c: Coluna) => ["inteiro", "decimal", "moeda", "percentual"].includes(c.tipo ?? "texto");

export async function relatorioPdf(r: Relatorio, cab: Cabecalho, logoUrl?: string | null): Promise<Buffer> {
  const svg = await logoSvg(logoUrl);
  const logo = svg ? `<img class="logo" alt="" src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}" />` : "";
  const filtros = r.filtros.map(([k, v]) => `<span><b>${esc(k)}:</b> ${esc(v)}</span>`).join("");
  const resumo = r.resumo?.length
    ? `<div class="resumo">${r.resumo.map(([k, v]) => `<div><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join("")}</div>`
    : "";
  const secoes = r.secoes
    .map((s) => {
      const th = s.colunas.map((c) => `<th class="${numerica(c) ? "n" : ""}">${esc(c.titulo)}</th>`).join("");
      const linhas = s.linhas.length
        ? s.linhas.map((l) => `<tr>${s.colunas.map((c) => `<td class="${numerica(c) ? "n" : ""}">${esc(fmtCelula(l[c.chave], c))}</td>`).join("")}</tr>`).join("")
        : `<tr><td colspan="${s.colunas.length}" class="vazio">Nenhum registro para os filtros aplicados.</td></tr>`;
      const total = s.total
        ? `<tfoot><tr>${s.colunas.map((c) => `<td class="${numerica(c) ? "n" : ""}">${s.total![c.chave] === undefined ? "" : esc(fmtCelula(s.total![c.chave], c))}</td>`).join("")}</tr></tfoot>`
        : "";
      return `<section><h2>${esc(s.titulo)} <small>(${s.linhas.length} registro${s.linhas.length === 1 ? "" : "s"})</small></h2>
        <table class="${s.colunas.length > 10 ? "larga" : ""}"><thead><tr>${th}</tr></thead><tbody>${linhas}</tbody>${total}</table>${s.nota ? `<p class="nota">${esc(s.nota)}</p>` : ""}</section>`;
    })
    .join("");

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(r.titulo)}</title><style>
    * { box-sizing: border-box; }
    body { font-family: "Segoe UI", Roboto, Arial, sans-serif; font-size: 9pt; color: #0f172a; margin: 0; }
    header.inst { display: flex; gap: 12px; align-items: center; border-bottom: 2px solid #${COR_PRIMARIA}; padding-bottom: 8px; margin-bottom: 8px; }
    .logo { height: 54px; }
    .inst .org { font-size: 11pt; font-weight: 700; color: #${COR_PRIMARIA}; }
    .inst .mun { font-size: 10pt; }
    .inst .meta { margin-left: auto; text-align: right; font-size: 8pt; color: #475569; }
    h1 { font-size: 14pt; margin: 6px 0 4px; }
    .filtros { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 8.5pt; color: #334155; margin-bottom: 8px; }
    .resumo { display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0 10px; }
    .resumo > div { border: 1px solid #cbd5e1; border-radius: 4px; padding: 4px 8px; }
    .resumo .k { font-size: 7.5pt; color: #475569; } .resumo .v { font-size: 11pt; font-weight: 600; }
    h2 { font-size: 11pt; margin: 12px 0 4px; color: #${COR_PRIMARIA}; } h2 small { font-weight: 400; color: #64748b; font-size: 8pt; }
    table { width: 100%; border-collapse: collapse; font-size: 8pt; }
    thead { display: table-header-group; } tr { page-break-inside: avoid; }
    th { background: #${COR_PRIMARIA}; color: #fff; text-align: left; padding: 4px 5px; font-weight: 600; }
    td { border-bottom: 1px solid #e2e8f0; padding: 3px 5px; vertical-align: top; }
    tbody tr:nth-child(even) td { background: #f8fafc; }
    tfoot td { font-weight: 700; border-top: 1.5px solid #0f172a; background: #f1f5f9; }
    .n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    th.n { white-space: normal; }
    td:first-child { white-space: nowrap; }
    table.larga { font-size: 7pt; } table.larga th, table.larga td { padding: 3px 3px; }
    .vazio { text-align: center; color: #64748b; padding: 10px; }
    .nota { font-size: 7.5pt; color: #475569; margin: 4px 0 0; }
  </style></head><body>
    <header class="inst">${logo}<div><div class="org">${esc(cab.organizacao)}</div><div class="mun">${esc(cab.municipio)}</div></div>
      <div class="meta">Emitido em ${esc(fmtDataHora(cab.emitido_em))}<br/>por ${esc(cab.usuario)}<br/>LicenciaGov</div></header>
    <h1>${esc(r.titulo)}</h1>
    <div class="filtros">${filtros}</div>
    ${resumo}
    ${secoes}
  </body></html>`;

  const rodape = `<div style="width:100%;font-size:7pt;color:#64748b;padding:0 15mm;display:flex;justify-content:space-between;font-family:Arial,sans-serif">
    <span>${esc(cab.organizacao_sigla)} · ${esc(r.titulo)} · emitido em ${esc(fmtDataHora(cab.emitido_em))}</span>
    <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>`;
  return htmlParaPdf(html, { paisagem: r.paisagem, rodapeHtml: rodape, margem: "12mm" });
}

const FMT_XLSX: Record<string, string> = {
  inteiro: "#,##0",
  decimal: "#,##0.0",
  moeda: '"R$" #,##0.00',
  percentual: '0.0"%"',
  data: "dd/mm/yyyy",
  datahora: "dd/mm/yyyy hh:mm",
};

/** Converte Date (UTC) para "data local" da Bahia – o Excel não tem fuso. */
const dataLocal = (d: Date) => new Date(d.getTime() - 3 * 3600000);

export async function relatorioXlsx(r: Relatorio, cab: Cabecalho, logoUrl?: string | null): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "LicenciaGov";
  wb.created = cab.emitido_em;
  const png = await logoPng(await logoSvg(logoUrl));
  const nomesUsados = new Set<string>();

  for (const s of r.secoes) {
    let nome = s.titulo.replace(/[\\/*?:[\]]/g, "").slice(0, 31).trim();
    while (nomesUsados.has(nome)) nome = `${nome.slice(0, 28)}_${nomesUsados.size}`;
    nomesUsados.add(nome);
    const ws = wb.addWorksheet(nome, { pageSetup: { orientation: r.paisagem ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
    const ncol = Math.max(s.colunas.length, 4);
    const inicioTexto = png ? 2 : 1; // coluna A reservada ao logo

    // Cabeçalho institucional (linhas mescladas)
    const linhasCab: [string, Partial<ExcelJS.Font>][] = [
      [cab.organizacao, { bold: true, size: 13, color: { argb: `FF${COR_PRIMARIA}` } }],
      [cab.municipio, { bold: true, size: 11 }],
      [r.titulo + (r.secoes.length > 1 ? ` – ${s.titulo}` : ""), { bold: true, size: 12 }],
      [r.filtros.map(([k, v]) => `${k}: ${v}`).join("  ·  "), { size: 9, color: { argb: "FF334155" } }],
      [`Emitido em ${fmtDataHora(cab.emitido_em)} por ${cab.usuario} – LicenciaGov`, { size: 9, color: { argb: "FF475569" } }],
    ];
    if (r.resumo?.length) linhasCab.push([r.resumo.map(([k, v]) => `${k}: ${v}`).join("  ·  "), { size: 9, bold: true }]);
    linhasCab.forEach(([texto, fonte], i) => {
      const row = i + 1;
      ws.mergeCells(row, inicioTexto, row, Math.max(ncol, inicioTexto));
      const c = ws.getCell(row, inicioTexto);
      c.value = texto;
      c.font = fonte;
      c.alignment = { vertical: "middle", wrapText: false };
    });
    if (png) {
      const img = wb.addImage({ buffer: png as unknown as ExcelJS.Buffer, extension: "png" });
      ws.addImage(img, { tl: { col: 0.15, row: 0.15 }, ext: { width: 48, height: 58 } });
    }
    const linhaHeader = linhasCab.length + 2;

    // Cabeçalho da tabela
    const header = ws.getRow(linhaHeader);
    s.colunas.forEach((c, i) => {
      const cell = header.getCell(i + 1);
      cell.value = c.titulo;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${COR_PRIMARIA}` } };
      cell.alignment = { vertical: "middle", horizontal: numerica(c) ? "right" : "left", wrapText: true };
      cell.border = { bottom: { style: "thin", color: { argb: "FF0F172A" } } };
    });
    header.height = 30;

    const valorXlsx = (v: Celula, c: Coluna) => {
      if (v === null || v === undefined) return null;
      if (v instanceof Date) return dataLocal(v);
      if (typeof v === "boolean") return v ? "Sim" : "Não";
      if (numerica(c) && typeof v === "string" && c.tipo !== "texto") return v; // ex.: "Total"/"12,5%"
      return v;
    };
    s.linhas.forEach((l, idx) => {
      const row = ws.getRow(linhaHeader + 1 + idx);
      s.colunas.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        cell.value = valorXlsx(l[c.chave], c) as ExcelJS.CellValue;
        if (c.tipo && FMT_XLSX[c.tipo]) cell.numFmt = FMT_XLSX[c.tipo];
      });
    });
    let ultima = linhaHeader + s.linhas.length;
    if (s.total) {
      ultima++;
      const row = ws.getRow(ultima);
      s.colunas.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        const v = s.total![c.chave];
        cell.value = v === undefined ? null : (valorXlsx(v, c) as ExcelJS.CellValue);
        if (c.tipo && FMT_XLSX[c.tipo]) cell.numFmt = FMT_XLSX[c.tipo];
        cell.font = { bold: true };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
        cell.border = { top: { style: "thin", color: { argb: "FF0F172A" } } };
      });
    }
    if (s.nota) {
      const row = ultima + 2;
      ws.mergeCells(row, 1, row, ncol);
      ws.getCell(row, 1).value = s.nota;
      ws.getCell(row, 1).font = { italic: true, size: 8, color: { argb: "FF475569" } };
    }

    s.colunas.forEach((c, i) => (ws.getColumn(i + 1).width = c.largura ?? Math.max(12, c.titulo.length + 2)));
    if (png && (ws.getColumn(1).width ?? 0) < 10) ws.getColumn(1).width = 10;
    ws.autoFilter = { from: { row: linhaHeader, column: 1 }, to: { row: linhaHeader + Math.max(s.linhas.length, 0), column: s.colunas.length } };
    ws.views = [{ state: "frozen", ySplit: linhaHeader, xSplit: 1, topLeftCell: `B${linhaHeader + 1}` }];
    ws.headerFooter.oddFooter = `&L${cab.organizacao_sigla} – ${r.titulo}&RPágina &P de &N`;
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}
