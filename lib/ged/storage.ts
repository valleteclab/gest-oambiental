// Arquivos do GED, isolados por cliente: ged/{organizacao_id}/{ano}/{documento_id}/v{n}-{sha8}.{ext}
// (docs/ged-design.md §1). O cliente NUNCA envia storage_key; o servidor a deriva com chaveGed() e toda leitura
// passa por lerArquivoGed(orgId, key), que recusa qualquer chave fora do prefixo do cliente.
import "server-only";
import { LIMITE_UPLOAD, lerArquivo, nomeSeguro, removerArquivo, salvarArquivo, salvarUpload } from "@/lib/storage";
import type { ContextoUpload } from "@/lib/antivirus";
import { invalido } from "@/lib/http";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const RE_UUID = new RegExp(`^${UUID}$`, "i");
/** Formato único e fechado de chave do GED (nada de caminhos livres). */
const RE_CHAVE = new RegExp(`^ged/(${UUID})/(\\d{4})/(${UUID})/v(\\d{1,6})-([0-9a-f]{8})\\.([a-z0-9]{1,6})$`, "i");

export type PartesChaveGed = { documentoId: string; n: number; sha8: string; ext: string; ano?: number };

/** Monta a chave de storage de uma versão. Valida cada parte (nunca concatene entrada do usuário aqui). */
export function chaveGed(organizacaoId: string, p: PartesChaveGed): string {
  const ano = p.ano ?? new Date().getFullYear();
  const ext = p.ext.replace(/^\./, "").toLowerCase();
  if (!RE_UUID.test(organizacaoId)) throw new Error("GED: organizacaoId inválido.");
  if (!RE_UUID.test(p.documentoId)) throw new Error("GED: documentoId inválido.");
  if (!Number.isInteger(p.n) || p.n < 1 || p.n > 999999) throw new Error("GED: número de versão inválido.");
  if (!/^[0-9a-f]{8}$/i.test(p.sha8)) throw new Error("GED: sha8 inválido.");
  if (!/^[a-z0-9]{1,6}$/.test(ext)) throw new Error("GED: extensão inválida.");
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2999) throw new Error("GED: ano inválido.");
  return `ged/${organizacaoId.toLowerCase()}/${ano}/${p.documentoId.toLowerCase()}/v${p.n}-${p.sha8.toLowerCase()}.${ext}`;
}

/**
 * Valida que `key` pertence ao cliente: formato exato de chaveGed(), prefixo `ged/{orgId}/`, sem `..`, barra invertida,
 * URL, caminho absoluto ou caracteres de controle. Lança Error (não vaza qual regra falhou para o cliente).
 */
export function validarChaveGed(organizacaoId: string, key: unknown): string {
  if (typeof key !== "string" || !RE_UUID.test(organizacaoId)) throw new Error("storage_key inválida");
  if (key.length > 300 || key.includes("..") || key.includes("\\") || key.includes("//") || key.includes(":") || key.startsWith("/") || /[\u0000-\u001f]/.test(key)) {
    throw new Error("storage_key inválida");
  }
  const m = RE_CHAVE.exec(key);
  if (!m || m[1].toLowerCase() !== organizacaoId.toLowerCase() || !key.startsWith(`ged/${organizacaoId.toLowerCase()}/`)) throw new Error("storage_key inválida");
  return key;
}

/** Documento ao qual a chave pertence (útil para conferir contra o registro da versão). */
export function documentoDaChaveGed(key: string): string | null {
  const m = RE_CHAVE.exec(key);
  return m ? m[3].toLowerCase() : null;
}

/**
 * Grava o arquivo de uma versão. `upload` informado = arquivo enviado por usuário (passa pelo antivírus/ClamAV via
 * salvarUpload); `null` = arquivo gerado pelo sistema (PDF do editor, selo, OCR) → salvarArquivo.
 */
export async function salvarArquivoGed(
  organizacaoId: string,
  key: string,
  dados: Buffer,
  mime: string,
  upload: ContextoUpload | null,
): Promise<void> {
  validarChaveGed(organizacaoId, key);
  if (upload) await salvarUpload(key, dados, mime, upload);
  else await salvarArquivo(key, dados, mime);
}

/** Lê o arquivo de uma versão do cliente. Recusa chave de outro cliente, `..`, URL ou caminho absoluto. */
export async function lerArquivoGed(organizacaoId: string, key: string): Promise<Buffer> {
  validarChaveGed(organizacaoId, key);
  return lerArquivo(key);
}

/** Remoção só para desfazer upload cuja transação falhou (versões gravadas nunca são excluídas). */
export async function removerArquivoGed(organizacaoId: string, key: string): Promise<void> {
  validarChaveGed(organizacaoId, key);
  await removerArquivo(key);
}

// ───────────── Validação de upload ─────────────

export type ResultadoValidacaoUpload = { ok: true; nome: string; ext: "pdf"; mime: "application/pdf"; tamanho: number } | { ok: false; erro: string };

const MIMES_PDF = new Set(["application/pdf", "application/x-pdf", "application/acrobat", "application/octet-stream", ""]);

/** Fase 1: somente PDF (extensão .pdf, assinatura `%PDF-` no início, até LIMITE_UPLOAD). */
export function validarUploadGed(dados: Buffer, nome: string, mime: string): ResultadoValidacaoUpload {
  if (!dados || dados.length === 0) return { ok: false, erro: "Arquivo vazio." };
  if (dados.length > LIMITE_UPLOAD) return { ok: false, erro: "Arquivo excede o limite de 25 MB." };
  const base = (nome ?? "").split(/[\\/]/).pop() ?? "";
  if (!/\.pdf$/i.test(base)) return { ok: false, erro: "Envie um arquivo PDF (.pdf)." };
  if (!MIMES_PDF.has((mime ?? "").toLowerCase().split(";")[0].trim())) return { ok: false, erro: "Tipo de arquivo não permitido. Envie um PDF." };
  if (dados.subarray(0, 5).toString("latin1") !== "%PDF-") return { ok: false, erro: "O arquivo não é um PDF válido." };
  const sem_ext = base.replace(/\.pdf$/i, "");
  const seguro = nomeSeguro(sem_ext).replace(/^[._-]+/, "") || "documento";
  return { ok: true, nome: `${seguro}.pdf`, ext: "pdf", mime: "application/pdf", tamanho: dados.length };
}

/** Variante que lança 422 (para rotas/ações). */
export function exigirUploadGedValido(dados: Buffer, nome: string, mime: string) {
  const r = validarUploadGed(dados, nome, mime);
  if (!r.ok) throw invalido(r.erro);
  return r;
}
