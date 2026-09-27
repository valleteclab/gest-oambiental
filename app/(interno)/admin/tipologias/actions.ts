"use server";
import type { PotencialPoluidor, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { auditar } from "@/lib/audit";
import { invalido } from "@/lib/http";
import { acaoAdmin, bool, obrigatorio, txt, txtOuNulo } from "@/lib/admin/acao";
import type { EstadoAcao } from "@/lib/admin/guard";
import { parseTipologiasCsv } from "@/lib/admin/tipologias-csv";
import { textoParaFaixas } from "@/lib/cadastros/porte";

export async function salvarTipologia(_: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  return acaoAdmin("/admin/tipologias", async (u) => {
    const id = txtOuNulo(f, "id");
    const pp = txt(f, "potencial_poluidor") as PotencialPoluidor;
    if (!["BAIXO", "MEDIO", "ALTO"].includes(pp)) throw invalido("Potencial poluidor inválido.", { campo: "potencial_poluidor" });
    let faixas;
    try {
      faixas = textoParaFaixas(obrigatorio(f, "faixas", "as faixas de porte"));
    } catch (e) {
      throw invalido((e as Error).message, { campo: "faixas" });
    }
    const dados = {
      codigo: obrigatorio(f, "codigo", "o código"),
      divisao: obrigatorio(f, "divisao", "a divisão"),
      descricao: obrigatorio(f, "descricao", "a descrição"),
      unidade_porte: obrigatorio(f, "unidade_porte", "a unidade de porte"),
      potencial_poluidor: pp,
      faixas_porte: faixas as unknown as Prisma.InputJsonValue,
      ativo: bool(f, "ativo"),
    };
    const org = await prisma.organizacao.findFirstOrThrow();
    const dup = await prisma.tipologia.findFirst({ where: { organizacao_id: org.id, codigo: dados.codigo, ...(id ? { id: { not: id } } : {}) } });
    if (dup) throw invalido(`Já existe tipologia com o código ${dados.codigo}.`, { campo: "codigo" });
    if (id) {
      const antes = await prisma.tipologia.findUniqueOrThrow({ where: { id } });
      await prisma.$transaction(async (tx) => {
        const t = await tx.tipologia.update({ where: { id }, data: dados });
        await auditar({ usuario_id: u.id, acao: "EDITAR", entidade: "tipologia", entidade_id: id, antes, depois: t }, tx);
      });
      return "Tipologia atualizada. (Empreendimentos existentes mantêm o porte já gravado.)";
    }
    const t = await prisma.$transaction(async (tx) => {
      const t = await tx.tipologia.create({ data: { ...dados, organizacao_id: org.id, created_by: u.id } });
      await auditar({ usuario_id: u.id, acao: "CRIAR", entidade: "tipologia", entidade_id: t.id, depois: t }, tx);
      return t;
    });
    return { mensagem: `Tipologia ${t.codigo} criada.`, extra: { link: `/admin/tipologias/${t.id}` } };
  });
}

/** Importa CSV (;) – tudo ou nada: se houver erro em alguma linha, nada é gravado. Atualiza por código. */
export async function importarTipologias(_: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  return acaoAdmin("/admin/tipologias", async (u) => {
    const arq = f.get("arquivo");
    let texto = txt(f, "csv");
    if (arq && typeof arq === "object" && "text" in arq && arq.size > 0) {
      if (arq.size > 2 * 1024 * 1024) throw invalido("Arquivo muito grande (máx. 2 MB).");
      texto = await arq.text();
    }
    if (!texto.trim()) throw invalido("Selecione um arquivo CSV ou cole o conteúdo.");
    const { linhas, erros } = parseTipologiasCsv(texto);
    if (erros.length) throw invalido(`Nenhuma tipologia importada – corrija o arquivo: ${erros.slice(0, 10).map((e) => `linha ${e.linha}: ${e.mensagem}`).join(" · ")}${erros.length > 10 ? ` (+${erros.length - 10} erros)` : ""}`);
    if (!linhas.length) throw invalido("O arquivo não tem linhas de dados.");
    const org = await prisma.organizacao.findFirstOrThrow();
    let criadas = 0;
    let atualizadas = 0;
    await prisma.$transaction(async (tx) => {
      for (const l of linhas) {
        const dados = { ...l, faixas_porte: l.faixas_porte as unknown as Prisma.InputJsonValue };
        const antes = await tx.tipologia.findUnique({ where: { organizacao_id_codigo: { organizacao_id: org.id, codigo: l.codigo } } });
        if (antes) {
          const t = await tx.tipologia.update({ where: { id: antes.id }, data: dados });
          await auditar({ usuario_id: u.id, acao: "IMPORTAR_CSV", entidade: "tipologia", entidade_id: t.id, antes, depois: t }, tx);
          atualizadas++;
        } else {
          const t = await tx.tipologia.create({ data: { ...dados, organizacao_id: org.id, created_by: u.id } });
          await auditar({ usuario_id: u.id, acao: "IMPORTAR_CSV", entidade: "tipologia", entidade_id: t.id, depois: t }, tx);
          criadas++;
        }
      }
    }, { timeout: 60000 });
    return `Importação concluída: ${criadas} criada(s), ${atualizadas} atualizada(s).`;
  });
}
