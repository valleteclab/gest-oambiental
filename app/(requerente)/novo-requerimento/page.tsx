import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { exigirUsuario, getOrgaoAtivo } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Aviso, CabecalhoPagina } from "@/components/ui";
import { documentosExigidos, UUID_RE } from "@/lib/processo/consultas";
import { ehTitular } from "@/lib/processo/maquina";
import { Proibido } from "../../(interno)/processos/_componentes/proibido";
import { WizardRequerimento, type DadosWizard } from "@/components/processo/wizard-requerimento";
import { lerDadosDemanda } from "@/lib/demandas/catalogo";

export const metadata = { title: "Novo requerimento" };

export default async function NovoRequerimento({ searchParams }: { searchParams: Promise<{ id?: string; passo?: string; tipo?: string }> }) {
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
      // Recém-protocolado (inclusive logo após o passo 5): vai para o acompanhamento com o aviso de sucesso.
      const recente = p.data_protocolo && Date.now() - p.data_protocolo.getTime() < 10 * 60 * 1000;
      redirect(`/meus-processos/${p.id}${recente ? "?protocolado=1" : ""}`);
    }
    const exigidos = await documentosExigidos(p.tipo_ato_id, p.empreendimento.tipologia_id);
    rascunho = {
      id: p.id,
      empreendimento_id: p.empreendimento_id,
      tipologia_id: p.empreendimento.tipologia_id,
      grandeza: p.empreendimento.grandeza_porte?.toString() ?? "",
      tipo_ato_id: p.tipo_ato_id,
      // Demandas urbanas: campos do serviço ficam em texto estruturado na descrição (lib/demandas)
      descricao_atividade: lerDadosDemanda(p.descricao_atividade)?.livre ?? p.descricao_atividade ?? "",
      dados_demanda: lerDadosDemanda(p.descricao_atividade)?.dados,
      exigidos: exigidos.map((d) => ({ id: d.id, nome: d.nome, obrigatorio: d.obrigatorio, formatos: d.formatos })),
      anexos: p.anexos.map((a) => ({ id: a.id, nome: a.nome_arquivo, tamanho: a.tamanho, documento_exigido_id: a.documento_exigido_id })),
    };
  }

  // Isolamento por organização (cliente): o requerimento é feito nos órgãos da organização do ÓRGÃO ATIVO
  // (ou do rascunho em andamento) – catálogo de tipologias/tipos de ato daquela organização. Para requerer
  // em outro cliente, o requerente troca de órgão.
  const orgao = await getOrgaoAtivo();
  const orgId = rascunho ? (await prisma.processo.findUniqueOrThrow({ where: { id: rascunho.id }, select: { organizacao_id: true } })).organizacao_id : orgao?.organizacao.id;
  if (!orgId) redirect(`/trocar-orgao?next=${encodeURIComponent(`/novo-requerimento${sp.tipo ? `?tipo=${encodeURIComponent(sp.tipo)}` : ""}`)}`);
  const [municipios, tipologias, tiposAto, empreendimentos] = await Promise.all([
    prisma.municipio.findMany({ where: { ativo: true, organizacao_id: orgId }, select: { id: true, nome: true, latitude: true, longitude: true }, orderBy: { nome: "asc" } }),
    prisma.tipologia.findMany({ where: { ativo: true, organizacao_id: orgId }, select: { id: true, codigo: true, divisao: true, descricao: true, unidade_porte: true, faixas_porte: true, potencial_poluidor: true }, orderBy: { codigo: "asc" } }),
    prisma.tipoAto.findMany({ where: { ativo: true, organizacao_id: orgId }, select: { id: true, sigla: true, nome: true, categoria: true, validade_meses_padrao: true, prazo_analise_dias: true }, orderBy: { sigla: "asc" } }),
    prisma.empreendimento.findMany({
      where: { requerente_id: u.pessoa_id, status: "ATIVO", organizacao_id: orgId },
      select: { id: true, nome: true, municipio_id: true, tipologia_id: true, grandeza_porte: true, latitude: true, longitude: true, municipio: { select: { nome: true } } },
      orderBy: { nome: "asc" },
    }),
  ]);

  // ?tipo=APC (links de /servicos): pré-seleciona o tipo de ato, se existir e estiver ativo na organização.
  const tipoInicial = sp.tipo && tiposAto.some((t) => t.sigla === sp.tipo!.toUpperCase()) ? sp.tipo.toUpperCase() : null;
  const dados: DadosWizard = {
    modo: "requerente",
    tipoInicial,
    municipioPadrao: orgao && municipios.some((m) => m.id === orgao.id) ? orgao.id : null,
    municipios: municipios.map((m) => ({ id: m.id, nome: m.nome, lat: m.latitude ? Number(m.latitude) : null, lng: m.longitude ? Number(m.longitude) : null })),
    tipologias: tipologias.map((t) => ({ ...t, faixas_porte: t.faixas_porte as unknown })),
    tiposAto,
    empreendimentos: empreendimentos.map((e) => ({ id: e.id, nome: e.nome, municipio: e.municipio.nome, tipologia_id: e.tipologia_id, grandeza: e.grandeza_porte?.toString() ?? "", lat: e.latitude ? Number(e.latitude) : null, lng: e.longitude ? Number(e.longitude) : null })),
    rascunho,
  };
  const passoInicial = Math.min(5, Math.max(1, Number(sp.passo) || (rascunho ? 4 : 1)));

  return (
    <>
      <CabecalhoPagina titulo={rascunho ? "Continuar requerimento" : tipoInicial ? `Solicitar ${tiposAto.find((t) => t.sigla === tipoInicial)!.nome}` : "Novo requerimento"} subtitulo="Preencha as etapas abaixo. O rascunho fica salvo a partir da etapa 3." />
      <WizardRequerimento dados={dados} passoInicial={rascunho ? passoInicial : Math.min(passoInicial, 3)} />
    </>
  );
}
