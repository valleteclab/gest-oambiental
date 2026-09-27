"use server";
import { prisma } from "@/lib/db";
import { auditar } from "@/lib/audit";
import { invalido } from "@/lib/http";
import { acaoAdmin, bool, int, obrigatorio, txtOuNulo } from "@/lib/admin/acao";
import type { EstadoAcao } from "@/lib/admin/guard";

const ETAPAS = ["TRIAGEM", "ANALISE_CURTA", "ANALISE_LONGA", "PENDENCIA", "VISTORIA", "DECISAO"];

export async function salvarPrazo(_: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  return acaoAdmin("/admin/prazos", async (u) => {
    const id = txtOuNulo(f, "id");
    const dados = { dias: int(f, "dias", 1, 720), dias_alerta: int(f, "dias_alerta", 0, 365), conta_dias_uteis: bool(f, "conta_dias_uteis") };
    if (dados.dias_alerta >= dados.dias) throw invalido("Os dias de alerta devem ser menores que o prazo.", { campo: "dias_alerta" });
    if (id) {
      const antes = await prisma.prazoConfig.findUniqueOrThrow({ where: { id } });
      await prisma.$transaction(async (tx) => {
        const p = await tx.prazoConfig.update({ where: { id }, data: dados });
        await auditar({ usuario_id: u.id, acao: "EDITAR", entidade: "prazo_config", entidade_id: id, antes, depois: p }, tx);
      });
      return "Prazo atualizado (vale para novas etapas; prazos em curso não são recalculados).";
    }
    const etapa = obrigatorio(f, "etapa", "a etapa");
    if (!ETAPAS.includes(etapa)) throw invalido("Etapa inválida.", { campo: "etapa" });
    const municipio_id = txtOuNulo(f, "municipio_id");
    const org = await prisma.organizacao.findFirstOrThrow();
    if (await prisma.prazoConfig.findFirst({ where: { organizacao_id: org.id, etapa, municipio_id } })) throw invalido("Já existe configuração para esta etapa neste escopo – edite-a na tabela.");
    await prisma.$transaction(async (tx) => {
      const p = await tx.prazoConfig.create({ data: { ...dados, etapa, municipio_id, organizacao_id: org.id, created_by: u.id } });
      await auditar({ usuario_id: u.id, acao: "CRIAR", entidade: "prazo_config", entidade_id: p.id, depois: p }, tx);
    });
    return "Configuração de prazo criada.";
  });
}

export async function removerPrazo(_: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  return acaoAdmin("/admin/prazos", async (u) => {
    const id = obrigatorio(f, "id", "o prazo");
    const antes = await prisma.prazoConfig.findUniqueOrThrow({ where: { id } });
    if (!antes.municipio_id) throw invalido("O prazo padrão da organização não pode ser removido – apenas editado.");
    await prisma.$transaction(async (tx) => {
      await tx.prazoConfig.delete({ where: { id } });
      await auditar({ usuario_id: u.id, acao: "REMOVER", entidade: "prazo_config", entidade_id: id, antes }, tx);
    });
    return "Exceção municipal removida – passa a valer o padrão da organização.";
  });
}
