"use server";
import type { TipoDocumento } from "@prisma/client";
import { prisma } from "@/lib/db";
import { auditar } from "@/lib/audit";
import { invalido } from "@/lib/http";
import { acaoAdmin, bool, obrigatorio, txt } from "@/lib/admin/acao";
import type { EstadoAcao } from "@/lib/admin/guard";

const TIPOS: TipoDocumento[] = ["LICENCA", "AUTORIZACAO", "CERTIDAO", "AUTO_INFRACAO", "NOTIFICACAO", "PARECER", "OFICIO", "RECIBO"];

/** Nunca altera uma versão existente: cada salvamento cria nova linha (versão = maior do tipo + 1), ativa e única ativa do tipo. */
export async function salvarNovaVersao(_: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  return acaoAdmin("/admin/modelos", async (u) => {
    const tipo = obrigatorio(f, "tipo", "o tipo") as TipoDocumento;
    if (!TIPOS.includes(tipo)) throw invalido("Tipo inválido.", { campo: "tipo" });
    const nome = obrigatorio(f, "nome", "o nome");
    const html = txt(f, "html");
    if (html.length < 20) throw invalido("O HTML do modelo está vazio ou muito curto.", { campo: "html" });
    if (/<script[\s>]/i.test(html)) throw invalido("Scripts não são permitidos no modelo.", { campo: "html" });
    const ativar = bool(f, "ativar");
    const m = await prisma.$transaction(async (tx) => {
      const ultima = await tx.modeloDocumento.aggregate({ where: { tipo }, _max: { versao: true } });
      const versao = (ultima._max.versao ?? 0) + 1;
      if (ativar) await tx.modeloDocumento.updateMany({ where: { tipo, ativo: true }, data: { ativo: false } });
      const m = await tx.modeloDocumento.create({ data: { tipo, nome, html, versao, ativo: ativar, created_by: u.id } });
      await auditar({ usuario_id: u.id, acao: "NOVA_VERSAO", entidade: "modelo_documento", entidade_id: m.id, depois: { tipo, nome, versao, ativo: ativar, tamanho_html: html.length, origem_id: txt(f, "origem_id") || null } }, tx);
      return m;
    });
    return { mensagem: `Versão ${m.versao} do modelo ${tipo} salva${ativar ? " e ativada" : ""}.`, extra: { link: `/admin/modelos/${m.id}` } };
  });
}

export async function alternarAtivo(_: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  return acaoAdmin("/admin/modelos", async (u) => {
    const id = obrigatorio(f, "id", "o modelo");
    const m = await prisma.modeloDocumento.findUniqueOrThrow({ where: { id } });
    const ativo = !m.ativo;
    await prisma.$transaction(async (tx) => {
      if (ativo) await tx.modeloDocumento.updateMany({ where: { tipo: m.tipo, ativo: true }, data: { ativo: false } });
      await tx.modeloDocumento.update({ where: { id }, data: { ativo } });
      await auditar({ usuario_id: u.id, acao: ativo ? "ATIVAR" : "DESATIVAR", entidade: "modelo_documento", entidade_id: id, antes: { ativo: m.ativo }, depois: { ativo } }, tx);
    });
    return ativo ? `Versão ${m.versao} ativada (demais versões de ${m.tipo} desativadas).` : `Versão ${m.versao} desativada. Sem versão ativa, o sistema usa o modelo padrão embutido.`;
  });
}
