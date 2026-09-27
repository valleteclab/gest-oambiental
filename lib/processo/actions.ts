"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { getUsuario } from "../auth";
import { ErroApi } from "../http";
import { prisma } from "../db";
import { transicionar } from "./transicionar";
import { salvarChecklist } from "./checklist";
import { salvarRascunho } from "./rascunho";
import { removerAnexoRascunho } from "./anexos";
import { obterProcessoAutorizado } from "./consultas";
import { emitirPdfParecer, emitirRecibo, tentarEmitir } from "./documentos";
import { ROTULO_ACAO, normalizarAcao } from "./maquina";

// Server Actions do módulo de processo (interno e requerente). Sempre revalidam a permissão no servidor.

export type EstadoAcao = { ok?: boolean; mensagem?: string; avisos?: string[]; erro?: string; campos?: Record<string, string>; id?: string } | undefined;

function traduzirErro(e: unknown): EstadoAcao {
  if (e instanceof ErroApi) return { erro: e.message };
  if (e instanceof ZodError) {
    const campos: Record<string, string> = {};
    for (const i of e.issues) campos[i.path.join(".") || "_"] ??= i.message;
    return { erro: e.issues.map((i) => i.message).filter((m, n, a) => a.indexOf(m) === n).join(" "), campos };
  }
  console.error(e);
  return { erro: "Erro inesperado. Tente novamente." };
}

function revalidar(processoId: string) {
  revalidatePath(`/processos/${processoId}`);
  revalidatePath(`/meus-processos/${processoId}`);
  revalidatePath("/processos");
  revalidatePath("/meus-processos");
  revalidatePath("/caixa");
}

/** Executa uma ação da máquina de estados. O formulário envia `payload` (JSON). */
export async function executarAcaoProcesso(processoId: string, acao: string, _prev: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const u = await getUsuario();
  if (!u) return { erro: "Sessão expirada. Entre novamente." };
  let payload: unknown = {};
  try {
    payload = JSON.parse(String(form.get("payload") ?? "{}") || "{}");
  } catch {
    return { erro: "Dados do formulário inválidos." };
  }
  try {
    const r = await transicionar(processoId, acao, payload, u);
    revalidar(processoId);
    const a = normalizarAcao(acao);
    return { ok: true, mensagem: `${a ? ROTULO_ACAO[a] : "Ação"}: concluído.${r.processo.numero ? ` Processo ${r.processo.numero}.` : ""}`, avisos: r.avisos, id: r.processo.id };
  } catch (e) {
    return traduzirErro(e);
  }
}

export async function salvarChecklistAcao(processoId: string, _prev: EstadoAcao, form: FormData): Promise<EstadoAcao> {
  const u = await getUsuario();
  if (!u) return { erro: "Sessão expirada. Entre novamente." };
  const respostas: Record<string, unknown> = {};
  for (const [k, v] of form.entries()) if (k.startsWith("item:") && typeof v === "string") respostas[k.slice(5)] = v;
  try {
    await salvarChecklist(processoId, respostas, u);
    revalidar(processoId);
    return { ok: true, mensagem: "Checklist salvo." };
  } catch (e) {
    return traduzirErro(e);
  }
}

/** Salva o rascunho do wizard (passos 1–3). Retorna o id do processo. */
export async function salvarRascunhoAcao(dados: unknown): Promise<EstadoAcao> {
  const u = await getUsuario();
  if (!u) return { erro: "Sessão expirada. Entre novamente." };
  try {
    const p = await salvarRascunho(dados, u);
    revalidatePath("/meus-processos");
    return { ok: true, id: p.id };
  } catch (e) {
    return traduzirErro(e);
  }
}

export async function removerAnexoAcao(anexoId: string): Promise<EstadoAcao> {
  const u = await getUsuario();
  if (!u) return { erro: "Sessão expirada. Entre novamente." };
  try {
    await removerAnexoRascunho(anexoId, u);
    return { ok: true };
  } catch (e) {
    return traduzirErro(e);
  }
}

/** Nova tentativa de gerar o recibo de protocolo (quando a emissão falhou). */
export async function gerarReciboAcao(processoId: string): Promise<EstadoAcao> {
  const u = await getUsuario();
  if (!u) return { erro: "Sessão expirada. Entre novamente." };
  try {
    const p = await obterProcessoAutorizado(processoId, u);
    if (!p.numero) return { erro: "O processo ainda não foi protocolado." };
    const r = await tentarEmitir(() => emitirRecibo(p.id, u));
    revalidar(processoId);
    return r.ok ? { ok: true, mensagem: "Recibo gerado." } : { erro: `Não foi possível gerar o recibo: ${r.erro}` };
  } catch (e) {
    return traduzirErro(e);
  }
}

/** Nova tentativa de gerar o PDF do parecer. */
export async function gerarPdfParecerAcao(processoId: string, parecerId: string): Promise<EstadoAcao> {
  const u = await getUsuario();
  if (!u) return { erro: "Sessão expirada. Entre novamente." };
  try {
    const p = await obterProcessoAutorizado(processoId, u);
    const par = await prisma.parecer.findFirst({ where: { id: parecerId, processo_id: p.id } });
    if (!par) return { erro: "Parecer não encontrado." };
    if (par.autor_id !== u.id && !u.papeis.some((x) => ["ADMIN", "TEC_CONSORCIO", "TEC_MUNICIPAL", "GESTOR_MUNICIPAL"].includes(x.papel))) return { erro: "Sem permissão." };
    const r = await tentarEmitir(() => emitirPdfParecer(par.id, u));
    revalidar(processoId);
    return r.ok ? { ok: true, mensagem: "PDF do parecer gerado." } : { erro: `Não foi possível gerar o PDF: ${r.erro}` };
  } catch (e) {
    return traduzirErro(e);
  }
}
