import { forbidden } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, XCircle } from "lucide-react";
import { exigirUsuario, getOrgaoAtivo } from "@/lib/auth";
import { can, filtroMunicipioPadrao, temEscopoOrganizacao } from "@/lib/rbac";
import { fmtData, fmtMoeda, fmtNumero } from "@/lib/format";
import { calcularIndicadores, opcoesFiltros } from "@/lib/indicadores/calcular";
import { lerFiltros, municipioPermitido, queryFiltros } from "@/lib/indicadores/filtros";
import { CabecalhoPagina, Card, ROTULO_STATUS } from "@/components/ui";
import { BarrasHorizontais, LicencasEmpilhadas, TabelaDados } from "@/components/graficos";
import { FiltrosGlobais } from "./filtros";
import { contarNovos } from "@/lib/monitoramento/servico";
import { podeVerMonitoramento } from "@/lib/monitoramento/regras";

export const dynamic = "force-dynamic";
export const metadata = { title: "Painel – LicenciaGov" };

function Kpi({ rotulo, valor, detalhe, href, testId, alerta }: { rotulo: string; valor: string; detalhe?: string; href?: string; testId: string; alerta?: "vermelho" | "amarelo" }) {
  const corpo = (
    <>
      <div className="text-xs font-medium text-slate-600">{rotulo}</div>
      <div className="mt-1 flex items-center gap-1.5 text-2xl font-semibold text-slate-900" data-testid={testId}>
        {alerta === "vermelho" && <XCircle className="h-5 w-5 text-red-600" aria-hidden />}
        {alerta === "amarelo" && <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden />}
        {valor}
      </div>
      {detalhe && <div className="mt-0.5 text-xs text-slate-500">{detalhe}</div>}
    </>
  );
  return href ? (
    <Link href={href} className="card block p-4 transition hover:border-primaria-600 focus-visible:outline-2 focus-visible:outline-primaria-600">{corpo}</Link>
  ) : (
    <div className="card p-4">{corpo}</div>
  );
}

export default async function PaginaDashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const u = await exigirUsuario({ interno: true });
  const sp = await searchParams;
  const orgao = await getOrgaoAtivo();
  // Sem ?municipio= na URL: padrão = órgão ativo (usuários com escopo amplo); "Todos" continua selecionável.
  const filtros = lerFiltros({ ...sp, municipio: filtroMunicipioPadrao(u, sp.municipio, orgao?.id) });
  if (!can(u, "ver", "dashboard") || !municipioPermitido(u, filtros)) {
    forbidden();
  }

  const [ind, opcoes, satelite] = await Promise.all([calcularIndicadores(u, filtros), opcoesFiltros(u), podeVerMonitoramento(u) ? contarNovos(u, filtros.municipio_id) : null]);
  const t = ind.totais;
  const mostrarTodos = temEscopoOrganizacao(u) || opcoes.municipios.length > 1;
  const qPrazos = (aba: string) => `/prazos${queryFiltros({ municipio_id: filtros.municipio_id, tecnico_id: filtros.tecnico_id }, { ...(filtros.municipio_id ? {} : { municipio: "" }), aba })}`;
  const d = ind.filtros.descricao;

  const dadosStatus = ind.porStatus.filter((s) => s.total > 0).map((s) => ({ rotulo: ROTULO_STATUS[s.status], valor: s.total }));
  const dadosTipo = ind.porTipoAto.map((s) => ({ rotulo: s.sigla === "CERT_DISP" ? "Certidão" : s.sigla, valor: s.total, detalhe: s.nome }));
  const dadosTempo = ind.tempoMedioPorTipo.filter((x) => x.dias !== null).map((x) => ({ rotulo: x.sigla, valor: x.dias!, detalhe: `${x.concluidos} concluído(s)` }));

  return (
    <div data-testid="dashboard">
      <CabecalhoPagina
        titulo="Painel de indicadores"
        subtitulo={<span data-testid="dashboard-escopo">{d.municipio} · {fmtData(`${ind.filtros.de}T12:00:00Z`)} a {fmtData(`${ind.filtros.ate}T12:00:00Z`)}{d.tipo_ato !== "Todos" ? ` · ${d.tipo_ato}` : ""}{d.tecnico !== "Todos" ? ` · ${d.tecnico}` : ""}</span>}
        acoes={can(u, "ver", "relatorio") ? <Link href={`/relatorios${queryFiltros(filtros)}`} className="btn-secundario">Relatórios</Link> : undefined}
      />

      <FiltrosGlobais
        acao="/dashboard"
        municipios={opcoes.municipios}
        tiposAto={opcoes.tiposAto}
        tecnicos={opcoes.tecnicos}
        mostrarTodos={mostrarTodos}
        valores={{ municipio: filtros.municipio_id ?? "", de: ind.filtros.de, ate: ind.filtros.ate, tipo_ato: filtros.tipo_ato_id ?? "", tecnico: filtros.tecnico_id ?? "" }}
      />

      <h2 className="sr-only">Indicadores principais</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi rotulo="Protocolados no período" valor={fmtNumero(t.protocolados)} testId="kpi-protocolados" />
        <Kpi rotulo="Em andamento" valor={fmtNumero(t.em_andamento)} detalhe="situação atual" testId="kpi-em-andamento" />
        <Kpi rotulo="Concluídos no período" valor={fmtNumero(t.concluidos)} testId="kpi-concluidos" />
        <Kpi rotulo="Tempo médio de tramitação" valor={t.tempo_medio_dias === null ? "—" : `${fmtNumero(t.tempo_medio_dias, 1)} dias`} detalhe="protocolo → conclusão" testId="kpi-tempo-medio" />
        <Kpi rotulo="Prazo vencido" valor={fmtNumero(t.prazo_vencido)} detalhe="ver na tela Prazos" href={qPrazos("vencidos")} testId="kpi-prazo-vencido" alerta={t.prazo_vencido > 0 ? "vermelho" : undefined} />
        <Kpi rotulo={`Vencendo em ${ind.definicoes.dias_vencendo} dias`} valor={fmtNumero(t.prazo_vencendo)} detalhe="ver na tela Prazos" href={qPrazos("vencendo")} testId="kpi-prazo-vencendo" alerta={t.prazo_vencendo > 0 ? "amarelo" : undefined} />
        <Kpi rotulo="Licenças emitidas" valor={fmtNumero(t.licencas_emitidas)} detalhe="licenças, autorizações e certidões" testId="kpi-licencas" />
        <Kpi rotulo="Licenças vencendo em 90 dias" valor={fmtNumero(t.licencas_vencendo_90)} testId="kpi-licencas-vencendo" />
        <Kpi rotulo="Denúncias recebidas / apuradas" valor={`${fmtNumero(t.denuncias_recebidas)} / ${fmtNumero(t.denuncias_apuradas)}`} testId="kpi-denuncias" />
        <Kpi rotulo="Fiscalizações" valor={fmtNumero(t.fiscalizacoes)} detalhe="vistorias realizadas" testId="kpi-fiscalizacoes" />
        <Kpi rotulo="Autos de infração" valor={fmtNumero(t.autos)} detalhe={`multas: ${fmtMoeda(t.multas_total)}`} testId="kpi-autos" />
        <Kpi rotulo="Notificações" valor={fmtNumero(t.notificacoes)} testId="kpi-notificacoes" />
      </div>

      {satelite && (
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Kpi
            rotulo="Alertas de desmatamento novos (satélite)"
            valor={fmtNumero(satelite.novos)}
            detalhe={`${fmtNumero(satelite.area_ha, 1)} ha sem tratamento · ver Monitoramento`}
            href={`/monitoramento?status=NOVO&de=${filtros.municipio_id ? `&municipio=${filtros.municipio_id}` : ""}`}
            testId="kpi-desmatamento-novos"
            alerta={satelite.novos > 0 ? "vermelho" : undefined}
          />
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card titulo="Processos por status">
          <p className="mb-2 text-xs text-slate-500">Protocolados no período, pela situação atual.</p>
          <BarrasHorizontais dados={dadosStatus} testId="grafico-status" rotuloLargura={150} />
          <TabelaDados titulo="Processos por status" colunas={["Status", "Processos"]} linhas={dadosStatus.map((x) => [x.rotulo, x.valor])} />
        </Card>
        <Card titulo="Processos por tipo de ato">
          <p className="mb-2 text-xs text-slate-500">Protocolados no período.</p>
          <BarrasHorizontais dados={dadosTipo} testId="grafico-tipo-ato" rotuloLargura={80} />
          <TabelaDados titulo="Processos por tipo de ato" colunas={["Tipo de ato", "Processos"]} linhas={ind.porTipoAto.map((x) => [`${x.sigla} – ${x.nome}`, x.total])} />
        </Card>
        <Card titulo="Licenças emitidas por tipo e município">
          <p className="mb-2 text-xs text-slate-500">Documentos válidos emitidos no período.</p>
          <LicencasEmpilhadas dados={ind.licencasPorTipoMunicipio} />
          <TabelaDados titulo="Licenças por tipo e município" colunas={["Município", "Tipo", "Emitidas"]} linhas={ind.licencasPorTipoMunicipio.map((x) => [x.municipio, x.sigla, x.total])} />
        </Card>
        <Card titulo="Tempo médio de tramitação por tipo de ato">
          <p className="mb-2 text-xs text-slate-500">Dias corridos do protocolo à conclusão (concluídos no período).</p>
          <BarrasHorizontais dados={dadosTempo} unidade="dias" casas={1} testId="grafico-tempo-medio" rotuloLargura={90} />
          <TabelaDados titulo="Tempo médio por tipo" colunas={["Tipo de ato", "Dias", "Concluídos"]} linhas={ind.tempoMedioPorTipo.map((x) => [x.sigla, x.dias === null ? "—" : fmtNumero(x.dias, 1), x.concluidos])} />
        </Card>
      </div>

      <Card titulo="Indicadores por município" className="mb-6" acoes={can(u, "exportar", "relatorio") ? (
        <div className="flex gap-2">
          <a className="btn-secundario btn-sm" href={`/api/v1/relatorios/indicadores${queryFiltros(filtros, { formato: "pdf" })}`} data-testid="dash-exportar-pdf">PDF</a>
          <a className="btn-secundario btn-sm" href={`/api/v1/relatorios/indicadores${queryFiltros(filtros, { formato: "xlsx" })}`} data-testid="dash-exportar-xlsx">XLSX</a>
        </div>) : undefined}>
        <TabelaMunicipios ind={ind} />
      </Card>

      <Card titulo="Adesão dos municípios">
        <Adesao ind={ind} />
      </Card>
    </div>
  );
}

type Ind = Awaited<ReturnType<typeof calcularIndicadores>>;

function TabelaMunicipios({ ind }: { ind: Ind }) {
  const cols: [keyof Ind["municipios"][number], string, "n" | "d" | "m"][] = [
    ["protocolados", "Protocolados", "n"], ["em_andamento", "Em andamento", "n"], ["concluidos", "Concluídos", "n"], ["tempo_medio_dias", "Tempo médio (dias)", "d"],
    ["prazo_vencido", "Prazo vencido", "n"], ["prazo_vencendo", `Vencendo (${ind.definicoes.dias_vencendo} d)`, "n"], ["licencas_emitidas", "Licenças emitidas", "n"],
    ["licencas_vencendo_90", "Licenças vencendo (90 d)", "n"], ["denuncias_recebidas", "Denúncias recebidas", "n"], ["denuncias_apuradas", "Denúncias apuradas", "n"],
    ["fiscalizacoes", "Fiscalizações", "n"], ["autos", "Autos", "n"], ["multas_total", "Multas", "m"], ["notificacoes", "Notificações", "n"],
    ["usuarios_ativos", "Usuários ativos", "n"], ["processos_total", "Processos (total)", "n"],
  ];
  const fmt = (v: unknown, k: "n" | "d" | "m") => (v === null || v === undefined ? "—" : k === "m" ? fmtMoeda(Number(v)) : k === "d" ? fmtNumero(Number(v), 1) : fmtNumero(Number(v)));
  const t = ind.totais as Record<string, unknown>;
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="tabela min-w-[1100px]" data-testid="tabela-municipios">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 bg-slate-50">Município</th>
            {cols.map(([k, r]) => <th key={k} scope="col" className="text-right">{r}</th>)}
          </tr>
        </thead>
        <tbody>
          {ind.municipios.map((m) => (
            <tr key={m.municipio_id} data-testid={`linha-municipio-${m.sigla}`}>
              <td className="sticky left-0 bg-white font-medium whitespace-nowrap text-slate-900">{m.nome}</td>
              {cols.map(([k, , f]) => <td key={k} className="text-right tabular-nums" data-col={k}>{fmt(m[k], f)}</td>)}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-semibold" data-testid="linha-municipio-total">
            <td className="sticky left-0 bg-slate-100 text-slate-900">Total</td>
            {cols.map(([k, , f]) => <td key={k} className="bg-slate-100 text-right tabular-nums" data-col={k}>{fmt(t[k], f)}</td>)}
          </tr>
        </tfoot>
      </table>
      <p className="mt-2 text-xs text-slate-500">
        Protocolados, concluídos, licenças, denúncias, fiscalizações, autos, multas e notificações: no período filtrado. Em andamento, prazos e licenças vencendo: situação atual.
        Filtros de tipo de ato e técnico não se aplicam à fiscalização.
      </p>
    </div>
  );
}

function Adesao({ ind }: { ind: Ind }) {
  const a = ind.adesao;
  const pct = Math.min(100, a.percentual);
  return (
    <div data-testid="bloco-adesao">
      <div className="mb-4 flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <div className="text-xs font-medium text-slate-600">Municípios aderidos</div>
          <div className="text-3xl font-semibold text-slate-900" data-testid="adesao-percentual">{fmtNumero(a.percentual, 1)}%</div>
          <div className="text-xs text-slate-500">{a.aderidos} de {a.total} · meta do convênio ≥ {a.meta}%</div>
        </div>
        <div className="min-w-48 flex-1">
          <div className="relative h-3 rounded-full bg-sky-100" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={a.percentual} aria-label="Percentual de adesão">
            <div className="h-3 rounded-full" style={{ width: `${pct}%`, background: "#2a78d6" }} />
            <div className="absolute -top-1 h-5 w-0.5 bg-slate-700" style={{ left: `${a.meta}%` }} title={`Meta ${a.meta}%`} aria-hidden />
          </div>
          <div className="mt-1 flex items-center gap-1 text-xs font-medium">
            {a.atingiu ? <><CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden /><span className="text-emerald-800">Meta atingida</span></> : <><Clock className="h-4 w-4 text-amber-600" aria-hidden /><span className="text-amber-800">Meta ainda não atingida</span></>}
          </div>
        </div>
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {a.municipios.map((m) => (
          <li key={m.municipio_id} className="flex items-start gap-2 rounded-md border border-slate-200 p-2 text-sm">
            {m.aderiu ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />}
            <div>
              <div className="font-medium">{m.nome} <span className="text-xs font-normal text-slate-500">({m.aderiu ? "aderido" : "não aderido"})</span></div>
              <div className="text-xs text-slate-600">{m.usuarios_ativos} usuário(s) ativo(s) · {m.processos_total} processo(s)</div>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-slate-500">Aderido = ao menos 1 usuário municipal ativo e 1 processo protocolado.</p>
    </div>
  );
}
