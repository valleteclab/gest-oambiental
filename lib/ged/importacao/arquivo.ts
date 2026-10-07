// Armazenamento temporário do ZIP do lote: ged/{organizacao_id}/importacao/{importacao_id}.zip. Removido ao fim do processamento.
// Nunca exposto por URL; só o job lê (lerZipImportacao recusa chave fora do prefixo do cliente).
import "server-only";
import { lerArquivo, removerArquivo, salvarArquivo } from "@/lib/storage";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const RE_UUID = new RegExp(`^${UUID}$`, "i");

export function chaveZipImportacao(organizacaoId: string, importacaoId: string): string {
  if (!RE_UUID.test(organizacaoId) || !RE_UUID.test(importacaoId)) throw new Error("GED: id inválido na chave da importação.");
  return `ged/${organizacaoId.toLowerCase()}/importacao/${importacaoId.toLowerCase()}.zip`;
}

function validarChaveZip(organizacaoId: string, key: string): string {
  if (key !== chaveZipImportacao(organizacaoId, key.split("/").pop()?.replace(/\.zip$/, "") ?? "")) throw new Error("storage_key inválida");
  return key;
}

export const salvarZipImportacao = (organizacaoId: string, importacaoId: string, dados: Buffer) =>
  salvarArquivo(chaveZipImportacao(organizacaoId, importacaoId), dados, "application/zip");

export const lerZipImportacao = (organizacaoId: string, key: string) => lerArquivo(validarChaveZip(organizacaoId, key));

export const removerZipImportacao = (organizacaoId: string, key: string) => removerArquivo(validarChaveZip(organizacaoId, key));
