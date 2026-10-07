"use server";
import type { FaseCobranca, PotencialPoluidor, Porte } from "@prisma/client";
import { prisma } from "@/lib/db";
import { auditar } from "@/lib/audit";
import { invalido, naoEncontrado } from "@/lib/http";
import { whereOrganizacao } from "@/lib/rbac";
import { acaoAdmin, bool, decOuNulo, obrigatorio, txt, txtOuNulo } from "@/lib/admin/acao";
import type { EstadoAcao } from "@/lib/admin/guard";
import { exigirMunicipioDoAdmin, organizacaoDoAdmin } from "@/lib/admin/escopo";
import { FASES } from "@/lib/cobranca/regras";

// Tabela de taxas (TabelaTaxa) da organização do admin – whereOrganizacao em toda leitura/escrita.

const CAMINHO = "/admin/taxas";
const PORTES: Porte[] = ["MICRO", "PEQUENO", "MEDIO", "GRANDE", "EXCEPCIONAL"];
const POTENCIAIS: PotencialPoluidor[] = ["BAIXO", "MEDIO", "ALTO"];

function valorObrigatorio(f: FormData): number {
  const v = decOuNulo(f, "valor", 0.01, 10_000_000);
  if (v === null) throw invalido("Informe o valor (R$).", { campo: "valor" });
  return Math.round(v * 100) / 100;
}

const textoCurto = (f: FormData, k: string, max: number) => {
  const v = txtOuNulo(f, k);
  if (v && v.length > max) throw invalido(`Máximo de ${max} caracteres.`, { campo: k });
  return v;
};

export async function criarTaxa(_: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  return acaoAdmin(CAMINHO, async (u) => {
    const organizacao_id = organizacaoDoAdmin(u);
    const fase = obrigatorio(f, "fase", "a fase") as FaseCobranca;
    if (!FASES.includes(fase)) throw invalido("Fase inválida.", { campo: "fase" });
    const municipio_id = txtOuNulo(f, "municipio_id");
    await exigirMunicipioDoAdmin(u, municipio_id);
    const tipo_ato_id = txtOuNulo(f, "tipo_ato_id");
    if (tipo_ato_id && !(await prisma.tipoAto.count({ where: { id: tipo_ato_id, ...whereOrganizacao(u) } }).catch(() => 0))) throw naoEncontrado("Tipo de ato não encontrado.");
    const porte = (txt(f, "porte") || null) as Porte | null;
    if (porte && !PORTES.includes(porte)) throw invalido("Porte inválido.", { campo: "porte" });
    const potencial = (txt(f, "potencial") || null) as PotencialPoluidor | null;
    if (potencial && !POTENCIAIS.includes(potencial)) throw invalido("Potencial poluidor inválido.", { campo: "potencial" });
    const dup = await prisma.tabelaTaxa.findFirst({ where: { organizacao_id, municipio_id, tipo_ato_id, fase, porte, potencial } });
    if (dup) throw invalido("Já existe uma linha com esta combinação (fase, município, tipo de ato, porte e potencial) – edite-a na tabela.");
    await prisma.$transaction(async (tx) => {
      const t = await tx.tabelaTaxa.create({
        data: { organizacao_id, municipio_id, tipo_ato_id, fase, porte, potencial, valor: valorObrigatorio(f), descricao: textoCurto(f, "descricao", 200), base_legal: textoCurto(f, "base_legal", 300), ativo: true, created_by: u.id },
      });
      await auditar({ usuario_id: u.id, acao: "CRIAR", entidade: "tabela_taxa", entidade_id: t.id, depois: t }, tx);
    });
    return "Taxa adicionada. Vale para as próximas cobranças (as já geradas não mudam).";
  });
}

export async function editarTaxa(_: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  return acaoAdmin(CAMINHO, async (u) => {
    const id = obrigatorio(f, "id", "a taxa");
    const antes = await prisma.tabelaTaxa.findFirst({ where: { id, ...whereOrganizacao(u) } }).catch(() => null);
    if (!antes) throw naoEncontrado("Taxa não encontrada.");
    await prisma.$transaction(async (tx) => {
      const t = await tx.tabelaTaxa.update({ where: { id }, data: { valor: valorObrigatorio(f), ativo: bool(f, "ativo"), descricao: textoCurto(f, "descricao", 200), base_legal: textoCurto(f, "base_legal", 300) } });
      await auditar({ usuario_id: u.id, acao: "EDITAR", entidade: "tabela_taxa", entidade_id: id, antes, depois: t }, tx);
    });
    return "Taxa atualizada.";
  });
}

export async function removerTaxa(_: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  return acaoAdmin(CAMINHO, async (u) => {
    const id = obrigatorio(f, "id", "a taxa");
    const antes = await prisma.tabelaTaxa.findFirst({ where: { id, ...whereOrganizacao(u) } }).catch(() => null);
    if (!antes) throw naoEncontrado("Taxa não encontrada.");
    await prisma.$transaction(async (tx) => {
      await tx.tabelaTaxa.delete({ where: { id } });
      await auditar({ usuario_id: u.id, acao: "REMOVER", entidade: "tabela_taxa", entidade_id: id, antes }, tx);
    });
    return "Taxa removida.";
  });
}
