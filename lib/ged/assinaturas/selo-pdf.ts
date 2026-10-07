// Manipulação de PDF do selo: QR + código no rodapé de TODAS as páginas (pdf-lib + qrcode) e anexação da folha de
// assinaturas. Funções sem banco/IO de storage (recebem e devolvem Buffers).
import QRCode from "qrcode";
import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { invalido } from "@/lib/http";
import { textoRodapeSelo, visualParaNativo } from "./regras";

const QR_LADO = 40; // pt
const MARGEM = 12; // pt
const FAIXA_ALTURA = QR_LADO + 4;
const FAIXA_LARGURA = 224;

export async function qrPng(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, { margin: 1, width: 300, errorCorrectionLevel: "M", type: "png" });
}

async function abrir(pdf: Buffer, rotulo: string): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(pdf, { updateMetadata: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/encrypt/i.test(msg)) throw invalido(`O ${rotulo} está protegido por senha/criptografia e não pode ser selado. Envie uma versão sem proteção.`);
    throw invalido(`Não foi possível ler o ${rotulo} para o selo (PDF inválido ou corrompido).`);
  }
}

/** Estampa, no canto inferior esquerdo de cada página (respeitando a rotação), o QR de verificação e o código curto. */
export async function estamparRodape(pdf: Buffer, p: { codigo: string; url: string }): Promise<{ pdf: Buffer; paginas: number }> {
  const doc = await abrir(pdf, "documento");
  const png = await doc.embedPng(await qrPng(p.url));
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);
  const t = textoRodapeSelo(p.codigo, p.url);
  const paginas = doc.getPages();
  for (const pg of paginas) {
    const cb = pg.getCropBox();
    const rot = pg.getRotation().angle;
    const w = cb.width;
    const h = cb.height;
    const quad = rot === 90 || rot === 270;
    const vw = quad ? h : w; // dimensões como a página é VISTA
    const larg = Math.min(FAIXA_LARGURA, vw - 2 * MARGEM);
    const pos = (vx: number, vy: number) => {
      const r = visualParaNativo(rot, w, h, vx, vy);
      return { x: cb.x + r.x, y: cb.y + r.y, rotate: degrees(r.angulo) };
    };
    // fundo branco (levemente translúcido) para o QR ler bem sobre qualquer conteúdo
    pg.drawRectangle({ ...pos(MARGEM, MARGEM), width: larg, height: FAIXA_ALTURA, color: rgb(1, 1, 1), opacity: 0.92, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.4 });
    pg.drawImage(png, { ...pos(MARGEM + 2, MARGEM + 2), width: QR_LADO, height: QR_LADO });
    pg.drawText(t.linha1, { ...pos(MARGEM + QR_LADO + 7, MARGEM + 29), size: 6.2, font: negrito, color: rgb(0.1, 0.1, 0.1) });
    pg.drawText(t.linha2, { ...pos(MARGEM + QR_LADO + 7, MARGEM + 19), size: 6.2, font: fonte, color: rgb(0.25, 0.25, 0.25) });
    pg.drawText(t.codigo, { ...pos(MARGEM + QR_LADO + 7, MARGEM + 7), size: 8, font: negrito, color: rgb(0.05, 0.3, 0.25) });
  }
  const bytes = await doc.save({ useObjectStreams: false });
  return { pdf: Buffer.from(bytes), paginas: paginas.length };
}

/** Acrescenta ao final do PDF as páginas de `extra` (folha de assinaturas). */
export async function anexarPaginas(base: Buffer, extra: Buffer): Promise<{ pdf: Buffer; paginas: number }> {
  const doc = await abrir(base, "documento");
  const ext = await abrir(extra, "folha de assinaturas");
  const copiadas = await doc.copyPages(ext, ext.getPageIndices());
  copiadas.forEach((pg) => doc.addPage(pg));
  const bytes = await doc.save({ useObjectStreams: false });
  return { pdf: Buffer.from(bytes), paginas: doc.getPageCount() };
}
