// Leitor de ZIP PURO (sem banco, sem disco) para a importação em lote do GED.
//
// Lê o diretório central e só descompacta uma entrada por vez, com teto de saída (zip-bomb). Implementação própria
// (zlib do Node) para controlar os limites antes de gastar memória. Suporta métodos 0 (stored) e 8 (deflate);
// ZIP64, ZIP criptografado e outros métodos são recusados com mensagem clara.
//
// Proteções:
//   - zip-slip: caminhos absolutos, unidade (C:), `..` e caracteres de controle são recusados por entrada;
//   - zip-bomb: nº de entradas/arquivos/pastas, profundidade, soma e tamanho por arquivo DECLARADOS no diretório central,
//     razão de compressão e teto real de saída na inflação (`maxOutputLength`: o tamanho declarado pode mentir);
//   - lixo do sistema ignorado em silêncio: __MACOSX, .DS_Store, Thumbs.db, desktop.ini, ~$*, qualquer item oculto (.nome);
//   - nomes: UTF-8 (flag 11), extra 0x7075 (Info-ZIP), UTF-8 sem flag ou CP850 (Windows pt-BR antigo); normalizados em NFC.
import { crc32 as crc32Node, inflateRawSync } from "node:zlib";
import { LIMITES_PADRAO, MAX_NOME_PASTA, type LimitesZip } from "./limites";

/** Erro que invalida o ZIP inteiro (mensagem em português, segura para mostrar ao usuário). */
export class ErroZip extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ErroZip";
  }
}

export type EntradaZip = {
  /** Posição no diretório central. */
  indice: number;
  nome_bruto: string;
  ehDiretorio: boolean;
  metodo: number;
  crc: number;
  tamanho_comprimido: number;
  tamanho: number;
  offset_local: number;
  cifrada: boolean;
  /** Atalho/link simbólico (nunca seguido). */
  link: boolean;
};

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOC = 0x07064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

// CP850 (Windows pt-BR "OEM"), metade alta 0x80–0xFF.
const CP850_ALTA =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ";

export function decodificarCp850(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x < 0x80 ? String.fromCharCode(x) : CP850_ALTA[x - 0x80];
  return s;
}

function utf8Estrito(b: Buffer): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    return null;
  }
}

/** Extra 0x7075 (Info-ZIP Unicode Path): versão(1) + crc32 do nome bruto(4) + nome UTF-8. */
function nomeUnicodeDoExtra(extra: Buffer, nomeBruto: Buffer): string | null {
  let i = 0;
  while (i + 4 <= extra.length) {
    const id = extra.readUInt16LE(i);
    const len = extra.readUInt16LE(i + 2);
    if (i + 4 + len > extra.length) break;
    if (id === 0x7075 && len > 5 && extra[i + 4] === 1) {
      const crc = extra.readUInt32LE(i + 5);
      const calc = crc32Node ? crc32Node(nomeBruto) : crc;
      if (crc === calc) return utf8Estrito(extra.subarray(i + 9, i + 4 + len));
    }
    i += 4 + len;
  }
  return null;
}

export function decodificarNome(nome: Buffer, flags: number, extra: Buffer): string {
  let s: string | null;
  if (flags & 0x800) s = new TextDecoder("utf-8").decode(nome);
  else s = nomeUnicodeDoExtra(extra, nome) ?? (nome.every((x) => x < 0x80) ? nome.toString("latin1") : (utf8Estrito(nome) ?? decodificarCp850(nome)));
  return s.normalize("NFC");
}

/** Lê o diretório central. Lança ErroZip para ZIP inválido ou que viole um limite global. */
export function lerDiretorioZip(zip: Buffer, limites: LimitesZip = LIMITES_PADRAO): EntradaZip[] {
  if (zip.length > limites.maxZipBytes) throw new ErroZip(`O ZIP excede o limite de ${Math.round(limites.maxZipBytes / 1048576)} MB.`);
  if (zip.length < 22) throw new ErroZip("O arquivo não é um ZIP válido.");
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) {
    if (zip.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ErroZip("O arquivo não é um ZIP válido (diretório central não encontrado).");
  if (eocd >= 20 && zip.readUInt32LE(eocd - 20) === SIG_ZIP64_LOC) throw new ErroZip("ZIP no formato ZIP64 (arquivos muito grandes) não é suportado. Divida em ZIPs menores.");
  const total = zip.readUInt16LE(eocd + 10);
  const tamCentral = zip.readUInt32LE(eocd + 12);
  const offCentral = zip.readUInt32LE(eocd + 16);
  if (total === 0xffff || tamCentral === 0xffffffff || offCentral === 0xffffffff) throw new ErroZip("ZIP no formato ZIP64 (arquivos muito grandes) não é suportado. Divida em ZIPs menores.");
  if (total > limites.maxEntradas) throw new ErroZip(`O ZIP tem itens demais (${total}); o limite é ${limites.maxEntradas}.`);
  if (offCentral + tamCentral > eocd) throw new ErroZip("ZIP corrompido (diretório central fora dos limites).");

  const entradas: EntradaZip[] = [];
  let p = offCentral;
  for (let i = 0; i < total; i++) {
    if (p + 46 > zip.length || zip.readUInt32LE(p) !== SIG_CENTRAL) throw new ErroZip("ZIP corrompido (diretório central inválido).");
    const versaoPor = zip.readUInt16LE(p + 4);
    const flags = zip.readUInt16LE(p + 8);
    const metodo = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const csize = zip.readUInt32LE(p + 20);
    const usize = zip.readUInt32LE(p + 24);
    const nLen = zip.readUInt16LE(p + 28);
    const eLen = zip.readUInt16LE(p + 30);
    const cLen = zip.readUInt16LE(p + 32);
    const attrExt = zip.readUInt32LE(p + 38);
    const off = zip.readUInt32LE(p + 42);
    if (p + 46 + nLen + eLen + cLen > zip.length) throw new ErroZip("ZIP corrompido (entrada truncada).");
    if (csize === 0xffffffff || usize === 0xffffffff || off === 0xffffffff) throw new ErroZip("ZIP no formato ZIP64 (arquivos muito grandes) não é suportado. Divida em ZIPs menores.");
    const nomeBuf = zip.subarray(p + 46, p + 46 + nLen);
    const extra = zip.subarray(p + 46 + nLen, p + 46 + nLen + eLen);
    const nome = decodificarNome(nomeBuf, flags, extra);
    const unix = versaoPor >> 8 === 3;
    const modo = unix ? (attrExt >>> 16) & 0xf000 : 0;
    entradas.push({
      indice: i,
      nome_bruto: nome,
      ehDiretorio: /[\\/]$/.test(nome) || (unix && modo === 0x4000),
      metodo,
      crc,
      tamanho_comprimido: csize,
      tamanho: usize,
      offset_local: off,
      cifrada: (flags & 1) !== 0,
      link: unix && modo === 0xa000,
    });
    p += 46 + nLen + eLen + cLen;
  }
  return entradas;
}

// ───────────── Caminhos ─────────────

export type CaminhoNormalizado = { ok: true; segmentos: string[] } | { ok: false; erro: string };

const SEGMENTO_LIXO = /^(__macosx|thumbs\.db|ehthumbs\.db|desktop\.ini|\.ds_store)$/i;

/** Segmento que faz o item inteiro ser ignorado em silêncio (lixo de sistema, oculto, temporário do Office). */
export const segmentoIgnorado = (seg: string) => seg.startsWith(".") || seg.startsWith("~$") || SEGMENTO_LIXO.test(seg);

/**
 * Normaliza o nome de uma entrada: separador `/`, sem `.`/vazios, recusa `..`, caminho absoluto, unidade (C:) e controles.
 * Cada segmento é aparado, sem pontos/espaços finais, até 120 caracteres.
 */
export function normalizarCaminho(bruto: string): CaminhoNormalizado {
  if (/[\u0000-\u001f\u007f]/.test(bruto)) return { ok: false, erro: "Nome com caracteres de controle." };
  const n = bruto.replace(/\\/g, "/");
  if (n.startsWith("/") || /^[A-Za-z]:/.test(n)) return { ok: false, erro: "Caminho absoluto não é permitido." };
  const segs: string[] = [];
  for (const crua of n.split("/")) {
    if (crua === "" || crua === ".") continue;
    if (crua.trim() === "..") return { ok: false, erro: "Caminho com \"..\" (tentativa de sair da pasta) não é permitido." };
    const s = crua.replace(/[​-‏‪-‮⁦-⁩﻿]/g, "").trim().replace(/[. ]+$/, "").slice(0, MAX_NOME_PASTA).trim();
    if (!s) return { ok: false, erro: "Nome vazio." };
    segs.push(s);
  }
  return { ok: true, segmentos: segs };
}

// ───────────── Plano ─────────────

export type ItemPlano = {
  /** Posição estável (ordenação por caminho) – chave de retomada do lote. */
  ordem: number;
  caminho: string;
  pasta: string[];
  nome: string;
  entrada: EntradaZip;
  /** Preenchido quando o arquivo já nasce rejeitado/ignorado (sem descompactar). */
  previo?: { status: "IGNORADO" | "ERRO"; motivo: string };
};

export type PlanoZip = { itens: ItemPlano[]; pastas: string[][]; ocultos: number };

const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const ehPdf = (nome: string) => /\.pdf$/i.test(nome);

/** PURA: transforma o diretório central em um plano determinístico. Lança ErroZip se violar limite global. */
export function planejarZip(entradas: EntradaZip[], limites: LimitesZip = LIMITES_PADRAO): PlanoZip {
  type Cand = { caminho: string; segs: string[]; entrada: EntradaZip; previo?: ItemPlano["previo"] };
  const cands: Cand[] = [];
  let ocultos = 0;
  let totalDeclarado = 0;
  for (const e of entradas) {
    const n = normalizarCaminho(e.nome_bruto);
    if (!n.ok) {
      if (e.ehDiretorio) continue;
      cands.push({ caminho: e.nome_bruto.replace(/[\u0000-\u001f\u007f]/g, "?").slice(0, 300), segs: [], entrada: e, previo: { status: "ERRO", motivo: n.erro } });
      continue;
    }
    if (n.segmentos.some(segmentoIgnorado)) {
      if (!e.ehDiretorio) ocultos++;
      continue;
    }
    if (e.ehDiretorio || n.segmentos.length === 0) continue;
    const caminho = n.segmentos.join("/");
    const c: Cand = { caminho, segs: n.segmentos, entrada: e };
    if (e.link) c.previo = { status: "IGNORADO", motivo: "Atalho/link simbólico ignorado." };
    else if (e.cifrada) c.previo = { status: "ERRO", motivo: "Arquivo protegido por senha dentro do ZIP." };
    else if (e.metodo !== 0 && e.metodo !== 8) c.previo = { status: "ERRO", motivo: "Método de compressão não suportado." };
    else if (!ehPdf(n.segmentos[n.segmentos.length - 1])) c.previo = { status: "IGNORADO", motivo: `Extensão não permitida (${/\.([^./]+)$/.exec(caminho)?.[0] ?? "sem extensão"}). Somente PDF.` };
    else if (n.segmentos.length - 1 > limites.maxProfundidade) c.previo = { status: "ERRO", motivo: `Pastas aninhadas demais (máximo ${limites.maxProfundidade} níveis).` };
    else if (e.tamanho > limites.maxArquivoBytes) c.previo = { status: "ERRO", motivo: `Arquivo excede o limite de ${Math.round(limites.maxArquivoBytes / 1048576)} MB.` };
    else if (e.tamanho > 1048576 && e.tamanho / Math.max(e.tamanho_comprimido, 1) > limites.maxRazaoCompressao) c.previo = { status: "ERRO", motivo: "Taxa de compressão suspeita (possível zip-bomb)." };
    else if (e.metodo === 0 && e.tamanho !== e.tamanho_comprimido) c.previo = { status: "ERRO", motivo: "Tamanho inconsistente no ZIP." };
    if (!c.previo) totalDeclarado += e.tamanho;
    cands.push(c);
  }
  if (cands.length > limites.maxArquivos) throw new ErroZip(`O ZIP tem arquivos demais (${cands.length}); o limite é ${limites.maxArquivos} por lote. Divida em lotes menores.`);
  if (totalDeclarado > limites.maxTotalDescompactado) throw new ErroZip(`O conteúdo descompactado excede ${Math.round(limites.maxTotalDescompactado / 1048576)} MB (proteção contra ZIP malicioso).`);
  cands.sort((a, b) => comparar(a.caminho, b.caminho) || a.entrada.indice - b.entrada.indice);
  const pastas = new Map<string, string[]>();
  const itens = cands.map((c, ordem): ItemPlano => {
    const pasta = c.segs.slice(0, -1);
    if (!c.previo || c.previo.status !== "ERRO") {
      for (let i = 1; i <= pasta.length; i++) {
        const k = pasta.slice(0, i).join("/").toLowerCase();
        if (!pastas.has(k)) pastas.set(k, pasta.slice(0, i));
      }
    }
    return { ordem, caminho: c.caminho, pasta, nome: c.segs[c.segs.length - 1] ?? c.caminho, entrada: c.entrada, previo: c.previo };
  });
  if (pastas.size > limites.maxPastas) throw new ErroZip(`O ZIP faria criar pastas demais (${pastas.size}); o limite é ${limites.maxPastas} por lote.`);
  return { itens, pastas: [...pastas.values()], ocultos };
}

// ───────────── Extração ─────────────

/** Descompacta UMA entrada, conferindo limites reais, tamanho declarado e CRC. Lança ErroZip (mensagem por arquivo). */
export function extrairEntrada(zip: Buffer, e: EntradaZip, limites: LimitesZip = LIMITES_PADRAO): Buffer {
  const o = e.offset_local;
  if (o + 30 > zip.length || zip.readUInt32LE(o) !== SIG_LOCAL) throw new ErroZip("Cabeçalho do arquivo corrompido no ZIP.");
  const ini = o + 30 + zip.readUInt16LE(o + 26) + zip.readUInt16LE(o + 28);
  const fim = ini + e.tamanho_comprimido;
  if (fim > zip.length) throw new ErroZip("Dados do arquivo truncados no ZIP.");
  const comp = zip.subarray(ini, fim);
  const teto = Math.min(e.tamanho, limites.maxArquivoBytes);
  let dados: Buffer;
  if (e.metodo === 0) dados = Buffer.from(comp);
  else if (e.metodo === 8) {
    try {
      dados = inflateRawSync(comp, { maxOutputLength: Math.max(teto, 1) });
    } catch (err) {
      const cod = (err as { code?: string }).code;
      throw new ErroZip(cod === "ERR_BUFFER_TOO_LARGE" ? "O tamanho real do arquivo excede o declarado (possível zip-bomb)." : "Dados comprimidos inválidos.");
    }
  } else throw new ErroZip("Método de compressão não suportado.");
  if (dados.length !== e.tamanho) throw new ErroZip("Tamanho do arquivo diverge do declarado no ZIP.");
  if (crc32Node && crc32Node(dados) !== e.crc) throw new ErroZip("Arquivo corrompido (CRC não confere).");
  return dados;
}
