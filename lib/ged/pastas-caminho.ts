// Caminhos materializados da árvore de pastas (GedPasta.caminho_ids / caminho_heranca / caminho_nome).
//
//   caminho_ids      raiz → … → pai → a própria pasta
//   caminho_heranca  da "raiz de herança de ACL" até a própria pasta. Se `herda_acl=false` (ou é pasta raiz) a cadeia
//                    recomeça nela mesma: [id]. Senão = caminho_heranca do pai + id.
//                    Uma ACL de pasta vale para os documentos de toda pasta cuja caminho_heranca a contém.
//   caminho_nome     "Controle interno/Relatórios"
//
// Quem cria/move uma pasta ou alterna `herda_acl` DEVE recalcular dentro da MESMA transação:
//   criar:  { id, ...calcularCaminhos({id, nome, herda_acl}, pai) }  (id gerado com randomUUID() antes do create)
//   mover/renomear/alternar herança:  update da pasta (parent_id/nome/herda_acl) + `await recalcularCaminhos(tx, pastaId)`.
import type { GedTx } from "./db";
import { invalido } from "@/lib/http";

export type CaminhosPasta = { caminho_ids: string[]; caminho_heranca: string[]; caminho_nome: string };
type PaiCaminhos = Pick<CaminhosPasta, "caminho_ids" | "caminho_heranca" | "caminho_nome"> | null;

/** Pura: caminhos de uma pasta a partir dos caminhos do pai (null = pasta raiz). */
export function calcularCaminhos(pasta: { id: string; nome: string; herda_acl: boolean }, pai: PaiCaminhos): CaminhosPasta {
  const nome = pasta.nome.trim();
  if (!pai) return { caminho_ids: [pasta.id], caminho_heranca: [pasta.id], caminho_nome: nome };
  return {
    caminho_ids: [...pai.caminho_ids, pasta.id],
    caminho_heranca: pasta.herda_acl ? [...pai.caminho_heranca, pasta.id] : [pasta.id],
    caminho_nome: `${pai.caminho_nome}/${nome}`,
  };
}

/** A pasta `candidatoId` é a própria `pastaId` ou descendente dela? (impede mover pasta para dentro de si mesma) */
export async function pastaEhDescendente(tx: GedTx, pastaId: string, candidatoId: string): Promise<boolean> {
  if (pastaId === candidatoId) return true;
  const c = await tx.gedPasta.findUnique({ where: { id: candidatoId }, select: { caminho_ids: true } });
  return !!c && c.caminho_ids.includes(pastaId);
}

/**
 * Recalcula os caminhos da pasta e de TODAS as suas descendentes a partir do estado atual (parent_id, nome, herda_acl).
 * Deve rodar na transação que alterou a pasta. Lança 422 se o pai criar ciclo. Devolve quantas pastas foram atualizadas.
 */
export async function recalcularCaminhos(tx: GedTx, pastaId: string): Promise<number> {
  const raiz = await tx.gedPasta.findUnique({ where: { id: pastaId }, select: { id: true, nome: true, herda_acl: true, parent_id: true } });
  if (!raiz) throw new Error("GED: pasta não encontrada para recálculo.");
  let pai: PaiCaminhos = null;
  if (raiz.parent_id) {
    const p = await tx.gedPasta.findUnique({ where: { id: raiz.parent_id }, select: { caminho_ids: true, caminho_heranca: true, caminho_nome: true } });
    if (!p) throw new Error("GED: pasta-pai não encontrada.");
    if (p.caminho_ids.includes(pastaId)) throw invalido("Não é possível mover uma pasta para dentro dela mesma.");
    pai = p;
  }
  const novos = new Map<string, CaminhosPasta>();
  novos.set(raiz.id, calcularCaminhos(raiz, pai));

  // Descendentes: o caminho_ids antigo delas ainda contém `pastaId`. Ordem por profundidade garante pai antes do filho.
  const desc = await tx.gedPasta.findMany({
    where: { caminho_ids: { has: pastaId }, id: { not: pastaId } },
    select: { id: true, nome: true, herda_acl: true, parent_id: true, caminho_ids: true },
  });
  desc.sort((a, b) => a.caminho_ids.length - b.caminho_ids.length);
  for (const d of desc) {
    const pc = d.parent_id ? novos.get(d.parent_id) : undefined;
    if (!pc) continue; // órfã inconsistente: não mexe
    novos.set(d.id, calcularCaminhos(d, pc));
  }
  let n = 0;
  for (const [id, c] of novos) {
    await tx.gedPasta.update({ where: { id }, data: c });
    n++;
  }
  return n;
}
