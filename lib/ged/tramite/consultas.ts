// Consultas de trâmite: linha do tempo do documento e caixas (entrada / enviados).
// Visibilidade SEMPRE via whereGedVisivel(ctx,"VER") AND-ed com as condições do trâmite.
import type { GedStatusDocumento, GedTipoTramite, Prisma } from "@prisma/client";
import { diasRestantes, semaforo, type Semaforo } from "@/lib/dias";
import type { CtxGed } from "../contratos";
import { exigirDocumento, whereGedVisivel } from "../permissoes";
import { TETO_ACOES } from "../papeis";
import { entregaMaisRecente, ehDestinatarioAtual, resolverRemetenteAnterior, TIPOS_QUE_MOVEM, type LinhaTramite } from "./regras";

/** Teto de documentos analisados por caixa (cálculo de ciência/prazo em memória). */
export const LIMITE_CAIXA = 1000;
export const DIAS_ALERTA_PRAZO = 3;

// ───────────── Linha do tempo ─────────────

export type EventoTramiteView = {
  id: string;
  tipo: GedTipoTramite;
  created_at: Date;
  de_nome: string | null;
  de_setor_nome: string | null;
  para_nome: string | null;
  para_setor_nome: string | null;
  despacho: string | null;
  prazo_em: Date | null;
  semaforo: Semaforo;
  /** Só em ENVIO/DEVOLUCAO: ciência registrada? */
  ciencia: { dada: boolean; por_nome?: string | null; em?: Date } | null;
  referencia_id: string | null;
};

type NomesMapa = { usuarios: Map<string, string>; setores: Map<string, string> };

async function carregarNomes(ctx: CtxGed, usuarioIds: (string | null)[], setorIds: (string | null)[]): Promise<NomesMapa> {
  const u = [...new Set(usuarioIds.filter((x): x is string => !!x))];
  const s = [...new Set(setorIds.filter((x): x is string => !!x))];
  const [us, ss] = await Promise.all([
    u.length ? ctx.db.usuario.findMany({ where: { id: { in: u }, organizacao_id: ctx.organizacao_id }, select: { id: true, nome: true } }) : [],
    s.length ? ctx.db.gedSetor.findMany({ where: { id: { in: s } }, select: { id: true, nome: true } }) : [],
  ]);
  return { usuarios: new Map(us.map((x) => [x.id, x.nome])), setores: new Map(ss.map((x) => [x.id, x.nome])) };
}

/** Histórico completo (mais antigo primeiro). Exige VER no documento. */
export async function linhaDoTempo(ctx: CtxGed, documentoId: string): Promise<EventoTramiteView[]> {
  await exigirDocumento(ctx, documentoId, "VER");
  const l = await ctx.db.gedTramite.findMany({ where: { documento_id: documentoId }, orderBy: { created_at: "asc" }, take: 1000 });
  const nomes = await carregarNomes(ctx, l.flatMap((t) => [t.de_usuario_id, t.para_usuario_id]), l.flatMap((t) => [t.de_setor_id, t.para_setor_id]));
  const cienciaPor = new Map(l.filter((t) => t.tipo === "CIENCIA" && t.referencia_id).map((t) => [t.referencia_id!, t]));
  return l.map((t) => {
    const c = TIPOS_QUE_MOVEM.includes(t.tipo) ? cienciaPor.get(t.id) : undefined;
    return {
      id: t.id,
      tipo: t.tipo,
      created_at: t.created_at,
      de_nome: t.de_usuario_id ? (nomes.usuarios.get(t.de_usuario_id) ?? "Usuário") : null,
      de_setor_nome: t.de_setor_id ? (nomes.setores.get(t.de_setor_id) ?? null) : null,
      para_nome: t.para_usuario_id ? (nomes.usuarios.get(t.para_usuario_id) ?? "Usuário") : null,
      para_setor_nome: t.para_setor_id ? (nomes.setores.get(t.para_setor_id) ?? null) : null,
      despacho: t.despacho,
      prazo_em: t.prazo_em,
      semaforo: t.tipo === "ENVIO" && !c ? semaforo(t.prazo_em, DIAS_ALERTA_PRAZO) : "cinza",
      ciencia: TIPOS_QUE_MOVEM.includes(t.tipo) ? (c ? { dada: true, por_nome: c.de_usuario_id ? (nomes.usuarios.get(c.de_usuario_id) ?? null) : null, em: c.created_at } : { dada: false }) : null,
      referencia_id: t.referencia_id,
    };
  });
}

/** Destinatário atual (nome do usuário e/ou setor) para o cabeçalho da aba. */
export async function posseAtual(ctx: CtxGed, documentoId: string) {
  const d = await ctx.db.gedDocumento.findUnique({ where: { id: documentoId }, select: { responsavel_id: true, setor_atual_id: true, status: true } });
  if (!d) return null;
  const nomes = await carregarNomes(ctx, [d.responsavel_id], [d.setor_atual_id]);
  return {
    responsavel_id: d.responsavel_id,
    setor_atual_id: d.setor_atual_id,
    responsavel_nome: d.responsavel_id ? (nomes.usuarios.get(d.responsavel_id) ?? null) : null,
    setor_nome: d.setor_atual_id ? (nomes.setores.get(d.setor_atual_id) ?? null) : null,
    status: d.status,
    sou_destinatario: ehDestinatarioAtual(d, ctx.usuario.id, ctx.setor_ids),
  };
}

/** Existe entrega para mim ainda sem ciência? (para mostrar o botão "Dar ciência") */
export async function cienciaPendenteDoDocumento(ctx: CtxGed, documentoId: string): Promise<boolean> {
  const hist = await ctx.db.gedTramite.findMany({
    where: { documento_id: documentoId, tipo: { in: ["ENVIO", "DEVOLUCAO", "CIENCIA"] } },
    orderBy: { created_at: "asc" },
    select: { id: true, tipo: true, de_usuario_id: true, de_setor_id: true, para_usuario_id: true, para_setor_id: true, referencia_id: true },
  });
  const entrega = entregaMaisRecente(hist as LinhaTramite[], ctx.usuario.id, ctx.setor_ids);
  return !!entrega && !hist.some((h) => h.tipo === "CIENCIA" && h.referencia_id === entrega.id);
}

// ───────────── Caixa de entrada ─────────────

export type ItemEntrada = {
  documento_id: string;
  numero: string;
  titulo: string;
  status: GedStatusDocumento;
  recebido_em: Date | null;
  remetente_nome: string | null;
  despacho: string | null;
  prazo_em: Date | null;
  semaforo: Semaforo;
  dias: number | null;
  ciencia_pendente: boolean;
  via_setor: boolean;
};

export type FiltroEntrada = "todos" | "pendentes" | "vencidos" | "vencendo";
export const FILTROS_ENTRADA: { valor: FiltroEntrada; rotulo: string }[] = [
  { valor: "todos", rotulo: "Todos" },
  { valor: "pendentes", rotulo: "Ciência pendente" },
  { valor: "vencidos", rotulo: "Prazo vencido" },
  { valor: "vencendo", rotulo: `Vencendo (até ${DIAS_ALERTA_PRAZO} dias)` },
];

const SELECT_LINHA = { id: true, documento_id: true, tipo: true, de_usuario_id: true, de_setor_id: true, para_usuario_id: true, para_setor_id: true, referencia_id: true, despacho: true, prazo_em: true, created_at: true } satisfies Prisma.GedTramiteSelect;

/** Todos os itens da caixa de entrada (até LIMITE_CAIXA), do mais urgente ao mais antigo. */
export async function carregarCaixaEntrada(ctx: CtxGed, q?: string): Promise<ItemEntrada[]> {
  const me = ctx.usuario.id;
  const busca = (q ?? "").trim();
  const where: Prisma.GedDocumentoWhereInput = {
    AND: [
      await whereGedVisivel(ctx, "VER"),
      { excluido_em: null, status: { not: "ARQUIVADO" }, OR: [{ responsavel_id: me }, { setor_atual_id: { in: ctx.setor_ids } }] },
      ...(busca ? [{ OR: [{ titulo: { contains: busca, mode: "insensitive" as const } }, { numero: { contains: busca, mode: "insensitive" as const } }] }] : []),
    ],
  };
  const docs = await ctx.db.gedDocumento.findMany({ where, orderBy: { updated_at: "desc" }, take: LIMITE_CAIXA, select: { id: true, numero: true, titulo: true, status: true, responsavel_id: true } });
  if (docs.length === 0) return [];
  const linhas = await ctx.db.gedTramite.findMany({
    where: { documento_id: { in: docs.map((d) => d.id) }, tipo: { in: ["ENVIO", "DEVOLUCAO", "CIENCIA"] } },
    orderBy: { created_at: "asc" },
    select: SELECT_LINHA,
  });
  const porDoc = new Map<string, typeof linhas>();
  for (const l of linhas) porDoc.set(l.documento_id, [...(porDoc.get(l.documento_id) ?? []), l]);
  const nomes = await carregarNomes(ctx, linhas.map((l) => l.de_usuario_id), []);

  const itens = docs.map<ItemEntrada>((d) => {
    const hist = porDoc.get(d.id) ?? [];
    const entrega = entregaMaisRecente(hist as LinhaTramite[], me, ctx.setor_ids) as (typeof hist)[number] | null;
    const dada = !!entrega && hist.some((h) => h.tipo === "CIENCIA" && h.referencia_id === entrega.id);
    const prazo = entrega?.tipo === "ENVIO" ? entrega.prazo_em : null;
    return {
      documento_id: d.id,
      numero: d.numero,
      titulo: d.titulo,
      status: d.status,
      recebido_em: entrega?.created_at ?? null,
      remetente_nome: entrega?.de_usuario_id ? (nomes.usuarios.get(entrega.de_usuario_id) ?? null) : null,
      despacho: entrega?.despacho ?? null,
      prazo_em: prazo,
      semaforo: dada ? "cinza" : semaforo(prazo, DIAS_ALERTA_PRAZO),
      dias: prazo && !dada ? diasRestantes(prazo) : null,
      ciencia_pendente: !!entrega && !dada,
      via_setor: d.responsavel_id !== me,
    };
  });
  const peso = (i: ItemEntrada) => (i.semaforo === "vermelho" ? 0 : i.semaforo === "amarelo" ? 1 : i.ciencia_pendente ? 2 : 3);
  return itens.sort((a, b) => peso(a) - peso(b) || (b.recebido_em?.getTime() ?? 0) - (a.recebido_em?.getTime() ?? 0));
}

export const aplicarFiltroEntrada = (itens: ItemEntrada[], f: FiltroEntrada): ItemEntrada[] =>
  f === "pendentes" ? itens.filter((i) => i.ciencia_pendente) : f === "vencidos" ? itens.filter((i) => i.semaforo === "vermelho") : f === "vencendo" ? itens.filter((i) => i.semaforo === "amarelo") : itens;

// ───────────── Enviados por mim ─────────────

export type ItemEnviado = {
  tramite_id: string;
  documento_id: string;
  numero: string;
  titulo: string;
  enviado_em: Date;
  para_nome: string | null;
  para_setor_nome: string | null;
  despacho: string | null;
  prazo_em: Date | null;
  semaforo: Semaforo;
  ciencia: { dada: boolean; por_nome?: string | null; em?: Date };
};
export type FiltroEnviados = "todos" | "sem_ciencia" | "com_ciencia";
export const FILTROS_ENVIADOS: { valor: FiltroEnviados; rotulo: string }[] = [
  { valor: "todos", rotulo: "Todos" },
  { valor: "sem_ciencia", rotulo: "Sem ciência" },
  { valor: "com_ciencia", rotulo: "Com ciência" },
];

export async function carregarEnviados(ctx: CtxGed, q?: string): Promise<ItemEnviado[]> {
  const busca = (q ?? "").trim();
  const docWhere: Prisma.GedDocumentoWhereInput = {
    AND: [
      await whereGedVisivel(ctx, "VER"),
      { excluido_em: null },
      ...(busca ? [{ OR: [{ titulo: { contains: busca, mode: "insensitive" as const } }, { numero: { contains: busca, mode: "insensitive" as const } }] }] : []),
    ],
  };
  const envios = await ctx.db.gedTramite.findMany({
    where: { tipo: "ENVIO", de_usuario_id: ctx.usuario.id, documento: { is: docWhere } },
    orderBy: { created_at: "desc" },
    take: LIMITE_CAIXA,
    select: { ...SELECT_LINHA, documento: { select: { numero: true, titulo: true } } },
  });
  if (envios.length === 0) return [];
  const cienciasL = await ctx.db.gedTramite.findMany({ where: { tipo: "CIENCIA", referencia_id: { in: envios.map((e) => e.id) } }, select: { referencia_id: true, de_usuario_id: true, created_at: true } });
  const ciencias = new Map(cienciasL.map((c) => [c.referencia_id!, c]));
  const nomes = await carregarNomes(ctx, [...envios.map((e) => e.para_usuario_id), ...cienciasL.map((c) => c.de_usuario_id)], envios.map((e) => e.para_setor_id));
  return envios.map((e) => {
    const c = ciencias.get(e.id);
    return {
      tramite_id: e.id,
      documento_id: e.documento_id,
      numero: e.documento.numero,
      titulo: e.documento.titulo,
      enviado_em: e.created_at,
      para_nome: e.para_usuario_id ? (nomes.usuarios.get(e.para_usuario_id) ?? "Usuário") : null,
      para_setor_nome: e.para_setor_id ? (nomes.setores.get(e.para_setor_id) ?? null) : null,
      despacho: e.despacho,
      prazo_em: e.prazo_em,
      semaforo: c ? "cinza" : semaforo(e.prazo_em, DIAS_ALERTA_PRAZO),
      ciencia: c ? { dada: true, por_nome: c.de_usuario_id ? (nomes.usuarios.get(c.de_usuario_id) ?? null) : null, em: c.created_at } : { dada: false },
    };
  });
}

export const aplicarFiltroEnviados = (itens: ItemEnviado[], f: FiltroEnviados): ItemEnviado[] =>
  f === "sem_ciencia" ? itens.filter((i) => !i.ciencia.dada) : f === "com_ciencia" ? itens.filter((i) => i.ciencia.dada) : itens;

// ───────────── Opções de destinatário ─────────────

const PAPEIS_TRAMITAM = (Object.keys(TETO_ACOES) as (keyof typeof TETO_ACOES)[]).filter((p) => (TETO_ACOES[p] as readonly string[]).includes("TRAMITAR"));

/** Usuários (ativos, papel que tramita, exceto o próprio) e setores ativos do cliente, para o seletor "Enviar para". */
export async function opcoesDestinatarios(ctx: CtxGed) {
  const [membros, setores] = await Promise.all([
    ctx.db.gedMembro.findMany({ where: { ativo: true, papel: { in: PAPEIS_TRAMITAM }, usuario_id: { not: ctx.usuario.id }, usuario: { is: { ativo: true, organizacao_id: ctx.organizacao_id } } }, select: { usuario: { select: { id: true, nome: true, cargo: true } } } }),
    ctx.db.gedSetor.findMany({ where: { ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true, sigla: true } }),
  ]);
  return {
    usuarios: membros.map((m) => m.usuario).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    setores,
  };
}

/** Há remetente anterior a quem devolver? (mostra/oculta o botão "Devolver") */
export async function haRemetenteAnterior(ctx: CtxGed, documentoId: string): Promise<boolean> {
  const h = await ctx.db.gedTramite.findMany({
    where: { documento_id: documentoId, tipo: { in: ["ENVIO", "DEVOLUCAO"] } },
    orderBy: { created_at: "asc" },
    select: { id: true, tipo: true, de_usuario_id: true, de_setor_id: true, para_usuario_id: true, para_setor_id: true },
  });
  return !!resolverRemetenteAnterior(h as LinhaTramite[]);
}
