"use server";
import { prisma } from "@/lib/db";
import { auditar } from "@/lib/audit";
import { invalido } from "@/lib/http";
import { acaoAdmin, bool, decOuNulo, obrigatorio, txtOuNulo } from "@/lib/admin/acao";
import type { EstadoAcao } from "@/lib/admin/guard";
import { organizacaoDoAdmin } from "@/lib/admin/escopo";
import { naoEncontrado } from "@/lib/http";

export async function salvarMunicipio(_: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  return acaoAdmin(["/admin/municipios"], async (u) => {
    const id = txtOuNulo(f, "id");
    const brasao = txtOuNulo(f, "brasao_url");
    if (brasao && !/^(https?:\/\/|\/)/.test(brasao)) throw invalido("Brasão: informe uma URL http(s) ou caminho iniciado por /.", { campo: "brasao_url" });
    const dados = {
      nome: obrigatorio(f, "nome", "o nome"),
      orgao_ambiental_nome: obrigatorio(f, "orgao_ambiental_nome", "o órgão ambiental"),
      brasao_url: brasao,
      endereco: txtOuNulo(f, "endereco"),
      email: txtOuNulo(f, "email"),
      telefone: txtOuNulo(f, "telefone"),
      latitude: decOuNulo(f, "latitude", -90, 90),
      longitude: decOuNulo(f, "longitude", -180, 180),
      distribuicao_auto: bool(f, "distribuicao_auto"),
      delega_decisao: bool(f, "delega_decisao"),
      ativo: bool(f, "ativo"),
    };
    if (id) {
      const antes = await prisma.municipio.findFirst({ where: { id, organizacao_id: organizacaoDoAdmin(u) } });
      if (!antes) throw naoEncontrado("Município não encontrado.");
      const depois = await prisma.$transaction(async (tx) => {
        const m = await tx.municipio.update({ where: { id }, data: dados });
        await auditar({ usuario_id: u.id, acao: "EDITAR", entidade: "municipio", entidade_id: id, antes, depois: m }, tx);
        return m;
      });
      return `Município ${depois.nome} atualizado.`;
    }
    const sigla = obrigatorio(f, "sigla", "a sigla").toUpperCase();
    if (!/^[A-Z]{3}$/.test(sigla)) throw invalido("A sigla deve ter 3 letras (ex.: LOR).", { campo: "sigla" });
    const codigo_ibge = obrigatorio(f, "codigo_ibge", "o código IBGE");
    if (!/^\d{7}$/.test(codigo_ibge)) throw invalido("Código IBGE deve ter 7 dígitos.", { campo: "codigo_ibge" });
    const org = { id: organizacaoDoAdmin(u) };
    const m = await prisma.$transaction(async (tx) => {
      const m = await tx.municipio.create({ data: { ...dados, sigla, codigo_ibge, organizacao_id: org.id, created_by: u.id } });
      await auditar({ usuario_id: u.id, acao: "CRIAR", entidade: "municipio", entidade_id: m.id, depois: m }, tx);
      return m;
    });
    return { mensagem: `Município ${m.nome} criado.`, extra: { link: `/admin/municipios/${m.id}` } };
  });
}
