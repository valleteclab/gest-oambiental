"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { getUsuario } from "../auth";
import { ErroApi, invalido } from "../http";
import { prisma } from "../db";
import { salvarChecklist } from "../processo/checklist";
import { transicionar } from "../processo/transicionar";
import { obterProcessoAutorizado } from "../processo/consultas";
import { itensChecklistPendentes, lerItensChecklist } from "../processo/maquina";
import { ehDemandaUrbana, resumoVistoriaPoda } from "./catalogo";

// Ações rápidas das demandas urbanas (/demandas). Cada passo usa os serviços normais (checklist + máquina de estados),
// com a mesma checagem de permissão, tramitação e auditoria de qualquer processo.

export type EstadoDemanda = { ok?: boolean; erro?: string; mensagem?: string } | undefined;

function erroTexto(e: unknown): string {
  if (e instanceof ErroApi) return e.message;
  if (e instanceof ZodError) return e.issues.map((i) => i.message).join(" ");
  console.error(e);
  return "Erro inesperado. Tente novamente.";
}

/**
 * Vistoria de campo em um passo (celular): salva o checklist e, com os itens obrigatórios completos, registra a vistoria
 * na máquina de estados (agendar → concluir, se ainda em análise; ou só concluir, se já agendada).
 */
export async function registrarVistoriaDemanda(processoId: string, _prev: EstadoDemanda, form: FormData): Promise<EstadoDemanda> {
  const u = await getUsuario();
  if (!u) return { erro: "Sessão expirada. Entre novamente." };
  try {
    const p = await obterProcessoAutorizado(processoId, u);
    if (!ehDemandaUrbana(p.tipo_ato.sigla) || !p.tipo_ato.exige_vistoria) throw invalido("Este tipo de ato não prevê vistoria simplificada.");
    if (p.status !== "EM_ANALISE" && p.status !== "AGUARDANDO_VISTORIA") throw invalido("A vistoria é registrada durante a análise (aceite o processo na triagem antes).");
    const respostas: Record<string, unknown> = {};
    for (const [k, v] of form.entries()) if (k.startsWith("item:") && typeof v === "string") respostas[k.slice(5)] = v;
    await salvarChecklist(p.id, respostas, u);

    const modelo = p.tipo_ato.checklist_modelo;
    const salvo = modelo ? await prisma.checklistPreenchido.findFirst({ where: { processo_id: p.id, checklist_modelo_id: modelo.id }, orderBy: { updated_at: "desc" } }) : null;
    const r = (salvo?.respostas as Record<string, unknown>) ?? {};
    const faltando = modelo ? itensChecklistPendentes(lerItensChecklist(modelo.itens), r) : [];
    if (faltando.length) {
      revalidar(p.id);
      return { erro: `Checklist salvo. Para concluir a vistoria, preencha: ${faltando.map((i) => i.texto).join("; ")}.` };
    }
    const v = resumoVistoriaPoda(r);
    const relatoLivre = String(form.get("relato") ?? "").trim();
    const relato = [
      `Vistoria realizada em campo (${p.tipo_ato.sigla}).`,
      v.especie ? `Espécie: ${v.especie}.` : "",
      v.dap_cm !== null ? `DAP ${v.dap_cm} cm; altura ${v.altura_m ?? "?"} m.` : "",
      v.fitossanidade ? `Estado fitossanitário: ${v.fitossanidade}.` : "",
      v.risco ? `Risco: ${v.risco}.` : "",
      v.recomendacao ? `Recomendação: ${v.recomendacao}.` : "",
      v.mudas !== null ? `Compensação: ${v.mudas} muda(s).` : "",
      relatoLivre,
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 5000);
    if (p.status === "EM_ANALISE") await transicionar(p.id, "agendar_vistoria", { data_prevista: new Date(), despacho: "Vistoria de campo da demanda urbana." }, u);
    await transicionar(p.id, "concluir_vistoria", { despacho: relato }, u);
    revalidar(p.id);
    return { ok: true, mensagem: "Vistoria registrada. Processo pronto para a decisão." };
  } catch (e) {
    return { erro: erroTexto(e) };
  }
}

function revalidar(id: string) {
  revalidatePath(`/demandas/${id}`);
  revalidatePath("/demandas");
  revalidatePath(`/processos/${id}`);
}
