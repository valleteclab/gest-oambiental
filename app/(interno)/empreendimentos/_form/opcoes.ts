import "server-only";
import { prisma } from "@/lib/db";
import { wherePessoaEscopo, whereResponsavelEscopo } from "@/lib/cadastros/escopo";
import { municipiosDoEscopo, tipologiasAtivas } from "@/lib/cadastros/opcoes";
import type { UsuarioSessao } from "@/lib/rbac";

export async function opcoesEmpreendimento(u: UsuarioSessao) {
  const [municipios, requerentes, tipologias, rts] = await Promise.all([
    municipiosDoEscopo(u),
    prisma.pessoa.findMany({ where: wherePessoaEscopo(u), select: { id: true, nome: true, cpf_cnpj_mascara: true }, orderBy: { nome: "asc" }, take: 2000 }),
    tipologiasAtivas(u),
    prisma.responsavelTecnico.findMany({ where: whereResponsavelEscopo(u), include: { pessoa: { select: { nome: true } } }, orderBy: { pessoa: { nome: "asc" } } }),
  ]);
  return {
    municipios: municipios.map((m) => ({ id: m.id, nome: m.nome, latitude: m.latitude ? Number(m.latitude) : null, longitude: m.longitude ? Number(m.longitude) : null })),
    requerentes: requerentes.map((p) => ({ id: p.id, nome: p.nome, doc: p.cpf_cnpj_mascara })),
    tipologias: tipologias.map((t) => ({ ...t, faixas_porte: t.faixas_porte as unknown })),
    rts: rts.map((r) => ({ id: r.id, nome: r.pessoa.nome, registro: `${r.conselho} ${r.registro_conselho}/${r.uf_conselho}` })),
  };
}
