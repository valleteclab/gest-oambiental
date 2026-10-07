// Selo do documento (docs/ged-design.md §3, passo 6): QR + código em todas as páginas, folha de assinaturas anexada e,
// quando o cliente tem certificado A1 (e-CNPJ do órgão), assinatura PAdES do arquivo final.
//
// CRASH-SAFE / IDEMPOTENTE: todo o trabalho pesado (carimbo, folha, PAdES) acontece FORA de transação e não grava nada no
// banco; a gravação é UMA transação curta que trava a solicitação, confere que ainda está ABERTA e então cria a versão SELO,
// atualiza o documento e conclui a solicitação. Rodar de novo depois de uma falha (ou concorrentemente) nunca duplica
// versões: quem chegar depois do commit encontra a solicitação CONCLUIDA e devolve o resultado já gravado (o arquivo
// excedente só existe em memória; a versão ganhadora é a única gravada em storage).
import "server-only";
import { createHash } from "node:crypto";
import { auditarGed } from "../auditoria";
import { ErroApi, invalido } from "@/lib/http";
import { htmlParaPdf } from "@/lib/pdf";
import { imagemDataUri } from "@/lib/imagem";
import { gerarCodigoVerificador } from "@/lib/crypto";
import { abrirCertificado, assinarComCertificado, type CertificadoEmissao } from "@/lib/assinatura/servico";
import { rotuloTipoCertificado } from "@/lib/assinatura/certificado";
import type { CtxGed } from "../contratos";
import { criarVersao } from "../documentos/versoes";
import { exigirEncontrado, resolverCodigoVerificador } from "../db";
import { lerArquivoGed } from "../storage";
import { verificarCadeia } from "./cadeia";
import { htmlFolhaAssinaturas } from "./folha";
import { avisar } from "./ponte";
import { urlVerificacao } from "./regras";
import { anexarPaginas, estamparRodape, qrPng } from "./selo-pdf";

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/**
 * Certificado A1 do cliente para o selo: e-CNPJ do ÓRGÃO da organização (titular ORGAO, município nulo), ativo e dentro da
 * validade (o mais recente). `null` = não há (o documento é selado como "eletrônica avançada", com aviso na folha).
 * Se existe um certificado válido mas NÃO abre (senha/DATA_KEY), lança erro claro – não rebaixa o selo em silêncio.
 * O .pfx e a senha são decifrados só em memória; nada é registrado em log.
 */
export async function certificadoDoCliente(ctx: Pick<CtxGed, "db" | "organizacao_id">, agora = new Date()): Promise<CertificadoEmissao | null> {
  // CertificadoDigital não é modelo Ged*: o escopo não é injetado – filtramos a organização aqui.
  const reg = await ctx.db.certificadoDigital.findFirst({
    where: { organizacao_id: ctx.organizacao_id, titular: "ORGAO", municipio_id: null, ativo: true, valido_de: { lte: agora }, valido_ate: { gte: agora } },
    orderBy: { created_at: "desc" },
  });
  if (!reg) return null;
  try {
    const lido = abrirCertificado(reg, agora);
    return { registro: reg, lido, rotulo: rotuloTipoCertificado(lido.tipo_documento, reg.titular) };
  } catch (e) {
    throw invalido(`Não foi possível usar o certificado digital do órgão no selo: ${e instanceof Error ? e.message : "erro desconhecido"} Corrija-o em Administração → Certificado ou desative-o para selar com assinatura eletrônica avançada.`);
  }
}

/** Código verificador único em ged_documento (todos os clientes) E documento_oficial. */
export async function gerarCodigoUnico(ctx: Pick<CtxGed, "db">, tentativas = 12): Promise<string> {
  for (let i = 0; i < tentativas; i++) {
    const c = gerarCodigoVerificador();
    if (await resolverCodigoVerificador(c)) continue;
    // DocumentoOficial não é modelo Ged*: só checa existência do código (sem expor nada).
    if (await ctx.db.documentoOficial.findUnique({ where: { codigo_verificador: c }, select: { id: true } })) continue;
    return c;
  }
  throw new Error("GED: não foi possível gerar um código verificador único.");
}

export type ResultadoSelo = {
  ja_selado: boolean;
  versao_selo_id: string;
  codigo_verificador: string;
  sha256_final: string;
  com_certificado: boolean;
};

const nomeArquivoSelado = (numero: string) => `${numero.replace(/[^A-Za-z0-9._-]+/g, "_")}-assinado.pdf`;

async function resultadoJaSelado(ctx: CtxGed, solicitacaoId: string): Promise<ResultadoSelo> {
  const s = exigirEncontrado(await ctx.db.gedSolicitacaoAssinatura.findUnique({ where: { id: solicitacaoId }, select: { documento_id: true, versao_selo_id: true } }));
  const d = exigirEncontrado(await ctx.db.gedDocumento.findUnique({ where: { id: s.documento_id }, select: { codigo_verificador: true, sha256_final: true } }));
  const v = s.versao_selo_id ? await ctx.db.gedVersaoDocumento.findUnique({ where: { id: s.versao_selo_id }, select: { storage_key: true } }) : null;
  const arquivo = v ? await lerArquivoGed(ctx.organizacao_id, v.storage_key).catch(() => null) : null;
  return {
    ja_selado: true,
    versao_selo_id: s.versao_selo_id ?? "",
    codigo_verificador: d.codigo_verificador ?? "",
    sha256_final: d.sha256_final ?? "",
    com_certificado: !!arquivo && arquivo.toString("latin1").includes("/ByteRange"),
  };
}

/**
 * Sela o documento da solicitação (todos assinaram). Chamado por `assinar` logo após a última assinatura e pelo job
 * de reconciliação (`selarPendentes`). `ctx` = qualquer membro do cliente (fica como autor técnico da versão SELO).
 */
export async function selarDocumento(ctx: CtxGed, solicitacaoId: string): Promise<ResultadoSelo> {
  const sol = exigirEncontrado(await ctx.db.gedSolicitacaoAssinatura.findUnique({ where: { id: solicitacaoId } }), "Solicitação não encontrada.");
  if (sol.status === "CONCLUIDA") return resultadoJaSelado(ctx, solicitacaoId);
  if (sol.status !== "ABERTA") throw invalido("A solicitação não está aberta; não é possível selar.");

  const assinantes = await ctx.db.gedAssinante.findMany({ where: { solicitacao_id: sol.id }, orderBy: { ordem: "asc" } });
  if (assinantes.length === 0 || assinantes.some((a) => a.status !== "ASSINADO")) throw invalido("Ainda faltam assinaturas para selar o documento.");

  const doc = exigirEncontrado(await ctx.db.gedDocumento.findUnique({ where: { id: sol.documento_id }, select: { id: true, numero: true, titulo: true, status: true, codigo_verificador: true } }));
  const versao = exigirEncontrado(await ctx.db.gedVersaoDocumento.findUnique({ where: { id: sol.versao_id } }));

  // 1) o arquivo que será selado é exatamente o que foi assinado
  const original = await lerArquivoGed(ctx.organizacao_id, versao.storage_key);
  if (sha256(original) !== sol.sha256_alvo) throw new ErroApi(409, "INTEGRIDADE", "O arquivo armazenado não confere com o hash assinado. O selo foi abortado.");
  // 2) a cadeia de hashes das assinaturas está íntegra
  const cadeia = verificarCadeia(
    sol.sha256_alvo,
    assinantes.map((a) => ({ assinante_id: a.id, usuario_id: a.usuario_id, hash_documento: a.hash_documento ?? "", assinado_em: a.assinado_em, metodo: a.metodo ?? "", ordem: a.ordem, status: a.status, hash_cadeia: a.hash_cadeia })),
  );
  if (!cadeia.ok) throw new ErroApi(409, "INTEGRIDADE", "A cadeia de hashes das assinaturas não confere. O selo foi abortado.");

  const certificado = await certificadoDoCliente(ctx);
  const codigo = doc.codigo_verificador ?? (await gerarCodigoUnico(ctx));
  const url = urlVerificacao(codigo);
  const selado_em = new Date();

  // 3) carimbo em todas as páginas + folha de assinaturas + PAdES
  const carimbado = await estamparRodape(original, { codigo, url });
  const usuarios = await ctx.db.usuario.findMany({ where: { id: { in: [...new Set([...assinantes.map((a) => a.usuario_id), sol.criada_por_id])] }, organizacao_id: ctx.organizacao_id }, select: { id: true, nome: true, cargo: true } });
  const u = new Map(usuarios.map((x) => [x.id, x]));
  const html = htmlFolhaAssinaturas({
    organizacao: { nome: ctx.organizacao.nome, logo_data_uri: await imagemDataUri(ctx.organizacao.logo_url).catch(() => null) },
    numero: doc.numero,
    titulo: doc.titulo,
    versao_n: versao.n,
    paginas_documento: versao.paginas ?? carimbado.paginas,
    sha256_alvo: sol.sha256_alvo,
    modo: sol.modo,
    solicitado_por: u.get(sol.criada_por_id)?.nome ?? "—",
    solicitada_em: sol.created_at,
    selado_em,
    codigo,
    url,
    qr_data_uri: `data:image/png;base64,${(await qrPng(url)).toString("base64")}`,
    assinantes: assinantes.map((a) => ({
      ordem: a.ordem,
      nome: u.get(a.usuario_id)?.nome ?? "Usuário",
      cargo: u.get(a.usuario_id)?.cargo ?? null,
      assinado_em: a.assinado_em!,
      metodo: a.metodo ?? "ELETRONICA_AVANCADA",
      hash_cadeia: a.hash_cadeia ?? "",
      rotulo: a.rotulo,
    })),
    certificado: certificado
      ? { titular: certificado.lido.nome, emissor: certificado.lido.emissor, serial: certificado.lido.serial, valido_ate: certificado.lido.valido_ate, teste: !certificado.lido.icp_brasil }
      : null,
  });
  const folha = await htmlParaPdf(html, { margem: "14mm" });
  const unido = await anexarPaginas(carimbado.pdf, folha);
  const final = certificado
    ? await assinarComCertificado(unido.pdf, certificado, { motivo: `Selo das assinaturas do documento ${doc.numero}`, local: ctx.organizacao.nome, contato: url, quando: selado_em })
    : unido.pdf;

  // 4) gravação atômica (idempotente)
  const out = await ctx.db.$transaction(
    async (tx): Promise<ResultadoSelo | null> => {
      // trava a solicitação: duas execuções simultâneas se enfileiram
      const trava = await tx.gedSolicitacaoAssinatura.update({ where: { id: sol.id }, data: { updated_at: new Date() }, select: { status: true } });
      if (trava.status === "CONCLUIDA") return null;
      if (trava.status !== "ABERTA") throw invalido("A solicitação deixou de estar aberta; o selo foi descartado.");
      const v = await criarVersao(tx, ctx, {
        documento_id: doc.id,
        origem: "SELO",
        arquivo: final,
        nome_arquivo: nomeArquivoSelado(doc.numero),
        mime: "application/pdf",
        selada: true,
        derivada_de_id: versao.id,
      });
      await tx.gedDocumento.update({ where: { id: doc.id }, data: { status: "ASSINADO", sha256_final: v.sha256, codigo_verificador: codigo } });
      await tx.gedSolicitacaoAssinatura.update({ where: { id: sol.id }, data: { status: "CONCLUIDA", concluida_em: selado_em, versao_selo_id: v.id } });
      await avisar(tx, ctx, "ASSINATURA_CONCLUIDA", {
        usuario_ids: [sol.criada_por_id, ...assinantes.map((a) => a.usuario_id)],
        documento_id: doc.id,
        dados: { codigo_verificador: codigo, url_verificacao: url, selado_em: selado_em.toISOString() },
      });
      await auditarGed(
        ctx,
        {
          acao: "GED_DOCUMENTO_SELADO",
          entidade: "ged_documento",
          entidade_id: doc.id,
          antes: { status: doc.status },
          depois: { status: "ASSINADO", solicitacao_id: sol.id, versao_selo_id: v.id, sha256_alvo: sol.sha256_alvo, sha256_final: v.sha256, codigo_verificador: codigo, pades: !!certificado, certificado_serial: certificado?.lido.serial ?? null },
        },
        tx,
      );
      return { ja_selado: false, versao_selo_id: v.id, codigo_verificador: codigo, sha256_final: v.sha256, com_certificado: !!certificado };
    },
    { maxWait: 15_000, timeout: 60_000 },
  );
  return out ?? resultadoJaSelado(ctx, solicitacaoId);
}
