"use server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { auditar } from "@/lib/audit";
import { invalido } from "@/lib/http";
import { acaoAdmin, obrigatorio, txt, txtOuNulo } from "@/lib/admin/acao";
import type { EstadoAcao } from "@/lib/admin/guard";
import { organizacaoDoAdmin } from "@/lib/admin/escopo";
import { naoEncontrado } from "@/lib/http";

const Itens = z
  .array(z.object({ id: z.string().min(1).max(40), texto: z.string().trim().min(3, "Texto do item muito curto."), tipo: z.enum(["SIM_NAO", "TEXTO", "NUMERO"]), obrigatorio: z.boolean() }))
  .min(1, "Inclua ao menos um item.")
  .refine((l) => new Set(l.map((i) => i.id)).size === l.length, "IDs de item repetidos.");

export async function salvarChecklist(_: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  return acaoAdmin("/admin/checklists", async (u) => {
    const id = txtOuNulo(f, "id");
    const nome = obrigatorio(f, "nome", "o nome");
    let itens;
    try {
      itens = Itens.parse(JSON.parse(txt(f, "itens") || "[]"));
    } catch (e) {
      throw invalido(e instanceof z.ZodError ? e.issues[0].message : "Itens inválidos.", { campo: "itens" });
    }
    const data = { nome, itens: itens as unknown as Prisma.InputJsonValue };
    if (id) {
      const antes = await prisma.checklistModelo.findFirst({ where: { id, organizacao_id: organizacaoDoAdmin(u) } });
      if (!antes) throw naoEncontrado("Checklist não encontrado.");
      await prisma.$transaction(async (tx) => {
        const c = await tx.checklistModelo.update({ where: { id }, data });
        await auditar({ usuario_id: u.id, acao: "EDITAR", entidade: "checklist_modelo", entidade_id: id, antes, depois: c }, tx);
      });
      return "Checklist salvo. (Checklists já preenchidos mantêm suas respostas.)";
    }
    const c = await prisma.$transaction(async (tx) => {
      const c = await tx.checklistModelo.create({ data: { ...data, organizacao_id: organizacaoDoAdmin(u), created_by: u.id } });
      await auditar({ usuario_id: u.id, acao: "CRIAR", entidade: "checklist_modelo", entidade_id: c.id, depois: c }, tx);
      return c;
    });
    return { mensagem: "Checklist criado.", extra: { link: `/admin/checklists/${c.id}` } };
  });
}
