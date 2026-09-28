import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { exigirUsuario, getOrgaoAtivo } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { podeProtocolarNoBalcao, podeVerMunicipio } from "@/lib/rbac";
import { listarPessoas, podeVerPessoa } from "@/lib/cadastros/pessoas";
import { whereResponsavelEscopo } from "@/lib/cadastros/escopo";
import { municipiosDoEscopo } from "@/lib/cadastros/opcoes";
import { documentosExigidos, UUID_RE } from "@/lib/processo/consultas";
import { fmtDataHora } from "@/lib/format";
import { Aviso, Badge, CabecalhoPagina, Card, Vazio } from "@/components/ui";
import { NavEtapas, WizardRequerimento, type DadosWizard } from "@/components/processo/wizard-requerimento";
import { BotaoReemitir } from "../_componentes/formularios";
import { CadastroRequerenteBalcao } from "./cadastro-requerente";

// Novo processo (balcão): servidor interno protocola em nome de um requerente que compareceu ao órgão.
// Passo 0 (esta página, sem ?requerente): busca/cadastro do requerente; depois o mesmo wizard do requerente.
// Permissão: podeProtocolarNoBalcao() no município (checada de novo em cada Server Action/serviço).

export const dynamic = "force-dynamic";
export const metadata = { title: "Novo processo (balcão)" };

type Busca = { municipio?: string; q?: string; requerente?: string; rascunho?: string; passo?: string };

export default async function NovoProcessoBalcao({ searchParams }: { searchParams: Promise<Busca> }) {
  const u = await exigirUsuario({ interno: true });
  if (!podeProtocolarNoBalcao(u)) forbidden();
  const sp = await searchParams;
  const municipios = (await municipiosDoEscopo(u)).filter((m) => podeProtocolarNoBalcao(u, m.id));
  if (!municipios.length) forbidden();

  // ── Continuação de rascunho / conclusão ──
  let rascunho: DadosWizard["rascunho"] = null;
  let municipioId: string;
  let requerenteId: string | undefined;
  let rtId: string | null = null;
  if (sp.rascunho) {
    if (!UUID_RE.test(sp.rascunho)) notFound();
    const p = await prisma.processo.findUnique({
      where: { id: sp.rascunho },
      include: { empreendimento: true, tipo_ato: true, requerente: { select: { nome: true } }, municipio: { select: { nome: true } }, anexos: { where: { pendencia_id: null }, orderBy: { created_at: "asc" } } },
    });
    if (!p) notFound();
    if (!podeVerMunicipio(u, p.municipio_id) || !podeProtocolarNoBalcao(u, p.municipio_id)) forbidden();
    if (p.status !== "RASCUNHO") {
      const [recibo, comLogin] = await Promise.all([
        prisma.documentoOficial.findFirst({ where: { processo_id: p.id, tipo: "RECIBO" }, orderBy: { emitido_em: "desc" } }),
        prisma.usuario.count({ where: { pessoa_id: p.requerente_id, ativo: true } }),
      ]);
      return (
        <>
          <CabecalhoPagina titulo="Novo processo (balcão)" />
          <Card>
            <div className="space-y-4" data-testid="balcao-concluido">
              <Aviso tipo="sucesso">
                Processo <strong data-testid="numero-protocolado">{p.numero}</strong> protocolado{p.data_protocolo ? ` em ${fmtDataHora(p.data_protocolo)}` : ""} em nome de {p.requerente.nome}.
              </Aviso>
              <p className="text-sm text-slate-700">{comLogin ? "O requerente possui login e acompanha o processo em “Meus processos”." : "O requerente não possui login: entregue o recibo impresso com o número do processo."}</p>
              <div className="flex flex-wrap gap-2">
                {recibo ? (
                  <a className="btn-primario" href={`/api/v1/documentos/${recibo.id}/pdf`} target="_blank" rel="noopener">Imprimir recibo</a>
                ) : (
                  p.numero && <BotaoReemitir processoId={p.id} rotulo="Gerar recibo de protocolo" />
                )}
                <Link className="btn-secundario" href={`/processos/${p.id}`}>Abrir processo</Link>
                <Link className="btn-secundario" href="/processos/novo">Novo processo (balcão)</Link>
              </div>
            </div>
          </Card>
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
    municipioId = p.municipio_id;
    requerenteId = p.requerente_id;
    rtId = p.rt_id;
  } else {
    // Município: pedido na URL (somente entre os permitidos → senão 403), órgão ativo ou o primeiro permitido.
    if (sp.municipio && !municipios.some((m) => m.id === sp.municipio)) forbidden();
    const orgao = await getOrgaoAtivo();
    municipioId = sp.municipio || (orgao && municipios.some((m) => m.id === orgao.id) ? orgao.id : municipios[0].id);
    requerenteId = sp.requerente;
  }
  const municipio = municipios.find((m) => m.id === municipioId)!;

  // ── Passo 0: busca / cadastro do requerente ──
  if (!requerenteId) {
    const q = (sp.q ?? "").trim();
    const resultado = q.length >= 2 ? await listarPessoas(u, { q, take: 20 }) : null;
    const comLogin = resultado ? new Set((await prisma.usuario.findMany({ where: { pessoa_id: { in: resultado.itens.map((p) => p.id) } }, select: { pessoa_id: true } })).map((x) => x.pessoa_id)) : new Set<string | null>();
    return (
      <div className="space-y-5">
        <CabecalhoPagina titulo="Novo processo (balcão)" subtitulo="Requerimento protocolado pelo servidor em nome do requerente presente no órgão." />
        <NavEtapas modo="balcao" atual={0} liberado={0} />
        <section className="card p-4 sm:p-6" aria-labelledby="titulo-passo">
          <h2 id="titulo-passo" className="mb-4 text-lg font-semibold">1. Requerente</h2>
          <form className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] sm:items-end" role="search" aria-label="Buscar requerente">
            <div>
              <label htmlFor="b-mun" className="label">Município do processo</label>
              <select id="b-mun" name="municipio" defaultValue={municipio.id} className="input">
                {municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="b-q" className="label">Nome, razão social ou CPF/CNPJ completo</label>
              <input id="b-q" name="q" defaultValue={q} className="input" placeholder="Ex.: Maria da Silva ou 000.000.000-00" />
            </div>
            <button className="btn-primario">Buscar</button>
          </form>

          {resultado && (
            <div className="mt-4" data-testid="resultado-requerentes">
              {resultado.itens.length === 0 ? (
                <Vazio>Nenhuma pessoa encontrada no seu escopo. Cadastre o requerente abaixo.</Vazio>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                  {resultado.itens.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900">{p.nome}{p.nome_fantasia ? <span className="font-normal text-slate-500"> ({p.nome_fantasia})</span> : null}</p>
                        <p className="text-xs text-slate-500">
                          {p.tipo === "PF" ? "CPF" : "CNPJ"} {p.cpf_cnpj_mascara}{p.municipio ? ` · ${p.municipio.nome}` : ""} · {comLogin.has(p.id) ? <Badge cor="azul">com login</Badge> : <Badge>sem login</Badge>}
                        </p>
                      </div>
                      <Link className="btn-secundario btn-sm" href={`/processos/novo?municipio=${municipio.id}&requerente=${p.id}`} aria-label={`Selecionar ${p.nome}`}>Selecionar</Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <Card titulo="Cadastrar novo requerente">
          <p className="mb-3 text-sm text-slate-600">Não encontrou? Cadastre a pessoa física ou jurídica. O cadastro fica vinculado a {municipio.nome}.</p>
          <CadastroRequerenteBalcao municipioId={municipio.id} />
        </Card>
      </div>
    );
  }

  // ── Requerente escolhido: wizard compartilhado (modo balcão) ──
  if (!UUID_RE.test(requerenteId)) notFound();
  const pessoa = await prisma.pessoa.findUnique({ where: { id: requerenteId }, select: { id: true, nome: true, tipo: true, cpf_cnpj_mascara: true } });
  if (!pessoa) notFound();
  if (!(await podeVerPessoa(u, pessoa.id))) forbidden();
  // Catálogo (tipologias/tipos de ato) da organização do município do protocolo – isolamento por cliente.
  const orgMunicipio = (await prisma.municipio.findUniqueOrThrow({ where: { id: municipio.id }, select: { organizacao_id: true } })).organizacao_id;

  const [tipologias, tiposAto, empreendimentos, rts, comLogin] = await Promise.all([
    prisma.tipologia.findMany({ where: { ativo: true, organizacao_id: orgMunicipio }, select: { id: true, codigo: true, divisao: true, descricao: true, unidade_porte: true, faixas_porte: true, potencial_poluidor: true }, orderBy: { codigo: "asc" } }),
    prisma.tipoAto.findMany({ where: { ativo: true, organizacao_id: orgMunicipio }, select: { id: true, sigla: true, nome: true, categoria: true, validade_meses_padrao: true, prazo_analise_dias: true }, orderBy: { sigla: "asc" } }),
    prisma.empreendimento.findMany({
      where: { requerente_id: pessoa.id, municipio_id: municipio.id, status: "ATIVO" },
      select: { id: true, nome: true, tipologia_id: true, grandeza_porte: true, latitude: true, longitude: true, municipio: { select: { nome: true } } },
      orderBy: { nome: "asc" },
    }),
    prisma.responsavelTecnico.findMany({ where: whereResponsavelEscopo(u), select: { id: true, conselho: true, registro_conselho: true, pessoa: { select: { nome: true } } }, orderBy: { pessoa: { nome: "asc" } }, take: 500 }),
    prisma.usuario.count({ where: { pessoa_id: pessoa.id, ativo: true } }),
  ]);

  const dados: DadosWizard = {
    modo: "balcao",
    balcao: {
      requerente: { id: pessoa.id, nome: pessoa.nome, tipo: pessoa.tipo, documento: pessoa.cpf_cnpj_mascara, tem_login: comLogin > 0 },
      municipio: { id: municipio.id, nome: municipio.nome },
      rts: rts.map((t) => ({ id: t.id, nome: t.pessoa.nome, registro: `${t.conselho} ${t.registro_conselho}` })),
      rt_id: rtId,
      trocarHref: rascunho ? null : `/processos/novo?municipio=${municipio.id}`,
    },
    municipioPadrao: municipio.id,
    municipios: [{ id: municipio.id, nome: municipio.nome, lat: municipio.latitude ? Number(municipio.latitude) : null, lng: municipio.longitude ? Number(municipio.longitude) : null }],
    tipologias: tipologias.map((t) => ({ ...t, faixas_porte: t.faixas_porte as unknown })),
    tiposAto,
    empreendimentos: empreendimentos.map((e) => ({ id: e.id, nome: e.nome, municipio: e.municipio.nome, tipologia_id: e.tipologia_id, grandeza: e.grandeza_porte?.toString() ?? "", lat: e.latitude ? Number(e.latitude) : null, lng: e.longitude ? Number(e.longitude) : null })),
    rascunho,
  };
  const passoInicial = Math.min(5, Math.max(0, Number(sp.passo) || (rascunho ? 4 : 0)));

  return (
    <>
      <CabecalhoPagina titulo={rascunho ? "Continuar processo (balcão)" : "Novo processo (balcão)"} subtitulo={`Requerente: ${pessoa.nome} · ${municipio.nome}. O rascunho fica salvo a partir da etapa “Tipo de ato”.`} />
      <WizardRequerimento dados={dados} passoInicial={rascunho ? passoInicial : Math.min(passoInicial, 3)} />
    </>
  );
}
