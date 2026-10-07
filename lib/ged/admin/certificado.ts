// Certificado A1 (e-CNPJ) do cliente para o selo PAdES dos documentos assinados (docs/ged-design.md §3): titular ORGAO,
// municipio_id nulo, na organização do administrador. Reaproveita o serviço de lib/assinatura (validação com a senha,
// cifragem em repouso, substituição do anterior) sem editá-lo; este wrapper restringe ao certificado DO CLIENTE (nunca mexe em
// e-CPF de servidores nem em certificados de municípios do licenciamento), audita com organizacao_id e nunca devolve segredo.
import { invalido } from "@/lib/http";
import { desativarCertificado, pdfTesteAssinado, salvarCertificado } from "@/lib/assinatura/servico";
import { diasParaVencer, situacaoCertificado, type SituacaoCertificado } from "@/lib/assinatura/certificado";
import { auditarGed } from "../auditoria";
import { exigirEncontrado } from "../db";
import type { CtxGed } from "../escopo";
import { exigirAdmin } from "./membros";

export type CertificadoGedView = {
  id: string; nome_titular: string; emissor: string; serial: string; valido_de: Date; valido_ate: Date; icp_brasil: boolean; ativo: boolean;
  situacao: SituacaoCertificado; dias_para_vencer: number;
};

const ESCOPO_CLIENTE = (ctx: CtxGed) => ({ organizacao_id: ctx.organizacao_id, titular: "ORGAO" as const, municipio_id: null });

export async function listarCertificados(ctx: CtxGed, agora = new Date()): Promise<CertificadoGedView[]> {
  exigirAdmin(ctx);
  const l = await ctx.db.certificadoDigital.findMany({
    where: ESCOPO_CLIENTE(ctx),
    select: { id: true, nome_titular: true, emissor: true, serial: true, valido_de: true, valido_ate: true, icp_brasil: true, ativo: true },
    orderBy: [{ ativo: "desc" }, { valido_ate: "desc" }],
  });
  return l.map((c) => ({ ...c, situacao: situacaoCertificado(c, agora), dias_para_vencer: diasParaVencer(c.valido_ate, agora) }));
}

export async function enviarCertificado(ctx: CtxGed, arquivo: File | null, senha: string): Promise<{ id: string; nome_titular: string; icp_brasil: boolean; valido_ate: Date }> {
  exigirAdmin(ctx);
  if (!arquivo || arquivo.size === 0) throw invalido("Selecione o arquivo do certificado A1 (.pfx ou .p12).", { campo: "arquivo" });
  // salvarCertificado valida extensão/tamanho, abre com a senha (erros amigáveis: senha errada, vencido, e-CPF no lugar de e-CNPJ…),
  // cifra .pfx e senha e desativa o certificado anterior do mesmo titular.
  const c = await salvarCertificado(ctx.usuario, { arquivo, senha, titular: "ORGAO", municipio_id: null, usuario_id: null });
  await auditarGed(ctx, {
    acao: "GED_CERTIFICADO_CADASTRADO", entidade: "ged_certificado", entidade_id: c.id,
    depois: { nome_titular: c.nome_titular, emissor: c.emissor, serial: c.serial, valido_ate: c.valido_ate, icp_brasil: c.icp_brasil },
  });
  return { id: c.id, nome_titular: c.nome_titular, icp_brasil: c.icp_brasil, valido_ate: c.valido_ate };
}

async function doCliente(ctx: CtxGed, id: string) {
  return exigirEncontrado(await ctx.db.certificadoDigital.findFirst({ where: { id, ...ESCOPO_CLIENTE(ctx) } }), "Certificado não encontrado.");
}

export async function desativarCertificadoGed(ctx: CtxGed, id: string): Promise<void> {
  exigirAdmin(ctx);
  const c = await doCliente(ctx, id);
  await desativarCertificado(ctx.usuario, c.id);
  await auditarGed(ctx, { acao: "GED_CERTIFICADO_DESATIVADO", entidade: "ged_certificado", entidade_id: c.id, antes: { ativo: true }, depois: { ativo: false, nome_titular: c.nome_titular } });
}

/** PDF de amostra assinado com o certificado (para abrir no leitor de PDF / validar.iti.gov.br). Não é documento do GED. */
export async function pdfTesteDoCertificado(ctx: CtxGed, id: string): Promise<Buffer> {
  exigirAdmin(ctx);
  const c = await doCliente(ctx, id);
  const pdf = await pdfTesteAssinado(ctx.usuario, c);
  await auditarGed(ctx, { acao: "GED_CERTIFICADO_TESTADO", entidade: "ged_certificado", entidade_id: c.id, depois: { thumbprint_sha1: c.thumbprint_sha1 } });
  return pdf;
}
