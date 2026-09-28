import "server-only";
import { randomUUID } from "node:crypto";
import type { Anexo } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { auditar } from "../audit";
import { sha256 } from "../crypto";
import { invalido, naoEncontrado, proibido } from "../http";
import { can, isInterno, isSomenteLeitura, podeProtocolarNoBalcao, podeVerMunicipio, type UsuarioSessao } from "../rbac";
import { lerArquivo, nomeSeguro, removerArquivo, salvarArquivo, urlUploadPreAssinada, validarUpload } from "../storage";
import { ehTitular, STATUS_FINAIS } from "./maquina";
import { obterProcessoAutorizado, podeVerProcesso, UUID_RE, type ProcessoCompleto } from "./consultas";

// Anexos do processo (SPEC 5.3 / 9.3): whitelist + 25 MB, SHA-256, chave {municipio}/processos/{id}/{uuid}-{nome}.

export const TIPOS_ANEXO = ["DOCUMENTO_EXIGIDO", "RESPOSTA_PENDENCIA", "OUTRO"] as const;

export const MetaAnexoSchema = z.object({
  tipo: z.enum(TIPOS_ANEXO).default("OUTRO"),
  documento_exigido_id: z.string().regex(UUID_RE).optional().nullable().or(z.literal("").transform(() => null)),
  pendencia_id: z.string().regex(UUID_RE).optional().nullable().or(z.literal("").transform(() => null)),
});
export type MetaAnexo = z.infer<typeof MetaAnexoSchema>;

const MIME_POR_EXT: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  dwg: "application/acad",
  kml: "application/vnd.google-earth.kml+xml",
  kmz: "application/vnd.google-earth.kmz",
  zip: "application/zip",
};
export const mimeDoNome = (nome: string) => MIME_POR_EXT[nome.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

export function chaveAnexo(siglaMunicipio: string, processoId: string, nome: string) {
  return `${siglaMunicipio}/processos/${processoId}/${randomUUID()}-${nomeSeguro(nome)}`;
}

/** Pode anexar? Requerente titular: rascunho ou pendência aberta. Interno: editar processo no município, fora de estado final;
 * no RASCUNHO também quem protocola no balcão (podeProtocolarNoBalcao – ex.: gestor). */
export function podeAnexar(u: UsuarioSessao, p: Pick<ProcessoCompleto, "status" | "municipio_id" | "requerente_id"> & { rt?: { pessoa_id: string } | null }): boolean {
  if (isSomenteLeitura(u)) return false;
  if (STATUS_FINAIS.includes(p.status)) return false;
  if (ehTitular(u, { requerente_id: p.requerente_id, rt_pessoa_id: p.rt?.pessoa_id }) && (p.status === "RASCUNHO" || p.status === "AGUARDANDO_REQUERENTE")) return true;
  if (!isInterno(u)) return false;
  return can(u, "editar", "processo", p.municipio_id) || (p.status === "RASCUNHO" && podeProtocolarNoBalcao(u, p.municipio_id));
}

async function validarMeta(p: ProcessoCompleto, meta: MetaAnexo, nome: string) {
  if (meta.documento_exigido_id) {
    const d = await prisma.documentoExigido.findUnique({ where: { id: meta.documento_exigido_id } });
    if (!d || d.tipo_ato_id !== p.tipo_ato_id) throw invalido("Documento exigido não pertence a este tipo de ato.");
    const ext = nome.split(".").pop()?.toLowerCase() ?? "";
    const formatos = d.formatos.split(",").map((f) => f.trim().toLowerCase()).filter(Boolean);
    const aceitos = formatos.includes("jpg") ? [...formatos, "jpeg"] : formatos;
    if (aceitos.length && !aceitos.includes(ext)) throw invalido(`Formato não aceito para "${d.nome}". Aceitos: ${formatos.join(", ")}.`);
  }
  if (meta.pendencia_id) {
    const pend = await prisma.pendencia.findUnique({ where: { id: meta.pendencia_id } });
    if (!pend || pend.processo_id !== p.id) throw invalido("Pendência não pertence a este processo.");
    if (pend.status !== "ABERTA" && pend.status !== "VENCIDA") throw invalido("Esta pendência não está aberta.");
  }
}

async function registrar(p: ProcessoCompleto, meta: MetaAnexo, arq: { nome: string; mime: string; tamanho: number; sha256: string; storage_key: string }, u: UsuarioSessao): Promise<Anexo> {
  const tipo = meta.pendencia_id ? "RESPOSTA_PENDENCIA" : meta.documento_exigido_id ? "DOCUMENTO_EXIGIDO" : meta.tipo;
  return prisma.$transaction(async (tx) => {
    const a = await tx.anexo.create({
      data: {
        processo_id: p.id,
        documento_exigido_id: meta.documento_exigido_id ?? null,
        pendencia_id: meta.pendencia_id ?? null,
        tipo,
        nome_arquivo: arq.nome.slice(0, 200),
        storage_key: arq.storage_key,
        mime: arq.mime,
        tamanho: arq.tamanho,
        sha256: arq.sha256,
        enviado_por: u.id,
      },
    });
    await auditar({ usuario_id: u.id, acao: "CRIAR", entidade: "anexo", entidade_id: a.id, depois: { ...a, processo_numero: p.numero } }, tx);
    return a;
  });
}

/** Upload direto (multipart / Server Action). */
export async function anexarArquivo(processoId: string, arquivo: { nome: string; mime?: string | null; dados: Buffer }, metaBruta: unknown, u: UsuarioSessao): Promise<Anexo> {
  const p = await obterProcessoAutorizado(processoId, u);
  if (!podeAnexar(u, p)) throw proibido("Você não pode anexar arquivos a este processo no estado atual.");
  const meta = MetaAnexoSchema.parse(metaBruta ?? {});
  const erro = validarUpload(arquivo.nome, arquivo.dados.length);
  if (erro) throw invalido(erro);
  if (!arquivo.dados.length) throw invalido("Arquivo vazio.");
  await validarMeta(p, meta, arquivo.nome);
  const mime = arquivo.mime && arquivo.mime !== "application/octet-stream" ? arquivo.mime : mimeDoNome(arquivo.nome);
  const storage_key = chaveAnexo(p.municipio.sigla, p.id, arquivo.nome);
  await salvarArquivo(storage_key, arquivo.dados, mime);
  try {
    return await registrar(p, meta, { nome: arquivo.nome, mime, tamanho: arquivo.dados.length, sha256: sha256(arquivo.dados), storage_key }, u);
  } catch (e) {
    await removerArquivo(storage_key);
    throw e;
  }
}

/** S3: gera URL pré-assinada (PUT). Retorna null em modo local (usar multipart). */
export async function prepararUpload(processoId: string, info: { nome: string; mime?: string | null; tamanho: number }, metaBruta: unknown, u: UsuarioSessao) {
  const p = await obterProcessoAutorizado(processoId, u);
  if (!podeAnexar(u, p)) throw proibido("Você não pode anexar arquivos a este processo no estado atual.");
  const meta = MetaAnexoSchema.parse(metaBruta ?? {});
  const erro = validarUpload(info.nome, info.tamanho);
  if (erro) throw invalido(erro);
  await validarMeta(p, meta, info.nome);
  const mime = info.mime || mimeDoNome(info.nome);
  const storage_key = chaveAnexo(p.municipio.sigla, p.id, info.nome);
  const url = await urlUploadPreAssinada(storage_key, mime);
  return url ? { modo: "s3" as const, url, storage_key, mime } : { modo: "multipart" as const };
}

/** S3: após o PUT, confirma lendo o objeto (tamanho + SHA-256 calculados no servidor). */
export async function confirmarUpload(processoId: string, info: { storage_key: string; nome: string; mime?: string | null }, metaBruta: unknown, u: UsuarioSessao): Promise<Anexo> {
  const p = await obterProcessoAutorizado(processoId, u);
  if (!podeAnexar(u, p)) throw proibido("Você não pode anexar arquivos a este processo no estado atual.");
  const meta = MetaAnexoSchema.parse(metaBruta ?? {});
  if (!info.storage_key.startsWith(`${p.municipio.sigla}/processos/${p.id}/`) || info.storage_key.includes("..")) throw invalido("storage_key inválida.");
  if (await prisma.anexo.findFirst({ where: { storage_key: info.storage_key } })) throw invalido("Arquivo já registrado.");
  await validarMeta(p, meta, info.nome);
  const dados = await lerArquivo(info.storage_key).catch(() => null);
  if (!dados) throw invalido("Arquivo não encontrado no storage. Refaça o envio.");
  const erro = validarUpload(info.nome, dados.length);
  if (erro) {
    await removerArquivo(info.storage_key);
    throw invalido(erro);
  }
  return registrar(p, meta, { nome: info.nome, mime: info.mime || mimeDoNome(info.nome), tamanho: dados.length, sha256: sha256(dados), storage_key: info.storage_key }, u);
}

/** Remove anexo de RASCUNHO (substituição de arquivo antes do protocolo). Após o protocolo os anexos são permanentes. */
export async function removerAnexoRascunho(anexoId: string, u: UsuarioSessao) {
  if (!UUID_RE.test(anexoId)) throw naoEncontrado("Anexo não encontrado.");
  const a = await prisma.anexo.findUnique({ where: { id: anexoId } });
  if (!a?.processo_id) throw naoEncontrado("Anexo não encontrado.");
  const p = await obterProcessoAutorizado(a.processo_id, u);
  if (p.status !== "RASCUNHO") throw proibido("Após o protocolo os anexos não podem ser removidos.");
  if (!podeAnexar(u, p)) throw proibido();
  await prisma.$transaction(async (tx) => {
    await tx.anexo.delete({ where: { id: a.id } });
    await auditar({ usuario_id: u.id, acao: "EXCLUIR", entidade: "anexo", entidade_id: a.id, antes: a }, tx);
  });
  await removerArquivo(a.storage_key);
}

/** Anexo para download, com verificação de escopo (processo ou fiscalização). */
export async function obterAnexoAutorizado(anexoId: string, u: UsuarioSessao) {
  if (!UUID_RE.test(anexoId)) throw naoEncontrado("Anexo não encontrado.");
  const a = await prisma.anexo.findUnique({
    where: { id: anexoId },
    include: { processo: { select: { municipio_id: true, requerente_id: true, rt: { select: { pessoa_id: true } } } }, fiscalizacao: { select: { municipio_id: true } } },
  });
  if (!a) throw naoEncontrado("Anexo não encontrado.");
  let ok = false;
  if (a.processo) ok = podeVerProcesso(u, a.processo);
  else if (a.fiscalizacao) ok = isInterno(u) && podeVerMunicipio(u, a.fiscalizacao.municipio_id) && can(u, "ver", "fiscalizacao", a.fiscalizacao.municipio_id);
  if (!ok) throw proibido("Você não tem acesso a este arquivo.");
  return a;
}
