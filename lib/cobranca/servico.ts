import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { Cobranca, ConfigCobranca, FaseCobranca, Prisma, StatusCobranca } from "@prisma/client";
import QRCode from "qrcode";
import { prisma } from "../db";
import { auditar, registrarAuditoria } from "../audit";
import { decifrar, somenteDigitos } from "../crypto";
import { enviarEmail } from "../email";
import { esc } from "../pdf";
import { fmtDataCivil, fmtMoeda } from "../format";
import { ErroApi, invalido, naoEncontrado, proibido } from "../http";
import { proximoNumero } from "../numeracao";
import { can, isInterno, isSomenteLeitura, type UsuarioSessao } from "../rbac";
import { ehTitular } from "../processo/maquina";
import { ehDemandaUrbana } from "../demandas/catalogo";
import { nomeSeguro, salvarUpload, validarUpload } from "../storage";
import { consultarPagamento, criarCobranca as criarNoAsaas, ErroAsaas, garantirCliente, removerCobranca, runtimeAsaas } from "./asaas";
import {
  calcularTaxa,
  dataIso,
  dataPagamento,
  dataVencimento,
  decidirTransicao,
  ehSimulada,
  faseGeradaPor,
  fasesQueBloqueiam,
  formaDoAsaas,
  LINHA_SIMULADA,
  lerEventoAsaas,
  mensagemBloqueio,
  pixSimulado,
  PREFIXO_SIMULADO,
  resumoTaxas,
  rotuloForma,
  rotuloTaxa,
  statusDoAsaas,
  statusDoEvento,
  STATUS_EM_ABERTO,
  venceu,
} from "./regras";

// Cobrança de taxas de licenciamento (Pix/boleto via Asaas) – docs/cobranca.md.
// Sem config_cobranca ATIVA no município → nenhuma cobrança é gerada e o fluxo do processo não muda.
// Chamadas HTTP ao gateway acontecem SEMPRE fora das transações do processo (pós-commit).

type Tx = Prisma.TransactionClient;
type Cliente = Tx | typeof prisma;

const n = (v: { toString(): string } | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v.toString()));

// ───────────── Configuração / modo do gateway ─────────────

/** PAGAMENTOS_SIMULADO=true: nunca chama o Asaas (homologação/E2E) – Pix/linha fictícios + "Simular pagamento". */
export const pagamentosSimulados = () => process.env.PAGAMENTOS_SIMULADO === "true";

export type ModoGateway = "ASAAS" | "SIMULADO" | "MANUAL" | "SEM_CHAVE";

/** Como a cobrança é registrada: Asaas real, simulado (sandbox sem chave ou PAGAMENTOS_SIMULADO), só guia (MANUAL). */
export function modoGateway(cfg: Pick<ConfigCobranca, "gateway" | "asaas_api_key_cifrada" | "asaas_sandbox">): ModoGateway {
  if (cfg.gateway === "MANUAL") return "MANUAL";
  if (pagamentosSimulados()) return "SIMULADO";
  if (!cfg.asaas_api_key_cifrada) return cfg.asaas_sandbox ? "SIMULADO" : "SEM_CHAVE";
  return "ASAAS";
}

/** Configuração ATIVA de cobrança do município (null = cobrança desligada). */
export async function configAtiva(municipioId: string, db: Cliente = prisma): Promise<ConfigCobranca | null> {
  const cfg = await db.configCobranca.findUnique({ where: { municipio_id: municipioId } });
  return cfg?.ativo ? cfg : null;
}

// ───────────── Permissões ─────────────

/** Servidor com escopo no município pode ver as cobranças (SEMA/INEMA: só leitura). */
export const podeVerCobrancas = (u: UsuarioSessao, municipioId: string) => isInterno(u) && can(u, "ver", "cobranca", municipioId);
/** Baixa manual, isenção, cancelamento, nova tentativa, reenvio: ADMIN e GESTOR_MUNICIPAL do município. */
export const podeGerirCobrancas = (u: UsuarioSessao, municipioId: string) => !isSomenteLeitura(u) && can(u, "editar", "cobranca", municipioId);

type CobrancaComProcesso = Cobranca & { processo: { id: string; numero: string | null; requerente_id: string; rt: { pessoa_id: string } | null } | null };

async function carregar(id: string, db: Cliente = prisma): Promise<CobrancaComProcesso> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw naoEncontrado("Cobrança não encontrada.");
  const c = await db.cobranca.findUnique({ where: { id }, include: { processo: { select: { id: true, numero: true, requerente_id: true, rt: { select: { pessoa_id: true } } } } } });
  if (!c) throw naoEncontrado("Cobrança não encontrada.");
  return c;
}

/** Cobrança visível ao usuário (servidor do município ou titular do processo). 404/403. */
export async function obterCobrancaAutorizada(id: string, u: UsuarioSessao): Promise<CobrancaComProcesso> {
  const c = await carregar(id);
  const titular = !!c.processo && ehTitular(u, { requerente_id: c.processo.requerente_id, rt_pessoa_id: c.processo.rt?.pessoa_id });
  if (!podeVerCobrancas(u, c.municipio_id) && !titular) throw proibido("Você não tem acesso a esta cobrança.");
  return c;
}

async function exigirGestao(id: string, u: UsuarioSessao): Promise<CobrancaComProcesso> {
  const c = await carregar(id);
  if (!podeGerirCobrancas(u, c.municipio_id)) throw proibido("Seu perfil não pode alterar cobranças deste município.");
  return c;
}

// ───────────── Processo: valor_taxa / taxa_paga ─────────────

/** Mantém processo.valor_taxa (soma das não canceladas) e processo.taxa_paga (todas as devidas quitadas). */
export async function atualizarTaxaProcesso(db: Cliente, processoId: string | null) {
  if (!processoId) return;
  const cobs = await db.cobranca.findMany({ where: { processo_id: processoId }, select: { status: true, valor: true } });
  if (!cobs.length) return;
  const r = resumoTaxas(cobs);
  await db.processo.update({ where: { id: processoId }, data: { valor_taxa: r.valor_taxa, taxa_paga: r.taxa_paga } });
}

// ───────────── Geração ─────────────

export type OpcoesGerar = { valor?: number | null; descricao?: string | null };

/**
 * Cria o REGISTRO da cobrança (sem HTTP) dentro da transação: config ativa + linha da tabela de taxas (ou valor
 * informado) → número DAM-{SIGLA}-000001/{ANO}, vencimento (hoje + dias_vencimento). Idempotente por processo+fase
 * (não duplica cobrança não cancelada). null = sem cobrança (config inativa, sem taxa na tabela, taxa única já cobrada).
 */
export async function criarRegistroCobranca(tx: Tx, processoId: string, fase: FaseCobranca, usuario: UsuarioSessao | null, opts: OpcoesGerar = {}): Promise<Cobranca | null> {
  const p = await tx.processo.findUnique({
    where: { id: processoId },
    include: { municipio: { select: { id: true, sigla: true } }, tipo_ato: { select: { sigla: true, nome: true } }, empreendimento: { select: { porte: true, potencial_poluidor: true } } },
  });
  if (!p) throw naoEncontrado("Processo não encontrado.");
  const cfg = await configAtiva(p.municipio_id, tx);
  if (!cfg) return null;
  const existentes = await tx.cobranca.findMany({ where: { processo_id: p.id, status: { not: "CANCELADA" } }, select: { fase: true } });
  if (existentes.some((c) => c.fase === fase)) return null;
  if (fase !== "UNICA" && existentes.some((c) => c.fase === "UNICA")) return null;

  let valor = opts.valor ?? null;
  let descricaoTabela: string | null = null;
  let baseLegal: string | null = null;
  if (valor === null) {
    const linhas = await tx.tabelaTaxa.findMany({ where: { organizacao_id: p.organizacao_id, fase, ativo: true, OR: [{ municipio_id: null }, { municipio_id: p.municipio_id }] } });
    const linha = calcularTaxa(linhas, { municipio_id: p.municipio_id, tipo_ato_id: p.tipo_ato_id, porte: p.empreendimento.porte, potencial: p.empreendimento.potencial_poluidor }, fase);
    if (!linha) return null;
    valor = n(linha.valor);
    descricaoTabela = linha.descricao ?? null;
    baseLegal = linha.base_legal ?? null;
  }
  if (!(valor > 0)) throw invalido("O valor da cobrança deve ser maior que zero.", { campo: "valor" });

  const ano = new Date().getFullYear();
  const seq = await proximoNumero(tx, p.municipio.id, "DAM", ano);
  const numero = `DAM-${p.municipio.sigla}-${String(seq).padStart(6, "0")}/${ano}`;
  const descricao = (opts.descricao?.trim() || [`${rotuloTaxa(fase)} – ${p.tipo_ato.sigla} ${p.tipo_ato.nome}`, p.numero ? `processo ${p.numero}` : null, descricaoTabela, baseLegal].filter(Boolean).join(" – ")).slice(0, 500);
  const c = await tx.cobranca.create({
    data: {
      municipio_id: p.municipio_id,
      processo_id: p.id,
      numero,
      fase,
      descricao,
      valor,
      vencimento: dataIso(dataVencimento(cfg.dias_vencimento)),
      status: "PENDENTE",
      gateway: cfg.gateway,
      pagador_id: p.requerente_id,
      created_by: usuario?.id ?? null,
    },
  });
  await auditar({ usuario_id: usuario?.id ?? null, acao: "CRIAR", entidade: "cobranca", entidade_id: c.id, depois: c }, tx);
  await atualizarTaxaProcesso(tx, p.id);
  return c;
}

/**
 * Gera a cobrança do processo na fase. Com `tx`: só o registro (o chamador deve chamar registrarNoGateway() após o
 * commit). Sem `tx`: transação própria + registro no gateway + aviso ao requerente.
 */
export async function gerarCobranca(processoId: string, fase: FaseCobranca, usuario: UsuarioSessao | null, tx?: Tx, opts: OpcoesGerar = {}): Promise<Cobranca | null> {
  if (tx) return criarRegistroCobranca(tx, processoId, fase, usuario, opts);
  const c = await prisma.$transaction((t) => criarRegistroCobranca(t, processoId, fase, usuario, opts));
  if (!c) return null;
  const r = await registrarNoGateway(c.id, usuario);
  await avisarRequerenteNovaCobranca(r.id);
  return r;
}

/** Gatilho manual (ficha do processo/API): ADMIN/GESTOR geram a cobrança de uma fase (valor da tabela ou informado). */
export async function gerarCobrancaManual(processoId: string, fase: FaseCobranca, usuario: UsuarioSessao, opts: OpcoesGerar = {}): Promise<Cobranca> {
  const p = await prisma.processo.findUnique({ where: { id: processoId }, select: { id: true, municipio_id: true, status: true } });
  if (!p) throw naoEncontrado("Processo não encontrado.");
  if (!podeGerirCobrancas(usuario, p.municipio_id)) throw proibido("Seu perfil não pode gerar cobranças neste município.");
  if (p.status === "RASCUNHO" || p.status === "ARQUIVADO") throw invalido("Não é possível gerar cobrança para processo em rascunho ou arquivado.");
  if (!(await configAtiva(p.municipio_id))) throw invalido("A cobrança de taxas não está ativa neste município (Administração → Cobrança).");
  const c = await gerarCobranca(p.id, fase, usuario, undefined, opts);
  if (!c) throw invalido(`Não há ${rotuloTaxa(fase).toLowerCase()} na tabela de taxas para este processo, ou já existe cobrança desta fase. Informe o valor para gerar manualmente.`);
  return c;
}

// ───────────── Registro no gateway (pós-commit) ─────────────

async function qrBase64(payload: string): Promise<string> {
  const url = await QRCode.toDataURL(payload, { margin: 1, width: 240, errorCorrectionLevel: "M" });
  return url.slice(url.indexOf(",") + 1);
}

/**
 * Registra a cobrança no gateway (Asaas) e preenche Pix/boleto/fatura. Erro do gateway: cobrança continua PENDENTE
 * com `erro_gateway` (botão "Tentar novamente" / job cobranca-sync). Idempotente (externalReference = id).
 */
export async function registrarNoGateway(cobrancaId: string, usuario: UsuarioSessao | null): Promise<Cobranca> {
  const c = await prisma.cobranca.findUniqueOrThrow({ where: { id: cobrancaId } });
  if (!STATUS_EM_ABERTO.includes(c.status) || (c.asaas_payment_id && !c.erro_gateway)) return c;
  const cfg = await prisma.configCobranca.findUnique({ where: { municipio_id: c.municipio_id } });
  if (!cfg) return c;
  const modo = modoGateway(cfg);
  let data: Prisma.CobrancaUpdateInput;
  if (modo === "MANUAL") return c;
  if (modo === "SIMULADO") {
    const payload = pixSimulado(c.numero ?? c.id, n(c.valor));
    data = { asaas_payment_id: `${PREFIXO_SIMULADO}${c.id}`, pix_copia_cola: payload, pix_qr_base64: await qrBase64(payload), pix_expira_em: c.vencimento, linha_digitavel: LINHA_SIMULADA, erro_gateway: null };
  } else if (modo === "SEM_CHAVE") {
    data = { erro_gateway: "Chave da API do Asaas não configurada para este município (Administração → Cobrança)." };
  } else {
    const rt = runtimeAsaas(cfg)!;
    try {
      const pessoa = c.pagador_id ? await prisma.pessoa.findUnique({ where: { id: c.pagador_id } }) : null;
      if (!pessoa) throw new Error("Cobrança sem pagador (requerente).");
      const cpfCnpj = somenteDigitos(decifrar(pessoa.cpf_cnpj_cifrado) ?? "");
      const anterior = c.asaas_customer_id ? null : await prisma.cobranca.findFirst({ where: { pagador_id: pessoa.id, municipio_id: c.municipio_id, asaas_customer_id: { not: null } }, select: { asaas_customer_id: true } });
      const customerId = c.asaas_customer_id ?? anterior?.asaas_customer_id ?? (await garantirCliente(rt, { nome: pessoa.nome, cpfCnpj, email: decifrar(pessoa.email), externalReference: pessoa.id }));
      const criada = await criarNoAsaas(rt, {
        customerId,
        valor: n(c.valor),
        vencimento: c.vencimento.toISOString().slice(0, 10),
        descricao: [c.numero, c.descricao, cfg.instrucoes].filter(Boolean).join(" – "),
        externalReference: c.id,
        multaPercentual: cfg.multa_percentual ? n(cfg.multa_percentual) : null,
        jurosMensalPercentual: cfg.juros_mensal_percentual ? n(cfg.juros_mensal_percentual) : null,
      });
      data = {
        asaas_customer_id: customerId,
        asaas_payment_id: criada.id,
        invoice_url: criada.invoiceUrl,
        boleto_url: criada.bankSlipUrl,
        linha_digitavel: criada.linhaDigitavel,
        pix_copia_cola: criada.pix.payload,
        pix_qr_base64: criada.pix.qrBase64,
        pix_expira_em: criada.pix.expiraEm ? new Date(criada.pix.expiraEm.replace(" ", "T")) : null,
        erro_gateway: null,
      };
    } catch (e) {
      const msg = e instanceof ErroAsaas || e instanceof Error ? e.message : String(e);
      console.error(`[cobranca] falha no Asaas (${c.numero}):`, msg);
      data = { erro_gateway: msg.slice(0, 1000) };
    }
  }
  const nova = await prisma.cobranca.update({ where: { id: c.id }, data });
  await auditar({ usuario_id: usuario?.id ?? null, acao: nova.erro_gateway ? "COBRANCA_GATEWAY_ERRO" : "COBRANCA_GATEWAY", entidade: "cobranca", entidade_id: c.id, antes: { asaas_payment_id: c.asaas_payment_id, erro_gateway: c.erro_gateway }, depois: { modo, asaas_payment_id: nova.asaas_payment_id, erro_gateway: nova.erro_gateway } });
  return nova;
}

/** "Tentar novamente" (erro do gateway). */
export async function tentarNovamente(cobrancaId: string, u: UsuarioSessao): Promise<Cobranca> {
  const c = await exigirGestao(cobrancaId, u);
  if (!STATUS_EM_ABERTO.includes(c.status)) throw invalido("Somente cobranças em aberto podem ser reenviadas ao gateway.");
  const r = await registrarNoGateway(c.id, u);
  if (r.erro_gateway) throw new ErroApi(502, "FALHA_GATEWAY", `O gateway recusou a cobrança: ${r.erro_gateway}`);
  return r;
}

async function removerNoGateway(c: Cobranca) {
  if (!c.asaas_payment_id || ehSimulada(c.asaas_payment_id)) return;
  const cfg = await prisma.configCobranca.findUnique({ where: { municipio_id: c.municipio_id } });
  const rt = cfg ? runtimeAsaas(cfg) : null;
  if (!rt || pagamentosSimulados()) return;
  try {
    await removerCobranca(rt, c.asaas_payment_id);
  } catch (e) {
    console.error(`[cobranca] não foi possível remover ${c.numero} no Asaas:`, (e as Error).message);
    await prisma.cobranca.update({ where: { id: c.id }, data: { erro_gateway: `Não removida no Asaas: ${(e as Error).message}`.slice(0, 1000) } }).catch(() => {});
  }
}

// ───────────── Mudança de status (webhook, consulta, baixa, isenção, cancelamento) ─────────────

type DadosStatus = {
  valor_pago?: number | null;
  pago_em?: Date | null;
  forma_pagamento?: string | null;
  baixa_manual?: boolean;
  baixa_por?: string | null;
  baixa_motivo?: string | null;
  comprovante_key?: string | null;
  cancelado_motivo?: string | null;
};

/**
 * Aplica um novo status à cobrança (com lock de linha). Idempotente (decidirTransicao): repetir o mesmo evento não
 * duplica tramitação nem e-mail. Pagamento/isenção registram entrada na tramitação do processo e avisam requerente
 * e técnico.
 */
export async function aplicarStatus(cobrancaId: string, novo: StatusCobranca, dados: DadosStatus, usuario: UsuarioSessao | null, origem: string): Promise<{ alterado: boolean; cobranca: Cobranca }> {
  const r = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM cobranca WHERE id = ${cobrancaId}::uuid FOR UPDATE`;
    const c = await tx.cobranca.findUniqueOrThrow({ where: { id: cobrancaId } });
    const t = decidirTransicao(c.status, novo);
    if (!t) return { alterado: false, cobranca: c, antes: c };
    const data: Prisma.CobrancaUpdateInput = { status: t.para };
    if (t.para === "PAGA") Object.assign(data, { valor_pago: dados.valor_pago ?? n(c.valor), pago_em: dados.pago_em ?? new Date(), forma_pagamento: dados.forma_pagamento ?? c.forma_pagamento, erro_gateway: null });
    if (t.para === "PAGA" || t.para === "ISENTA") Object.assign(data, { baixa_manual: !!dados.baixa_manual, baixa_por: dados.baixa_por ?? null, baixa_motivo: dados.baixa_motivo ?? null, comprovante_key: dados.comprovante_key ?? null });
    if (t.para === "ISENTA") Object.assign(data, { forma_pagamento: null, valor_pago: null, pago_em: new Date() });
    if (t.para === "CANCELADA") data.cancelado_motivo = dados.cancelado_motivo ?? "Cancelada.";
    const nova = await tx.cobranca.update({ where: { id: c.id }, data });
    await auditar({ usuario_id: usuario?.id ?? null, acao: `COBRANCA_${t.para}`, entidade: "cobranca", entidade_id: c.id, antes: { status: c.status }, depois: { status: nova.status, origem, forma_pagamento: nova.forma_pagamento, valor_pago: nova.valor_pago, pago_em: nova.pago_em, baixa_manual: nova.baixa_manual, motivo: dados.baixa_motivo ?? dados.cancelado_motivo ?? null } }, tx);
    await atualizarTaxaProcesso(tx, c.processo_id);
    if (c.processo_id && (t.para === "PAGA" || t.para === "ISENTA")) {
      const p = await tx.processo.findUniqueOrThrow({ where: { id: c.processo_id }, select: { status: true } });
      const despacho = t.para === "PAGA"
        ? `${rotuloTaxa(c.fase)} paga (${rotuloForma(nova.forma_pagamento)}) – ${c.numero ?? ""}, ${fmtMoeda(nova.valor_pago ?? c.valor)}.${dados.baixa_manual && dados.baixa_motivo ? ` Baixa manual: ${dados.baixa_motivo}` : ""}`
        : `${rotuloTaxa(c.fase)} isenta – ${c.numero ?? ""}. Motivo: ${dados.baixa_motivo ?? "—"}`;
      await tx.tramitacao.create({ data: { processo_id: c.processo_id, acao: t.para === "PAGA" ? "taxa_paga" : "taxa_isenta", de_status: p.status, para_status: p.status, de_usuario_id: usuario?.id ?? null, despacho, publico: true } });
    }
    return { alterado: true, cobranca: nova, antes: c };
  });
  if (r.alterado && (r.cobranca.status === "PAGA" || r.cobranca.status === "ISENTA")) await avisarQuitacao(r.cobranca);
  return { alterado: r.alterado, cobranca: r.cobranca };
}

/** Baixa manual (pagamento fora do gateway: DAM no banco, dinheiro no caixa…). Motivo obrigatório; comprovante opcional. */
export async function baixaManual(cobrancaId: string, u: UsuarioSessao, entrada: { motivo: string; forma?: string | null; pago_em?: Date | null; valor_pago?: number | null; comprovante?: File | null }): Promise<Cobranca> {
  const c = await exigirGestao(cobrancaId, u);
  const motivo = entrada.motivo?.trim() ?? "";
  if (motivo.length < 5) throw invalido("Informe o motivo/descrição da baixa (mín. 5 caracteres).", { campo: "motivo" });
  if (!STATUS_EM_ABERTO.includes(c.status)) throw invalido("Somente cobranças pendentes ou vencidas podem receber baixa manual.");
  let comprovante_key: string | null = null;
  const arq = entrada.comprovante;
  if (arq && arq.size > 0) {
    const erro = validarUpload(arq.name, arq.size);
    if (erro) throw invalido(erro, { campo: "comprovante" });
    comprovante_key = `${c.municipio_id}/cobrancas/${c.id}/${Date.now()}-${nomeSeguro(arq.name)}`;
    await salvarUpload(comprovante_key, Buffer.from(await arq.arrayBuffer()), arq.type || "application/octet-stream", { nome: arq.name, contexto: "comprovante_cobranca", usuario_id: u.id, entidade_id: c.id });
  }
  const r = await aplicarStatus(c.id, "PAGA", { baixa_manual: true, baixa_por: u.id, baixa_motivo: motivo, comprovante_key, forma_pagamento: entrada.forma || "MANUAL", pago_em: entrada.pago_em ?? new Date(), valor_pago: entrada.valor_pago ?? null }, u, "baixa_manual");
  if (!r.alterado) throw invalido("A cobrança não pôde receber baixa (status mudou). Atualize a página.");
  await removerNoGateway(r.cobranca);
  return r.cobranca;
}

/** Isenção (lei municipal, entidade sem fins lucrativos, órgão público…). Motivo obrigatório. */
export async function isentar(cobrancaId: string, u: UsuarioSessao, motivo: string): Promise<Cobranca> {
  const c = await exigirGestao(cobrancaId, u);
  if ((motivo ?? "").trim().length < 5) throw invalido("Informe o motivo/fundamento da isenção (mín. 5 caracteres).", { campo: "motivo" });
  if (!STATUS_EM_ABERTO.includes(c.status)) throw invalido("Somente cobranças pendentes ou vencidas podem ser isentadas.");
  const r = await aplicarStatus(c.id, "ISENTA", { baixa_por: u.id, baixa_motivo: motivo.trim() }, u, "isencao");
  if (!r.alterado) throw invalido("A cobrança não pôde ser isentada (status mudou). Atualize a página.");
  await removerNoGateway(r.cobranca);
  return r.cobranca;
}

/** Cancelamento (motivo obrigatório). Remove a cobrança no Asaas (melhor esforço). */
export async function cancelarCobranca(cobrancaId: string, u: UsuarioSessao | null, motivo: string): Promise<Cobranca> {
  const c = u ? await exigirGestao(cobrancaId, u) : await carregar(cobrancaId);
  if ((motivo ?? "").trim().length < 5) throw invalido("Informe o motivo do cancelamento (mín. 5 caracteres).", { campo: "motivo" });
  if (!STATUS_EM_ABERTO.includes(c.status)) throw invalido("Somente cobranças pendentes ou vencidas podem ser canceladas.");
  const r = await aplicarStatus(c.id, "CANCELADA", { cancelado_motivo: motivo.trim() }, u, "cancelamento");
  if (!r.alterado) throw invalido("A cobrança não pôde ser cancelada (status mudou). Atualize a página.");
  await removerNoGateway(r.cobranca);
  return r.cobranca;
}

/** Homologação: marca como PAGA uma cobrança SIMULADA (servidor com gestão ou o próprio requerente). */
export async function simularPagamento(cobrancaId: string, u: UsuarioSessao): Promise<Cobranca> {
  const c = await carregar(cobrancaId);
  if (!ehSimulada(c.asaas_payment_id)) throw invalido("Somente cobranças de homologação (simuladas) podem ter o pagamento simulado.");
  const titular = !!c.processo && ehTitular(u, { requerente_id: c.processo.requerente_id, rt_pessoa_id: c.processo.rt?.pessoa_id });
  if (!titular && !podeGerirCobrancas(u, c.municipio_id)) throw proibido("Sem permissão para simular o pagamento desta cobrança.");
  const r = await aplicarStatus(c.id, "PAGA", { forma_pagamento: "SIMULADO", pago_em: new Date() }, u, "simulacao");
  return r.cobranca;
}

/** Reenvia ao requerente o e-mail com os dados de pagamento. */
export async function reenviarCobranca(cobrancaId: string, u: UsuarioSessao): Promise<number> {
  const c = await exigirGestao(cobrancaId, u);
  if (!STATUS_EM_ABERTO.includes(c.status)) throw invalido("Somente cobranças em aberto podem ser reenviadas.");
  const enviados = await avisarRequerenteNovaCobranca(c.id);
  await auditar({ usuario_id: u.id, acao: "COBRANCA_REENVIO", entidade: "cobranca", entidade_id: c.id, depois: { destinatarios: enviados } });
  return enviados;
}

// ───────────── Webhook Asaas ─────────────

function tokensIguais(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export type ResultadoWebhook = { processado: boolean; motivo: string; cobranca_id?: string };

/**
 * Evento do Asaas (POST /api/v1/webhooks/asaas/{token}). Autentica pelo token da URL + header `asaas-access-token`
 * (os dois iguais ao token do município), registra o evento bruto no log de auditoria (WEBHOOK_ASAAS) e aplica o
 * status. Idempotente: evento repetido (mesmo id) é ignorado; status igual não muda nada.
 */
export async function processarWebhookAsaas(token: string, headerToken: string | null, corpo: unknown): Promise<ResultadoWebhook> {
  if (!token || token.length < 16) return { processado: false, motivo: "token inválido" };
  const cfg = await prisma.configCobranca.findFirst({ where: { asaas_webhook_token: token } });
  if (!cfg?.asaas_webhook_token) return { processado: false, motivo: "token desconhecido" };
  if (await prisma.municipio.count({ where: { id: cfg.municipio_id, organizacao: { status: "SUSPENSO" } } })) return { processado: false, motivo: "cliente suspenso" };
  if (!headerToken || !tokensIguais(headerToken.trim(), cfg.asaas_webhook_token)) return { processado: false, motivo: "header asaas-access-token ausente ou inválido" };
  const ev = lerEventoAsaas(corpo);
  if (!ev) return { processado: false, motivo: "evento sem pagamento" };
  const ref = ev.pagamento.externalReference && /^[0-9a-f-]{36}$/i.test(ev.pagamento.externalReference) ? ev.pagamento.externalReference : null;
  const c = (await prisma.cobranca.findUnique({ where: { asaas_payment_id: ev.pagamento.id } })) ?? (ref ? await prisma.cobranca.findUnique({ where: { id: ref } }) : null);
  if (!c || c.municipio_id !== cfg.municipio_id) return { processado: false, motivo: "cobrança não encontrada neste município" };
  if (ev.id) {
    const repetido = await prisma.logAuditoria.findFirst({ where: { entidade: "cobranca", entidade_id: c.id, acao: "WEBHOOK_ASAAS", depois: { path: ["evento_id"], equals: ev.id } }, select: { id: true } });
    if (repetido) return { processado: false, motivo: "evento repetido", cobranca_id: c.id };
  }
  await registrarAuditoria({ usuario_id: null, acao: "WEBHOOK_ASAAS", entidade: "cobranca", entidade_id: c.id, depois: { evento_id: ev.id, evento: ev.evento, pagamento: ev.pagamento } });
  const novo = statusDoEvento(ev.evento) ?? statusDoAsaas(ev.pagamento.status, !!ev.pagamento.deleted);
  const r = await aplicarStatus(
    c.id,
    novo ?? c.status,
    novo === "PAGA" ? { valor_pago: ev.pagamento.value ?? null, pago_em: dataPagamento(ev.pagamento), forma_pagamento: formaDoAsaas(ev.pagamento.billingType) } : { cancelado_motivo: novo === "CANCELADA" ? "Cobrança removida no Asaas." : null },
    null,
    `webhook ${ev.evento}`,
  );
  return { processado: r.alterado, motivo: r.alterado ? `status → ${r.cobranca.status}` : "sem alteração", cobranca_id: c.id };
}

// ───────────── Sincronização (fallback do webhook – job cobranca-sync) ─────────────

export type ResumoSync = { verificadas: number; pagas: number; vencidas: number; canceladas: number; registradas: number; erros: number };

/**
 * Consulta no Asaas as cobranças em aberto (GET /payments/{id}), registra as que falharam no gateway e marca VENCIDA
 * as vencidas sem gateway (manual/simulada). Filtro opcional por organização ou município.
 */
export async function sincronizarPendentes(filtro: { organizacao_id?: string; municipio_id?: string } = {}): Promise<ResumoSync> {
  const r: ResumoSync = { verificadas: 0, pagas: 0, vencidas: 0, canceladas: 0, registradas: 0, erros: 0 };
  const where: Prisma.CobrancaWhereInput = {
    status: { in: STATUS_EM_ABERTO },
    ...(filtro.municipio_id ? { municipio_id: filtro.municipio_id } : {}),
    // clientes suspensos (painel /plataforma) ficam fora da sincronização
    municipio: { organizacao: { status: "ATIVO", ...(filtro.organizacao_id ? { id: filtro.organizacao_id } : {}) } },
  };
  const cobrancas = await prisma.cobranca.findMany({ where, orderBy: { created_at: "asc" }, take: 2000 });
  const cfgs = new Map((await prisma.configCobranca.findMany({ where: { municipio_id: { in: [...new Set(cobrancas.map((c) => c.municipio_id))] } } })).map((c) => [c.municipio_id, c]));
  for (const c of cobrancas) {
    r.verificadas++;
    try {
      const cfg = cfgs.get(c.municipio_id);
      const modo = cfg ? modoGateway(cfg) : "MANUAL";
      if (cfg?.ativo && c.gateway === "ASAAS" && (!c.asaas_payment_id || c.erro_gateway) && modo !== "SEM_CHAVE" && modo !== "MANUAL") {
        const nova = await registrarNoGateway(c.id, null);
        if (!nova.erro_gateway) r.registradas++;
        else r.erros++;
        continue;
      }
      if (modo === "ASAAS" && c.asaas_payment_id && !ehSimulada(c.asaas_payment_id)) {
        const pag = await consultarPagamento(runtimeAsaas(cfg!)!, c.asaas_payment_id);
        const novo = statusDoAsaas(pag.status, !!pag.deleted);
        if (!novo) continue;
        const res = await aplicarStatus(c.id, novo, novo === "PAGA" ? { valor_pago: pag.value ?? null, pago_em: dataPagamento(pag), forma_pagamento: formaDoAsaas(pag.billingType) } : { cancelado_motivo: "Cobrança removida no Asaas." }, null, "sincronizacao");
        if (res.alterado && novo === "PAGA") r.pagas++;
        if (res.alterado && novo === "VENCIDA") r.vencidas++;
        if (res.alterado && novo === "CANCELADA") r.canceladas++;
        continue;
      }
      if (c.status === "PENDENTE" && venceu(c.vencimento)) {
        const res = await aplicarStatus(c.id, "VENCIDA", {}, null, "sincronizacao");
        if (res.alterado) r.vencidas++;
      }
    } catch (e) {
      r.erros++;
      console.error(`[cobranca-sync] ${c.numero}:`, (e as Error).message);
    }
  }
  return r;
}

// ───────────── Integração com o fluxo do processo (lib/processo/transicionar.ts) ─────────────

/** Cobrança em aberto das fases que bloqueia o processo (null = liberado ou município sem exigência). */
export async function pagamentoPendente(processo: { id: string; municipio_id: string }, fases: FaseCobranca[], db: Cliente = prisma): Promise<Cobranca | null> {
  if (!fases.length) return null;
  const cfg = await configAtiva(processo.municipio_id, db);
  if (!cfg?.exige_pagamento) return null;
  return db.cobranca.findFirst({ where: { processo_id: processo.id, fase: { in: fases }, status: { in: STATUS_EM_ABERTO } }, orderBy: { created_at: "asc" } });
}

/** Lança 409 PAGAMENTO_PENDENTE se a ação depende de taxa ainda não quitada. */
export async function exigirPagamento(db: Cliente, processo: { id: string; municipio_id: string }, acao: string) {
  const c = await pagamentoPendente(processo, fasesQueBloqueiam(acao), db);
  if (c) throw new ErroApi(409, "PAGAMENTO_PENDENTE", mensagemBloqueio(c), { cobranca_id: c.id, numero: c.numero });
}

export type EfeitosCobranca = { geradas: string[]; canceladas: string[] };

/**
 * Dentro da transação da transição (após os passos): gera a cobrança da fase (protocolar → UNICA ou ANALISE;
 * agendar_vistoria → VISTORIA; deferir → EMISSAO) e, no arquivamento, cancela as em aberto.
 */
export async function efeitosCobrancaTransicao(tx: Tx, p: { id: string; municipio_id: string; tipo_ato: { sigla: string } }, acao: string, u: UsuarioSessao): Promise<EfeitosCobranca> {
  const ef: EfeitosCobranca = { geradas: [], canceladas: [] };
  if (acao === "arquivar") {
    const abertas = await tx.cobranca.findMany({ where: { processo_id: p.id, status: { in: STATUS_EM_ABERTO } } });
    for (const c of abertas) {
      const nova = await tx.cobranca.update({ where: { id: c.id }, data: { status: "CANCELADA", cancelado_motivo: "Processo arquivado." } });
      await auditar({ usuario_id: u.id, acao: "COBRANCA_CANCELADA", entidade: "cobranca", entidade_id: c.id, antes: { status: c.status }, depois: { status: nova.status, origem: "arquivamento" } }, tx);
      ef.canceladas.push(c.id);
    }
    if (abertas.length) await atualizarTaxaProcesso(tx, p.id);
    return ef;
  }
  if (!(await configAtiva(p.municipio_id, tx))) return ef;
  const temUnica = (await tx.cobranca.count({ where: { processo_id: p.id, fase: "UNICA", status: { not: "CANCELADA" } } })) > 0;
  const g = faseGeradaPor(acao, { demandaUrbana: ehDemandaUrbana(p.tipo_ato.sigla), temUnica });
  if (!g) return ef;
  for (const fase of g === "PROTOCOLO" ? (["UNICA", "ANALISE"] as const) : [g]) {
    const c = await criarRegistroCobranca(tx, p.id, fase, u);
    if (c) {
      ef.geradas.push(c.id);
      break;
    }
  }
  return ef;
}

/** Pós-commit da transição: registra as novas cobranças no gateway e avisa o requerente; remove as canceladas. */
export async function posCommitCobranca(ef: EfeitosCobranca, u: UsuarioSessao, avisos: string[]) {
  for (const id of ef.geradas) {
    try {
      const c = await registrarNoGateway(id, u);
      await avisarRequerenteNovaCobranca(c.id);
      if (c.erro_gateway) avisos.push(`A cobrança ${c.numero} foi gerada, mas o gateway recusou o registro (${c.erro_gateway}). Use "Tentar novamente" na aba Taxas.`);
    } catch (e) {
      console.error("[cobranca] pós-commit:", e);
      avisos.push("A cobrança da taxa foi gerada, mas não pôde ser registrada no gateway agora. Use \"Tentar novamente\" na aba Taxas.");
    }
  }
  for (const id of ef.canceladas) {
    const c = await prisma.cobranca.findUnique({ where: { id } });
    if (c) await removerNoGateway(c);
  }
}

// ───────────── Avisos ─────────────

async function emailsRequerente(pessoaId: string | null): Promise<string[]> {
  if (!pessoaId) return [];
  return (await prisma.usuario.findMany({ where: { pessoa_id: pessoaId, ativo: true }, select: { email: true } })).map((x) => x.email);
}

/** E-mail ao requerente com valor, vencimento e como pagar. Retorna o nº de destinatários. */
export async function avisarRequerenteNovaCobranca(cobrancaId: string): Promise<number> {
  try {
    const c = await prisma.cobranca.findUnique({ where: { id: cobrancaId }, include: { processo: { select: { id: true, numero: true, requerente_id: true } }, municipio: { select: { orgao_ambiental_nome: true } } } });
    if (!c?.processo || !STATUS_EM_ABERTO.includes(c.status)) return 0;
    const emails = await emailsRequerente(c.processo.requerente_id);
    const app = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
    const corpo = [
      `<p>Foi gerada a cobrança <strong>${esc(c.numero ?? "")}</strong> – ${esc(rotuloTaxa(c.fase))} do processo <strong>${esc(c.processo.numero ?? "")}</strong> (${esc(c.municipio.orgao_ambiental_nome)}).</p>`,
      `<p>Valor: <strong>${esc(fmtMoeda(c.valor))}</strong> · vencimento: <strong>${esc(fmtDataCivil(c.vencimento))}</strong>.</p>`,
      c.invoice_url ? `<p>Pague por Pix ou boleto: <a href="${esc(c.invoice_url)}">${esc(c.invoice_url)}</a></p>` : "",
      `<p>O código Pix e a linha digitável também estão em "Meus processos": <a href="${esc(`${app}/meus-processos/${c.processo.id}`)}">${esc(`${app}/meus-processos/${c.processo.id}`)}</a>.</p>`,
    ].join("");
    for (const e of emails) await enviarEmail(e, `Taxa de licenciamento – ${c.numero} (processo ${c.processo.numero})`, corpo);
    return emails.length;
  } catch (e) {
    console.error("[cobranca] falha ao avisar requerente:", e);
    return 0;
  }
}

/** Pagamento/isenção: e-mail ao requerente + alerta (sino) ao técnico/gestor do processo. */
async function avisarQuitacao(c: Cobranca) {
  if (!c.processo_id) return;
  try {
    const p = await prisma.processo.findUnique({ where: { id: c.processo_id }, select: { id: true, numero: true, requerente_id: true, tecnico_id: true, gestor_id: true, municipio_id: true } });
    if (!p) return;
    const txt = c.status === "PAGA" ? `${rotuloTaxa(c.fase)} do processo ${p.numero} paga (${rotuloForma(c.forma_pagamento)}) – ${c.numero}.` : `${rotuloTaxa(c.fase)} do processo ${p.numero} isenta – ${c.numero}.`;
    for (const e of await emailsRequerente(p.requerente_id)) await enviarEmail(e, c.status === "PAGA" ? `Pagamento confirmado – ${c.numero}` : `Taxa isenta – ${c.numero}`, `<p>${esc(txt)}</p><p>O processo segue para a próxima etapa.</p>`);
    for (const uid of [...new Set([p.tecnico_id, c.fase === "EMISSAO" ? p.gestor_id : null].filter((x): x is string => !!x))]) {
      await prisma.alerta
        .create({ data: { usuario_id: uid, municipio_id: p.municipio_id, tipo: "TAXA_PAGA", referencia_tipo: "PROCESSO", referencia_id: p.id, chave: `TAXA_PAGA:${c.id}:${uid}`, mensagem: c.fase === "EMISSAO" ? `${txt} Emita o documento.` : txt } })
        .catch(() => {});
    }
  } catch (e) {
    console.error("[cobranca] falha ao avisar quitação:", e);
  }
}
