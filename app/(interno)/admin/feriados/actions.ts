"use server";
import { prisma } from "@/lib/db";
import { auditar } from "@/lib/audit";
import { invalido } from "@/lib/http";
import { acaoAdmin, obrigatorio, txtOuNulo } from "@/lib/admin/acao";
import type { EstadoAcao } from "@/lib/admin/guard";
import { exigirMunicipioDoAdmin, organizacaoDoAdmin } from "@/lib/admin/escopo";
import { naoEncontrado } from "@/lib/http";

export async function adicionarFeriado(_: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  return acaoAdmin("/admin/feriados", async (u) => {
    const data = obrigatorio(f, "data", "a data");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw invalido("Data inválida.", { campo: "data" });
    const municipio_id = txtOuNulo(f, "municipio_id");
    // Feriados nacionais (sem município) são da plataforma e valem para todos os clientes: o ADMIN da
    // organização cadastra feriados dos SEUS municípios.
    if (!municipio_id) throw invalido("Selecione o município (feriados nacionais são mantidos pela plataforma).", { campo: "municipio_id" });
    await exigirMunicipioDoAdmin(u, municipio_id);
    const d = new Date(`${data}T00:00:00Z`);
    if (await prisma.feriado.findFirst({ where: { data: d, municipio_id } })) throw invalido("Já existe feriado nesta data para este escopo.");
    await prisma.$transaction(async (tx) => {
      const r = await tx.feriado.create({ data: { data: d, descricao: obrigatorio(f, "descricao", "a descrição"), municipio_id, created_by: u.id } });
      await auditar({ usuario_id: u.id, acao: "CRIAR", entidade: "feriado", entidade_id: r.id, depois: r }, tx);
    });
    return "Feriado cadastrado.";
  });
}

export async function removerFeriado(_: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  return acaoAdmin("/admin/feriados", async (u) => {
    const id = obrigatorio(f, "id", "o feriado");
    const antes = await prisma.feriado.findFirst({ where: { id, municipio: { organizacao_id: organizacaoDoAdmin(u) } } });
    if (!antes) throw naoEncontrado("Feriado não encontrado (feriados nacionais não podem ser removidos pelo órgão).");
    await prisma.$transaction(async (tx) => {
      await tx.feriado.delete({ where: { id } });
      await auditar({ usuario_id: u.id, acao: "REMOVER", entidade: "feriado", entidade_id: id, antes }, tx);
    });
    return "Feriado removido.";
  });
}
