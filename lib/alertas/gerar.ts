// Motor de alertas (SPEC 6.1) – executado a cada 1 h pelo worker (jobs/worker.ts) ou manualmente
// (POST /api/v1/alertas/gerar). Idempotente: alerta.chave é UNIQUE (tipo+ref+destinatário+marco+data).
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { enviarEmail } from "../email";
import { decifrar } from "../crypto";
import { registrarAuditoria } from "../audit";
import { configPrazo, type Etapa } from "../prazos";
import { diasRestantes } from "../dias";
import {
  STATUS_COM_PRAZO,
  chaveAlerta,
  classificarPrazo,
  destinatariosProcesso,
  deveArquivarAutomatico,
  etapaDoStatus,
  marcoPrazo,
  marcoRenovacao,
  mensagemPrazo,
  type ReferenciaTipo,
  type TipoAlerta,
} from "./regras";

export type ResumoGeracao = {
  alertas_criados: number;
  emails_enviados: number;
  pendencias_vencidas: number;
  arquivados: number;
  arquivamento_auto: "desativado" | "indisponivel" | "executado";
  erros: string[];
  duracao_ms: number;
};

const ROTULO_ETAPA: Record<string, string> = {
  TRIAGEM: "triagem",
  ANALISE_CURTA: "análise",
  ANALISE_LONGA: "análise",
  VISTORIA: "vistoria",
  DECISAO: "decisão",
  PENDENCIA: "pendência",
};

const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";
const DIA = 86400000;

/** Destinatário: usuário do sistema (alerta no sino + e-mail) ou apenas e-mail externo (pessoa sem conta). */
type Destinatario = { usuario_id: string; email: string } | { usuario_id: null; pessoa_id: string; email: string };

type NovoAlerta = {
  municipio_id: string;
  tipo: TipoAlerta;
  referencia_tipo: ReferenciaTipo;
  referencia_id: string;
  marco: string | number;
  ate: Date | null;
  mensagem: string;
  link: string;
};

/** Contexto de uma execução: caches de usuários, gestores, requerentes e configurações. */
class Execucao {
  resumo: ResumoGeracao = { alertas_criados: 0, emails_enviados: 0, pendencias_vencidas: 0, arquivados: 0, arquivamento_auto: "desativado", erros: [], duracao_ms: 0 };
  private usuarios = new Map<string, { email: string; ativo: boolean } | null>();
  private gestores = new Map<string, string[]>();
  private porPessoa = new Map<string, Destinatario[]>();
  private cfg = new Map<string, number>();
  private orgDe = new Map<string, string | null>();

  /** `organizacaoId`: restringe a execução aos municípios de uma organização (disparo manual por um ADMIN). */
  constructor(public agora: Date, public organizacaoId: string | null = null) {}

  /** Filtro Prisma por município da organização da execução (vazio = todas – job do worker). */
  get whereMun(): { municipio_id?: { in: string[] } } {
    return this.municipiosOrg ? { municipio_id: { in: this.municipiosOrg } } : {};
  }
  municipiosOrg: string[] | null = null;

  async organizacaoDoMunicipio(municipioId: string | null): Promise<string | null> {
    if (!municipioId) return null;
    if (!this.orgDe.has(municipioId)) this.orgDe.set(municipioId, (await prisma.municipio.findUnique({ where: { id: municipioId }, select: { organizacao_id: true } }))?.organizacao_id ?? null);
    return this.orgDe.get(municipioId)!;
  }

  async usuario(id: string | null | undefined): Promise<Destinatario | null> {
    if (!id) return null;
    if (!this.usuarios.has(id)) {
      const u = await prisma.usuario.findUnique({ where: { id }, select: { email: true, ativo: true } });
      this.usuarios.set(id, u);
    }
    const u = this.usuarios.get(id);
    return u && u.ativo ? { usuario_id: id, email: u.email } : null;
  }

  async gestoresDoMunicipio(municipioId: string): Promise<string[]> {
    if (!this.gestores.has(municipioId)) {
      const ps = await prisma.usuarioPapel.findMany({ where: { papel: "GESTOR_MUNICIPAL", municipio_id: municipioId, usuario: { ativo: true } }, select: { usuario_id: true } });
      this.gestores.set(municipioId, [...new Set(ps.map((p) => p.usuario_id))]);
    }
    return this.gestores.get(municipioId)!;
  }

  /** Usuários vinculados à pessoa (requerente/notificado). Sem conta → e-mail cadastrado da pessoa (decifrado). */
  async daPessoa(pessoaId: string | null | undefined): Promise<Destinatario[]> {
    if (!pessoaId) return [];
    if (!this.porPessoa.has(pessoaId)) {
      const us = await prisma.usuario.findMany({ where: { pessoa_id: pessoaId, ativo: true }, select: { id: true, email: true } });
      let lista: Destinatario[] = us.map((u) => ({ usuario_id: u.id, email: u.email }));
      if (lista.length === 0) {
        const p = await prisma.pessoa.findUnique({ where: { id: pessoaId }, select: { email: true } });
        let email: string | null = null;
        try {
          email = decifrar(p?.email);
        } catch {
          email = null;
        }
        if (email && email.includes("@")) lista = [{ usuario_id: null, pessoa_id: pessoaId, email }];
      }
      this.porPessoa.set(pessoaId, lista);
    }
    return this.porPessoa.get(pessoaId)!;
  }

  async diasAlerta(organizacaoId: string, municipioId: string | null, etapa: Etapa): Promise<number> {
    const k = `${organizacaoId}|${municipioId}|${etapa}`;
    if (!this.cfg.has(k)) this.cfg.set(k, (await configPrazo(prisma, organizacaoId, municipioId, etapa)).dias_alerta);
    return this.cfg.get(k)!;
  }

  /** Configuração livre em prazo_config (etapas extras: CONDICIONANTE, NOTIFICACAO, ARQUIVAMENTO_AUTO). */
  async configExtra(municipioId: string | null, etapa: string): Promise<{ dias: number; dias_alerta: number } | null> {
    // Só configurações da organização do município (a de outro cliente nunca vale aqui).
    const org = await this.organizacaoDoMunicipio(municipioId);
    if (!org) return null;
    const cs = await prisma.prazoConfig.findMany({ where: { organizacao_id: org, etapa, OR: [{ municipio_id: municipioId }, { municipio_id: null }] } });
    const c = cs.find((x) => x.municipio_id === municipioId) ?? cs.find((x) => x.municipio_id === null);
    return c ? { dias: c.dias, dias_alerta: c.dias_alerta } : null;
  }

  /** Cria o alerta (se ainda não existe para a chave) e envia o e-mail. */
  async emitir(dest: Destinatario, a: NovoAlerta): Promise<boolean> {
    const destKey = dest.usuario_id ?? `pessoa-${dest.pessoa_id}`;
    const chave = chaveAlerta(a.tipo, a.referencia_id, destKey, a.marco, a.ate);
    let id: string;
    try {
      const criado = await prisma.alerta.create({
        data: {
          usuario_id: dest.usuario_id,
          municipio_id: a.municipio_id,
          tipo: a.tipo,
          referencia_tipo: a.referencia_tipo,
          referencia_id: a.referencia_id,
          chave,
          mensagem: a.mensagem,
          vence_em: a.ate,
        },
      });
      id = criado.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false; // já existe
      throw e;
    }
    this.resumo.alertas_criados++;
    try {
      const link = `${appUrl()}${a.link}`;
      const corpo = `<p>${escHtml(a.mensagem)}</p><p><a href="${link}">${link}</a></p><p style="color:#64748b;font-size:12px">LicenciaGov – alerta automático. Não responda este e-mail.</p>`;
      await enviarEmail(dest.email, `[LicenciaGov] ${a.mensagem.slice(0, 120)}`, corpo);
      await prisma.alerta.update({ where: { id }, data: { enviado_email: true } });
      this.resumo.emails_enviados++;
    } catch (e) {
      this.resumo.erros.push(`e-mail ${dest.email}: ${String(e)}`);
    }
    return true;
  }

  async emitirPara(dests: (Destinatario | null)[], a: NovoAlerta) {
    const vistos = new Set<string>();
    for (const d of dests) {
      if (!d) continue;
      const k = d.usuario_id ?? `p:${d.pessoa_id}`;
      if (vistos.has(k)) continue;
      vistos.add(k);
      await this.emitir(d, a);
    }
  }
}

function escHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// ───────────────────────── Regras ─────────────────────────

/** Processos com prazo de etapa vencendo/vencido → técnico + gestor(es). */
async function alertasProcessos(ex: Execucao) {
  const limite = new Date(ex.agora.getTime() + 60 * DIA);
  const processos = await prisma.processo.findMany({
    where: { ...ex.whereMun, status: { in: STATUS_COM_PRAZO }, prazo_pausado: false, prazo_etapa_ate: { not: null, lte: limite } },
    select: { id: true, numero: true, status: true, organizacao_id: true, municipio_id: true, tecnico_id: true, gestor_id: true, prazo_etapa_ate: true, tipo_ato: { select: { sigla: true, prazo_analise_dias: true } } },
  });
  for (const p of processos) {
    const etapa = etapaDoStatus(p.status, p.tipo_ato);
    if (!etapa) continue;
    const diasAlerta = await ex.diasAlerta(p.organizacao_id, p.municipio_id, etapa);
    const { situacao, dias } = classificarPrazo(p.prazo_etapa_ate, diasAlerta, false, ex.agora);
    if (situacao !== "VENCIDO" && situacao !== "VENCENDO") continue;
    const ids = destinatariosProcesso(p, await ex.gestoresDoMunicipio(p.municipio_id));
    const dests = await Promise.all(ids.map((id) => ex.usuario(id)));
    await ex.emitirPara(dests, {
      municipio_id: p.municipio_id,
      tipo: situacao === "VENCIDO" ? "PRAZO_VENCIDO" : "PRAZO_VENCENDO",
      referencia_tipo: "PROCESSO",
      referencia_id: p.id,
      marco: `${p.status}`,
      ate: p.prazo_etapa_ate,
      mensagem: mensagemPrazo(situacao, p.numero ?? "(sem número)", ROTULO_ETAPA[etapa] ?? etapa, dias ?? 0),
      link: `/processos/${p.id}`,
    });
  }
}

/** Pendências ABERTAS vencendo/vencidas → requerente (e-mail) + técnico; vencidas passam a VENCIDA. */
async function alertasPendencias(ex: Execucao) {
  const pendencias = await prisma.pendencia.findMany({
    where: { processo: ex.whereMun, status: "ABERTA", prazo_ate: { lte: new Date(ex.agora.getTime() + 60 * DIA) } },
    select: { id: true, descricao: true, prazo_ate: true, processo: { select: { id: true, numero: true, organizacao_id: true, municipio_id: true, tecnico_id: true, requerente_id: true } } },
  });
  for (const pe of pendencias) {
    const p = pe.processo;
    const diasAlerta = await ex.diasAlerta(p.organizacao_id, p.municipio_id, "PENDENCIA");
    const marco = marcoPrazo(pe.prazo_ate, diasAlerta, ex.agora);
    if (!marco) continue;
    if (marco === "VENCIDO") {
      await prisma.pendencia.update({ where: { id: pe.id }, data: { status: "VENCIDA" } });
      await registrarAuditoria({ usuario_id: null, acao: "PENDENCIA_VENCIDA", entidade: "pendencia", entidade_id: pe.id, antes: { status: "ABERTA" }, depois: { status: "VENCIDA", origem: "job_alertas" } });
      ex.resumo.pendencias_vencidas++;
    }
    const dias = diasRestantes(pe.prazo_ate, false, new Set(), ex.agora);
    const num = p.numero ?? "(sem número)";
    const resumoDesc = pe.descricao.length > 80 ? `${pe.descricao.slice(0, 77)}…` : pe.descricao;
    const base = {
      municipio_id: p.municipio_id,
      tipo: (marco === "VENCIDO" ? "PENDENCIA_VENCIDA" : "PENDENCIA_VENCENDO") as TipoAlerta,
      referencia_tipo: "PENDENCIA" as const,
      referencia_id: pe.id,
      marco,
      ate: pe.prazo_ate,
    };
    const msg = marco === "VENCIDO" ? `Processo ${num}: pendência "${resumoDesc}" venceu sem resposta.` : `Processo ${num}: pendência "${resumoDesc}" vence ${dias === 0 ? "hoje" : `em ${dias} dia(s)`}.`;
    await ex.emitirPara(await ex.daPessoa(p.requerente_id), { ...base, mensagem: msg, link: `/meus-processos/${p.id}` });
    await ex.emitirPara([await ex.usuario(p.tecnico_id)], { ...base, mensagem: msg, link: `/processos/${p.id}` });
  }
}

/** Licenças/autorizações válidas a 120/60/30 dias do vencimento → requerente + técnico. */
async function alertasLicencas(ex: Execucao) {
  const docs = await prisma.documentoOficial.findMany({
    where: {
      ...ex.whereMun,
      status: "VALIDO",
      tipo: { in: ["LICENCA", "AUTORIZACAO"] },
      validade_ate: { not: null, lte: new Date(ex.agora.getTime() + 121 * DIA), gte: new Date(ex.agora.getTime() - 30 * DIA) },
    },
    select: { id: true, numero: true, sigla_ato: true, validade_ate: true, municipio_id: true, titular_id: true, processo: { select: { id: true, tecnico_id: true, requerente_id: true } } },
  });
  for (const d of docs) {
    const marco = marcoRenovacao(d.validade_ate!, ex.agora);
    if (marco === null) continue;
    const dias = diasRestantes(d.validade_ate!, false, new Set(), ex.agora);
    const msg =
      marco === "VENCIDA"
        ? `${d.sigla_ato ?? "Licença"} ${d.numero} venceu em ${d.validade_ate!.toLocaleDateString("pt-BR", { timeZone: "America/Bahia" })}. Providencie a renovação.`
        : `${d.sigla_ato ?? "Licença"} ${d.numero} vence em ${dias} dia(s). Providencie a renovação com antecedência.`;
    const base = { municipio_id: d.municipio_id, tipo: "LICENCA_RENOVACAO" as const, referencia_tipo: "DOCUMENTO" as const, referencia_id: d.id, marco, ate: d.validade_ate };
    await ex.emitirPara(await ex.daPessoa(d.titular_id ?? d.processo?.requerente_id), { ...base, mensagem: msg, link: `/meus-processos` });
    await ex.emitirPara([await ex.usuario(d.processo?.tecnico_id)], { ...base, mensagem: msg, link: d.processo ? `/processos/${d.processo.id}` : `/documentos` });
  }
}

/** Condicionantes PENDENTES com prazo → requerente + técnico (janela: prazo_config CONDICIONANTE ou 15 dias). */
async function alertasCondicionantes(ex: Execucao) {
  const itens = await prisma.condicionante.findMany({
    where: { processo: ex.whereMun, status: "PENDENTE", prazo_ate: { not: null, lte: new Date(ex.agora.getTime() + 60 * DIA) } },
    select: { id: true, descricao: true, prazo_ate: true, processo: { select: { id: true, numero: true, municipio_id: true, tecnico_id: true, requerente_id: true } } },
  });
  for (const c of itens) {
    const p = c.processo;
    const janela = (await ex.configExtra(p.municipio_id, "CONDICIONANTE"))?.dias_alerta ?? 15;
    const marco = marcoPrazo(c.prazo_ate!, janela, ex.agora);
    if (!marco) continue;
    const dias = diasRestantes(c.prazo_ate!, false, new Set(), ex.agora);
    const desc = c.descricao.length > 80 ? `${c.descricao.slice(0, 77)}…` : c.descricao;
    const msg = marco === "VENCIDO" ? `Condicionante "${desc}" (processo ${p.numero ?? "—"}) está com prazo vencido.` : `Condicionante "${desc}" (processo ${p.numero ?? "—"}) vence em ${dias} dia(s).`;
    const base = { municipio_id: p.municipio_id, tipo: "CONDICIONANTE" as const, referencia_tipo: "CONDICIONANTE" as const, referencia_id: c.id, marco, ate: c.prazo_ate };
    await ex.emitirPara(await ex.daPessoa(p.requerente_id), { ...base, mensagem: msg, link: `/meus-processos/${p.id}` });
    await ex.emitirPara([await ex.usuario(p.tecnico_id)], { ...base, mensagem: msg, link: `/processos/${p.id}` });
  }
}

/** Notificações EMITIDAS com prazo → notificado + técnico do processo (ou autor da fiscalização). */
async function alertasNotificacoes(ex: Execucao) {
  const itens = await prisma.notificacao.findMany({
    where: { ...ex.whereMun, status: "EMITIDA", prazo_ate: { lte: new Date(ex.agora.getTime() + 60 * DIA) } },
    select: { id: true, numero: true, prazo_ate: true, municipio_id: true, notificado_id: true, created_by: true, processo: { select: { id: true, tecnico_id: true } }, fiscalizacao: { select: { id: true, created_by: true } } },
  });
  for (const n of itens) {
    const janela = (await ex.configExtra(n.municipio_id, "NOTIFICACAO"))?.dias_alerta ?? 5;
    const marco = marcoPrazo(n.prazo_ate, janela, ex.agora);
    if (!marco) continue;
    const dias = diasRestantes(n.prazo_ate, false, new Set(), ex.agora);
    const msg = marco === "VENCIDO" ? `Notificação ${n.numero}: prazo para atendimento vencido.` : `Notificação ${n.numero}: prazo para atendimento vence em ${dias} dia(s).`;
    const base = { municipio_id: n.municipio_id, tipo: "NOTIFICACAO" as const, referencia_tipo: "NOTIFICACAO" as const, referencia_id: n.id, marco, ate: n.prazo_ate };
    await ex.emitirPara(await ex.daPessoa(n.notificado_id), { ...base, mensagem: msg, link: `/meus-processos` });
    const interno = n.processo?.tecnico_id ?? n.fiscalizacao?.created_by ?? n.created_by;
    await ex.emitirPara([await ex.usuario(interno)], { ...base, mensagem: msg, link: n.fiscalizacao ? `/fiscalizacao/${n.fiscalizacao.id}` : n.processo ? `/processos/${n.processo.id}` : `/fiscalizacao` });
  }
}

// ───────────────────────── Arquivamento automático ─────────────────────────

/**
 * SPEC 6: AGUARDANDO_REQUERENTE com prazo de pendência vencido → ARQUIVADO (automático, configurável).
 * Ativo quando ARQUIVAMENTO_AUTO=true (env) ou existe prazo_config com etapa 'ARQUIVAMENTO_AUTO'
 * (por município ou organização; `dias` = carência após o vencimento). Padrão: desativado.
 * Usa `transicionar` de lib/processo/transicionar.ts (módulo de processo); se não existir, não faz nada.
 */
export async function arquivarPendenciasVencidas(agora = new Date(), ex = new Execucao(agora)): Promise<{ status: ResumoGeracao["arquivamento_auto"]; arquivados: number }> {
  const envAtivo = process.env.ARQUIVAMENTO_AUTO === "true";
  const temConfig = (await prisma.prazoConfig.count({ where: { etapa: "ARQUIVAMENTO_AUTO" } })) > 0;
  if (!envAtivo && !temConfig) return { status: "desativado", arquivados: 0 };

  let transicionar: ((...args: unknown[]) => Promise<unknown>) | null = null;
  try {
    const nome = process.env.ALERTAS_MODULO_TRANSICIONAR ?? "transicionar";
    const mod = await import(`../processo/${nome}`);
    transicionar = typeof mod.transicionar === "function" ? mod.transicionar : null;
  } catch {
    transicionar = null;
  }
  if (!transicionar) return { status: "indisponivel", arquivados: 0 };

  const candidatos = await prisma.processo.findMany({
    where: { ...ex.whereMun, status: "AGUARDANDO_REQUERENTE" },
    select: { id: true, numero: true, status: true, organizacao_id: true, municipio_id: true, pendencias: { select: { status: true, prazo_ate: true } } },
  });
  let arquivados = 0;
  for (const p of candidatos) {
    const cfg = await ex.configExtra(p.municipio_id, "ARQUIVAMENTO_AUTO");
    if (!cfg && !envAtivo) continue;
    if (cfg && cfg.dias < 0) continue; // dias negativo = desativado para o município
    const carencia = cfg?.dias ?? Number(process.env.ARQUIVAMENTO_AUTO_CARENCIA_DIAS ?? 0);
    if (!deveArquivarAutomatico(p, agora, carencia)) continue;
    try {
      // Assinatura (lib/processo/transicionar.ts): transicionar(processoId, acao, payload, usuario)
      await transicionar(p.id, "arquivar", { justificativa: `Arquivamento automático: prazo de resposta à pendência vencido há mais de ${carencia} dia(s) (SPEC 6).` }, usuarioSistema(p.organizacao_id, [p.municipio_id]));
      arquivados++;
    } catch (e) {
      ex.resumo.erros.push(`arquivar ${p.numero ?? p.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { status: "executado", arquivados };
}

/** Usuário sintético usado em transições automáticas (sem id real – log com usuario_id null). */
// id nulo: tramitacao.de_usuario_id e log_auditoria.usuario_id ficam NULL (= ação do sistema).
export const USUARIO_SISTEMA = { id: null as unknown as string, nome: "Sistema (job de prazos)", email: "sistema@licenciagov", cargo: null, pessoa_id: null, trocar_senha: false, papeis: [{ papel: "ADMIN" as const, municipio_id: null }], organizacao_id: null as string | null, municipios_org: [] as string[] };

/** Usuário do sistema com escopo restrito à organização/município do registro tratado (isolamento por cliente). */
export function usuarioSistema(organizacaoId: string, municipios: string[]) {
  return { ...USUARIO_SISTEMA, organizacao_id: organizacaoId, municipios_org: municipios };
}

// ───────────────────────── Entrada ─────────────────────────

/**
 * Gera todos os alertas devidos em `agora`. Idempotente – pode rodar quantas vezes quiser.
 * `opts.organizacao_id`: só os registros dos municípios dessa organização (disparo manual pelo ADMIN do cliente);
 * sem ela, todas as organizações (job do worker). Cada alerta vai a destinatários do próprio registro.
 */
export async function gerarAlertas(agora = new Date(), opts: { organizacao_id?: string | null } = {}): Promise<ResumoGeracao> {
  const t0 = Date.now();
  const ex = new Execucao(agora, opts.organizacao_id ?? null);
  if (opts.organizacao_id !== undefined) {
    ex.municipiosOrg = opts.organizacao_id ? (await prisma.municipio.findMany({ where: { organizacao_id: opts.organizacao_id }, select: { id: true } })).map((m) => m.id) : [];
  }
  const etapas: [string, (e: Execucao) => Promise<void>][] = [
    ["processos", alertasProcessos],
    ["pendencias", alertasPendencias],
    ["licencas", alertasLicencas],
    ["condicionantes", alertasCondicionantes],
    ["notificacoes", alertasNotificacoes],
  ];
  for (const [nome, fn] of etapas) {
    try {
      await fn(ex);
    } catch (e) {
      ex.resumo.erros.push(`${nome}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  try {
    const r = await arquivarPendenciasVencidas(agora, ex);
    ex.resumo.arquivamento_auto = r.status;
    ex.resumo.arquivados = r.arquivados;
  } catch (e) {
    ex.resumo.erros.push(`arquivamento: ${e instanceof Error ? e.message : String(e)}`);
  }
  ex.resumo.duracao_ms = Date.now() - t0;
  return ex.resumo;
}
