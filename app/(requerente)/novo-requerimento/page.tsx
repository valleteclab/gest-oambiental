import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Aviso, CabecalhoPagina } from "@/components/ui";
import { documentosExigidos, UUID_RE } from "@/lib/processo/consultas";
import { ehTitular } from "@/lib/processo/maquina";
import { Proibido } from "../../(interno)/processos/_componentes/proibido";
import { Wizard, type DadosWizard } from "./wizard";

export const metadata = { title: "Novo requerimento" };

export default async function NovoRequerimento({ searchParams }: { searchParams: Promise<{ id?: string; passo?: string }> }) {
  const u = await exigirUsuario();
  const sp = await searchParams;
  if (!u.pessoa_id) {
    return (
      <>
        <CabecalhoPagina titulo="Novo requerimento" />
        <Aviso tipo="alerta">Seu usuário não está vinculado a um cadastro de pessoa (CPF/CNPJ). Procure o órgão ambiental ou faça o <Link className="underline" href="/cadastro">cadastro de requerente</Link>.</Aviso>
      </>
    );
  }

  let rascunho: DadosWizard["rascunho"] = null;
  if (sp.id) {
    if (!UUID_RE.test(sp.id)) notFound();
    const p = await prisma.processo.findUnique({
      where: { id: sp.id },
      include: { empreendimento: true, tipo_ato: true, rt: { select: { pessoa_id: true } }, anexos: { where: { pendencia_id: null }, orderBy: { created_at: "asc" } } },
    });
    if (!p) notFound();
    if (!ehTitular(u, { requerente_id: p.requerente_id, rt_pessoa_id: p.rt?.pessoa_id })) return <Proibido voltar="/meus-processos" mensagem="Este requerimento não pertence ao seu cadastro." />;
    if (p.status !== "RASCUNHO") {
      return (
        <>
          <CabecalhoPagina titulo="Requerimento já protocolado" />
          <Aviso tipo="info">Este requerimento já foi protocolado. <Link className="underline" href={`/meus-processos/${p.id}`}>Acompanhe o processo</Link>.</Aviso>
        </>
      );
    }
    const exigidos = await documentosExigidos(p.tipo_ato_id, p.empreendimento.tipologia_id);
    rascunho = {
      id: p.id,
      empreendimento_id: p.empreendimento_id,
      tipologia_id: p.empreendimento.tipologia_id,
      grandeza: p.empreendimento.grandeza_porte?.toString() ?? "",
      tipo_ato_id: p.tipo_ato_id,
      descricao_atividade: p.descricao_atividade ?? "",
      exigidos: exigidos.map((d) => ({ id: d.id, nome: d.nome, obrigatorio: d.obrigatorio, formatos: d.formatos })),
      anexos: p.anexos.map((a) => ({ id: a.id, nome: a.nome_arquivo, tamanho: a.tamanho, documento_exigido_id: a.documento_exigido_id })),
    };
  }

  const [municipios, tipologias, tiposAto, empreendimentos] = await Promise.all([
    prisma.municipio.findMany({ where: { ativo: true }, select: { id: true, nome: true, latitude: true, longitude: true }, orderBy: { nome: "asc" } }),
    prisma.tipologia.findMany({ where: { ativo: true }, select: { id: true, codigo: true, divisao: true, descricao: true, unidade_porte: true, faixas_porte: true, potencial_poluidor: true }, orderBy: { codigo: "asc" } }),
    prisma.tipoAto.findMany({ where: { ativo: true }, select: { id: true, sigla: true, nome: true, categoria: true, validade_meses_padrao: true, prazo_analise_dias: true }, orderBy: { sigla: "asc" } }),
    prisma.empreendimento.findMany({
      where: { requerente_id: u.pessoa_id, status: "ATIVO" },
      select: { id: true, nome: true, municipio_id: true, tipologia_id: true, grandeza_porte: true, latitude: true, longitude: true, municipio: { select: { nome: true } } },
      orderBy: { nome: "asc" },
    }),
  ]);

  const dados: DadosWizard = {
    municipios: municipios.map((m) => ({ id: m.id, nome: m.nome, lat: m.latitude ? Number(m.latitude) : null, lng: m.longitude ? Number(m.longitude) : null })),
    tipologias: tipologias.map((t) => ({ ...t, faixas_porte: t.faixas_porte as unknown })),
    tiposAto,
    empreendimentos: empreendimentos.map((e) => ({ id: e.id, nome: e.nome, municipio: e.municipio.nome, tipologia_id: e.tipologia_id, grandeza: e.grandeza_porte?.toString() ?? "", lat: e.latitude ? Number(e.latitude) : null, lng: e.longitude ? Number(e.longitude) : null })),
    rascunho,
  };
  const passoInicial = Math.min(5, Math.max(1, Number(sp.passo) || (rascunho ? 4 : 1)));

  return (
    <>
      <CabecalhoPagina titulo={rascunho ? "Continuar requerimento" : "Novo requerimento"} subtitulo="Preencha as etapas abaixo. O rascunho fica salvo a partir da etapa 3." />
      <Wizard dados={dados} passoInicial={rascunho ? passoInicial : Math.min(passoInicial, 3)} />
    </>
  );
}
