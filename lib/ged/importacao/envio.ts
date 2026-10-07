// Importação v2 – ENVIO: pasta arquivo a arquivo (navegador) e ZIP grande em partes. O lote nasce RECEBENDO (o job não o vê),
// recebe os arquivos/partes por requisições curtas e independentes (retentáveis; reabrir o lote e mandar só o que falta) e vira
// PENDENTE em `concluirEnvio`. Todas as operações exigem `importar` (Admin/Gestor), só o dono do lote (ou o Admin) mexe nele e tudo
// passa por gedDb(organizacao_id); arquivos em ged/{org}/importacao/{id}/… (nunca por URL).
import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { ErroApi, invalido } from "@/lib/http";
import { auditarGed } from "../auditoria";
import { exigirEncontrado } from "../db";
import type { CtxGed } from "../escopo";
import { sha256Hex } from "../documentos/versoes";
import { zUuid } from "../tipos";
import { chaveArquivoPasta, chaveParte, descartarArquivoOrfao, lerArquivoPasta, listarPartesRecebidas, salvarArquivoPasta, salvarParteZip } from "./arquivo";
import { ehPdf, ehZip, normalizarCaminho, segmentoIgnorado } from "./caminhos";
import { LIMITES_PADRAO, MAX_PARTE_ZIP, TAMANHO_PARTE_ZIP, type LimitesZip } from "./limites";
import { descartarArmazenamentoImportacao, exigirPodeImportar, exigirVagaLote, validarDestino, whereVisiveis, type DestinoImportacao } from "./servico";

const MAX_IGNORADOS_POR_CONCLUSAO = 5000;
const MAX_CAMINHO = 1000;

async function obterLoteAberto(ctx: CtxGed, id: string, origem: "ZIP" | "PASTA") {
  exigirPodeImportar(ctx);
  if (!zUuid.safeParse(id).success) exigirEncontrado(null, "Importação não encontrada.");
  const lote = exigirEncontrado(await ctx.db.gedImportacao.findFirst({ where: { AND: [{ id }, whereVisiveis(ctx)] } }), "Importação não encontrada.");
  if (lote.origem !== origem) throw invalido(origem === "PASTA" ? "Este lote não é de uma pasta." : "Este lote não é de um ZIP.");
  if (lote.status !== "RECEBENDO") throw new ErroApi(409, "LOTE_FECHADO", "Este lote não está mais recebendo arquivos.");
  return lote;
}

const tocar = (ctx: CtxGed, id: string) => ctx.db.gedImportacao.update({ where: { id }, data: { updated_at: new Date() } });

// ───────────── Pasta ─────────────

export type EntradaPasta = DestinoImportacao & { nome?: string | null; total_esperado?: number | null; unir_pastas?: boolean };

export async function iniciarImportacaoPasta(ctx: CtxGed, e: EntradaPasta, limites: LimitesZip = LIMITES_PADRAO): Promise<{ id: string; status: "RECEBENDO" }> {
  exigirPodeImportar(ctx);
  const { pastaId, tipoId, sensibilidade } = await validarDestino(ctx, e);
  const esperado = Math.max(0, Math.min(Math.trunc(Number(e.total_esperado ?? 0)) || 0, limites.maxArquivos));
  await exigirVagaLote(ctx);
  const nome = (e.nome ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200) || "Pasta";
  const id = randomUUID();
  await ctx.db.$transaction(async (tx) => {
    await tx.gedImportacao.create({
      data: {
        id,
        criado_por_id: ctx.usuario.id,
        nome_arquivo: `Pasta: ${nome}`.slice(0, 250),
        tamanho_zip: 0,
        sha256_zip: "pasta",
        pasta_destino_id: pastaId,
        tipo_id: tipoId,
        sensibilidade,
        status: "RECEBENDO",
        origem: "PASTA",
        unir_pastas: !!e.unir_pastas,
        total_esperado: esperado,
      } as Prisma.GedImportacaoUncheckedCreateInput,
    });
    await auditarGed(ctx, { acao: "GED_IMPORTACAO_CRIADA", entidade: "ged_importacao", entidade_id: id, depois: { origem: "PASTA", nome, total_esperado: esperado, pasta_destino_id: pastaId, tipo_id: tipoId, sensibilidade, unir_pastas: !!e.unir_pastas } }, tx);
  });
  return { id, status: "RECEBENDO" };
}

export type ResultadoArquivoPasta = { status: "RECEBIDO" | "IGNORADO" | "ERRO" | "OCULTO"; repetido?: boolean; motivo?: string };

const MOTIVO_MAX = (l: LimitesZip) => `Arquivo excede o limite de ${Math.round(l.maxArquivoBytes / 1048576)} MB.`;

/** Registra (sem guardar o arquivo) um item que já nasce ignorado/com erro. Idempotente por caminho. */
async function registrarSemArquivo(ctx: CtxGed, id: string, caminho: string, status: "IGNORADO" | "ERRO", motivo: string, tamanho?: number): Promise<ResultadoArquivoPasta> {
  const existente = await ctx.db.gedImportacaoItem.findFirst({ where: { importacao_id: id, caminho }, select: { id: true } });
  if (!existente) await criarItem(ctx, id, { caminho, status, motivo, tamanho: tamanho ?? null });
  return { status, motivo };
}

async function criarItem(ctx: CtxGed, id: string, d: { caminho: string; status: "RECEBIDO" | "IGNORADO" | "ERRO"; motivo?: string | null; sha256?: string | null; tamanho?: number | null; itemId?: string; storage_key?: string | null }) {
  for (let tentativa = 0; ; tentativa++) {
    const max = await ctx.db.gedImportacaoItem.aggregate({ where: { importacao_id: id }, _max: { ordem: true } });
    try {
      await ctx.db.gedImportacaoItem.create({
        data: { id: d.itemId, importacao_id: id, ordem: (max._max.ordem ?? -1) + 1 + Math.floor(Math.random() * tentativa), caminho: d.caminho, status: d.status, motivo: d.motivo ?? null, sha256: d.sha256 ?? null, tamanho: d.tamanho ?? null, storage_key: d.storage_key ?? null } as Prisma.GedImportacaoItemUncheckedCreateInput,
      });
      return;
    } catch (e) {
      // outra requisição paralela pegou a mesma `ordem`: tenta de novo com a próxima livre
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") || tentativa >= 10) throw e;
    }
  }
}

/**
 * Recebe UM arquivo da pasta (corpo = bytes). Idempotente por caminho: reenviar o mesmo arquivo (retentativa ou retomada) não duplica.
 * Só PDF e ZIP são guardados; outros formatos viram item "Ignorado" (sem guardar); oculto/lixo não vira item.
 */
export async function receberArquivoPasta(ctx: CtxGed, id: string, e: { caminho: string; dados: Buffer; sha256?: string | null }, limites: LimitesZip = LIMITES_PADRAO): Promise<ResultadoArquivoPasta> {
  const lote = await obterLoteAberto(ctx, id, "PASTA");
  const n = normalizarCaminho(e.caminho ?? "");
  const caminho = n.ok ? n.segmentos.join("/") : "";
  if (!n.ok) return registrarSemArquivo(ctx, id, String(e.caminho ?? "").replace(/[\u0000-\u001f\u007f]/g, "?").slice(0, 300) || "(sem nome)", "ERRO", n.erro);
  if (n.segmentos.length === 0) throw invalido("Caminho do arquivo ausente.");
  if (caminho.length > MAX_CAMINHO) return registrarSemArquivo(ctx, id, caminho.slice(0, 300), "ERRO", "Caminho longo demais.");
  if (n.segmentos.some(segmentoIgnorado)) return { status: "OCULTO" };
  const nome = n.segmentos[n.segmentos.length - 1];
  if (n.segmentos.length - 1 > limites.maxProfundidade) return registrarSemArquivo(ctx, id, caminho, "ERRO", `Pastas aninhadas demais (máximo ${limites.maxProfundidade} níveis).`);
  if (!ehPdf(nome) && !ehZip(nome)) return registrarSemArquivo(ctx, id, caminho, "IGNORADO", `Extensão não permitida (${/\.([^./]+)$/.exec(nome)?.[0] ?? "sem extensão"}). Somente PDF.`, e.dados.length);
  if (e.dados.length === 0) return registrarSemArquivo(ctx, id, caminho, "ERRO", "Arquivo vazio.", 0);
  if (e.dados.length > limites.maxArquivoBytes) return registrarSemArquivo(ctx, id, caminho, "ERRO", MOTIVO_MAX(limites), e.dados.length);
  if (ehZip(nome)) {
    const sig = e.dados.subarray(0, 4).toString("latin1");
    if (sig !== "PK\x03\x04" && sig !== "PK\x05\x06") return registrarSemArquivo(ctx, id, caminho, "ERRO", "O arquivo não é um ZIP válido.", e.dados.length);
  }
  const sha256 = sha256Hex(e.dados);
  if (e.sha256 && e.sha256.toLowerCase() !== sha256) throw new ErroApi(422, "ARQUIVO_CORROMPIDO", "O arquivo chegou corrompido (sha256 diferente do informado). Tente enviar de novo.");

  const existente = await ctx.db.gedImportacaoItem.findFirst({ where: { importacao_id: id, caminho }, select: { id: true, status: true, sha256: true, tamanho: true, storage_key: true } });
  if (existente && existente.status === "RECEBIDO" && existente.sha256 === sha256 && existente.tamanho === e.dados.length) return { status: "RECEBIDO", repetido: true };
  if (!existente) {
    const total = await ctx.db.gedImportacaoItem.count({ where: { importacao_id: id } });
    if (total >= limites.maxArquivos) throw invalido(`O lote tem arquivos demais; o limite é ${limites.maxArquivos} por lote. Divida em lotes menores.`);
  }
  const itemId = existente?.id ?? randomUUID();
  const key = chaveArquivoPasta(ctx.organizacao_id, lote.id, itemId);
  await salvarArquivoPasta(ctx.organizacao_id, key, e.dados, ehZip(nome) ? "application/zip" : "application/pdf");
  try {
    if (existente) await ctx.db.gedImportacaoItem.update({ where: { id: existente.id }, data: { status: "RECEBIDO", motivo: null, sha256, tamanho: e.dados.length, storage_key: key } });
    else await criarItem(ctx, id, { itemId, caminho, status: "RECEBIDO", sha256, tamanho: e.dados.length, storage_key: key });
  } catch (err) {
    if (!existente) await descartarArquivoOrfao(ctx.organizacao_id, key);
    throw err;
  }
  void tocar(ctx, id).catch(() => {});
  return { status: "RECEBIDO" };
}

/** O que o servidor já tem do lote (para retomar enviando só o que falta): caminho + tamanho + sha256, paginado por `ordem`. */
export async function listarRecebidos(ctx: CtxGed, id: string, opc: { depois?: number; take?: number } = {}) {
  exigirPodeImportar(ctx);
  if (!zUuid.safeParse(id).success) exigirEncontrado(null, "Importação não encontrada.");
  const lote = exigirEncontrado(await ctx.db.gedImportacao.findFirst({ where: { AND: [{ id }, whereVisiveis(ctx)] } }), "Importação não encontrada.");
  const take = Math.min(5000, Math.max(1, opc.take ?? 5000));
  const itens = await ctx.db.gedImportacaoItem.findMany({
    where: { importacao_id: id, ordem: { gt: opc.depois ?? -1 } },
    orderBy: { ordem: "asc" },
    take,
    select: { ordem: true, caminho: true, tamanho: true, sha256: true, status: true },
  });
  const partes = lote.origem === "ZIP" && lote.partes_total > 0 && lote.status === "RECEBENDO" ? await listarPartesRecebidas(ctx.organizacao_id, id) : [];
  return { itens, proximo: itens.length === take ? itens[itens.length - 1].ordem : null, partes, partes_total: lote.partes_total, tamanho_parte: TAMANHO_PARTE_ZIP, status: lote.status };
}

// ───────────── ZIP em partes ─────────────

export type EntradaZipEmPartes = DestinoImportacao & { nome_arquivo: string; tamanho: number; unir_pastas?: boolean };

export async function iniciarImportacaoZipPartes(ctx: CtxGed, e: EntradaZipEmPartes, limites: LimitesZip = LIMITES_PADRAO): Promise<{ id: string; status: "RECEBENDO"; partes_total: number; tamanho_parte: number }> {
  exigirPodeImportar(ctx);
  const nome = (e.nome_arquivo ?? "").split(/[\\/]/).pop()?.trim() ?? "";
  if (!/\.zip$/i.test(nome)) throw invalido("Envie um arquivo ZIP (.zip).");
  const tamanho = Math.trunc(Number(e.tamanho));
  if (!Number.isFinite(tamanho) || tamanho < 22) throw invalido("Tamanho do ZIP inválido.");
  if (tamanho > limites.maxZipBytes) throw invalido(`O ZIP excede o limite de ${Math.round(limites.maxZipBytes / 1048576)} MB. Envie por pasta ou divida em ZIPs menores.`);
  const { pastaId, tipoId, sensibilidade } = await validarDestino(ctx, e);
  await exigirVagaLote(ctx);
  const partes = Math.ceil(tamanho / TAMANHO_PARTE_ZIP);
  const id = randomUUID();
  await ctx.db.$transaction(async (tx) => {
    await tx.gedImportacao.create({
      data: {
        id,
        criado_por_id: ctx.usuario.id,
        nome_arquivo: nome.slice(0, 250),
        tamanho_zip: tamanho,
        sha256_zip: "pendente",
        pasta_destino_id: pastaId,
        tipo_id: tipoId,
        sensibilidade,
        status: "RECEBENDO",
        origem: "ZIP",
        unir_pastas: !!e.unir_pastas,
        partes_total: partes,
      } as Prisma.GedImportacaoUncheckedCreateInput,
    });
    await auditarGed(ctx, { acao: "GED_IMPORTACAO_CRIADA", entidade: "ged_importacao", entidade_id: id, depois: { origem: "ZIP_EM_PARTES", nome_arquivo: nome, tamanho, partes, pasta_destino_id: pastaId, tipo_id: tipoId, sensibilidade, unir_pastas: !!e.unir_pastas } }, tx);
  });
  return { id, status: "RECEBENDO", partes_total: partes, tamanho_parte: TAMANHO_PARTE_ZIP };
}

/** Recebe a parte `n` (1-based). Tamanho exato (todas de 8 MB, a última com o resto); idempotente. */
export async function receberParteZip(ctx: CtxGed, id: string, n: number, dados: Buffer): Promise<{ parte: number; partes_total: number }> {
  const lote = await obterLoteAberto(ctx, id, "ZIP");
  if (lote.partes_total === 0) throw invalido("Este lote não recebe ZIP em partes.");
  if (!Number.isInteger(n) || n < 1 || n > lote.partes_total) throw invalido(`Parte inválida (1 a ${lote.partes_total}).`);
  const esperado = n < lote.partes_total ? TAMANHO_PARTE_ZIP : lote.tamanho_zip - (lote.partes_total - 1) * TAMANHO_PARTE_ZIP;
  if (dados.length > MAX_PARTE_ZIP || dados.length !== esperado) throw invalido(`A parte ${n} deveria ter ${esperado} bytes (recebi ${dados.length}). Tente enviar de novo.`);
  await salvarParteZip(ctx.organizacao_id, id, n, dados);
  void tocar(ctx, id).catch(() => {});
  return { parte: n, partes_total: lote.partes_total };
}

// ───────────── Concluir / cancelar ─────────────

export type EntradaConclusao = { ignorados?: { caminho: string; motivo?: string }[]; ocultos?: number };

/** Fecha o envio e coloca o lote na fila (RECEBENDO → PENDENTE). Para ZIP exige todas as partes; para pasta, ao menos um PDF/ZIP. */
export async function concluirEnvio(ctx: CtxGed, id: string, c: EntradaConclusao = {}, limites: LimitesZip = LIMITES_PADRAO): Promise<{ id: string; status: string; total_arquivos: number }> {
  exigirPodeImportar(ctx);
  if (!zUuid.safeParse(id).success) exigirEncontrado(null, "Importação não encontrada.");
  const lote = exigirEncontrado(await ctx.db.gedImportacao.findFirst({ where: { AND: [{ id }, whereVisiveis(ctx)] } }), "Importação não encontrada.");
  // idempotente: a resposta de um "concluir" pode se perder e o navegador repetir (o lote pode até já ter terminado)
  if (lote.status !== "RECEBENDO" && lote.status !== "FALHOU") return { id, status: lote.status, total_arquivos: lote.total_arquivos };
  if (lote.status !== "RECEBENDO") throw new ErroApi(409, "LOTE_FECHADO", "Este lote já foi encerrado.");

  let total = lote.total_arquivos;
  let ocultos = lote.ocultos;
  if (lote.origem === "ZIP") {
    const recebidas = new Set(await listarPartesRecebidas(ctx.organizacao_id, id));
    const faltam = Array.from({ length: lote.partes_total }, (_, i) => i + 1).filter((p) => !recebidas.has(p));
    if (faltam.length) throw new ErroApi(409, "PARTES_FALTANDO", `Faltam ${faltam.length} parte(s) do ZIP (ex.: ${faltam.slice(0, 5).join(", ")}). Reenvie as que faltam e conclua de novo.`, { faltam });
    // validação barata: o ZIP começa com "PK" e termina com o registro de fim do diretório central
    const primeira = await lerArquivoPasta(ctx.organizacao_id, chaveParte(ctx.organizacao_id, id, 1));
    const sig = primeira.subarray(0, 4).toString("latin1");
    if (sig !== "PK\x03\x04" && sig !== "PK\x05\x06") throw invalido("O arquivo não é um ZIP válido.");
    const ultima = await lerArquivoPasta(ctx.organizacao_id, chaveParte(ctx.organizacao_id, id, lote.partes_total));
    const cauda = lote.partes_total > 1 && ultima.length < 70_000 ? Buffer.concat([(await lerArquivoPasta(ctx.organizacao_id, chaveParte(ctx.organizacao_id, id, lote.partes_total - 1))).subarray(-70_000), ultima]) : ultima;
    if (cauda.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) < 0) throw invalido("O arquivo não é um ZIP válido (diretório central não encontrado). O envio pode ter sido interrompido.");
  } else {
    const ign = (c.ignorados ?? []).slice(0, MAX_IGNORADOS_POR_CONCLUSAO);
    for (const i of ign) {
      const n = normalizarCaminho(String(i.caminho ?? ""));
      if (!n.ok || n.segmentos.length === 0) continue;
      const caminho = n.segmentos.join("/").slice(0, MAX_CAMINHO);
      if (n.segmentos.some(segmentoIgnorado)) continue;
      const existe = await ctx.db.gedImportacaoItem.findFirst({ where: { importacao_id: id, caminho }, select: { id: true } });
      if (!existe) await criarItem(ctx, id, { caminho, status: "IGNORADO", motivo: String(i.motivo ?? "Ignorado pelo navegador.").slice(0, 300) });
    }
    ocultos += Math.max(0, Math.min(1_000_000, Math.trunc(Number(c.ocultos ?? 0)) || 0));
    total = await ctx.db.gedImportacaoItem.count({ where: { importacao_id: id } });
    const aProcessar = await ctx.db.gedImportacaoItem.count({ where: { importacao_id: id, status: "RECEBIDO" } });
    if (aProcessar === 0) throw invalido("Nenhum PDF foi recebido neste lote (outros formatos e arquivos ocultos são ignorados).");
    if (total > limites.maxArquivos) throw invalido(`O lote tem arquivos demais (${total}); o limite é ${limites.maxArquivos}.`);
    const soma = await ctx.db.gedImportacaoItem.aggregate({ where: { importacao_id: id, status: "RECEBIDO" }, _sum: { tamanho: true } });
    if (Number(soma._sum.tamanho ?? 0) > limites.maxTotalDescompactado) throw invalido(`O lote excede ${Math.round(limites.maxTotalDescompactado / 1073741824)} GB. Divida em lotes menores.`);
  }
  const r = await ctx.db.gedImportacao.updateMany({ where: { id, status: "RECEBENDO" }, data: { status: "PENDENTE", total_arquivos: total, ocultos } });
  if (r.count === 1) await auditarGed(ctx, { acao: "GED_IMPORTACAO_ENVIADA", entidade: "ged_importacao", entidade_id: id, depois: { origem: lote.origem, total_arquivos: total } });
  return { id, status: "PENDENTE", total_arquivos: total };
}

/** Descarta um lote ainda em envio (RECEBENDO) e tudo que ele guardou. */
export async function cancelarEnvio(ctx: CtxGed, id: string): Promise<void> {
  exigirPodeImportar(ctx);
  if (!zUuid.safeParse(id).success) exigirEncontrado(null, "Importação não encontrada.");
  const lote = exigirEncontrado(await ctx.db.gedImportacao.findFirst({ where: { AND: [{ id }, whereVisiveis(ctx)] } }), "Importação não encontrada.");
  if (lote.status !== "RECEBENDO") throw new ErroApi(409, "LOTE_FECHADO", "Só é possível cancelar um lote que ainda está recebendo arquivos.");
  await ctx.db.gedImportacao.update({ where: { id }, data: { status: "FALHOU", erro: "Envio cancelado.", concluido_em: new Date(), storage_key: null } });
  await descartarArmazenamentoImportacao(ctx.db, ctx.organizacao_id, lote);
  await auditarGed(ctx, { acao: "GED_IMPORTACAO_CANCELADA", entidade: "ged_importacao", entidade_id: id, depois: {} });
}

/** Registra um arquivo da pasta que nem chegou a ser lido (grande demais): aparece no relatório como erro. */
export async function registrarArquivoRejeitado(ctx: CtxGed, id: string, caminhoBruto: string, motivo: string, tamanho?: number): Promise<ResultadoArquivoPasta> {
  await obterLoteAberto(ctx, id, "PASTA");
  const n = normalizarCaminho(caminhoBruto ?? "");
  const caminho = n.ok ? n.segmentos.join("/").slice(0, MAX_CAMINHO) : String(caminhoBruto ?? "").replace(/[\u0000-\u001f\u007f]/g, "?").slice(0, 300);
  if (n.ok && n.segmentos.some(segmentoIgnorado)) return { status: "OCULTO" };
  return registrarSemArquivo(ctx, id, caminho || "(sem nome)", "ERRO", motivo, tamanho);
}
