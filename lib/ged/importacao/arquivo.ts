// Armazenamento temporário dos lotes de importação (nunca exposto por URL; só o job/serviço lê):
//   ged/{org}/importacao/{id}.zip                 ZIP enviado de uma vez (envio simples, ≤ 64 MB)
//   ged/{org}/importacao/{id}/partes/parte-NNNNNN  ZIP grande enviado em partes (~8 MB cada)
//   ged/{org}/importacao/{id}/arq/{item}           arquivo de uma PASTA enviada pelo navegador, até ser processado
// Tudo é removido ao fim do lote (inclusive em falha/cancelamento). O ZIP é remontado em DISCO TEMPORÁRIO local
// (GED_IMPORTACAO_TMP, padrão <tmp>/ged-importacao/{org}/{id}.zip) para ser lido por posição – nunca inteiro na memória.
import "server-only";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listarArquivos, lerArquivo, removerArquivo, salvarArquivo } from "@/lib/storage";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const RE_UUID = new RegExp(`^${UUID}$`, "i");

function ids(organizacaoId: string, importacaoId: string): [string, string] {
  if (!RE_UUID.test(organizacaoId) || !RE_UUID.test(importacaoId)) throw new Error("GED: id inválido na chave da importação.");
  return [organizacaoId.toLowerCase(), importacaoId.toLowerCase()];
}

export function chaveZipImportacao(organizacaoId: string, importacaoId: string): string {
  const [o, i] = ids(organizacaoId, importacaoId);
  return `ged/${o}/importacao/${i}.zip`;
}
export function prefixoPartes(organizacaoId: string, importacaoId: string): string {
  const [o, i] = ids(organizacaoId, importacaoId);
  return `ged/${o}/importacao/${i}/partes`;
}
export function chaveParte(organizacaoId: string, importacaoId: string, n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 999_999) throw new Error("GED: número de parte inválido.");
  return `${prefixoPartes(organizacaoId, importacaoId)}/parte-${String(n).padStart(6, "0")}`;
}
export function chaveArquivoPasta(organizacaoId: string, importacaoId: string, itemId: string): string {
  const [o, i] = ids(organizacaoId, importacaoId);
  if (!RE_UUID.test(itemId)) throw new Error("GED: id de item inválido.");
  return `ged/${o}/importacao/${i}/arq/${itemId.toLowerCase()}`;
}

/** Recusa qualquer chave fora do prefixo de importação do cliente (defesa em profundidade). */
function validarChave(organizacaoId: string, key: string): string {
  const base = `ged/${organizacaoId.toLowerCase()}/importacao/`;
  if (!RE_UUID.test(organizacaoId) || !key.startsWith(base) || key.includes("..") || key.includes("//") || /[^A-Za-z0-9/._-]/.test(key)) throw new Error("storage_key inválida");
  return key;
}

export const salvarZipImportacao = (organizacaoId: string, importacaoId: string, dados: Buffer) => salvarArquivo(chaveZipImportacao(organizacaoId, importacaoId), dados, "application/zip");
export const lerZipImportacao = (organizacaoId: string, key: string) => lerArquivo(validarChave(organizacaoId, key));
export const removerZipImportacao = (organizacaoId: string, key: string) => removerArquivo(validarChave(organizacaoId, key));

export const salvarParteZip = (organizacaoId: string, importacaoId: string, n: number, dados: Buffer) => salvarArquivo(chaveParte(organizacaoId, importacaoId, n), dados, "application/octet-stream");
export const salvarArquivoPasta = (organizacaoId: string, key: string, dados: Buffer, mime: string) => salvarArquivo(validarChave(organizacaoId, key), dados, mime);
export const lerArquivoPasta = lerZipImportacao;
export const descartarArquivoOrfao = (organizacaoId: string, key: string) => removerArquivo(validarChave(organizacaoId, key)).catch(() => {});
export const removerArquivoPasta = removerZipImportacao;

/** Números (1-based) das partes já recebidas, em ordem. */
export async function listarPartesRecebidas(organizacaoId: string, importacaoId: string): Promise<number[]> {
  const prefixo = prefixoPartes(organizacaoId, importacaoId);
  const chaves = await listarArquivos(prefixo).catch(() => [] as string[]);
  const out: number[] = [];
  for (const k of chaves) {
    const m = /\/parte-(\d{6})$/.exec(k);
    if (m) out.push(Number(m[1]));
  }
  return out.sort((a, b) => a - b);
}

export async function removerPartesZip(organizacaoId: string, importacaoId: string, partesTotal: number): Promise<void> {
  const recebidas = await listarPartesRecebidas(organizacaoId, importacaoId).catch(() => [] as number[]);
  const todas = new Set<number>(recebidas);
  for (let n = 1; n <= partesTotal; n++) todas.add(n);
  for (const n of todas) await removerArquivo(chaveParte(organizacaoId, importacaoId, n)).catch(() => {});
}

// ───────────── Disco temporário ─────────────

export const diretorioTemporario = () => path.resolve(process.env.GED_IMPORTACAO_TMP || path.join(os.tmpdir(), "ged-importacao"));

/** Caminho local do ZIP remontado do lote (e pasta de trabalho dos ZIPs aninhados). */
export function caminhoZipLocal(organizacaoId: string, importacaoId: string): string {
  const [o, i] = ids(organizacaoId, importacaoId);
  return path.join(diretorioTemporario(), o, `${i}.zip`);
}
export function pastaTrabalhoLocal(organizacaoId: string, importacaoId: string): string {
  const [o, i] = ids(organizacaoId, importacaoId);
  return path.join(diretorioTemporario(), o, i);
}

export async function limparTemporarios(organizacaoId: string, importacaoId: string): Promise<void> {
  await rm(caminhoZipLocal(organizacaoId, importacaoId), { force: true }).catch(() => {});
  await rm(pastaTrabalhoLocal(organizacaoId, importacaoId), { recursive: true, force: true }).catch(() => {});
}

/**
 * Remonta o ZIP do lote em disco local, parte por parte (memória: uma parte de cada vez) e confere o tamanho esperado. Devolve o
 * caminho e o sha256 do ZIP inteiro. Se o arquivo local já existe com o tamanho certo (retomada depois de queda), é reaproveitado.
 */
export async function montarZipLocal(
  organizacaoId: string,
  imp: { id: string; storage_key: string | null; partes_total: number; tamanho_zip: number },
  batimento?: () => void,
): Promise<{ caminho: string; sha256: string | null }> {
  const destino = caminhoZipLocal(organizacaoId, imp.id);
  await mkdir(path.dirname(destino), { recursive: true });
  const existente = await stat(destino).catch(() => null);
  if (existente && existente.size === imp.tamanho_zip && imp.tamanho_zip > 0) return { caminho: destino, sha256: null };
  if (imp.partes_total === 0) {
    if (!imp.storage_key) throw new Error("O arquivo ZIP do lote não está mais disponível.");
    await writeFile(destino, await lerZipImportacao(organizacaoId, imp.storage_key));
    return { caminho: destino, sha256: null };
  }
  const hash = createHash("sha256");
  const tmp = `${destino}.parcial`;
  const saida = createWriteStream(tmp);
  let total = 0;
  try {
    for (let n = 1; n <= imp.partes_total; n++) {
      const parte = await lerArquivo(chaveParte(organizacaoId, imp.id, n)).catch(() => null);
      if (!parte) throw new Error(`Parte ${n} de ${imp.partes_total} do ZIP não está disponível.`);
      hash.update(parte);
      if (n % 10 === 0) batimento?.();
      total += parte.length;
      if (!saida.write(parte)) await new Promise<void>((r) => saida.once("drain", () => r()));
    }
    await new Promise<void>((res, rej) => {
      saida.once("error", rej);
      saida.end(() => res());
    });
  } catch (e) {
    saida.destroy();
    await rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
  if (total !== imp.tamanho_zip) {
    await rm(tmp, { force: true }).catch(() => {});
    throw new Error("O tamanho do ZIP remontado não confere com o enviado.");
  }
  await rename(tmp, destino);
  return { caminho: destino, sha256: hash.digest("hex") };
}
