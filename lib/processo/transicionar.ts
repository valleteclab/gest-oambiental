import "server-only";
import type { DocumentoOficial, Prisma, StatusProcesso } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { auditar } from "../audit";
import { ErroApi, invalido, naoEncontrado, proibido } from "../http";
import { numeroDocumento, numeroProcesso } from "../numeracao";
import { calcularPrazo, configPrazo, etapaAnalise, saldoDias, type Etapa } from "../prazos";
import { somarDias } from "../dias";
import { esc } from "../pdf";
import { enviarEmail } from "../email";
import type { UsuarioSessao } from "../rbac";
import { ROTULO_STATUS } from "@/components/ui";
import { destino, itensChecklistPendentes, lerItensChecklist, normalizarAcao, permitido, proximoDoRodizio, ROTULO_ACAO, type AcaoProcesso } from "./maquina";
import { podeVerProcesso, tecnicosElegiveis, UUID_RE } from "./consultas";
import { emitirDocumentoDecisao, emitirPdfParecer, emitirRecibo, tentarEmitir, tipoDocumentoDoAto } from "./documentos";

// SPEC 6 – ÚNICA forma de mudar o status de um processo.
// Cada transição: valida perfil/escopo, estado e pré-requisitos; grava tramitacao + log_auditoria;
// recalcula prazo_etapa_ate (relógio pausa em AGUARDANDO_REQUERENTE). Documentos são emitidos após o commit.

type Tx = Prisma.TransactionClient;

const texto = (min: number, msg: string) => z.string().trim().min(min, msg).max(20000);
const despachoOpc = z.string().trim().max(5000).optional().nullable();

export const SCHEMAS = {
  protocolar: z.object({ despacho: despachoOpc }),
  distribuir: z.object({ tecnico_id: z.string().regex(UUID_RE, "Técnico inválido.").optional().nullable().or(z.literal("")), despacho: despachoOpc }),
  pendencia: z
    .object({
      descricao: z.string().trim().max(5000).optional().nullable(),
      itens: z.array(z.object({ descricao: texto(5, "Descreva a pendência (mín. 5 caracteres).") })).optional(),
      prazo_dias: z.coerce.number().int().min(1).max(365).optional().nullable(),
      despacho: despachoOpc,
    })
    .transform((v) => ({ ...v, itens: v.itens?.length ? v.itens : v.descricao ? [{ descricao: v.descricao }] : [] }))
    .refine((v) => v.itens.length > 0 && v.itens.every((i) => i.descricao.length >= 5), { message: "Informe ao menos uma pendência (mín. 5 caracteres).", path: ["itens"] }),
  responder: z.object({
    resposta: z.string().trim().max(20000).optional().nullable(),
    respostas: z.array(z.object({ pendencia_id: z.string().regex(UUID_RE), resposta: z.string().trim().max(20000) })).optional(),
  }),
  aceitar: z.object({ despacho: despachoOpc }),
  agendar_vistoria: z.object({ data_prevista: z.coerce.date().optional().nullable(), despacho: despachoOpc }),
  concluir_vistoria: z.object({ despacho: despachoOpc }),
  parecer: z
    .object({
      conclusao: z.enum(["FAVORAVEL", "DESFAVORAVEL", "FAVORAVEL_COM_CONDICIONANTES"]),
      texto: texto(20, "O texto do parecer deve ter pelo menos 20 caracteres."),
      condicionantes: z
        .array(z.object({ descricao: texto(5, "Descreva a condicionante."), periodicidade: z.string().trim().max(100).optional().nullable(), prazo_dias: z.coerce.number().int().min(1).max(3650).optional().nullable() }))
        .optional()
        .default([]),
    })
    .refine((v) => v.conclusao !== "FAVORAVEL_COM_CONDICIONANTES" || v.condicionantes.length > 0, { message: "Informe ao menos uma condicionante.", path: ["condicionantes"] }),
  deferir: z.object({ despacho: despachoOpc }),
  indeferir: z.object({ motivo: texto(10, "Informe a motivação do indeferimento (mín. 10 caracteres).") }),
  emitir_documento: z.object({}).passthrough(),
  arquivar: z.object({ justificativa: texto(10, "A justificativa do arquivamento é obrigatória (mín. 10 caracteres).") }),
} satisfies Record<AcaoProcesso, z.ZodTypeAny>;

export type DocumentoResumo = Pick<DocumentoOficial, "id" | "tipo" | "numero" | "codigo_verificador" | "validade_ate" | "emitido_em" | "status">;

export type ResultadoTransicao = {
  processo: { id: string; numero: string | null; status: StatusProcesso };
  avisos: string[];
  documentos: DocumentoResumo[];
};

const resumir = (d: DocumentoOficial): DocumentoResumo => ({ id: d.id, tipo: d.tipo, numero: d.numero, codigo_verificador: d.codigo_verificador, validade_ate: d.validade_ate, emitido_em: d.emitido_em, status: d.status });

const conflito = (msg: string) => new ErroApi(409, "ESTADO_INVALIDO", msg);

const INCLUDE = {
  municipio: true,
  tipo_ato: { include: { checklist_modelo: true } },
  empreendimento: true,
  rt: { select: { pessoa_id: true } },
  tecnico: { select: { id: true, nome: true } },
} satisfies Prisma.ProcessoInclude;
type ProcessoTx = Prisma.ProcessoGetPayload<{ include: typeof INCLUDE }>;

type Passo = {
  acao: string;
  para: StatusProcesso;
  data?: Prisma.ProcessoUncheckedUpdateInput;
  despacho?: string | null;
  para_usuario_id?: string | null;
  publico?: boolean;
  extra?: Record<string, unknown>;
};

type PosCommit = { recibo?: boolean; parecerId?: string; decisao?: boolean; motivo?: string; emailRequerente?: { assunto: string; corpo: string } };

/** Texto simples → HTML seguro em parágrafos. */
export function textoParaHtml(t: string): string {
  return t
    .split(/\n{2,}/)
    .map((par) => `<p>${esc(par.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Status de onde veio a pendência (última entrada em AGUARDANDO_REQUERENTE). */
async function origemPendencia(tx: Tx, processoId: string): Promise<StatusProcesso | null> {
  const t = await tx.tramitacao.findFirst({ where: { processo_id: processoId, para_status: "AGUARDANDO_REQUERENTE" }, orderBy: { created_at: "desc" } });
  return t?.de_status ?? null;
}

async function escolherTecnico(tx: Tx, municipioId: string) {
  const candidatos = await tecnicosElegiveis(municipioId, tx);
  if (!candidatos.length) return null;
  const ultimas = await tx.tramitacao.groupBy({
    by: ["para_usuario_id"],
    where: { acao: "distribuir", para_usuario_id: { in: candidatos.map((c) => c.id) } },
    _max: { created_at: true },
  });
  const mapa = new Map(ultimas.map((u) => [u.para_usuario_id, u._max.created_at]));
  return proximoDoRodizio(candidatos.map((c) => ({ id: c.id, nome: c.nome, ultima: mapa.get(c.id) ?? null })));
}

async function passoDistribuir(tx: Tx, p: ProcessoTx, statusAtual: StatusProcesso, tecnicoId: string | null | undefined, despacho: string | null | undefined, automatico: boolean): Promise<Passo> {
  let tecnico: { id: string; nome: string } | null;
  if (tecnicoId) {
    const elegiveis = await tecnicosElegiveis(p.municipio_id, tx);
    tecnico = elegiveis.find((t) => t.id === tecnicoId) ?? null;
    if (!tecnico) throw invalido("O técnico escolhido não atua neste município.");
  } else {
    tecnico = await escolherTecnico(tx, p.municipio_id);
    if (!tecnico) throw invalido("Nenhum técnico disponível para distribuição neste município.");
  }
  const para = statusAtual === "PROTOCOLADO" ? "EM_TRIAGEM" : statusAtual;
  const data: Prisma.ProcessoUncheckedUpdateInput = { tecnico_id: tecnico.id };
  if (statusAtual === "PROTOCOLADO") {
    const prazo = await calcularPrazo(tx, { organizacao_id: p.organizacao_id, municipio_id: p.municipio_id, etapa: "TRIAGEM" });
    Object.assign(data, { prazo_etapa_ate: prazo.ate, etapa_atual: "TRIAGEM", prazo_pausado: false });
  }
  const modo = automatico || !tecnicoId ? "Distribuição automática (rodízio)" : "Distribuição manual";
  return {
    acao: "distribuir",
    para,
    data,
    para_usuario_id: tecnico.id,
    despacho: [`${modo} para ${tecnico.nome}.`, despacho].filter(Boolean).join(" "),
    publico: statusAtual === "PROTOCOLADO",
  };
}

type Payloads = { [K in AcaoProcesso]: z.output<(typeof SCHEMAS)[K]> };

async function montarPassos(tx: Tx, p: ProcessoTx, acao: AcaoProcesso, payload: Payloads[AcaoProcesso], u: UsuarioSessao, pos: PosCommit): Promise<Passo[]> {
  const agora = new Date();
  const base = { organizacao_id: p.organizacao_id, municipio_id: p.municipio_id };

  switch (acao) {
    case "protocolar": {
      const pl = payload as Payloads["protocolar"];
      const exigidos = await tx.documentoExigido.findMany({
        where: { tipo_ato_id: p.tipo_ato_id, obrigatorio: true, OR: [{ tipologia_id: null }, { tipologia_id: p.empreendimento.tipologia_id }] },
        select: { id: true, nome: true },
      });
      const anexados = new Set((await tx.anexo.findMany({ where: { processo_id: p.id, documento_exigido_id: { in: exigidos.map((d) => d.id) } }, select: { documento_exigido_id: true } })).map((a) => a.documento_exigido_id));
      const faltando = exigidos.filter((d) => !anexados.has(d.id));
      if (faltando.length) throw invalido(`Anexe os documentos obrigatórios antes de protocolar: ${faltando.map((d) => d.nome).join("; ")}.`, { faltando });
      const numero = await numeroProcesso(tx, p.municipio);
      const prazo = await calcularPrazo(tx, { ...base, etapa: "TRIAGEM" });
      pos.recibo = true;
      const passos: Passo[] = [
        {
          acao: "protocolar",
          para: "PROTOCOLADO",
          data: { numero, data_protocolo: agora, etapa_atual: "TRIAGEM", prazo_etapa_ate: prazo.ate, prazo_pausado: false, prazo_saldo_dias: null },
          despacho: pl.despacho || `Requerimento de ${p.tipo_ato.nome} protocolado sob o nº ${numero}.`,
          publico: true,
          extra: { numero },
        },
      ];
      if (p.municipio.distribuicao_auto) {
        const tecnico = await escolherTecnico(tx, p.municipio_id);
        if (tecnico) passos.push(await passoDistribuir(tx, p, "PROTOCOLADO", tecnico.id, null, true));
      }
      return passos;
    }

    case "distribuir": {
      const pl = payload as Payloads["distribuir"];
      return [await passoDistribuir(tx, p, p.status, pl.tecnico_id || null, pl.despacho, false)];
    }

    case "pendencia": {
      const pl = payload as Payloads["pendencia"];
      const cfg = await configPrazo(tx, p.organizacao_id, p.municipio_id, "PENDENCIA");
      const dias = pl.prazo_dias ?? cfg.dias;
      const prazo = await calcularPrazo(tx, { ...base, etapa: "PENDENCIA", dias });
      const tipo = p.status === "EM_TRIAGEM" ? "DOCUMENTAL" : "TECNICA";
      for (const i of pl.itens) {
        const pend = await tx.pendencia.create({ data: { processo_id: p.id, tipo, descricao: i.descricao, prazo_dias: dias, prazo_ate: prazo.ate, created_by: u.id } });
        await auditar({ usuario_id: u.id, acao: "CRIAR", entidade: "pendencia", entidade_id: pend.id, depois: pend }, tx);
      }
      pos.emailRequerente = {
        assunto: `Pendência no processo ${p.numero} – ação necessária`,
        corpo: `<p>O processo <strong>${esc(p.numero)}</strong> possui pendência(s) a responder até <strong>${prazo.ate.toLocaleDateString("pt-BR", { timeZone: "America/Bahia" })}</strong>:</p><ul>${pl.itens.map((i) => `<li>${esc(i.descricao)}</li>`).join("")}</ul><p>Acesse "Meus processos" no LicenciaGov para responder.</p>`,
      };
      return [
        {
          acao: "pendencia",
          para: "AGUARDANDO_REQUERENTE",
          // Relógio do órgão pausa: guarda o saldo; prazo_etapa_ate passa a ser o prazo do requerente.
          data: { prazo_pausado: true, prazo_saldo_dias: saldoDias(p.prazo_etapa_ate), prazo_etapa_ate: prazo.ate, etapa_atual: "PENDENCIA" },
          despacho: [`Pendência ${tipo === "DOCUMENTAL" ? "documental" : "técnica"} (prazo de ${dias} dias):`, ...pl.itens.map((i, n) => `${n + 1}) ${i.descricao}`), pl.despacho].filter(Boolean).join("\n"),
          para_usuario_id: null,
          publico: true,
        },
      ];
    }

    case "responder": {
      const pl = payload as Payloads["responder"];
      const abertas = await tx.pendencia.findMany({ where: { processo_id: p.id, status: { in: ["ABERTA", "VENCIDA"] } }, orderBy: { created_at: "asc" } });
      if (!abertas.length) throw conflito("Não há pendências abertas para responder.");
      const especificas = new Map((pl.respostas ?? []).map((r) => [r.pendencia_id, r.resposta]));
      for (const pend of abertas) {
        const resposta = (especificas.get(pend.id) || pl.resposta || "").trim();
        if (!resposta) throw invalido(`Responda a pendência: "${pend.descricao.slice(0, 80)}".`, { pendencia_id: pend.id });
        const nova = await tx.pendencia.update({ where: { id: pend.id }, data: { status: "RESPONDIDA", resposta, respondida_em: agora } });
        await auditar({ usuario_id: u.id, acao: "RESPONDER", entidade: "pendencia", entidade_id: pend.id, antes: pend, depois: nova }, tx);
      }
      const origem = (await origemPendencia(tx, p.id)) === "EM_ANALISE" ? "EM_ANALISE" : "EM_TRIAGEM";
      const etapa: Etapa = origem === "EM_ANALISE" ? etapaAnalise(p.tipo_ato) : "TRIAGEM";
      // Relógio retoma do saldo restante
      const prazo = await calcularPrazo(tx, { ...base, etapa, dias: p.prazo_saldo_dias ?? undefined });
      return [
        {
          acao: "responder",
          para: origem,
          data: { prazo_pausado: false, prazo_saldo_dias: null, prazo_etapa_ate: prazo.ate, etapa_atual: etapa },
          despacho: `Pendência(s) respondida(s) pelo requerente (${abertas.length}). Prazo retomado com saldo de ${prazo.dias} dia(s).`,
          para_usuario_id: p.tecnico_id,
          publico: true,
        },
      ];
    }

    case "aceitar": {
      const pl = payload as Payloads["aceitar"];
      const etapa = etapaAnalise(p.tipo_ato);
      const prazo = await calcularPrazo(tx, { ...base, etapa });
      return [{ acao: "aceitar", para: "EM_ANALISE", data: { prazo_etapa_ate: prazo.ate, etapa_atual: etapa, prazo_saldo_dias: null, ...(p.tecnico_id ? {} : { tecnico_id: u.id }) }, despacho: pl.despacho || "Documentação aceita na triagem. Processo encaminhado para análise técnica.", publico: true }];
    }

    case "agendar_vistoria": {
      const pl = payload as Payloads["agendar_vistoria"];
      const prazo = await calcularPrazo(tx, { ...base, etapa: "VISTORIA" });
      const data = pl.data_prevista ?? prazo.ate;
      const tecnico = p.tecnico ?? { id: u.id, nome: u.nome };
      const f = await tx.fiscalizacao.create({
        data: {
          organizacao_id: p.organizacao_id,
          municipio_id: p.municipio_id,
          origem: "PROCESSO",
          processo_id: p.id,
          empreendimento_id: p.empreendimento_id,
          data_hora: data,
          latitude: p.empreendimento.latitude,
          longitude: p.empreendimento.longitude,
          equipe: [{ usuario_id: tecnico.id, nome: tecnico.nome }],
          relato: pl.despacho || null,
          status: "AGENDADA",
          created_by: u.id,
        },
      });
      await auditar({ usuario_id: u.id, acao: "CRIAR", entidade: "fiscalizacao", entidade_id: f.id, depois: f }, tx);
      return [
        {
          acao: "agendar_vistoria",
          para: "AGUARDANDO_VISTORIA",
          // Guarda o saldo da análise para retomar após a vistoria
          data: { prazo_saldo_dias: saldoDias(p.prazo_etapa_ate), prazo_etapa_ate: prazo.ate, etapa_atual: "VISTORIA" },
          despacho: [`Vistoria agendada para ${data.toLocaleDateString("pt-BR", { timeZone: "America/Bahia" })}.`, pl.despacho].filter(Boolean).join(" "),
          para_usuario_id: tecnico.id,
          publico: true,
          extra: { fiscalizacao_id: f.id },
        },
      ];
    }

    case "concluir_vistoria": {
      const pl = payload as Payloads["concluir_vistoria"];
      const realizadas = await tx.fiscalizacao.count({ where: { processo_id: p.id, status: "REALIZADA" } });
      if (!realizadas) {
        const relato = (pl.despacho ?? "").trim();
        if (relato.length < 10) throw invalido("Nenhuma vistoria registrada para este processo. Registre a vistoria ou informe o relato (mín. 10 caracteres).");
        const agendada = await tx.fiscalizacao.findFirst({ where: { processo_id: p.id, status: "AGENDADA" }, orderBy: { created_at: "desc" } });
        if (agendada) {
          const nova = await tx.fiscalizacao.update({ where: { id: agendada.id }, data: { status: "REALIZADA", relato, data_hora: agora } });
          await auditar({ usuario_id: u.id, acao: "EDITAR", entidade: "fiscalizacao", entidade_id: agendada.id, antes: agendada, depois: nova }, tx);
        }
      }
      const etapa = etapaAnalise(p.tipo_ato);
      const prazo = await calcularPrazo(tx, { ...base, etapa, dias: p.prazo_saldo_dias ?? undefined });
      return [{ acao: "concluir_vistoria", para: "EM_ANALISE", data: { prazo_etapa_ate: prazo.ate, etapa_atual: etapa, prazo_saldo_dias: null }, despacho: pl.despacho || "Vistoria concluída. Análise retomada.", para_usuario_id: p.tecnico_id, publico: true }];
    }

    case "parecer": {
      const pl = payload as Payloads["parecer"];
      if (p.tipo_ato.checklist_modelo) {
        const itens = lerItensChecklist(p.tipo_ato.checklist_modelo.itens);
        const preenchido = await tx.checklistPreenchido.findFirst({ where: { processo_id: p.id, checklist_modelo_id: p.tipo_ato.checklist_modelo.id }, orderBy: { updated_at: "desc" } });
        const faltando = itensChecklistPendentes(itens, (preenchido?.respostas as Record<string, unknown>) ?? {});
        if (faltando.length) throw invalido(`Preencha o checklist antes do parecer. Itens obrigatórios pendentes: ${faltando.map((i) => i.texto).join("; ")}.`, { itens: faltando.map((i) => i.id) });
      }
      const numero = await numeroDocumento(tx, p.municipio, "PAR");
      const parecer = await tx.parecer.create({ data: { processo_id: p.id, numero, conclusao: pl.conclusao, texto_html: textoParaHtml(pl.texto), autor_id: u.id, created_by: u.id } });
      await auditar({ usuario_id: u.id, acao: "CRIAR", entidade: "parecer", entidade_id: parecer.id, depois: parecer }, tx);
      if (pl.conclusao === "FAVORAVEL_COM_CONDICIONANTES") {
        for (const c of pl.condicionantes) {
          const cond = await tx.condicionante.create({
            data: { processo_id: p.id, descricao: c.descricao, periodicidade: c.periodicidade || null, prazo_ate: c.prazo_dias ? somarDias(agora, c.prazo_dias, false) : null, created_by: u.id },
          });
          await auditar({ usuario_id: u.id, acao: "CRIAR", entidade: "condicionante", entidade_id: cond.id, depois: cond }, tx);
        }
      }
      pos.parecerId = parecer.id;
      const prazo = await calcularPrazo(tx, { ...base, etapa: "DECISAO" });
      const gestor = await tx.usuario.findFirst({ where: { ativo: true, papeis: { some: { papel: "GESTOR_MUNICIPAL", municipio_id: p.municipio_id } } }, select: { id: true }, orderBy: { nome: "asc" } });
      const rotulo = { FAVORAVEL: "favorável", DESFAVORAVEL: "desfavorável", FAVORAVEL_COM_CONDICIONANTES: "favorável com condicionantes" }[pl.conclusao];
      return [
        {
          acao: "parecer",
          para: "AGUARDANDO_DECISAO",
          data: { prazo_etapa_ate: prazo.ate, etapa_atual: "DECISAO", prazo_saldo_dias: null, ...(gestor && !p.gestor_id ? { gestor_id: gestor.id } : {}) },
          despacho: `Parecer técnico ${numero} emitido: ${rotulo}.`,
          para_usuario_id: p.gestor_id ?? gestor?.id ?? null,
          publico: true,
          extra: { parecer_id: parecer.id, numero },
        },
      ];
    }

    case "deferir":
    case "indeferir": {
      if (acao === "deferir" && p.tipo_ato.exige_parecer && (await tx.parecer.count({ where: { processo_id: p.id } })) === 0) {
        throw invalido(`Não é possível deferir sem parecer técnico: ${p.tipo_ato.nome} exige parecer.`);
      }
      pos.decisao = true;
      const despacho = acao === "deferir" ? (payload as Payloads["deferir"]).despacho || `Requerimento deferido. Emissão de ${p.tipo_ato.nome} autorizada.` : (payload as Payloads["indeferir"]).motivo;
      if (acao === "indeferir") pos.motivo = despacho ?? undefined;
      return [
        {
          acao,
          para: acao === "deferir" ? "DEFERIDO" : "INDEFERIDO",
          data: { prazo_etapa_ate: null, etapa_atual: null, prazo_pausado: false, prazo_saldo_dias: null, gestor_id: u.id },
          despacho,
          publico: true,
        },
      ];
    }

    case "arquivar": {
      const pl = payload as Payloads["arquivar"];
      const canceladas = await tx.pendencia.updateMany({ where: { processo_id: p.id, status: { in: ["ABERTA", "VENCIDA"] } }, data: { status: "CANCELADA" } });
      return [
        {
          acao: "arquivar",
          para: "ARQUIVADO",
          data: { prazo_etapa_ate: null, etapa_atual: null, prazo_pausado: false, prazo_saldo_dias: null, data_conclusao: agora },
          despacho: pl.justificativa,
          publico: true,
          extra: { pendencias_canceladas: canceladas.count },
        },
      ];
    }

    case "emitir_documento":
      throw new Error("emitir_documento é tratado fora da transação");
  }
}

async function aplicarPasso(tx: Tx, p: ProcessoTx, de: StatusProcesso, passo: Passo, u: UsuarioSessao) {
  const antes = { status: de, tecnico_id: p.tecnico_id, prazo_etapa_ate: p.prazo_etapa_ate, prazo_pausado: p.prazo_pausado, etapa_atual: p.etapa_atual };
  const atualizado = await tx.processo.update({ where: { id: p.id }, data: { ...passo.data, status: passo.para } });
  await tx.tramitacao.create({
    data: { processo_id: p.id, acao: passo.acao, de_status: de, para_status: passo.para, de_usuario_id: u.id, para_usuario_id: passo.para_usuario_id ?? null, despacho: passo.despacho ?? null, publico: passo.publico ?? true },
  });
  await auditar(
    {
      usuario_id: u.id,
      acao: `PROCESSO_${passo.acao.toUpperCase()}`,
      entidade: "processo",
      entidade_id: p.id,
      antes,
      depois: { status: atualizado.status, numero: atualizado.numero, tecnico_id: atualizado.tecnico_id, prazo_etapa_ate: atualizado.prazo_etapa_ate, prazo_pausado: atualizado.prazo_pausado, prazo_saldo_dias: atualizado.prazo_saldo_dias, etapa_atual: atualizado.etapa_atual, despacho: passo.despacho, ...passo.extra },
    },
    tx,
  );
  return atualizado;
}

async function notificarRequerente(requerenteId: string, assunto: string, corpo: string) {
  try {
    const usuarios = await prisma.usuario.findMany({ where: { pessoa_id: requerenteId, ativo: true }, select: { email: true } });
    for (const x of usuarios) await enviarEmail(x.email, assunto, corpo);
  } catch (e) {
    console.error("[processo] falha ao notificar requerente:", e);
  }
}

/** Conclui (DEFERIDO/INDEFERIDO → CONCLUIDO) após o documento da decisão ter sido emitido. */
async function concluirComDocumento(processoId: string, doc: DocumentoOficial, u: UsuarioSessao) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM processo WHERE id = ${processoId}::uuid FOR UPDATE`;
    const p = await tx.processo.findUniqueOrThrow({ where: { id: processoId }, include: INCLUDE });
    if (p.status === "CONCLUIDO") return p;
    if (!destino("emitir_documento", p.status)) throw conflito(`Processo em "${ROTULO_STATUS[p.status]}" não aguarda emissão de documento.`);
    const nome = { LICENCA: "Licença", AUTORIZACAO: "Autorização", CERTIDAO: "Certidão", OFICIO: "Ofício de indeferimento" }[doc.tipo as "LICENCA"] ?? "Documento";
    return aplicarPasso(tx, p, p.status, { acao: "emitir_documento", para: "CONCLUIDO", data: { data_conclusao: new Date() }, despacho: `${nome} nº ${doc.numero} emitido(a) (código ${doc.codigo_verificador}).`, publico: true, extra: { documento_id: doc.id } }, u);
  });
}

async function executarEmissaoDecisao(processoId: string, u: UsuarioSessao, motivo: string | undefined, avisos: string[], documentos: DocumentoOficial[]) {
  const r = await tentarEmitir(() => emitirDocumentoDecisao(processoId, u, motivo));
  if (!r.ok) {
    avisos.push(`A decisão foi registrada, mas o documento não pôde ser emitido agora (${r.erro}). Use "Emitir documento" para tentar novamente.`);
    return null;
  }
  documentos.push(r.valor);
  return concluirComDocumento(processoId, r.valor, u);
}

/**
 * Executa uma ação da máquina de estados sobre o processo.
 * Lança ErroApi: 404 (inexistente), 403 (perfil/escopo), 409 (estado), 422 (pré-requisito/validação).
 */
export async function transicionar(processoId: string, acaoBruta: string, payloadBruto: unknown, usuario: UsuarioSessao): Promise<ResultadoTransicao> {
  const acao = normalizarAcao(acaoBruta);
  if (!acao) throw invalido(`Ação desconhecida: ${acaoBruta}.`);
  if (!UUID_RE.test(processoId)) throw naoEncontrado("Processo não encontrado.");
  const payload = SCHEMAS[acao].parse(payloadBruto ?? {}) as Payloads[AcaoProcesso];
  const avisos: string[] = [];
  const documentos: DocumentoOficial[] = [];

  // Checagem de acesso fora da transação (evita lock para quem não pode).
  const previa = await prisma.processo.findUnique({ where: { id: processoId }, include: INCLUDE });
  if (!previa) throw naoEncontrado("Processo não encontrado.");
  if (!podeVerProcesso(usuario, previa)) throw proibido("Você não tem acesso a este processo.");

  if (acao === "emitir_documento") {
    const ctx = { status: previa.status, municipio_id: previa.municipio_id, requerente_id: previa.requerente_id, rt_pessoa_id: previa.rt?.pessoa_id, delega_decisao: previa.municipio.delega_decisao, exige_parecer: previa.tipo_ato.exige_parecer };
    if (!permitido(usuario, acao, ctx)) throw proibido("Seu perfil não pode emitir o documento deste processo.");
    if (!destino(acao, previa.status)) throw conflito(`Ação "${ROTULO_ACAO[acao]}" não permitida em "${ROTULO_STATUS[previa.status]}".`);
    const r = await tentarEmitir(() => emitirDocumentoDecisao(processoId, usuario));
    if (!r.ok) throw new ErroApi(502, "FALHA_EMISSAO", `Não foi possível emitir o documento: ${r.erro}`);
    documentos.push(r.valor);
    const p = await concluirComDocumento(processoId, r.valor, usuario);
    await notificarRequerente(p.requerente_id, `Processo ${p.numero} concluído`, `<p>O processo <strong>${esc(p.numero)}</strong> foi concluído. O documento ${esc(r.valor.numero)} está disponível em "Meus processos".</p>`);
    return { processo: { id: p.id, numero: p.numero, status: p.status }, avisos, documentos: documentos.map(resumir) };
  }

  const pos: PosCommit = {};
  const final = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM processo WHERE id = ${processoId}::uuid FOR UPDATE`;
      let p = await tx.processo.findUniqueOrThrow({ where: { id: processoId }, include: INCLUDE });
      const ctx = { status: p.status, municipio_id: p.municipio_id, requerente_id: p.requerente_id, rt_pessoa_id: p.rt?.pessoa_id, delega_decisao: p.municipio.delega_decisao, exige_parecer: p.tipo_ato.exige_parecer };
      if (!permitido(usuario, acao, ctx)) throw proibido(`Seu perfil não pode executar "${ROTULO_ACAO[acao]}" neste processo.`);
      if (!destino(acao, p.status)) throw conflito(`Ação "${ROTULO_ACAO[acao]}" não permitida no status "${ROTULO_STATUS[p.status]}".`);
      const passos = await montarPassos(tx, p, acao, payload, usuario, pos);
      let atual = p.status;
      for (const passo of passos) {
        await aplicarPasso(tx, p, atual, passo, usuario);
        atual = passo.para;
        p = await tx.processo.findUniqueOrThrow({ where: { id: processoId }, include: INCLUDE });
      }
      return p;
    },
    { timeout: 30000, maxWait: 10000 },
  );

  // ── Pós-commit: documentos (lentos) e notificações ──
  let resultado = { id: final.id, numero: final.numero, status: final.status };
  if (pos.recibo) {
    const r = await tentarEmitir(() => emitirRecibo(final.id, usuario));
    if (r.ok) documentos.push(r.valor);
    else avisos.push(`Processo protocolado, mas o recibo PDF não pôde ser gerado agora (${r.erro}). Tente "Gerar recibo" novamente mais tarde.`);
  }
  if (pos.parecerId) {
    const r = await tentarEmitir(() => emitirPdfParecer(pos.parecerId!, usuario));
    if (r.ok) documentos.push(r.valor);
    else avisos.push(`Parecer registrado, mas o PDF não pôde ser gerado agora (${r.erro}). Use "Gerar PDF do parecer" na aba Parecer.`);
  }
  if (pos.decisao) {
    const concl = await executarEmissaoDecisao(final.id, usuario, pos.motivo, avisos, documentos);
    if (concl) {
      resultado = { id: concl.id, numero: concl.numero, status: concl.status };
      const tipo = final.status === "DEFERIDO" ? tipoDocumentoDoAto(final.tipo_ato.categoria) : "OFICIO";
      await notificarRequerente(final.requerente_id, `Processo ${final.numero} concluído`, `<p>O processo <strong>${esc(final.numero)}</strong> foi ${final.status === "DEFERIDO" ? "deferido" : "indeferido"} e concluído. O documento (${tipo}) está disponível em "Meus processos".</p>`);
    }
  }
  if (pos.emailRequerente) await notificarRequerente(final.requerente_id, pos.emailRequerente.assunto, pos.emailRequerente.corpo);

  return { processo: resultado, avisos, documentos: documentos.map(resumir) };
}
