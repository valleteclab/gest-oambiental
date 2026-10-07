// Pastas (árvore) do GED. Criar/renomear/mover/arquivar exige podeGerirEstruturaGed (Admin/Gestor) E permissão na pasta:
//   criar subpasta → EDITAR na pasta-pai;  renomear / sensibilidade padrão → EDITAR;  mover / arquivar → ADMINISTRAR
//   (+ EDITAR no destino). Pasta raiz: só o papel (quem cria sem ser Admin recebe ACL de criador para continuar a vê-la).
// Caminhos materializados sempre recalculados na MESMA transação (pastas-caminho.ts). Visibilidade: whereGedPastasVisiveis.
import { randomUUID } from "node:crypto";
import { Prisma, type GedSensibilidade } from "@prisma/client";
import { z } from "zod";
import { invalido, proibido } from "@/lib/http";
import { concederAclAoCriador } from "./acl";
import { auditarGed } from "./auditoria";
import { exigirEncontrado } from "./db";
import type { CtxGed } from "./escopo";
import { podeGerirEstruturaGed } from "./papeis";
import { calcularCaminhos, pastaEhDescendente, recalcularCaminhos } from "./pastas-caminho";
import { exigirPasta, whereGedPastas, whereGedPastasVisiveis, whereGedVisivel } from "./permissoes";
import { zSensibilidade, zUuid } from "./tipos";

export const zNomePasta = z
  .string()
  .trim()
  .min(1, "Informe o nome da pasta.")
  .max(120, "Nome com até 120 caracteres.")
  .refine((n) => !n.includes("/"), "O nome não pode conter a barra (/).");

export type PastaNo = {
  id: string;
  parent_id: string | null;
  nome: string;
  caminho_nome: string;
  herda_acl: boolean;
  sensibilidade_padrao: GedSensibilidade;
  arquivada: boolean;
  /** Documentos ativos (não arquivados) da pasta que o usuário pode ver, sem subpastas. */
  documentos: number;
};

const ehUnico = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
const MSG_NOME_REPETIDO = "Já existe uma pasta com este nome neste local.";

function exigirEstrutura(ctx: CtxGed) {
  if (!podeGerirEstruturaGed(ctx)) throw proibido("Somente administradores e gestores podem alterar a estrutura de pastas.");
}

/** Pastas visíveis (não arquivadas, ou todas com `incluirArquivadas`) – a árvore é montada no cliente a partir do pai. */
export async function listarPastas(ctx: CtxGed, opc: { incluirArquivadas?: boolean } = {}): Promise<PastaNo[]> {
  const where: Prisma.GedPastaWhereInput = { AND: [await whereGedPastasVisiveis(ctx), opc.incluirArquivadas ? {} : { excluido_em: null }] };
  const [pastas, contagem] = await Promise.all([
    ctx.db.gedPasta.findMany({ where, select: { id: true, parent_id: true, nome: true, caminho_nome: true, herda_acl: true, sensibilidade_padrao: true, excluido_em: true }, orderBy: { caminho_nome: "asc" } }),
    (async () =>
      ctx.db.gedDocumento.groupBy({
        by: ["pasta_id"],
        where: { AND: [await whereGedVisivel(ctx, "VER"), { excluido_em: null, status: { not: "ARQUIVADO" }, pasta_id: { not: null } }] },
        _count: { _all: true },
      }))(),
  ]);
  const n = new Map(contagem.map((c) => [c.pasta_id, c._count._all]));
  return pastas.map(({ excluido_em, ...p }) => ({ ...p, arquivada: excluido_em !== null, documentos: n.get(p.id) ?? 0 }));
}

export type NoArvore = PastaNo & { filhas: NoArvore[] };

/** PURA: monta a árvore; pasta cujo pai não é visível vira raiz (visível por ACL própria). */
export function montarArvore(pastas: PastaNo[]): NoArvore[] {
  const por = new Map<string, NoArvore>(pastas.map((p) => [p.id, { ...p, filhas: [] }]));
  const raizes: NoArvore[] = [];
  for (const p of por.values()) {
    const pai = p.parent_id ? por.get(p.parent_id) : undefined;
    (pai ? pai.filhas : raizes).push(p);
  }
  const ord = (l: NoArvore[]) => {
    l.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }));
    l.forEach((x) => ord(x.filhas));
  };
  ord(raizes);
  return raizes;
}

export type EntradaCriarPasta = { nome: string; parent_id?: string | null; sensibilidade_padrao?: GedSensibilidade };

export async function criarPasta(ctx: CtxGed, entrada: EntradaCriarPasta): Promise<{ id: string }> {
  exigirEstrutura(ctx);
  const nome = zNomePasta.parse(entrada.nome);
  const sens = zSensibilidade.optional().parse(entrada.sensibilidade_padrao) ?? "RESTRITO";
  const parentId = entrada.parent_id ? zUuid.parse(entrada.parent_id) : null;
  if (parentId) await exigirPasta(ctx, parentId, "EDITAR");
  const id = randomUUID();
  try {
    return await ctx.db.$transaction(async (tx) => {
      let pai = null;
      if (parentId) {
        pai = exigirEncontrado(await tx.gedPasta.findUnique({ where: { id: parentId }, select: { caminho_ids: true, caminho_heranca: true, caminho_nome: true, excluido_em: true } }), "Pasta superior não encontrada.");
        if (pai.excluido_em) throw invalido("A pasta superior está arquivada.");
      }
      const c = calcularCaminhos({ id, nome, herda_acl: true }, pai);
      await tx.gedPasta.create({ data: { id, parent_id: parentId, nome, herda_acl: true, sensibilidade_padrao: sens, ...c } as Prisma.GedPastaUncheckedCreateInput });
      if (ctx.membro.papel !== "GED_ADMIN") await concederAclAoCriador(tx, ctx, { tipo: "pasta", id });
      await auditarGed(ctx, { acao: "GED_PASTA_CRIADA", entidade: "ged_pasta", entidade_id: id, depois: { nome, parent_id: parentId, caminho_nome: c.caminho_nome, sensibilidade_padrao: sens } }, tx);
      return { id };
    });
  } catch (e) {
    if (ehUnico(e)) throw invalido(MSG_NOME_REPETIDO);
    throw e;
  }
}

export type EntradaAtualizarPasta = { nome?: string; sensibilidade_padrao?: GedSensibilidade; parent_id?: string | null };

/** Renomeia, muda a sensibilidade padrão e/ou move (parent_id: null = raiz; omitido = não move). */
export async function atualizarPasta(ctx: CtxGed, pastaId: string, entrada: EntradaAtualizarPasta): Promise<void> {
  exigirEstrutura(ctx);
  const id = zUuid.parse(pastaId);
  const mover = entrada.parent_id !== undefined;
  const novoPai = mover && entrada.parent_id ? zUuid.parse(entrada.parent_id) : null;
  await exigirPasta(ctx, id, mover ? "ADMINISTRAR" : "EDITAR");
  if (mover && novoPai) await exigirPasta(ctx, novoPai, "EDITAR");
  const nome = entrada.nome !== undefined ? zNomePasta.parse(entrada.nome) : undefined;
  const sens = entrada.sensibilidade_padrao !== undefined ? zSensibilidade.parse(entrada.sensibilidade_padrao) : undefined;
  try {
    await ctx.db.$transaction(async (tx) => {
      const antes = exigirEncontrado(await tx.gedPasta.findUnique({ where: { id } }), "Pasta não encontrada.");
      if (antes.excluido_em) throw invalido("A pasta está arquivada. Restaure-a antes de alterar.");
      const trocaPai = mover && novoPai !== antes.parent_id;
      if (trocaPai && novoPai) {
        if (await pastaEhDescendente(tx, id, novoPai)) throw invalido("Não é possível mover uma pasta para dentro dela mesma.");
        const destino = exigirEncontrado(await tx.gedPasta.findUnique({ where: { id: novoPai }, select: { excluido_em: true } }), "Pasta de destino não encontrada.");
        if (destino.excluido_em) throw invalido("A pasta de destino está arquivada.");
      }
      const data: Prisma.GedPastaUncheckedUpdateInput = {};
      if (nome !== undefined && nome !== antes.nome) data.nome = nome;
      if (sens !== undefined && sens !== antes.sensibilidade_padrao) data.sensibilidade_padrao = sens;
      if (trocaPai) data.parent_id = novoPai;
      if (!Object.keys(data).length) return;
      await tx.gedPasta.update({ where: { id }, data });
      if (data.nome !== undefined || trocaPai) await recalcularCaminhos(tx, id);
      await auditarGed(
        ctx,
        {
          acao: trocaPai ? "GED_PASTA_MOVIDA" : data.nome !== undefined ? "GED_PASTA_RENOMEADA" : "GED_PASTA_ATUALIZADA",
          entidade: "ged_pasta",
          entidade_id: id,
          antes: { nome: antes.nome, parent_id: antes.parent_id, sensibilidade_padrao: antes.sensibilidade_padrao, caminho_nome: antes.caminho_nome },
          depois: { nome: data.nome ?? antes.nome, parent_id: trocaPai ? novoPai : antes.parent_id, sensibilidade_padrao: data.sensibilidade_padrao ?? antes.sensibilidade_padrao },
        },
        tx,
      );
    });
  } catch (e) {
    if (ehUnico(e)) throw invalido(MSG_NOME_REPETIDO);
    throw e;
  }
}

/** Arquiva a pasta (some da árvore). Só se não tiver subpastas ativas nem documentos ativos. */
export async function arquivarPasta(ctx: CtxGed, pastaId: string): Promise<void> {
  exigirEstrutura(ctx);
  const id = zUuid.parse(pastaId);
  await exigirPasta(ctx, id, "ADMINISTRAR");
  await ctx.db.$transaction(async (tx) => {
    const p = exigirEncontrado(await tx.gedPasta.findUnique({ where: { id } }), "Pasta não encontrada.");
    if (p.excluido_em) return;
    const [filhas, docs] = await Promise.all([
      tx.gedPasta.count({ where: { parent_id: id, excluido_em: null } }),
      tx.gedDocumento.count({ where: { pasta_id: id, excluido_em: null, status: { not: "ARQUIVADO" } } }),
    ]);
    if (filhas > 0) throw invalido("A pasta tem subpastas. Mova ou arquive as subpastas antes.");
    if (docs > 0) throw invalido("A pasta ainda tem documentos. Mova ou arquive os documentos antes.");
    await tx.gedPasta.update({ where: { id }, data: { excluido_em: new Date() } });
    await auditarGed(ctx, { acao: "GED_PASTA_ARQUIVADA", entidade: "ged_pasta", entidade_id: id, antes: { nome: p.nome, caminho_nome: p.caminho_nome } }, tx);
  });
}

export async function restaurarPasta(ctx: CtxGed, pastaId: string): Promise<void> {
  exigirEstrutura(ctx);
  const id = zUuid.parse(pastaId);
  await exigirPasta(ctx, id, "ADMINISTRAR");
  try {
    await ctx.db.$transaction(async (tx) => {
      const p = exigirEncontrado(await tx.gedPasta.findUnique({ where: { id } }), "Pasta não encontrada.");
      if (!p.excluido_em) return;
      if (p.parent_id) {
        const pai = await tx.gedPasta.findUnique({ where: { id: p.parent_id }, select: { excluido_em: true } });
        if (!pai || pai.excluido_em) throw invalido("A pasta superior está arquivada. Restaure-a primeiro.");
      }
      await tx.gedPasta.update({ where: { id }, data: { excluido_em: null } });
      await auditarGed(ctx, { acao: "GED_PASTA_RESTAURADA", entidade: "ged_pasta", entidade_id: id, depois: { nome: p.nome } }, tx);
    });
  } catch (e) {
    if (ehUnico(e)) throw invalido(MSG_NOME_REPETIDO);
    throw e;
  }
}

/** Para seletores (upload, mover): pastas visíveis em que o usuário pode criar documentos (EDITAR). */
export async function pastasParaSeletor(ctx: CtxGed): Promise<{ id: string; caminho_nome: string; sensibilidade_padrao: GedSensibilidade }[]> {
  const where: Prisma.GedPastaWhereInput = { AND: [await whereGedPastas(ctx, "EDITAR"), { excluido_em: null }] };
  return ctx.db.gedPasta.findMany({ where, select: { id: true, caminho_nome: true, sensibilidade_padrao: true }, orderBy: { caminho_nome: "asc" } });
}
