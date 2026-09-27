import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { auditar } from "../audit";
import { invalido, proibido } from "../http";
import { can, isSomenteLeitura, type UsuarioSessao } from "../rbac";
import { lerItensChecklist } from "./maquina";
import { obterProcessoAutorizado } from "./consultas";

// Checklist de análise (checklist_modelo.itens do tipo de ato). Obrigatórios são exigidos antes do parecer.

export const STATUS_CHECKLIST_EDITAVEL = ["EM_TRIAGEM", "EM_ANALISE", "AGUARDANDO_VISTORIA", "AGUARDANDO_REQUERENTE"] as const;

export function podeEditarChecklist(u: UsuarioSessao, p: { municipio_id: string; status: string }) {
  return !isSomenteLeitura(u) && can(u, "analisar", "processo", p.municipio_id) && (STATUS_CHECKLIST_EDITAVEL as readonly string[]).includes(p.status);
}

export async function salvarChecklist(processoId: string, respostasBrutas: Record<string, unknown>, u: UsuarioSessao) {
  const p = await obterProcessoAutorizado(processoId, u);
  if (!podeEditarChecklist(u, p)) throw proibido("Você não pode editar o checklist deste processo agora.");
  const modelo = p.tipo_ato.checklist_modelo;
  if (!modelo) throw invalido("Este tipo de ato não possui checklist.");
  const itens = lerItensChecklist(modelo.itens);
  const respostas: Record<string, string | number | null> = {};
  for (const i of itens) {
    const v = respostasBrutas[i.id];
    if (v === undefined || v === null || String(v).trim() === "") {
      respostas[i.id] = null;
      continue;
    }
    const s = String(v).trim();
    if (i.tipo === "NUMERO") {
      const n = Number(s.replace(",", "."));
      if (!Number.isFinite(n)) throw invalido(`Valor numérico inválido em "${i.texto}".`);
      respostas[i.id] = n;
    } else if (i.tipo === "SIM_NAO") {
      if (!["SIM", "NAO", "NA"].includes(s)) throw invalido(`Resposta inválida em "${i.texto}".`);
      respostas[i.id] = s;
    } else respostas[i.id] = s.slice(0, 5000);
  }
  return prisma.$transaction(async (tx) => {
    const atual = await tx.checklistPreenchido.findFirst({ where: { processo_id: p.id, checklist_modelo_id: modelo.id } });
    const reg = atual
      ? await tx.checklistPreenchido.update({ where: { id: atual.id }, data: { respostas: respostas as Prisma.InputJsonValue, preenchido_por: u.id } })
      : await tx.checklistPreenchido.create({ data: { processo_id: p.id, checklist_modelo_id: modelo.id, respostas: respostas as Prisma.InputJsonValue, preenchido_por: u.id, created_by: u.id } });
    await auditar({ usuario_id: u.id, acao: atual ? "EDITAR" : "CRIAR", entidade: "checklist_preenchido", entidade_id: reg.id, antes: atual?.respostas, depois: { processo_id: p.id, respostas } }, tx);
    return reg;
  });
}
