import "server-only";
import { prisma } from "../db";
import { hashContato } from "../canais/contato";
import { podeConsultarProtocolo } from "./privacidade";
import { ROTULO_STATUS_CIDADAO } from "./textos";

// Acompanhamento público da denúncia (/denuncia/acompanhar): protocolo + o MESMO telefone/e-mail usado no registro.
// Sem coincidência do contato → "não encontrado" (não revela se o protocolo existe).
export async function acompanharDenuncia(protocolo: string, contato: string) {
  const p = protocolo.trim().toUpperCase();
  const h = hashContato(contato);
  if (!/^DEN-[A-Z]{3}-\d{3,}\/\d{4}$/.test(p) || !h) return null;
  const d = await prisma.denuncia.findUnique({
    where: { protocolo: p, municipio: { organizacao: { status: "ATIVO" } } },
    select: { id: true, protocolo: true, status: true, descricao: true, endereco: true, created_at: true, contato_hash: true, canal: true, municipio: { select: { nome: true, orgao_ambiental_nome: true } }, _count: { select: { anexos: true } } },
  });
  if (!d || !podeConsultarProtocolo(d.contato_hash, h)) return null;
  const hist = await prisma.logAuditoria.findMany({ where: { entidade: "denuncia", entidade_id: d.id, acao: "ALTERAR_STATUS_DENUNCIA" }, orderBy: { created_at: "asc" }, select: { created_at: true, depois: true } });
  return {
    protocolo: d.protocolo,
    status: d.status,
    situacao: ROTULO_STATUS_CIDADAO[d.status] ?? d.status,
    municipio: d.municipio.nome,
    orgao: d.municipio.orgao_ambiental_nome,
    registrada_em: d.created_at,
    descricao: d.descricao,
    endereco: d.endereco,
    fotos: d._count.anexos,
    linha_do_tempo: [
      { em: d.created_at, situacao: "Denúncia registrada" },
      ...hist.map((x) => ({ em: x.created_at, situacao: ROTULO_STATUS_CIDADAO[String((x.depois as { status?: string } | null)?.status ?? "")] ?? "Atualização" })),
    ],
  };
}
