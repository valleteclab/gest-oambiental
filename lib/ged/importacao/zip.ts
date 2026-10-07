// Leitor de ZIP próprio (sem banco) para a importação em lote do GED.
//
// Lê o diretório central e só descompacta uma entrada por vez, com teto de saída (zip-bomb). Implementação própria
// (zlib do Node) para controlar os limites antes de gastar memória. Suporta métodos 0 (stored) e 8 (deflate) e ZIP64;
// ZIP criptografado e outros métodos são recusados com mensagem clara.
//
// Duas fontes: Buffer (ZIPs pequenos e testes: lerDiretorioZip/extrairEntrada, síncronas) e ARQUIVO EM DISCO (ZipDisco: lê só o
// diretório central e os bytes de cada entrada por posição – o ZIP de 2 GB nunca vai inteiro para a memória). Os dois caminhos
// compartilham o mesmo analisador do diretório central e a mesma conferência de tamanho/CRC.
//
// Proteções:
//   - zip-slip: caminhos absolutos, unidade (C:), `..` e caracteres de controle são recusados por entrada;
//   - zip-bomb: nº de entradas/arquivos/pastas, profundidade, soma e tamanho por arquivo DECLARADOS no diretório central,
//     razão de compressão e teto real de saída na inflação (`maxOutputLength`: o tamanho declarado pode mentir);
//   - lixo do sistema ignorado em silêncio: __MACOSX, .DS_Store, Thumbs.db, desktop.ini, ~$*, qualquer item oculto (.nome);
//   - nomes: UTF-8 (flag 11), extra 0x7075 (Info-ZIP), UTF-8 sem flag ou CP850 (Windows pt-BR antigo); normalizados em NFC.
import { createReadStream, createWriteStream } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInflateRaw, crc32 as crc32Node, inflateRawSync } from "node:zlib";
import { chaveDiretorio, ehPdf, ehZip, MOTIVO_ZIP_DUPLICADO, nomeBaseZip, normalizarCaminho, segmentoIgnorado } from "./caminhos";
import { LIMITES_PADRAO, type LimitesZip } from "./limites";

export { normalizarCaminho, segmentoIgnorado, type CaminhoNormalizado } from "./caminhos";

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
const SIG_EOCD64 = 0x06064b50;
const MSG_ZIP64 = "ZIP no formato ZIP64 incompleto ou corrompido (registro ZIP64 não encontrado).";

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

// ───────────── Diretório central (Buffer ou disco) ─────────────

type Eocd = { total: number; tamCentral: number; offCentral: number; posEocd: number; zip64Off: number | null };

const numeroSeguro = (v: bigint): number => {
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new ErroZip("ZIP corrompido (valores fora do intervalo).");
  return Number(v);
};

/** Acha o EOCD na cauda do arquivo (últimos ~64 KB). `inicio` = posição absoluta do primeiro byte de `cauda`. */
function analisarCauda(cauda: Buffer, inicio: number, tamanhoArquivo: number, limites: LimitesZip): Eocd {
  if (tamanhoArquivo > limites.maxZipBytes) throw new ErroZip(`O ZIP excede o limite de ${Math.round(limites.maxZipBytes / 1048576)} MB.`);
  if (tamanhoArquivo < 22) throw new ErroZip("O arquivo não é um ZIP válido.");
  let e = -1;
  for (let i = cauda.length - 22; i >= Math.max(0, cauda.length - 22 - 65535); i--) {
    if (cauda.readUInt32LE(i) === SIG_EOCD) {
      e = i;
      break;
    }
  }
  if (e < 0) throw new ErroZip("O arquivo não é um ZIP válido (diretório central não encontrado).");
  let total = cauda.readUInt16LE(e + 10);
  let tamCentral = cauda.readUInt32LE(e + 12);
  let offCentral = cauda.readUInt32LE(e + 16);
  const posEocd = inicio + e;
  const saturado = total === 0xffff || tamCentral === 0xffffffff || offCentral === 0xffffffff;
  let zip64Off: number | null = null;
  if (saturado) {
    if (e < 20 || cauda.readUInt32LE(e - 20) !== SIG_ZIP64_LOC) throw new ErroZip(MSG_ZIP64);
    zip64Off = numeroSeguro(cauda.readBigUInt64LE(e - 20 + 8));
    total = -1;
    tamCentral = -1;
    offCentral = -1;
  }
  return { total, tamCentral, offCentral, posEocd, zip64Off };
}

/** Completa o EOCD com o registro ZIP64 (56 bytes lidos em `zip64Off`). */
function aplicarZip64(eo: Eocd, rec: Buffer): Eocd {
  if (rec.length < 56 || rec.readUInt32LE(0) !== SIG_EOCD64) throw new ErroZip(MSG_ZIP64);
  return { ...eo, total: numeroSeguro(rec.readBigUInt64LE(32)), tamCentral: numeroSeguro(rec.readBigUInt64LE(40)), offCentral: numeroSeguro(rec.readBigUInt64LE(48)) };
}

function validarEocd(eo: Eocd, limites: LimitesZip) {
  if (eo.total > limites.maxEntradas) throw new ErroZip(`O ZIP tem itens demais (${eo.total}); o limite é ${limites.maxEntradas}.`);
  if (eo.offCentral + eo.tamCentral > eo.posEocd) throw new ErroZip("ZIP corrompido (diretório central fora dos limites).");
  // ~46 bytes + nomes: 64 MB cobre com folga os 40 000 itens (evita ler "diretório" gigante de um ZIP malicioso)
  if (eo.tamCentral > 64 * 1048576) throw new ErroZip("ZIP corrompido (diretório central grande demais).");
}

/** Extra 0x0001 (ZIP64): valores de 8 bytes, na ordem tamanho, comprimido, deslocamento, só para os campos saturados. */
function extraZip64(extra: Buffer, precisa: { usize: boolean; csize: boolean; off: boolean }): { usize?: number; csize?: number; off?: number } {
  let i = 0;
  while (i + 4 <= extra.length) {
    const id = extra.readUInt16LE(i);
    const len = extra.readUInt16LE(i + 2);
    if (i + 4 + len > extra.length) break;
    if (id === 0x0001) {
      let p = i + 4;
      const fim = i + 4 + len;
      const r: { usize?: number; csize?: number; off?: number } = {};
      const proximo = () => {
        if (p + 8 > fim) throw new ErroZip(MSG_ZIP64);
        const v = numeroSeguro(extra.readBigUInt64LE(p));
        p += 8;
        return v;
      };
      if (precisa.usize) r.usize = proximo();
      if (precisa.csize) r.csize = proximo();
      if (precisa.off) r.off = proximo();
      return r;
    }
    i += 4 + len;
  }
  throw new ErroZip(MSG_ZIP64);
}

/** Analisa o diretório central (já em memória, só ele). */
function analisarCentral(cd: Buffer, total: number): EntradaZip[] {
  const entradas: EntradaZip[] = [];
  let p = 0;
  for (let i = 0; i < total; i++) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== SIG_CENTRAL) throw new ErroZip("ZIP corrompido (diretório central inválido).");
    const versaoPor = cd.readUInt16LE(p + 4);
    const flags = cd.readUInt16LE(p + 8);
    const metodo = cd.readUInt16LE(p + 10);
    const crc = cd.readUInt32LE(p + 16);
    let csize = cd.readUInt32LE(p + 20);
    let usize = cd.readUInt32LE(p + 24);
    const nLen = cd.readUInt16LE(p + 28);
    const eLen = cd.readUInt16LE(p + 30);
    const cLen = cd.readUInt16LE(p + 32);
    const attrExt = cd.readUInt32LE(p + 38);
    let off = cd.readUInt32LE(p + 42);
    if (p + 46 + nLen + eLen + cLen > cd.length) throw new ErroZip("ZIP corrompido (entrada truncada).");
    const nomeBuf = cd.subarray(p + 46, p + 46 + nLen);
    const extra = cd.subarray(p + 46 + nLen, p + 46 + nLen + eLen);
    const sat = { usize: usize === 0xffffffff, csize: csize === 0xffffffff, off: off === 0xffffffff };
    if (sat.usize || sat.csize || sat.off) {
      const z = extraZip64(extra, sat);
      if (z.usize !== undefined) usize = z.usize;
      if (z.csize !== undefined) csize = z.csize;
      if (z.off !== undefined) off = z.off;
    }
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

/** Lê o diretório central de um ZIP em memória. Lança ErroZip para ZIP inválido ou que viole um limite global. */
export function lerDiretorioZip(zip: Buffer, limites: LimitesZip = LIMITES_PADRAO): EntradaZip[] {
  if (zip.length > limites.maxZipBytes) throw new ErroZip(`O ZIP excede o limite de ${Math.round(limites.maxZipBytes / 1048576)} MB.`);
  let eo = analisarCauda(zip, 0, zip.length, limites);
  if (eo.zip64Off !== null) eo = aplicarZip64(eo, zip.subarray(eo.zip64Off, eo.zip64Off + 56));
  validarEocd(eo, limites);
  return analisarCentral(zip.subarray(eo.offCentral, eo.offCentral + eo.tamCentral), eo.total);
}

/** ZIP em arquivo local: leituras por posição (nada de ler o arquivo inteiro). Lembre de chamar fechar(). */
export class ZipDisco {
  private constructor(
    readonly caminho: string,
    readonly tamanho: number,
    private fh: FileHandle,
  ) {}
  static async abrir(caminho: string): Promise<ZipDisco> {
    const fh = await open(caminho, "r");
    return new ZipDisco(caminho, (await fh.stat()).size, fh);
  }
  async ler(posicao: number, bytes: number): Promise<Buffer> {
    const buf = Buffer.alloc(bytes);
    let lido = 0;
    while (lido < bytes) {
      const r = await this.fh.read(buf, lido, bytes - lido, posicao + lido);
      if (r.bytesRead === 0) break;
      lido += r.bytesRead;
    }
    return lido === bytes ? buf : buf.subarray(0, lido);
  }
  async fechar() {
    await this.fh.close().catch(() => {});
  }
}

/** Lê o diretório central de um ZIP em disco (cauda + diretório central; ZIP64 incluído). */
export async function lerDiretorioZipDisco(z: ZipDisco, limites: LimitesZip = LIMITES_PADRAO): Promise<EntradaZip[]> {
  const n = Math.min(z.tamanho, 65535 + 22 + 20);
  const inicio = z.tamanho - n;
  let eo = analisarCauda(await z.ler(inicio, n), inicio, z.tamanho, limites);
  if (eo.zip64Off !== null) eo = aplicarZip64(eo, await z.ler(eo.zip64Off, 56));
  validarEocd(eo, limites);
  const cd = await z.ler(eo.offCentral, eo.tamCentral);
  if (cd.length !== eo.tamCentral) throw new ErroZip("ZIP corrompido (diretório central truncado).");
  return analisarCentral(cd, eo.total);
}

// ───────────── Plano ─────────────

export type ItemPlano = {
  /** Posição estável (ordenação por caminho) – chave de retomada do lote. */
  ordem: number;
  caminho: string;
  pasta: string[];
  nome: string;
  entrada: EntradaZip;
  /** ZIP aninhado a expandir como pasta (nome-base do ZIP). */
  aninhado?: boolean;
  /** Preenchido quando o arquivo já nasce rejeitado/ignorado (sem descompactar). */
  previo?: { status: "IGNORADO" | "ERRO"; motivo: string };
};

export type PlanoZip = { itens: ItemPlano[]; pastas: string[][]; ocultos: number };

const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * PURA: transforma o diretório central em um plano determinístico. Lança ErroZip se violar limite global.
 * `opc.nivel` = nível de aninhamento deste ZIP (0 = o ZIP enviado; 1 = ZIP dentro dele…): ZIPs encontrados quando o nível já é
 * `maxAninhamento` viram erro do item.
 */
export function planejarZip(entradas: EntradaZip[], limites: LimitesZip = LIMITES_PADRAO, opc: { nivel?: number } = {}): PlanoZip {
  const nivel = opc.nivel ?? 0;
  type Cand = { caminho: string; segs: string[]; entrada: EntradaZip; previo?: ItemPlano["previo"]; aninhado?: boolean };
  const cands: Cand[] = [];
  const pastasConhecidas = new Set<string>(); // caminhos (minúsculos) de TODAS as pastas vistas – regra do ZIP duplicado
  const marcarPastas = (segs: string[], soDiretorios: boolean) => {
    for (let i = 1; i <= (soDiretorios ? segs.length : segs.length - 1); i++) pastasConhecidas.add(chaveDiretorio(segs.slice(0, i)));
  };
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
    if (e.ehDiretorio || n.segmentos.length === 0) {
      marcarPastas(n.segmentos, true);
      continue;
    }
    marcarPastas(n.segmentos, false);
    const caminho = n.segmentos.join("/");
    const nomeArq = n.segmentos[n.segmentos.length - 1];
    const c: Cand = { caminho, segs: n.segmentos, entrada: e };
    if (e.link) c.previo = { status: "IGNORADO", motivo: "Atalho/link simbólico ignorado." };
    else if (e.cifrada) c.previo = { status: "ERRO", motivo: "Arquivo protegido por senha dentro do ZIP." };
    else if (e.metodo !== 0 && e.metodo !== 8) c.previo = { status: "ERRO", motivo: "Método de compressão não suportado." };
    else if (!ehPdf(nomeArq) && !ehZip(nomeArq)) c.previo = { status: "IGNORADO", motivo: `Extensão não permitida (${/\.([^./]+)$/.exec(caminho)?.[0] ?? "sem extensão"}). Somente PDF.` };
    else if (n.segmentos.length - 1 > limites.maxProfundidade) c.previo = { status: "ERRO", motivo: `Pastas aninhadas demais (máximo ${limites.maxProfundidade} níveis).` };
    else if (ehZip(nomeArq)) c.aninhado = true; // decidido abaixo (precisa conhecer todas as pastas)
    else if (e.tamanho > limites.maxArquivoBytes) c.previo = { status: "ERRO", motivo: `Arquivo excede o limite de ${Math.round(limites.maxArquivoBytes / 1048576)} MB.` };
    else if (e.tamanho > 1048576 && e.tamanho / Math.max(e.tamanho_comprimido, 1) > limites.maxRazaoCompressao) c.previo = { status: "ERRO", motivo: "Taxa de compressão suspeita (possível zip-bomb)." };
    else if (e.metodo === 0 && e.tamanho !== e.tamanho_comprimido) c.previo = { status: "ERRO", motivo: "Tamanho inconsistente no ZIP." };
    cands.push(c);
  }
  // ZIPs aninhados: duplicado da pasta irmã → ignora com nota; senão expande como pasta (respeitando nível e tamanho)
  for (const c of cands) {
    if (!c.aninhado) continue;
    const nomeArq = c.segs[c.segs.length - 1];
    const dir = c.segs.slice(0, -1);
    if (pastasConhecidas.has(chaveDiretorio([...dir, nomeBaseZip(nomeArq)]))) {
      c.aninhado = false;
      c.previo = { status: "IGNORADO", motivo: MOTIVO_ZIP_DUPLICADO };
    } else if (nivel >= limites.maxAninhamento) {
      c.aninhado = false;
      c.previo = { status: "ERRO", motivo: `ZIP dentro de ZIP além do limite (${limites.maxAninhamento} níveis de aninhamento).` };
    } else if (c.entrada.tamanho > limites.maxZipAninhadoBytes) {
      c.aninhado = false;
      c.previo = { status: "ERRO", motivo: `ZIP aninhado excede o limite de ${Math.round(limites.maxZipAninhadoBytes / 1048576)} MB.` };
    } else if (c.entrada.metodo === 0 && c.entrada.tamanho !== c.entrada.tamanho_comprimido) {
      c.aninhado = false;
      c.previo = { status: "ERRO", motivo: "Tamanho inconsistente no ZIP." };
    }
  }
  for (const c of cands) if (!c.previo && !c.aninhado) totalDeclarado += c.entrada.tamanho;
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
    return { ordem, caminho: c.caminho, pasta, nome: c.segs[c.segs.length - 1] ?? c.caminho, entrada: c.entrada, previo: c.previo, aninhado: c.aninhado };
  });
  if (pastas.size > limites.maxPastas) throw new ErroZip(`O ZIP faria criar pastas demais (${pastas.size}); o limite é ${limites.maxPastas} por lote.`);
  return { itens, pastas: [...pastas.values()], ocultos };
}

// ───────────── Extração ─────────────

/** Confere cabeçalho local e devolve o intervalo [ini, fim) dos dados comprimidos. */
function intervaloDados(cab: Buffer, e: EntradaZip): number {
  if (cab.length < 30 || cab.readUInt32LE(0) !== SIG_LOCAL) throw new ErroZip("Cabeçalho do arquivo corrompido no ZIP.");
  return e.offset_local + 30 + cab.readUInt16LE(26) + cab.readUInt16LE(28);
}

function descomprimir(comp: Buffer, e: EntradaZip, limites: LimitesZip): Buffer {
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

/** Descompacta UMA entrada de um ZIP em memória, conferindo limites reais, tamanho declarado e CRC. Lança ErroZip. */
export function extrairEntrada(zip: Buffer, e: EntradaZip, limites: LimitesZip = LIMITES_PADRAO): Buffer {
  const o = e.offset_local;
  const ini = intervaloDados(zip.subarray(o, o + 30), e);
  const fim = ini + e.tamanho_comprimido;
  if (fim > zip.length) throw new ErroZip("Dados do arquivo truncados no ZIP.");
  return descomprimir(zip.subarray(ini, fim), e, limites);
}

/** Igual a extrairEntrada, para ZIP em disco: lê só os bytes comprimidos da entrada (limitados ao teto do arquivo). */
export async function extrairEntradaDisco(z: ZipDisco, e: EntradaZip, limites: LimitesZip = LIMITES_PADRAO): Promise<Buffer> {
  if (e.tamanho_comprimido > limites.maxArquivoBytes + 1048576) throw new ErroZip("Arquivo comprimido grande demais para a importação.");
  const ini = intervaloDados(await z.ler(e.offset_local, 30), e);
  if (ini + e.tamanho_comprimido > z.tamanho) throw new ErroZip("Dados do arquivo truncados no ZIP.");
  const comp = await z.ler(ini, e.tamanho_comprimido);
  if (comp.length !== e.tamanho_comprimido) throw new ErroZip("Dados do arquivo truncados no ZIP.");
  return descomprimir(comp, e, limites);
}

/**
 * Extrai UMA entrada para um arquivo em disco, em fluxo (ZIP aninhado de centenas de MB sem ocupar memória): inflação com teto
 * de saída, conferência de tamanho declarado e CRC incremental. Em erro, o arquivo parcial deve ser apagado por quem chamou.
 */
export async function extrairEntradaParaArquivo(z: ZipDisco, e: EntradaZip, destino: string, maxBytes: number): Promise<void> {
  if (e.tamanho > maxBytes) throw new ErroZip(`Arquivo excede o limite de ${Math.round(maxBytes / 1048576)} MB.`);
  const ini = intervaloDados(await z.ler(e.offset_local, 30), e);
  if (ini + e.tamanho_comprimido > z.tamanho) throw new ErroZip("Dados do arquivo truncados no ZIP.");
  if (e.metodo !== 0 && e.metodo !== 8) throw new ErroZip("Método de compressão não suportado.");
  let total = 0;
  let crc = 0;
  const medir = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      total += chunk.length;
      if (total > e.tamanho) return cb(new ErroZip("O tamanho real do arquivo excede o declarado (possível zip-bomb)."));
      crc = crc32Node(chunk, crc);
      cb(null, chunk);
    },
  });
  const origem = createReadStream(z.caminho, { start: ini, end: ini + e.tamanho_comprimido - 1, highWaterMark: 1 << 20 });
  try {
    if (e.tamanho_comprimido === 0) await pipeline(origem, medir, createWriteStream(destino));
    else if (e.metodo === 0) await pipeline(origem, medir, createWriteStream(destino));
    else await pipeline(origem, createInflateRaw(), medir, createWriteStream(destino));
  } catch (err) {
    if (err instanceof ErroZip) throw err;
    throw new ErroZip("Dados comprimidos inválidos.");
  }
  if (total !== e.tamanho) throw new ErroZip("Tamanho do arquivo diverge do declarado no ZIP.");
  if (crc >>> 0 !== e.crc) throw new ErroZip("Arquivo corrompido (CRC não confere).");
}
