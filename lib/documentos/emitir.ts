// Documentos oficiais (SPEC 7): emissão com PDF + QR Code + código verificador + sha256, e cancelamento.
import "server-only";
import { randomUUID } from "node:crypto";
import { addMonths } from "date-fns";
import QRCode from "qrcode";
import { Prisma, type DocumentoOficial, type TipoDocumento } from "@prisma/client";
import { prisma } from "../db";
import { auditar } from "../audit";
import { gerarCodigoVerificador, sha256 } from "../crypto";
import { htmlParaPdf } from "../pdf";
import { salvarArquivo, removerArquivo } from "../storage";
import { numeroAto, numeroDocumento } from "../numeracao";
import { can, type UsuarioSessao } from "../rbac";
import { invalido, naoEncontrado, proibido } from "../http";
import { rodape, type ContextoDocumento } from "@/templates";
import type { EmitirInput } from "./index";
import { carregarContexto, ehUuid } from "./contexto";
import { renderizarDocumento } from "./modelo";
import { dominioDe } from "./render";

export function urlValidacao(codigo: string): string {
  return `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "")}/validar/${codigo}`;
}

const PREFIXO: Partial<Record<TipoDocumento, "AI" | "NOT" | "PAR" | "OF" | "REC">> = {
  AUTO_INFRACAO: "AI",
  NOTIFICACAO: "NOT",
  PARECER: "PAR",
  OFICIO: "OF",
  RECIBO: "REC",
};
const SIGLA_PADRAO: Partial<Record<TipoDocumento, string>> = { LICENCA: "LIC", AUTORIZACAO: "AUT", CERTIDAO: "CERT" };

const anoBahia = (d: Date) => Number(new Intl.DateTimeFormat("en", { timeZone: "America/Bahia", year: "numeric" }).format(d));
const jsonSeguro = (v: unknown) => JSON.parse(JSON.stringify(v ?? {}, (_k, x) => (typeof x === "bigint" ? x.toString() : x))) as Prisma.InputJsonObject;

function colisaoCodigo(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && String(e.meta?.target ?? "").includes("codigo_verificador");
}

/**
 * Emite um documento oficial. NÃO checa permissão (o módulo de origem já checou – ex.: recibo emitido no protocolo do
 * requerente); rotas/ações genéricas devem checar `can(u, "emitir_documento", "documento", municipio)`.
 * Pode ser chamado fora de transação (abre a sua própria; o PDF é gerado dentro dela para o número não "furar").
 */
export async function emitirDocumento(input: EmitirInput): Promise<DocumentoOficial> {
  if (!input?.tipo || !input.municipio_id || !input.usuario?.id) throw invalido("tipo, municipio_id e usuario são obrigatórios.");
  for (let tentativa = 0; ; tentativa++) {
    try {
      return await emitirUmaVez(input);
    } catch (e) {
      if (colisaoCodigo(e) && tentativa < 3) continue;
      throw e;
    }
  }
}

async function emitirUmaVez(input: EmitirInput): Promise<DocumentoOficial> {
  const base = await carregarContexto(input);
  const modelo = await prisma.modeloDocumento.findFirst({ where: { tipo: input.tipo, ativo: true }, orderBy: [{ versao: "desc" }, { updated_at: "desc" }] });
  const id = randomUUID();
  const emitidoEm = new Date();
  const ano = anoBahia(emitidoEm);
  const municipio = { id: input.municipio_id, sigla: base.sigla_municipio };
  const publico = ["LICENCA", "AUTORIZACAO", "CERTIDAO"].includes(input.tipo);
  const validade = input.validade_ate ?? (publico && base.validade_meses_padrao ? addMonths(emitidoEm, base.validade_meses_padrao) : null);
  const storageKey = `${base.sigla_municipio}/documentos/${ano}/${id}.pdf`;
  let gravou = false;

  try {
    return await prisma.$transaction(
      async (tx) => {
        // 1) Número
        let numero = input.numero?.trim() || null;
        if (numero) {
          const existentes = await tx.documentoOficial.findMany({ where: { municipio_id: input.municipio_id, tipo: input.tipo, numero: { startsWith: numero } }, select: { numero: true, status: true } });
          const mesmo = existentes.find((x) => x.numero === numero);
          if (mesmo?.status === "VALIDO") throw invalido(`Já existe ${input.tipo} válido com o número ${numero}. Cancele-o antes de emitir o substituto.`);
          // Reemissão de número já cancelado/substituído: sufixo de retificação (-R1, -R2…)
          if (mesmo) {
            let n = 1;
            while (existentes.some((x) => x.numero === `${numero}-R${n}`)) n++;
            numero = `${numero}-R${n}`;
          }
        } else if (PREFIXO[input.tipo]) {
          numero = await numeroDocumento(tx, municipio, PREFIXO[input.tipo]!, ano);
        } else {
          numero = await numeroAto(tx, municipio, (base.sigla_ato ?? SIGLA_PADRAO[input.tipo] ?? "DOC").toUpperCase(), ano);
        }

        // 2) Código verificador único
        let codigo = gerarCodigoVerificador();
        for (let i = 0; i < 5 && (await tx.documentoOficial.findUnique({ where: { codigo_verificador: codigo }, select: { id: true } })); i++) codigo = gerarCodigoVerificador();

        // 3) HTML → PDF (rodapé com QR em todas as páginas)
        const url = urlValidacao(codigo);
        const ctx: ContextoDocumento = { ...base, numero, codigo, url_validacao: url, dominio: dominioDe(process.env.APP_URL ?? url), emitido_em: emitidoEm, validade_ate: validade };
        const html = renderizarDocumento(ctx, modelo?.html);
        const qr = await QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: "M" });
        const pdf = await htmlParaPdf(html, { rodapeHtml: rodape(ctx, qr), margem: "14mm" });
        const hash = sha256(pdf);
        await salvarArquivo(storageKey, pdf, "application/pdf");
        gravou = true;

        // 4) Registro imutável
        const dados = jsonSeguro({
          ...input.dados,
          _contexto: {
            titulo: ctx.titulo,
            modelo: modelo ? `modelo_documento:${modelo.id}:v${modelo.versao}` : "embutido",
            titular: base.titular ? { nome: base.titular.nome, tipo: base.titular.tipo, documento: base.titular_mascara } : null,
            empreendimento: base.empreendimento ? { nome: base.empreendimento.nome, endereco: base.empreendimento.endereco } : null,
            processo: base.processo ? { numero: base.processo.numero, tipo_ato: base.processo.tipo_ato_nome, sigla: base.processo.tipo_ato_sigla } : null,
            condicionantes: base.condicionantes,
            municipio: base.municipio.nome,
            orgao: base.municipio.orgao,
          },
        });
        const doc = await tx.documentoOficial.create({
          data: {
            id,
            municipio_id: input.municipio_id,
            processo_id: input.processo_id ?? null,
            fiscalizacao_id: input.fiscalizacao_id ?? base.fiscalizacao_id,
            tipo: input.tipo,
            sigla_ato: publico ? (base.sigla_ato ?? null) : null,
            numero,
            ano,
            codigo_verificador: codigo,
            titular_id: base.titular_id,
            sha256_pdf: hash,
            storage_key: storageKey,
            validade_ate: validade,
            emitido_por: input.usuario.id,
            emitido_por_nome: input.usuario.nome,
            emitido_por_cargo: ctx.signatario.cargo,
            emitido_em: emitidoEm,
            dados,
          },
        });

        // 5) Referências de volta
        const d = input.dados ?? {};
        if (ehUuid(d.parecer_id)) await tx.parecer.updateMany({ where: { id: d.parecer_id }, data: { documento_id: doc.id } });
        if (ehUuid(d.auto_infracao_id)) await tx.autoInfracao.updateMany({ where: { id: d.auto_infracao_id }, data: { documento_id: doc.id } });
        if (ehUuid(d.notificacao_id)) await tx.notificacao.updateMany({ where: { id: d.notificacao_id }, data: { documento_id: doc.id } });
        if ((input.tipo === "LICENCA" || input.tipo === "AUTORIZACAO") && input.processo_id) {
          const anteriores = ehUuid(d.substitui_documento_id) ? [d.substitui_documento_id] : [];
          await tx.condicionante.updateMany({
            where: { processo_id: input.processo_id, status: { not: "CANCELADA" }, OR: [{ documento_id: null }, ...(anteriores.length ? [{ documento_id: { in: anteriores } }] : [])] },
            data: { documento_id: doc.id },
          });
        }

        await auditar(
          {
            usuario_id: input.usuario.id,
            acao: "EMITIR_DOCUMENTO",
            entidade: "documento_oficial",
            entidade_id: doc.id,
            depois: { tipo: doc.tipo, numero: doc.numero, codigo_verificador: doc.codigo_verificador, sha256_pdf: doc.sha256_pdf, processo_id: doc.processo_id, fiscalizacao_id: doc.fiscalizacao_id, validade_ate: doc.validade_ate, storage_key: doc.storage_key },
          },
          tx,
        );
        return doc;
      },
      { timeout: 120_000, maxWait: 20_000 },
    );
  } catch (e) {
    if (gravou) await removerArquivo(storageKey).catch(() => {});
    throw e;
  }
}

/**
 * Cancela (CANCELADO) ou marca como SUBSTITUIDO (quando `substitutoId`). Motivo obrigatório. O PDF nunca é alterado.
 * Permissão: can(u, "cancelar_documento", "documento", municipio).
 */
export async function cancelarDocumento(id: string, motivo: string, usuario: UsuarioSessao, substitutoId?: string): Promise<DocumentoOficial> {
  const m = (motivo ?? "").trim();
  if (m.length < 5) throw invalido("Informe o motivo do cancelamento (mínimo de 5 caracteres).");
  if (!ehUuid(id)) throw naoEncontrado("Documento não encontrado.");
  return prisma.$transaction(async (tx) => {
    const [doc] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM documento_oficial WHERE id = ${id}::uuid FOR UPDATE`;
    const atual = doc ? await tx.documentoOficial.findUnique({ where: { id } }) : null;
    if (!atual) throw naoEncontrado("Documento não encontrado.");
    if (!can(usuario, "cancelar_documento", "documento", atual.municipio_id)) throw proibido("Sem permissão para cancelar documentos deste município.");
    if (atual.status !== "VALIDO") throw invalido(`Documento já está ${atual.status === "CANCELADO" ? "cancelado" : "substituído"}.`);
    if (substitutoId) {
      if (!ehUuid(substitutoId) || substitutoId === id) throw invalido("Documento substituto inválido.");
      const sub = await tx.documentoOficial.findUnique({ where: { id: substitutoId } });
      if (!sub || sub.municipio_id !== atual.municipio_id) throw invalido("Documento substituto não encontrado neste município.");
      if (sub.status !== "VALIDO") throw invalido("O documento substituto precisa estar válido.");
    }
    const novo = await tx.documentoOficial.update({
      where: { id },
      data: { status: substitutoId ? "SUBSTITUIDO" : "CANCELADO", motivo_cancelamento: m, cancelado_em: new Date(), substituto_id: substitutoId ?? null },
    });
    await auditar(
      {
        usuario_id: usuario.id,
        acao: substitutoId ? "SUBSTITUIR_DOCUMENTO" : "CANCELAR_DOCUMENTO",
        entidade: "documento_oficial",
        entidade_id: id,
        antes: { status: atual.status },
        depois: { status: novo.status, motivo_cancelamento: m, substituto_id: novo.substituto_id },
      },
      tx,
    );
    return novo;
  });
}
