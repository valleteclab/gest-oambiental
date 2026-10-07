// Serviço de trâmite (contrato em lib/ged/contratos.ts). Roda DENTRO da transação escopada do chamador (`tx`):
// não abre transação, não checa permissão (quem chama já fez via exigirDocumento), audita via auditarGed e valida que
// usuário/setor de destino pertencem ao mesmo cliente (o trigger ged_mesmo_tenant é só o último recurso).
// O histórico (ged_tramite) é imutável: só INSERT.
import type { GedAcao, Prisma } from "@prisma/client";
import { invalido } from "@/lib/http";
import { auditarGed } from "../auditoria";
import type { CtxGed, GedTx, RegistrarTramiteInput } from "../contratos";
import { exigirEncontrado } from "../db";
import { TETO_ACOES } from "../papeis";
import { notificarSePossivel } from "./notificacao";
import {
  entregaMaisRecente, exigirStatusPermite, fmtDataHoraBR, novaPosse, resolverRemetenteAnterior, statusAposTramite, TIPOS_QUE_MOVEM,
  validarEntradaTramite, type LinhaTramite,
} from "./regras";

const PAPEIS_QUE_TRAMITAM = (Object.keys(TETO_ACOES) as (keyof typeof TETO_ACOES)[]).filter((p) => (TETO_ACOES[p] as readonly GedAcao[]).includes("TRAMITAR"));

/** Usuários do cliente aptos a receber trâmite (ativos, com GedMembro ativo e papel que permite TRAMITAR). */
export async function usuariosAptosAReceber(tx: GedTx, ctx: Pick<CtxGed, "organizacao_id">, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const l = await tx.gedMembro.findMany({
    where: { usuario_id: { in: ids }, ativo: true, papel: { in: PAPEIS_QUE_TRAMITAM }, usuario: { is: { ativo: true, organizacao_id: ctx.organizacao_id } } },
    select: { usuario_id: true },
  });
  return l.map((m) => m.usuario_id);
}

/** Valida o destinatário e devolve quem será notificado. Lança 422 se for de outro cliente, inativo ou sem papel adequado. */
export async function resolverDestinatario(
  tx: GedTx,
  ctx: Pick<CtxGed, "organizacao_id" | "usuario">,
  para: { usuario_id: string | null; setor_id: string | null },
): Promise<{ notificar: string[]; rotulo: string }> {
  if (para.usuario_id) {
    const u = await tx.usuario.findFirst({ where: { id: para.usuario_id, organizacao_id: ctx.organizacao_id, ativo: true }, select: { id: true, nome: true } });
    if (!u) throw invalido("Destinatário não encontrado nesta organização.");
    const aptos = await usuariosAptosAReceber(tx, ctx, [u.id]);
    if (aptos.length === 0) throw invalido("O destinatário não tem acesso ativo ao módulo ou seu papel não permite tramitar documentos.");
    return { notificar: u.id === ctx.usuario.id ? [] : [u.id], rotulo: u.nome };
  }
  if (para.setor_id) {
    const s = await tx.gedSetor.findFirst({ where: { id: para.setor_id, ativo: true }, select: { id: true, nome: true } });
    if (!s) throw invalido("Setor não encontrado nesta organização.");
    const membros = await tx.gedSetorMembro.findMany({ where: { setor_id: s.id }, select: { usuario_id: true } });
    const aptos = await usuariosAptosAReceber(tx, ctx, membros.map((m) => m.usuario_id));
    if (aptos.length === 0) throw invalido("O setor não tem nenhum participante ativo apto a receber documentos.");
    return { notificar: aptos.filter((id) => id !== ctx.usuario.id), rotulo: s.nome };
  }
  throw invalido("Destinatário não informado.");
}

/** Registra um trâmite imutável (e atualiza setor_atual_id/responsavel_id/status do documento de forma coerente). */
export async function registrarTramite(tx: GedTx, ctx: CtxGed, input: RegistrarTramiteInput): Promise<{ id: string }> {
  const { despacho } = validarEntradaTramite({ ...input });
  const doc = exigirEncontrado(
    await tx.gedDocumento.findUnique({ where: { id: input.documento_id }, select: { id: true, status: true, responsavel_id: true, setor_atual_id: true } }),
    "Documento não encontrado.",
  );
  exigirStatusPermite(input.tipo, doc.status);

  const historico: LinhaTramite[] = await tx.gedTramite.findMany({
    where: { documento_id: doc.id },
    orderBy: [{ created_at: "asc" }],
    select: { id: true, tipo: true, de_usuario_id: true, de_setor_id: true, para_usuario_id: true, para_setor_id: true, referencia_id: true },
  });

  const me = ctx.usuario.id;
  // Remetente "de" = eu, atuando a partir do setor que detém o documento (se eu pertenço a ele).
  const deSetor = doc.setor_atual_id && ctx.setor_ids.includes(doc.setor_atual_id) ? doc.setor_atual_id : null;

  let para: { usuario_id: string | null; setor_id: string | null } = { usuario_id: null, setor_id: null };
  let referencia: string | null = null;

  if (input.tipo === "ENVIO") {
    para = { usuario_id: input.para_usuario_id ?? null, setor_id: input.para_setor_id ?? null };
    if (para.usuario_id === me) throw invalido("Você não pode enviar o documento para si mesmo.");
  } else if (input.tipo === "DEVOLUCAO") {
    const anterior = resolverRemetenteAnterior(historico);
    if (!anterior) throw invalido("Não há remetente anterior: o documento não foi recebido por trâmite.");
    para = { usuario_id: anterior.usuario_id, setor_id: anterior.setor_id };
  } else if (input.tipo === "CIENCIA") {
    const entrega = input.referencia_id
      ? historico.find((l) => l.id === input.referencia_id && TIPOS_QUE_MOVEM.includes(l.tipo))
      : entregaMaisRecente(historico, me, ctx.setor_ids);
    if (!entrega) throw invalido("Não há envio recebido por você para dar ciência.");
    if (historico.some((l) => l.tipo === "CIENCIA" && l.referencia_id === entrega.id)) throw invalido("A ciência deste envio já foi registrada.");
    referencia = entrega.id;
  }

  let notificar: string[] = [];
  if (TIPOS_QUE_MOVEM.includes(input.tipo)) {
    const dest = await resolverDestinatario(tx, ctx, para);
    notificar = dest.notificar;
  }

  const criado = await tx.gedTramite.create({
    data: {
      documento_id: doc.id,
      tipo: input.tipo,
      de_usuario_id: me,
      de_setor_id: deSetor,
      para_usuario_id: para.usuario_id,
      para_setor_id: para.setor_id,
      despacho,
      prazo_em: input.tipo === "ENVIO" ? (input.prazo_em ?? null) : null,
      referencia_id: referencia,
    } as Prisma.GedTramiteUncheckedCreateInput,
    select: { id: true },
  });

  const posse = novaPosse(para, input.tipo, { responsavel_id: doc.responsavel_id, setor_atual_id: doc.setor_atual_id });
  const status = statusAposTramite(input.tipo, doc.status);
  const mudou = posse.responsavel_id !== doc.responsavel_id || posse.setor_atual_id !== doc.setor_atual_id || status !== doc.status;
  if (mudou) {
    await tx.gedDocumento.update({ where: { id: doc.id }, data: { responsavel_id: posse.responsavel_id, setor_atual_id: posse.setor_atual_id, status } });
  }

  await auditarGed(
    ctx,
    {
      acao: `GED_TRAMITE_${input.tipo}`,
      entidade: "ged_documento",
      entidade_id: doc.id,
      antes: { responsavel_id: doc.responsavel_id, setor_atual_id: doc.setor_atual_id, status: doc.status },
      depois: { tramite_id: criado.id, tipo: input.tipo, para_usuario_id: para.usuario_id, para_setor_id: para.setor_id, prazo_em: input.prazo_em ?? null, referencia_id: referencia, responsavel_id: posse.responsavel_id, setor_atual_id: posse.setor_atual_id, status },
    },
    tx,
  );

  if (notificar.length) {
    const dados: Record<string, string> = { remetente: ctx.usuario.nome, tipo: input.tipo };
    if (despacho) dados.despacho = despacho.slice(0, 500);
    if (input.prazo_em) dados.prazo = fmtDataHoraBR(input.prazo_em);
    await notificarSePossivel(tx, ctx, "TRAMITE_RECEBIDO", { usuario_ids: notificar, documento_id: doc.id, dados });
  }
  return { id: criado.id };
}
