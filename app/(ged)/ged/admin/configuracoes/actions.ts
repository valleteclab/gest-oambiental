"use server";
import { revalidatePath } from "next/cache";
import { comoEstadoForm, type EstadoFormGed } from "@/lib/ged/acoes";
import { salvarConfiguracoes } from "@/lib/ged/admin/configuracoes";
import { ctxGedApi } from "@/lib/ged/escopo";
import { salvarConfigCompartilhamento } from "@/lib/ged/compartilhamento/servico";
import { atualizarAssunto, criarAssunto, definirAssuntoAtivo, excluirAssunto, salvarConfigProtocolo } from "@/lib/ged/protocolo/config";

export async function salvarConfiguracoesAction(_: EstadoFormGed, f: FormData) {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    await salvarConfiguracoes(ctx, {
      assinatura_prazo_dias: String(f.get("assinatura_prazo_dias") ?? ""),
      lembrete_dias: String(f.get("lembrete_dias") ?? ""),
      retencao_acesso_log_dias: String(f.get("retencao_acesso_log_dias") ?? ""),
      cota_gb: String(f.get("cota_gb") ?? "").replace(",", "."),
      ocr_cota_paginas_mes: String(f.get("ocr_cota_paginas_mes") ?? "").trim(),
    });
    revalidatePath("/ged/admin/configuracoes");
    return "Configurações salvas.";
  });
}

const txt = (f: FormData, k: string) => String(f.get(k) ?? "");
const assuntoDe = (f: FormData) => ({
  nome: txt(f, "nome"), descricao: txt(f, "descricao"), destino_setor_id: txt(f, "destino_setor_id"), tipo_documento_id: txt(f, "tipo_documento_id"),
  prioridade: txt(f, "prioridade"), prazo_dias: txt(f, "prazo_dias"), ordem: txt(f, "ordem"),
});

/** Protocolo online: liga/desliga, endereço público, orientação, limites de anexos e responsável. */
export async function salvarProtocoloAction(_: EstadoFormGed, f: FormData) {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    await salvarConfigProtocolo(ctx, {
      portal_ativo: f.get("portal_ativo") === "on", slug: txt(f, "slug"), orientacao: txt(f, "orientacao"),
      max_anexos: txt(f, "max_anexos"), max_mb: txt(f, "max_mb"), responsavel_id: txt(f, "responsavel_id"),
    });
    revalidatePath("/ged/admin/configuracoes");
    return "Configuração do protocolo online salva.";
  });
}

export async function criarAssuntoAction(_: EstadoFormGed, f: FormData) {
  return comoEstadoForm(async () => {
    await criarAssunto(await ctxGedApi(), assuntoDe(f));
    revalidatePath("/ged/admin/configuracoes");
    return "Assunto cadastrado.";
  });
}

export async function atualizarAssuntoAction(_: EstadoFormGed, f: FormData) {
  return comoEstadoForm(async () => {
    await atualizarAssunto(await ctxGedApi(), txt(f, "id"), assuntoDe(f));
    revalidatePath("/ged/admin/configuracoes");
    return "Assunto atualizado.";
  });
}

export async function alternarAssuntoAction(_: EstadoFormGed, f: FormData) {
  return comoEstadoForm(async () => {
    await definirAssuntoAtivo(await ctxGedApi(), txt(f, "id"), txt(f, "ativo") === "true");
    revalidatePath("/ged/admin/configuracoes");
    return txt(f, "ativo") === "true" ? "Assunto ativado." : "Assunto desativado.";
  });
}

export async function excluirAssuntoAction(_: EstadoFormGed, f: FormData) {
  return comoEstadoForm(async () => {
    await excluirAssunto(await ctxGedApi(), txt(f, "id"));
    revalidatePath("/ged/admin/configuracoes");
    return "Assunto excluído.";
  });
}

/** Compartilhamento externo por link + OTP no WhatsApp: liga/desliga, validade padrão e teto (máx. 30 dias) e aviso no 1º acesso. */
export async function salvarCompartilhamentoAction(_: EstadoFormGed, f: FormData) {
  return comoEstadoForm(async () => {
    const ctx = await ctxGedApi();
    await salvarConfigCompartilhamento(ctx, {
      ativo: f.get("ativo") === "on",
      validade_padrao_dias: Number(String(f.get("validade_padrao_dias") ?? "")),
      validade_max_dias: Number(String(f.get("validade_max_dias") ?? "")),
      notificar_acesso: f.get("notificar_acesso") === "on",
    });
    revalidatePath("/ged/admin/configuracoes");
    return "Configuração do compartilhamento externo salva.";
  });
}
