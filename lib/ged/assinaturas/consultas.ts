// Consultas de leitura do fluxo de assinatura (painel, aba do documento, tela de assinar). Tudo via ctx.db (escopo do
// cliente) e, nas listas, filtrando documentos visíveis com whereGedVisivel(ctx, "VER").
import "server-only";
import type { GedModoAssinatura, GedStatusAssinante, GedStatusSolicitacao, Prisma } from "@prisma/client";
import type { CtxGed } from "../contratos";
import { exigirEncontrado } from "../db";
import { exigirDocumento, whereGedVisivel } from "../permissoes";
import { daVez, podeAssinarAgora, prazoExpirado, todosAssinaram } from "./regras";

export type AssinanteView = {
  id: string;
  usuario_id: string;
  nome: string;
  cargo: string | null;
  ordem: number;
  rotulo: string;
  status: GedStatusAssinante;
  visualizou_em: Date | null;
  assinado_em: Date | null;
  recusado_em: Date | null;
  justificativa_recusa: string | null;
  metodo: string | null;
  hash_cadeia: string | null;
  eu: boolean;
};

export type SolicitacaoView = {
  id: string;
  documento_id: string;
  versao_id: string;
  versao_n: number | null;
  modo: GedModoAssinatura;
  status: GedStatusSolicitacao;
  prazo_em: Date;
  mensagem: string | null;
  criada_por_id: string;
  criada_por_nome: string;
  created_at: Date;
  concluida_em: Date | null;
  versao_selo_id: string | null;
  sha256_alvo: string;
  assinantes: AssinanteView[];
  /** Eu sou signatário e é a minha vez de assinar agora. */
  minha_vez: boolean;
  meu_assinante_id: string | null;
  da_vez_nome: string | null;
  /** Todos assinaram mas o selo ainda não foi gravado (falha temporária; o job refaz). */
  selo_pendente: boolean;
  prazo_vencido: boolean;
};

async function nomesDe(ctx: CtxGed, ids: string[]) {
  const l = ids.length ? await ctx.db.usuario.findMany({ where: { id: { in: [...new Set(ids)] }, organizacao_id: ctx.organizacao_id }, select: { id: true, nome: true, cargo: true } }) : [];
  return new Map(l.map((u) => [u.id, u]));
}

type SolBruta = Prisma.GedSolicitacaoAssinaturaGetPayload<{ include: { assinantes: true } }>;

async function montarViews(ctx: CtxGed, sols: SolBruta[]): Promise<SolicitacaoView[]> {
  const usuarios = await nomesDe(ctx, sols.flatMap((s) => [s.criada_por_id, ...s.assinantes.map((a) => a.usuario_id)]));
  const vids = [...new Set(sols.map((s) => s.versao_id))];
  const versoes = vids.length ? await ctx.db.gedVersaoDocumento.findMany({ where: { id: { in: vids } }, select: { id: true, n: true } }) : [];
  const nv = new Map(versoes.map((v) => [v.id, v.n]));
  const agora = new Date();
  return sols.map((s) => {
    const ass = [...s.assinantes].sort((a, b) => a.ordem - b.ordem);
    const eu = ass.find((a) => a.usuario_id === ctx.usuario.id) ?? null;
    const vez = s.status === "ABERTA" ? daVez(ass) : null;
    return {
      id: s.id,
      documento_id: s.documento_id,
      versao_id: s.versao_id,
      versao_n: nv.get(s.versao_id) ?? null,
      modo: s.modo,
      status: s.status,
      prazo_em: s.prazo_em,
      mensagem: s.mensagem,
      criada_por_id: s.criada_por_id,
      criada_por_nome: usuarios.get(s.criada_por_id)?.nome ?? "Usuário",
      created_at: s.created_at,
      concluida_em: s.concluida_em,
      versao_selo_id: s.versao_selo_id,
      sha256_alvo: s.sha256_alvo,
      assinantes: ass.map((a) => ({
        id: a.id, usuario_id: a.usuario_id, nome: usuarios.get(a.usuario_id)?.nome ?? "Usuário", cargo: usuarios.get(a.usuario_id)?.cargo ?? null,
        ordem: a.ordem, rotulo: a.rotulo, status: a.status, visualizou_em: a.visualizou_em, assinado_em: a.assinado_em, recusado_em: a.recusado_em,
        justificativa_recusa: a.justificativa_recusa, metodo: a.metodo, hash_cadeia: a.hash_cadeia, eu: a.usuario_id === ctx.usuario.id,
      })),
      minha_vez: s.status === "ABERTA" && !!eu && podeAssinarAgora(s.modo, ass, eu.id),
      meu_assinante_id: eu?.id ?? null,
      da_vez_nome: vez ? (usuarios.get(vez.usuario_id!)?.nome ?? null) : null,
      selo_pendente: s.status === "ABERTA" && todosAssinaram(ass),
      prazo_vencido: s.status === "ABERTA" && prazoExpirado(s.prazo_em, agora),
    };
  });
}

/** Solicitações (mais recente primeiro) de um documento. Exige VER. */
export async function solicitacoesDoDocumento(ctx: CtxGed, documentoId: string, take = 20): Promise<SolicitacaoView[]> {
  await exigirDocumento(ctx, documentoId, "VER");
  const l = await ctx.db.gedSolicitacaoAssinatura.findMany({ where: { documento_id: documentoId }, include: { assinantes: true }, orderBy: { created_at: "desc" }, take });
  return montarViews(ctx, l);
}

export type ComentarioAssinaturaView = { id: string; autor_nome: string; contexto: string; texto: string; created_at: Date; solicitacao_id: string | null };

/** Comentários do contexto de assinatura (ASSINATURA/RECUSA) – de uma solicitação ou de todo o documento. */
export async function comentariosDeAssinatura(ctx: CtxGed, documentoId: string, solicitacaoId?: string, take = 200): Promise<ComentarioAssinaturaView[]> {
  const l = await ctx.db.gedComentario.findMany({
    where: { documento_id: documentoId, contexto: { in: ["ASSINATURA", "RECUSA"] }, ...(solicitacaoId ? { solicitacao_id: solicitacaoId } : {}) },
    orderBy: { created_at: "asc" },
    take,
    select: { id: true, autor_id: true, contexto: true, texto: true, created_at: true, solicitacao_id: true },
  });
  const nomes = await nomesDe(ctx, l.map((c) => c.autor_id));
  return l.map((c) => ({ id: c.id, autor_nome: nomes.get(c.autor_id)?.nome ?? "Usuário", contexto: c.contexto, texto: c.texto, created_at: c.created_at, solicitacao_id: c.solicitacao_id }));
}

/** Detalhe para a tela de assinar: solicitação + documento + comentários. 404 se o usuário não vê o documento. */
export async function detalheSolicitacao(ctx: CtxGed, solicitacaoId: string) {
  const s = exigirEncontrado(await ctx.db.gedSolicitacaoAssinatura.findUnique({ where: { id: solicitacaoId }, include: { assinantes: true } }), "Solicitação não encontrada.");
  const { doc, acoes } = await exigirDocumento(ctx, s.documento_id, "VER", { semMemo: true });
  const [view] = await montarViews(ctx, [s]);
  const documento = exigirEncontrado(await ctx.db.gedDocumento.findUnique({ where: { id: s.documento_id }, select: { id: true, numero: true, titulo: true, status: true, sensibilidade: true, codigo_verificador: true, sha256_final: true } }));
  const comentarios = await comentariosDeAssinatura(ctx, s.documento_id, s.id);
  return { solicitacao: view, documento, comentarios, acoes, documento_min: doc };
}

// ───────────── Painel ─────────────

export const ABAS_PAINEL = ["aguardando", "enviadas", "concluidas", "recusadas"] as const;
export type AbaPainel = (typeof ABAS_PAINEL)[number];
export const ROTULO_ABA: Record<AbaPainel, string> = {
  aguardando: "Aguardando minha assinatura",
  enviadas: "Enviadas por mim",
  concluidas: "Concluídas",
  recusadas: "Recusadas/Expiradas",
};

export type LinhaPainel = SolicitacaoView & { documento: { id: string; numero: string; titulo: string } };

export async function painelAssinaturas(ctx: CtxGed, p: { aba: AbaPainel; page?: number; size?: number; q?: string; status?: GedStatusSolicitacao }) {
  const page = Math.max(1, p.page ?? 1);
  const size = Math.min(50, Math.max(1, p.size ?? 15));
  const me = ctx.usuario.id;
  const visivel = await whereGedVisivel(ctx, "VER");
  const meEnvolvi: Prisma.GedSolicitacaoAssinaturaWhereInput = { OR: [{ criada_por_id: me }, { assinantes: { some: { usuario_id: me } } }] };
  const termo = (p.q ?? "").trim();
  const busca: Prisma.GedSolicitacaoAssinaturaWhereInput = termo
    ? { documento: { is: { OR: [{ titulo: { contains: termo, mode: "insensitive" } }, { numero: { contains: termo, mode: "insensitive" } }] } } }
    : {};
  let filtro: Prisma.GedSolicitacaoAssinaturaWhereInput;
  switch (p.aba) {
    case "aguardando": filtro = { status: "ABERTA", assinantes: { some: { usuario_id: me, status: "PENDENTE" } } }; break;
    case "enviadas": filtro = { criada_por_id: me, ...(p.status ? { status: p.status } : {}) }; break;
    case "concluidas": filtro = { status: "CONCLUIDA", ...meEnvolvi }; break;
    default: filtro = { status: { in: ["RECUSADA", "EXPIRADA"] }, ...meEnvolvi };
  }
  const where: Prisma.GedSolicitacaoAssinaturaWhereInput = { AND: [filtro, busca, { documento: { is: visivel } }] };
  const [total, l] = await Promise.all([
    ctx.db.gedSolicitacaoAssinatura.count({ where }),
    ctx.db.gedSolicitacaoAssinatura.findMany({
      where,
      include: { assinantes: true },
      orderBy: p.aba === "aguardando" ? [{ prazo_em: "asc" }] : [{ created_at: "desc" }],
      skip: (page - 1) * size,
      take: size,
    }),
  ]);
  const views = await montarViews(ctx, l);
  const docs = l.length ? await ctx.db.gedDocumento.findMany({ where: { id: { in: [...new Set(l.map((s) => s.documento_id))] } }, select: { id: true, numero: true, titulo: true } }) : [];
  const dm = new Map(docs.map((d) => [d.id, d]));
  const linhas: LinhaPainel[] = views.map((v) => ({ ...v, documento: dm.get(v.documento_id) ?? { id: v.documento_id, numero: "—", titulo: "—" } }));
  return { linhas, total, page, size };
}

/** Quantas solicitações aguardam a minha assinatura (selo no menu/painel). */
export async function contarAguardandoMinhaAssinatura(ctx: CtxGed): Promise<number> {
  const visivel = await whereGedVisivel(ctx, "VER");
  return ctx.db.gedSolicitacaoAssinatura.count({ where: { status: "ABERTA", assinantes: { some: { usuario_id: ctx.usuario.id, status: "PENDENTE" } }, documento: { is: visivel } } });
}
