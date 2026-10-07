"use server";
// Server Actions do fluxo de assinatura (telas /ged/assinaturas e aba Assinaturas do documento). Cada ação refaz a checagem de
// sessão/módulo (ctxGedApi) e os serviços checam permissão de novo (nunca confie no front).
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { comoEstadoForm, type EstadoFormGed } from "@/lib/ged/acoes";
import { ctxGedApi } from "@/lib/ged/escopo";
import { metaDosCabecalhos } from "@/lib/ged/assinaturas/limites";
import { assinar, cancelarSolicitacao, comentarAssinatura, recusar, solicitarAssinatura, tentarSelar } from "@/lib/ged/assinaturas/servico";

const txt = (f: FormData, k: string) => String(f.get(k) ?? "");
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Revalida só caminhos conhecidos (ids validados como UUID). */
function revalidar(f: FormData, solicitacaoId?: string) {
  revalidatePath("/ged/assinaturas");
  const sol = solicitacaoId ?? txt(f, "solicitacao_id");
  if (RE_UUID.test(sol)) revalidatePath(`/ged/assinaturas/${sol}`);
  const doc = txt(f, "documento_id");
  if (RE_UUID.test(doc)) revalidatePath(`/ged/documentos/${doc}`);
}

export async function solicitarAssinaturaAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    const r = await solicitarAssinatura(ctx, {
      documento_id: txt(f, "documento_id"),
      signatarios: f.getAll("signatarios").map(String),
      modo: txt(f, "modo"),
      prazo_dias: txt(f, "prazo_dias") || undefined,
      mensagem: txt(f, "mensagem") || undefined,
    });
    revalidar(f, r.id);
    return "Solicitação enviada. Os signatários foram avisados.";
  });
}

export async function assinarAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    const r = await assinar(ctx, { solicitacao_id: txt(f, "solicitacao_id"), senha: txt(f, "senha"), consentimento: f.get("consentimento") === "on" }, metaDosCabecalhos(await headers()));
    revalidar(f);
    if (r.aviso_selo) return r.aviso_selo;
    return r.concluida ? "Assinatura registrada. Todas as assinaturas foram concluídas e o documento foi selado." : "Assinatura registrada.";
  });
}

export async function recusarAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    await recusar(ctx, { solicitacao_id: txt(f, "solicitacao_id"), justificativa: txt(f, "justificativa") }, metaDosCabecalhos(await headers()));
    revalidar(f);
    return "Recusa registrada. O autor foi avisado.";
  });
}

export async function cancelarAssinaturaAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    await cancelarSolicitacao(ctx, { solicitacao_id: txt(f, "solicitacao_id"), motivo: txt(f, "motivo") || undefined });
    revalidar(f);
    return "Solicitação cancelada.";
  });
}

export async function comentarAssinaturaAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    await comentarAssinatura(ctx, { solicitacao_id: txt(f, "solicitacao_id"), texto: txt(f, "texto") });
    revalidar(f);
    return "Comentário registrado.";
  });
}

export async function tentarSelarAction(_: EstadoFormGed, f: FormData): Promise<EstadoFormGed> {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    await tentarSelar(ctx, txt(f, "solicitacao_id"));
    revalidar(f);
    return "Documento selado.";
  });
}
