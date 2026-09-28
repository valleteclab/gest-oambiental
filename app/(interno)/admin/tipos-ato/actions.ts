"use server";
import type { CategoriaAto } from "@prisma/client";
import { prisma } from "@/lib/db";
import { auditar } from "@/lib/audit";
import { invalido } from "@/lib/http";
import { acaoAdmin, bool, int, intOuNulo, obrigatorio, txtOuNulo } from "@/lib/admin/acao";
import type { EstadoAcao } from "@/lib/admin/guard";
import { organizacaoDoAdmin } from "@/lib/admin/escopo";
import { naoEncontrado } from "@/lib/http";

const CATEGORIAS: CategoriaAto[] = ["LICENCA", "AUTORIZACAO", "CERTIDAO", "DECLARACAO"];

export async function salvarTipoAto(_: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  return acaoAdmin("/admin/tipos-ato", async (u) => {
    const id = txtOuNulo(f, "id");
    const categoria = obrigatorio(f, "categoria", "a categoria") as CategoriaAto;
    if (!CATEGORIAS.includes(categoria)) throw invalido("Categoria inválida.", { campo: "categoria" });
    const sigla = obrigatorio(f, "sigla", "a sigla").toUpperCase();
    if (!/^[A-Z0-9_]{1,15}$/.test(sigla)) throw invalido("Sigla: letras, números e _ (até 15).", { campo: "sigla" });
    const dados = {
      sigla,
      nome: obrigatorio(f, "nome", "o nome"),
      categoria,
      validade_meses_padrao: intOuNulo(f, "validade_meses_padrao", 1, 240),
      exige_vistoria: bool(f, "exige_vistoria"),
      exige_parecer: bool(f, "exige_parecer"),
      modelo_documento: txtOuNulo(f, "modelo_documento"),
      checklist_modelo_id: txtOuNulo(f, "checklist_modelo_id"),
      prazo_analise_dias: int(f, "prazo_analise_dias", 1, 720),
      ativo: bool(f, "ativo"),
    };
    const org = { id: organizacaoDoAdmin(u) };
    if (dados.checklist_modelo_id && !(await prisma.checklistModelo.count({ where: { id: dados.checklist_modelo_id, organizacao_id: org.id } }))) throw invalido("Checklist inválido.", { campo: "checklist_modelo_id" });
    const dup = await prisma.tipoAto.findFirst({ where: { organizacao_id: org.id, sigla, ...(id ? { id: { not: id } } : {}) } });
    if (dup) throw invalido(`Já existe tipo de ato com a sigla ${sigla}.`, { campo: "sigla" });
    if (id) {
      const antes = await prisma.tipoAto.findFirst({ where: { id, organizacao_id: org.id } });
      if (!antes) throw naoEncontrado("Tipo de ato não encontrado.");
      await prisma.$transaction(async (tx) => {
        const t = await tx.tipoAto.update({ where: { id }, data: dados });
        await auditar({ usuario_id: u.id, acao: "EDITAR", entidade: "tipo_ato", entidade_id: id, antes, depois: t }, tx);
      });
      return "Tipo de ato atualizado.";
    }
    const t = await prisma.$transaction(async (tx) => {
      const t = await tx.tipoAto.create({ data: { ...dados, organizacao_id: org.id, created_by: u.id } });
      await auditar({ usuario_id: u.id, acao: "CRIAR", entidade: "tipo_ato", entidade_id: t.id, depois: t }, tx);
      return t;
    });
    return { mensagem: `Tipo de ato ${t.sigla} criado.`, extra: { link: `/admin/tipos-ato/${t.id}` } };
  });
}
