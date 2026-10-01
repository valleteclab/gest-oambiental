"use server";
import { randomBytes } from "node:crypto";
import type { ConfigCobranca } from "@prisma/client";
import { prisma } from "@/lib/db";
import { auditar } from "@/lib/audit";
import { cifrar, decifrar } from "@/lib/crypto";
import { invalido } from "@/lib/http";
import { acaoAdmin, bool, decOuNulo, int, obrigatorio, txt, txtOuNulo } from "@/lib/admin/acao";
import type { EstadoAcao } from "@/lib/admin/guard";
import { exigirMunicipioDoAdmin } from "@/lib/admin/escopo";
import { chaveSandbox, mascararChave } from "@/lib/cobranca/regras";
import { registrarWebhook, runtimeAsaas, testarConexao } from "@/lib/cobranca/asaas";
import { sincronizarPendentes } from "@/lib/cobranca/servico";
import { urlWebhookAsaas } from "@/lib/cobranca/webhook-url";

// Configuração da cobrança por município (conta Asaas da prefeitura). A chave da API é SOMENTE ESCRITA:
// cifrada (cifrar) ao salvar e nunca devolvida – a tela mostra só "••••1234".

const CAMINHO = "/admin/cobranca";

/** Config para auditoria/tela sem segredos. */
function semSegredos(c: ConfigCobranca | null) {
  if (!c) return null;
  const { asaas_api_key_cifrada, asaas_webhook_token, ...resto } = c;
  return { ...resto, chave: mascararChave(decifrar(asaas_api_key_cifrada)), webhook_token: asaas_webhook_token ? mascararChave(asaas_webhook_token) : null };
}

const novoToken = () => randomBytes(24).toString("hex");

async function municipioDoForm(u: Parameters<typeof exigirMunicipioDoAdmin>[0], f: FormData): Promise<string> {
  const municipio_id = obrigatorio(f, "municipio_id", "o município");
  await exigirMunicipioDoAdmin(u, municipio_id);
  return municipio_id;
}

export async function salvarConfigCobranca(_: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  return acaoAdmin(CAMINHO, async (u) => {
    const municipio_id = await municipioDoForm(u, f);
    const antes = await prisma.configCobranca.findUnique({ where: { municipio_id } });
    const gateway = txt(f, "gateway") === "MANUAL" ? "MANUAL" : "ASAAS";
    const chave = txt(f, "asaas_api_key");
    if (chave && (chave.length < 20 || /\s/.test(chave))) throw invalido("Chave da API do Asaas inválida (copie a chave completa em Integrações → Chave de API).", { campo: "asaas_api_key" });
    const remover = bool(f, "remover_chave");
    const instrucoes = txtOuNulo(f, "instrucoes");
    if (instrucoes && instrucoes.length > 1000) throw invalido("Instruções: máximo de 1000 caracteres.", { campo: "instrucoes" });
    const ativo = bool(f, "ativo");
    const dados = {
      ativo,
      gateway: gateway as ConfigCobranca["gateway"],
      // Chave nova: o prefixo decide o ambiente (…_hmlg_… = sandbox); sem chave nova vale a opção da tela.
      asaas_sandbox: chave ? chaveSandbox(chave) : bool(f, "asaas_sandbox"),
      dias_vencimento: int(f, "dias_vencimento", 1, 90),
      exige_pagamento: bool(f, "exige_pagamento"),
      multa_percentual: decOuNulo(f, "multa_percentual", 0, 2),
      juros_mensal_percentual: decOuNulo(f, "juros_mensal_percentual", 0, 1),
      instrucoes,
      ...(chave ? { asaas_api_key_cifrada: cifrar(chave) } : remover ? { asaas_api_key_cifrada: null } : {}),
      ...(ativo && !antes?.asaas_webhook_token ? { asaas_webhook_token: novoToken() } : {}),
    };
    await prisma.$transaction(async (tx) => {
      const depois = await tx.configCobranca.upsert({ where: { municipio_id }, update: dados, create: { ...dados, municipio_id, created_by: u.id } });
      await auditar({ usuario_id: u.id, acao: antes ? "EDITAR" : "CRIAR", entidade: "config_cobranca", entidade_id: depois.id, antes: semSegredos(antes), depois: { ...semSegredos(depois), chave_alterada: !!chave || remover } }, tx);
    });
    return chave ? `Configuração salva. Chave ${mascararChave(chave)} (${chaveSandbox(chave) ? "sandbox" : "produção"}) armazenada cifrada.` : "Configuração salva.";
  });
}

export async function gerarTokenWebhook(_: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  return acaoAdmin(CAMINHO, async (u) => {
    const municipio_id = await municipioDoForm(u, f);
    const token = novoToken();
    await prisma.$transaction(async (tx) => {
      const antes = await tx.configCobranca.findUnique({ where: { municipio_id } });
      const depois = await tx.configCobranca.upsert({ where: { municipio_id }, update: { asaas_webhook_token: token }, create: { municipio_id, asaas_webhook_token: token, created_by: u.id } });
      await auditar({ usuario_id: u.id, acao: "GERAR_TOKEN_WEBHOOK", entidade: "config_cobranca", entidade_id: depois.id, antes: semSegredos(antes), depois: semSegredos(depois) }, tx);
    });
    return "Novo token gerado. Atualize (ou registre novamente) o webhook no Asaas – o token anterior deixa de valer.";
  });
}

export async function testarConexaoAsaas(_: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  return acaoAdmin(CAMINHO, async (u) => {
    const municipio_id = await municipioDoForm(u, f);
    const cfg = await prisma.configCobranca.findUnique({ where: { municipio_id } });
    const rt = cfg ? runtimeAsaas(cfg) : null;
    if (!rt) throw invalido("Salve a chave da API do Asaas antes de testar a conexão.");
    try {
      const r = await testarConexao(rt);
      await auditar({ usuario_id: u.id, acao: "TESTAR_CONEXAO_ASAAS", entidade: "config_cobranca", entidade_id: cfg!.id, depois: { ok: true, ambiente: r.ambiente } });
      return `Conexão OK – ${r.conta} (${r.ambiente})${r.saldo !== null ? ` · saldo ${r.saldo.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : ""}.`;
    } catch (e) {
      await auditar({ usuario_id: u.id, acao: "TESTAR_CONEXAO_ASAAS", entidade: "config_cobranca", entidade_id: cfg!.id, depois: { ok: false, erro: (e as Error).message } });
      throw invalido(`Falha na conexão com o Asaas: ${(e as Error).message}`);
    }
  });
}

export async function registrarWebhookAsaas(_: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  return acaoAdmin(CAMINHO, async (u) => {
    const municipio_id = await municipioDoForm(u, f);
    const cfg = await prisma.configCobranca.findUnique({ where: { municipio_id }, include: { municipio: { select: { nome: true, email: true } } } });
    const rt = cfg ? runtimeAsaas(cfg) : null;
    if (!cfg || !rt) throw invalido("Salve a chave da API do Asaas antes de registrar o webhook.");
    if (!cfg.asaas_webhook_token) throw invalido("Gere o token do webhook primeiro.");
    const url = urlWebhookAsaas(cfg.asaas_webhook_token);
    if (!url.startsWith("https://")) throw invalido(`O Asaas só aceita webhook em HTTPS público. APP_URL atual: ${url.split("/api/")[0]}.`);
    try {
      await registrarWebhook(rt, { url, token: cfg.asaas_webhook_token, email: cfg.municipio.email || u.email, nome: `LicenciaGov – ${cfg.municipio.nome}` });
    } catch (e) {
      throw invalido(`O Asaas recusou o webhook: ${(e as Error).message}`);
    }
    await auditar({ usuario_id: u.id, acao: "REGISTRAR_WEBHOOK_ASAAS", entidade: "config_cobranca", entidade_id: cfg.id, depois: { url: url.replace(cfg.asaas_webhook_token, "••••") } });
    return "Webhook registrado no Asaas (eventos de pagamento, vencimento, remoção e estorno).";
  });
}

export async function sincronizarAgora(_: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  return acaoAdmin([CAMINHO, "/financeiro"], async (u) => {
    const municipio_id = await municipioDoForm(u, f);
    const r = await sincronizarPendentes({ municipio_id });
    return `Sincronização concluída: ${r.verificadas} verificada(s), ${r.pagas} paga(s), ${r.vencidas} vencida(s), ${r.canceladas} cancelada(s), ${r.registradas} registrada(s) no gateway${r.erros ? `, ${r.erros} erro(s)` : ""}.`;
  });
}
