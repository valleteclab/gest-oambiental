// Permissões do GED – docs/ged-design.md §7.
//
// Ações: VER, EDITAR, ASSINAR, TRAMITAR, ADMINISTRAR, ANONIMIZAR (EDITAR/ASSINAR/TRAMITAR implicam VER).
// Permissão efetiva = (união do que concedem as regras abaixo) ∩ (teto do papel – lib/ged/papeis.ts).
//
//  1. Criador do documento: VER, EDITAR, TRAMITAR, ADMINISTRAR (ASSINAR nunca é implícito).
//  2. ACL direta no documento (usuário ou setor do usuário; ignora entradas expiradas: `expira_em`).
//  3. ACL de pasta herdada: só se `acl_propria=false` e o documento não é SIGILOSO; vale a ACL das pastas em
//     `pasta.caminho_heranca` (cadeia já cortada onde `herda_acl=false`).
//  4. Signatário: VER + ASSINAR enquanto a solicitação está ABERTA e a linha GedAssinante não foi decidida; mantém VER
//     depois de assinar/recusar enquanto a solicitação estiver ABERTA/CONCLUIDA/RECUSADA (evidência do próprio ato).
//     (Quem pode assinar AGORA – a vez no modo sequencial, OTP, hash – é verificado por lib/ged/assinaturas.)
//  5. Destinatário atual do trâmite (`responsavel_id` = eu ou `setor_atual_id` ∈ meus setores): VER + TRAMITAR.
//  6. GED_ADMIN: ADMINISTRAR em todo documento; VER/ANONIMIZAR em todo documento NÃO sigiloso. Documento SIGILOSO sem ACL
//     (ou autoria) explícita fica invisível ao admin (decisão do dono do produto). EDITAR/ASSINAR/TRAMITAR só por ACL/posse.
//  7. SIGILOSO desliga a herança de pasta (regra 3).
//  8. Documento ASSINADO (selado) nega EDITAR (edição = novo derivado).
//  9. Assinar exige, além da ação ASSINAR, a linha GedAssinante (verificado em lib/ged/assinaturas).
//
// Pastas: ACL de pasta (e das ancestrais até a raiz de herança) + GED_ADMIN (VER, EDITAR, ADMINISTRAR em todas).
//
// Listas filtram NO BANCO (`whereGedVisivel`) – nunca filtre depois de paginar. `podeNoDocumento` é para acesso por ID.
// Semântica HTTP (use `exigirDocumento`): outro cliente/inexistente → 404; mesmo cliente sem VER → 404; com VER sem a ação → 403.
//
// A decisão é PURA (`decidirAcoesDocumento`/`decidirAcoesPasta`) e testada sem banco; o restante só carrega os "fatos".
import { cache } from "react";
import type { GedAcao, GedPapel, GedSensibilidade, GedStatusDocumento, Prisma } from "@prisma/client";
import { proibido } from "@/lib/http";
import { naoEncontrado } from "./db";
import type { CtxGed } from "./escopo";
import { tetoDoPapel } from "./papeis";

// ───────────── Tipos ─────────────

export type GedDocumentoMin = {
  id: string;
  organizacao_id: string;
  criado_por_id: string;
  pasta_id: string | null;
  status: GedStatusDocumento;
  sensibilidade: GedSensibilidade;
  acl_propria: boolean;
  responsavel_id: string | null;
  setor_atual_id: string | null;
};
export const SELECT_DOCUMENTO_MIN = {
  id: true, organizacao_id: true, criado_por_id: true, pasta_id: true, status: true, sensibilidade: true,
  acl_propria: true, responsavel_id: true, setor_atual_id: true,
} satisfies Prisma.GedDocumentoSelect;

export type GedPastaMin = { id: string; organizacao_id: string; caminho_heranca: string[] };
export const SELECT_PASTA_MIN = { id: true, organizacao_id: true, caminho_heranca: true } satisfies Prisma.GedPastaSelect;

// ───────────── Constantes e utilitários puros ─────────────

/** Ações implícitas: quem pode EDITAR/ASSINAR/TRAMITAR pode VER. */
export const IMPLICAM_VER: readonly GedAcao[] = ["EDITAR", "ASSINAR", "TRAMITAR"];
/** Regra 1. */
export const ACOES_DO_CRIADOR: readonly GedAcao[] = ["VER", "EDITAR", "TRAMITAR", "ADMINISTRAR"];
/** Ações que fazem sentido em pasta. */
export const ACOES_DE_PASTA: readonly GedAcao[] = ["VER", "EDITAR", "ADMINISTRAR"];
const ORDEM: readonly GedAcao[] = ["VER", "EDITAR", "ASSINAR", "TRAMITAR", "ADMINISTRAR", "ANONIMIZAR"];

const ordenar = (s: Iterable<GedAcao>): GedAcao[] => {
  const set = new Set(s);
  return ORDEM.filter((a) => set.has(a));
};

/** Ações cuja concessão equivale a ter `acao` (VER é concedida por VER/EDITAR/ASSINAR/TRAMITAR). */
export const acoesQueConcedem = (acao: GedAcao): GedAcao[] => (acao === "VER" ? ["VER", ...IMPLICAM_VER] : [acao]);

/** Entrada de ACL ainda vigente em `agora`? */
export const aclVigente = (e: { expira_em: Date | null }, agora: Date = new Date()) => e.expira_em === null || e.expira_em.getTime() > agora.getTime();

/** Acrescenta VER quando há EDITAR/ASSINAR/TRAMITAR. */
function aplicarImplicacoes(s: Set<GedAcao>) {
  if (IMPLICAM_VER.some((a) => s.has(a))) s.add("VER");
}

export type SituacaoSignatario = { ver: boolean; assinar: boolean };

/** Fatos (já carregados) sobre o usuário em relação ao documento. */
export type FatosDocumento = {
  papel: GedPapel;
  usuario_id: string;
  doc: Pick<GedDocumentoMin, "criado_por_id" | "status" | "sensibilidade" | "acl_propria">;
  /** União das ações de ACLs diretas no documento (vigentes) para o usuário/seus setores. */
  acl_direta: Iterable<GedAcao>;
  /** União das ações das ACLs das pastas em `caminho_heranca` (vigentes). */
  acl_pasta: Iterable<GedAcao>;
  signatario: SituacaoSignatario;
  /** Destinatário atual do trâmite (responsavel_id = eu ou setor_atual_id ∈ meus setores). */
  destinatario: boolean;
};

/** PURA: ações efetivas sobre um documento (regras 1–8 e teto do papel). */
export function decidirAcoesDocumento(f: FatosDocumento): GedAcao[] {
  const s = new Set<GedAcao>();
  const sigiloso = f.doc.sensibilidade === "SIGILOSO";
  if (f.doc.criado_por_id === f.usuario_id) ACOES_DO_CRIADOR.forEach((a) => s.add(a));
  for (const a of f.acl_direta) s.add(a);
  if (!f.doc.acl_propria && !sigiloso) for (const a of f.acl_pasta) s.add(a);
  if (f.signatario.assinar) {
    s.add("VER");
    s.add("ASSINAR");
  } else if (f.signatario.ver) s.add("VER");
  if (f.destinatario) {
    s.add("VER");
    s.add("TRAMITAR");
  }
  if (f.papel === "GED_ADMIN") {
    s.add("ADMINISTRAR");
    if (!sigiloso) {
      s.add("VER");
      s.add("ANONIMIZAR");
    }
  }
  aplicarImplicacoes(s);
  if (f.doc.status === "ASSINADO") s.delete("EDITAR");
  const teto = tetoDoPapel(f.papel);
  return ordenar([...s].filter((a) => teto.has(a)));
}

/**
 * PURA: ações efetivas sobre uma pasta. `acl_pasta` = união das ACLs vigentes das pastas de `caminho_heranca`.
 * VER/EDITAR/ADMINISTRAR valem para a própria pasta; as demais (ASSINAR, TRAMITAR, ANONIMIZAR) só se propagam aos
 * documentos herdeiros – ficam na lista para que quem as detém possa repassá-las (limite de concessão em acl.ts).
 */
export function decidirAcoesPasta(f: { papel: GedPapel; acl_pasta: Iterable<GedAcao> }): GedAcao[] {
  const s = new Set<GedAcao>(f.acl_pasta);
  if (f.papel === "GED_ADMIN") ACOES_DE_PASTA.forEach((a) => s.add(a));
  aplicarImplicacoes(s);
  const teto = tetoDoPapel(f.papel);
  return ordenar([...s].filter((a) => teto.has(a)));
}

// ───────────── Carregamento de fatos (banco) ─────────────

type GrantPasta = { pasta_id: string; acoes: GedAcao[] };

const vigenteWhere = (agora: Date) => ({ OR: [{ expira_em: null }, { expira_em: { gt: agora } }] });
const principalWhere = (ctx: Pick<CtxGed, "setor_ids"> & { usuario: { id: string } }) => ({
  OR: [{ usuario_id: ctx.usuario.id }, { setor_id: { in: ctx.setor_ids } }],
});

/** ACLs de PASTA vigentes do usuário (diretas e via seus setores). Sem memoização. */
export async function carregarGrantsPastas(ctx: CtxGed): Promise<GrantPasta[]> {
  const l = await ctx.db.gedAcl.findMany({
    where: { pasta_id: { not: null }, AND: [principalWhere(ctx), vigenteWhere(new Date())] },
    select: { pasta_id: true, acoes: true },
  });
  return l.flatMap((a) => (a.pasta_id ? [{ pasta_id: a.pasta_id, acoes: a.acoes }] : []));
}
/** Memoizada por requisição (React `cache`; fora de requisição executa direto). Não use logo após alterar ACLs. */
const grantsPastasMemo = cache((ctx: CtxGed) => carregarGrantsPastas(ctx));
const grantsPastas = (ctx: CtxGed, semMemo?: boolean) => (semMemo ? carregarGrantsPastas(ctx) : grantsPastasMemo(ctx));

const unirGrants = (grants: GrantPasta[], caminho: string[]): GedAcao[] =>
  grants.filter((g) => caminho.includes(g.pasta_id)).flatMap((g) => g.acoes);

export type OpcoesPermissao = { /** Ignora a memoização por requisição (use após alterar ACLs na mesma requisição). */ semMemo?: boolean };

/** Ações efetivas sobre vários documentos (3–4 consultas no total, não por documento). Documentos de outro cliente → []. */
export async function acoesDosDocumentos(ctx: CtxGed, docs: GedDocumentoMin[], op: OpcoesPermissao = {}): Promise<Map<string, GedAcao[]>> {
  const res = new Map<string, GedAcao[]>();
  const meus = docs.filter((d) => d.organizacao_id === ctx.organizacao_id);
  for (const d of docs) if (d.organizacao_id !== ctx.organizacao_id) res.set(d.id, []);
  if (meus.length === 0) return res;
  const ids = meus.map((d) => d.id);
  const agora = new Date();

  const [aclsDiretas, assinaturas, pastas, grants] = await Promise.all([
    ctx.db.gedAcl.findMany({
      where: { documento_id: { in: ids }, AND: [principalWhere(ctx), vigenteWhere(agora)] },
      select: { documento_id: true, acoes: true },
    }),
    ctx.db.gedAssinante.findMany({
      where: { usuario_id: ctx.usuario.id, solicitacao: { documento_id: { in: ids } } },
      select: { status: true, solicitacao: { select: { documento_id: true, status: true } } },
    }),
    (async () => {
      const pids = [...new Set(meus.flatMap((d) => (d.pasta_id ? [d.pasta_id] : [])))];
      return pids.length ? ctx.db.gedPasta.findMany({ where: { id: { in: pids } }, select: SELECT_PASTA_MIN }) : [];
    })(),
    grantsPastas(ctx, op.semMemo),
  ]);

  const caminhoPorPasta = new Map(pastas.map((p) => [p.id, p.caminho_heranca]));
  for (const d of meus) {
    const sig: SituacaoSignatario = { ver: false, assinar: false };
    for (const a of assinaturas) {
      if (a.solicitacao.documento_id !== d.id) continue;
      const aberta = a.solicitacao.status === "ABERTA";
      if (aberta && (a.status === "PENDENTE" || a.status === "AGUARDANDO")) sig.assinar = true;
      if (["ABERTA", "CONCLUIDA", "RECUSADA"].includes(a.solicitacao.status) && ["PENDENTE", "AGUARDANDO", "ASSINADO", "RECUSADO"].includes(a.status)) sig.ver = true;
    }
    res.set(
      d.id,
      decidirAcoesDocumento({
        papel: ctx.membro.papel,
        usuario_id: ctx.usuario.id,
        doc: d,
        acl_direta: aclsDiretas.filter((a) => a.documento_id === d.id).flatMap((a) => a.acoes),
        acl_pasta: d.pasta_id ? unirGrants(grants, caminhoPorPasta.get(d.pasta_id) ?? []) : [],
        signatario: sig,
        destinatario: d.responsavel_id === ctx.usuario.id || (d.setor_atual_id !== null && ctx.setor_ids.includes(d.setor_atual_id)),
      }),
    );
  }
  return res;
}

/** Todas as ações que o usuário tem sobre o documento (para a UI mostrar/esconder botões). */
export async function acoesDoDocumento(ctx: CtxGed, doc: GedDocumentoMin, op: OpcoesPermissao = {}): Promise<GedAcao[]> {
  return (await acoesDosDocumentos(ctx, [doc], op)).get(doc.id) ?? [];
}

/** O usuário pode `acao` neste documento? (acesso por ID). Documento de outro cliente → false. */
export async function podeNoDocumento(ctx: CtxGed, doc: GedDocumentoMin, acao: GedAcao, op: OpcoesPermissao = {}): Promise<boolean> {
  return (await acoesDoDocumento(ctx, doc, op)).includes(acao);
}

/** Documento (campos mínimos) do cliente do contexto; outro cliente ou inexistente → null. */
export async function carregarDocumentoMin(ctx: CtxGed, id: string): Promise<GedDocumentoMin | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return ctx.db.gedDocumento.findUnique({ where: { id }, select: SELECT_DOCUMENTO_MIN });
}

/**
 * Carrega o documento e exige `acao` com a semântica HTTP do GED:
 * inexistente/outro cliente → 404; sem VER → 404 (não revela existência); com VER mas sem a ação → 403.
 * Devolve também as ações efetivas (para a UI).
 */
export async function exigirDocumento(ctx: CtxGed, id: string, acao: GedAcao = "VER", op: OpcoesPermissao = {}): Promise<{ doc: GedDocumentoMin; acoes: GedAcao[] }> {
  const doc = await carregarDocumentoMin(ctx, id);
  if (!doc) throw naoEncontrado("Documento não encontrado.");
  const acoes = await acoesDoDocumento(ctx, doc, op);
  if (!acoes.includes("VER") && !(acao === "ADMINISTRAR" && acoes.includes("ADMINISTRAR"))) throw naoEncontrado("Documento não encontrado.");
  if (!acoes.includes(acao)) throw proibido("Você não tem permissão para esta ação no documento.");
  return { doc, acoes };
}

// ───────────── Listas: filtro no banco ─────────────

/** Where que não casa com nada (negar por padrão). */
export const WHERE_NENHUM = { id: { in: [] as string[] } };

/** ACLs de pasta vigentes (do usuário) que concedem `acao` → ids das pastas. */
async function pastasComGrant(ctx: CtxGed, acao: GedAcao, semMemo?: boolean): Promise<string[]> {
  const L = acoesQueConcedem(acao);
  return (await grantsPastas(ctx, semMemo)).filter((g) => g.acoes.some((a) => L.includes(a))).map((g) => g.pasta_id);
}

/**
 * Filtro Prisma de documentos em que o usuário tem `acao` (use em TODA lista/busca/contagem; combine com AND).
 * Reproduz decidirAcoesDocumento() em SQL: criador, ACL direta, ACL de pasta herdada, signatário, trâmite, admin; teto do papel;
 * EDITAR exclui documentos ASSINADO. ASSÍNCRONA porque a ACL de pasta é resolvida em ids de pastas (uma consulta, memoizada).
 */
export async function whereGedVisivel(ctx: CtxGed, acao: GedAcao, op: OpcoesPermissao = {}): Promise<Prisma.GedDocumentoWhereInput> {
  if (!tetoDoPapel(ctx.membro.papel).has(acao)) return WHERE_NENHUM;
  const me = ctx.usuario.id;
  const L = acoesQueConcedem(acao);
  const agora = new Date();
  const conds: Prisma.GedDocumentoWhereInput[] = [];

  if (ACOES_DO_CRIADOR.includes(acao)) conds.push({ criado_por_id: me });
  conds.push({ acls: { some: { organizacao_id: ctx.organizacao_id, AND: [principalWhere(ctx), vigenteWhere(agora)], acoes: { hasSome: L } } } });
  const pastas = await pastasComGrant(ctx, acao, op.semMemo);
  if (pastas.length) conds.push({ acl_propria: false, sensibilidade: { not: "SIGILOSO" }, pasta: { is: { caminho_heranca: { hasSome: pastas } } } });
  if (acao === "VER") {
    conds.push({
      solicitacoes: {
        some: {
          status: { in: ["ABERTA", "CONCLUIDA", "RECUSADA"] },
          assinantes: { some: { usuario_id: me, status: { in: ["PENDENTE", "AGUARDANDO", "ASSINADO", "RECUSADO"] } } },
        },
      },
    });
  }
  if (acao === "ASSINAR") {
    conds.push({ solicitacoes: { some: { status: "ABERTA", assinantes: { some: { usuario_id: me, status: { in: ["PENDENTE", "AGUARDANDO"] } } } } } });
  }
  if (acao === "VER" || acao === "TRAMITAR") {
    conds.push({ OR: [{ responsavel_id: me }, { setor_atual_id: { in: ctx.setor_ids } }] });
  }
  if (ctx.membro.papel === "GED_ADMIN") {
    // (`{}` dentro de OR não casa nada no Prisma: use um predicado sempre verdadeiro dentro do escopo)
    if (acao === "ADMINISTRAR") conds.push({ organizacao_id: ctx.organizacao_id });
    if (acao === "VER" || acao === "ANONIMIZAR") conds.push({ sensibilidade: { not: "SIGILOSO" } });
  }
  const and: Prisma.GedDocumentoWhereInput[] = [{ OR: conds }];
  if (acao === "EDITAR") and.push({ status: { not: "ASSINADO" } });
  return { AND: and };
}

// ───────────── Pastas ─────────────

/** Ações do usuário sobre uma pasta (ACL das pastas de `caminho_heranca` + admin). */
export async function acoesDaPasta(ctx: CtxGed, pasta: GedPastaMin, op: OpcoesPermissao = {}): Promise<GedAcao[]> {
  if (pasta.organizacao_id !== ctx.organizacao_id) return [];
  const grants = await grantsPastas(ctx, op.semMemo);
  return decidirAcoesPasta({ papel: ctx.membro.papel, acl_pasta: unirGrants(grants, pasta.caminho_heranca) });
}

export async function podeNaPasta(ctx: CtxGed, pasta: GedPastaMin, acao: GedAcao, op: OpcoesPermissao = {}): Promise<boolean> {
  return (await acoesDaPasta(ctx, pasta, op)).includes(acao);
}

export async function carregarPastaMin(ctx: CtxGed, id: string): Promise<GedPastaMin | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return ctx.db.gedPasta.findUnique({ where: { id }, select: SELECT_PASTA_MIN });
}

/** Mesma semântica de exigirDocumento para pastas (404 sem VER; 403 com VER sem a ação). */
export async function exigirPasta(ctx: CtxGed, id: string, acao: GedAcao = "VER", op: OpcoesPermissao = {}): Promise<{ pasta: GedPastaMin; acoes: GedAcao[] }> {
  const pasta = await carregarPastaMin(ctx, id);
  if (!pasta) throw naoEncontrado("Pasta não encontrada.");
  const acoes = await acoesDaPasta(ctx, pasta, op);
  if (!acoes.includes("VER")) throw naoEncontrado("Pasta não encontrada.");
  if (!acoes.includes(acao)) throw proibido("Você não tem permissão para esta ação na pasta.");
  return { pasta, acoes };
}

/** Filtro de pastas em que o usuário tem `acao` (padrão VER). */
export async function whereGedPastas(ctx: CtxGed, acao: GedAcao = "VER", op: OpcoesPermissao = {}): Promise<Prisma.GedPastaWhereInput> {
  if (!ACOES_DE_PASTA.includes(acao) || !tetoDoPapel(ctx.membro.papel).has(acao)) return WHERE_NENHUM;
  if (ctx.membro.papel === "GED_ADMIN") return {};
  const pastas = await pastasComGrant(ctx, acao, op.semMemo);
  return pastas.length ? { caminho_heranca: { hasSome: pastas } } : WHERE_NENHUM;
}
export const whereGedPastasVisiveis = (ctx: CtxGed, op: OpcoesPermissao = {}) => whereGedPastas(ctx, "VER", op);
