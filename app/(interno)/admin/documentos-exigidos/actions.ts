"use server";
import { prisma } from "@/lib/db";
import { auditar } from "@/lib/audit";
import { invalido } from "@/lib/http";
import { acaoAdmin, bool, obrigatorio, txt, txtOuNulo } from "@/lib/admin/acao";
import type { EstadoAcao } from "@/lib/admin/guard";

const FORMATOS_OK = ["pdf", "jpg", "jpeg", "png", "dwg", "kml", "kmz", "zip"];

function formatos(f: FormData) {
  const lista = txt(f, "formatos").toLowerCase().split(/[,\s;]+/).filter(Boolean);
  const invalidos = lista.filter((x) => !FORMATOS_OK.includes(x));
  if (!lista.length) throw invalido("Informe ao menos um formato.", { campo: "formatos" });
  if (invalidos.length) throw invalido(`Formato(s) não permitido(s): ${invalidos.join(", ")}. Permitidos: ${FORMATOS_OK.join(", ")}.`, { campo: "formatos" });
  return [...new Set(lista)].join(",");
}

export async function salvarDocumentoExigido(_: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  return acaoAdmin("/admin/documentos-exigidos", async (u) => {
    const id = txtOuNulo(f, "id");
    const dados = { nome: obrigatorio(f, "nome", "o nome do documento"), obrigatorio: bool(f, "obrigatorio"), formatos: formatos(f), tipologia_id: txtOuNulo(f, "tipologia_id") };
    if (id) {
      const antes = await prisma.documentoExigido.findUniqueOrThrow({ where: { id } });
      await prisma.$transaction(async (tx) => {
        const d = await tx.documentoExigido.update({ where: { id }, data: dados });
        await auditar({ usuario_id: u.id, acao: "EDITAR", entidade: "documento_exigido", entidade_id: id, antes, depois: d }, tx);
      });
      return "Documento atualizado.";
    }
    const tipo_ato_id = obrigatorio(f, "tipo_ato_id", "o tipo de ato");
    await prisma.$transaction(async (tx) => {
      const d = await tx.documentoExigido.create({ data: { ...dados, tipo_ato_id, created_by: u.id } });
      await auditar({ usuario_id: u.id, acao: "CRIAR", entidade: "documento_exigido", entidade_id: d.id, depois: d }, tx);
    });
    return "Documento adicionado.";
  });
}

export async function removerDocumentoExigido(_: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  return acaoAdmin("/admin/documentos-exigidos", async (u) => {
    const id = obrigatorio(f, "id", "o documento");
    const usados = await prisma.anexo.count({ where: { documento_exigido_id: id } });
    if (usados) throw invalido(`Documento já usado em ${usados} anexo(s) – marque como opcional em vez de remover.`);
    const antes = await prisma.documentoExigido.findUniqueOrThrow({ where: { id } });
    await prisma.$transaction(async (tx) => {
      await tx.documentoExigido.delete({ where: { id } });
      await auditar({ usuario_id: u.id, acao: "REMOVER", entidade: "documento_exigido", entidade_id: id, antes }, tx);
    });
    return "Documento removido da lista.";
  });
}
