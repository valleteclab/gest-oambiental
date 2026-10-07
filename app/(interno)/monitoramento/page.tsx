import Link from "next/link";
import { forbidden } from "next/navigation";
import { exigirUsuario, getOrgaoAtivo } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { escopoMunicipios, filtroMunicipioPadrao, podeVerMunicipio } from "@/lib/rbac";
import { fmtData, fmtDataHora, fmtNumero } from "@/lib/format";
import { codigoIbgeReal } from "@/lib/geo/uf";
import { Aviso, Badge, CabecalhoPagina, Card, Paginacao, Vazio } from "@/components/ui";
import { Mapa, type FeicaoMapa } from "@/components/mapa";
import { listarAlertas, ultimasSincronizacoes } from "@/lib/monitoramento/servico";
import {
  COR_BADGE_STATUS_ALERTA, COR_STATUS_ALERTA, ROTULO_FONTE, ROTULO_STATUS_ALERTA, ROTULO_SUGESTAO, podeSincronizar, podeVerMonitoramento, type Sugestao,
} from "@/lib/monitoramento/regras";
import type { ResumoSync } from "@/lib/monitoramento/sync";
import { BotaoSincronizar } from "./_componentes/botao-sincronizar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Monitoramento por satélite – LicenciaGov" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const sp1 = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
const TAM = 25;
const COR_SUGESTAO: Record<Sugestao, "verde" | "vermelho" | "amarelo" | "cinza"> = { AUTORIZADO: "verde", POSSIVEL_IRREGULAR: "vermelho", SEM_CAR: "amarelo", INDETERMINADO: "cinza" };

function qs(base: Record<string, string | null | undefined>, extra: Record<string, string | number | null> = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...extra })) if (v !== null && v !== undefined) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

function Kpi({ rotulo, valor, detalhe, testId }: { rotulo: string; valor: string; detalhe?: string; testId: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium text-slate-600">{rotulo}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900" data-testid={testId}>{valor}</div>
      {detalhe && <div className="mt-0.5 text-xs text-slate-500">{detalhe}</div>}
    </div>
  );
}

export default async function PaginaMonitoramento({ searchParams }: { searchParams: SP }) {
  const u = await exigirUsuario({ interno: true });
  if (!podeVerMonitoramento(u)) forbidden();
  const s = await searchParams;
  const orgao = await getOrgaoAtivo();
  const municipio = filtroMunicipioPadrao(u, s.municipio, orgao?.id) || null;
  if (municipio && !podeVerMunicipio(u, municipio)) forbidden();
  const umAno = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const f = {
    municipio_id: municipio,
    fonte: sp1(s.fonte) || null,
    status: sp1(s.status) || null,
    classe: sp1(s.classe) || null,
    sugestao: sp1(s.sugestao) || null,
    de: s.de === undefined ? umAno : sp1(s.de) || null,
    ate: sp1(s.ate) || null,
  };
  const page = Math.max(1, Number(sp1(s.page) ?? 1) || 1);
  const base = { municipio: municipio ?? "", fonte: f.fonte, status: f.status, classe: f.classe, sugestao: f.sugestao, de: f.de ?? "", ate: f.ate };

  const [municipios, lista, syncs] = await Promise.all([
    prisma.municipio.findMany({ where: { id: { in: escopoMunicipios(u) } }, orderBy: { nome: "asc" }, select: { id: true, nome: true, codigo_ibge: true, latitude: true, longitude: true } }),
    listarAlertas(u, f, { skip: (page - 1) * TAM, take: TAM }),
    ultimasSincronizacoes(u, municipio),
  ]);
  const mun = municipios.find((m) => m.id === (municipio ?? orgao?.id));
  const centro: [number, number] | undefined = mun?.latitude != null && mun.longitude != null ? [Number(mun.latitude), Number(mun.longitude)] : undefined;
  const feicoes: FeicaoMapa[] = lista.feicoes
    .filter((x) => x.geometria)
    .map((x) => ({ id: x.id, geometria: x.geometria as GeoJSON.Geometry, cor: COR_STATUS_ALERTA[x.status], titulo: x.titulo, descricao: x.descricao, href: `/monitoramento/${x.id}` }));
  const k = lista.kpi;
  const ultima = syncs[0];
  const emAndamento = syncs.some((x) => x.status === "EXECUTANDO" && Date.now() - x.iniciado_em.getTime() < 45 * 60_000);
  const munSync = municipio ?? orgao?.id ?? null;
  const podeSync = !!munSync && podeSincronizar(u, munSync);
  const ficticio = !!mun && !codigoIbgeReal(mun.codigo_ibge);
  const resumoUltima = (ultima?.resumo ?? null) as ResumoSync | null;

  return (
    <div data-testid="pagina-monitoramento">
      <CabecalhoPagina
        titulo="Monitoramento por satélite"
        subtitulo="Alertas de desmatamento (INPE DETER e PRODES Cerrado) cruzados com o CAR e as licenças do município"
        acoes={podeSync && munSync ? <BotaoSincronizar municipioId={munSync} emAndamento={emAndamento} /> : undefined}
      />

      <div className="mb-4 text-sm text-slate-700" data-testid="ultima-sincronizacao">
        {ultima ? (
          <>
            Última sincronização{municipio ? "" : ` (${ultima.municipio.nome})`}: <strong>{fmtDataHora(ultima.iniciado_em)}</strong> –{" "}
            {ultima.status === "EXECUTANDO" ? <Badge cor="azul">em andamento</Badge> : <Badge cor={ultima.status === "OK" ? "verde" : ultima.status === "PARCIAL" ? "amarelo" : "vermelho"}>{ultima.status.toLowerCase()}</Badge>}
            {resumoUltima?.fontes?.length ? <span className="ml-2 text-xs text-slate-600">{resumoUltima.fontes.filter((x) => x.status !== "DESATIVADA").map((x) => `${x.fonte}: ${x.recebidos} recebido(s), ${x.novos} novo(s)${x.status === "ERRO" ? " – erro" : ""}`).join(" · ")}</span> : null}
          </>
        ) : ficticio ? (
          <span>Município de demonstração (código IBGE fictício): os alertas exibidos são <strong>fictícios</strong>; a sincronização com o INPE só ocorre para municípios reais.</span>
        ) : (
          <span>Nenhuma sincronização realizada ainda. A sincronização automática roda diariamente às 06:30.</span>
        )}
      </div>

      <form className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8" method="get" aria-label="Filtros">
        <label className="block xl:col-span-2"><span className="label">Município</span>
          <select name="municipio" defaultValue={municipio ?? ""} className="input">
            <option value="">Todos</option>
            {municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        </label>
        <label className="block"><span className="label">Fonte</span>
          <select name="fonte" defaultValue={f.fonte ?? ""} className="input">
            <option value="">Todas</option>
            {Object.entries(ROTULO_FONTE).map(([k2, v]) => <option key={k2} value={k2}>{v}</option>)}
          </select>
        </label>
        <label className="block"><span className="label">Situação</span>
          <select name="status" defaultValue={f.status ?? ""} className="input" data-testid="filtro-status">
            <option value="">Todas</option>
            {Object.entries(ROTULO_STATUS_ALERTA).map(([k2, v]) => <option key={k2} value={k2}>{v}</option>)}
          </select>
        </label>
        <label className="block"><span className="label">Classe</span>
          <select name="classe" defaultValue={f.classe ?? ""} className="input">
            <option value="">Todas</option>
            {lista.classes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="block"><span className="label">Detectado de</span><input type="date" name="de" defaultValue={f.de ?? ""} className="input" /></label>
        <label className="block"><span className="label">até</span><input type="date" name="ate" defaultValue={f.ate ?? ""} className="input" /></label>
        <div className="flex items-end gap-2"><button className="btn-primario">Filtrar</button><Link href="/monitoramento" className="btn-secundario">Limpar</Link></div>
      </form>

      <h2 className="sr-only">Indicadores</h2>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi rotulo="Alertas no período" valor={fmtNumero(k.total)} detalhe={`${fmtNumero(k.novos)} novo(s) sem tratamento`} testId="kpi-alertas" />
        <Kpi rotulo="Área total" valor={`${fmtNumero(k.area_ha, 1)} ha`} testId="kpi-area" />
        <Kpi rotulo="Com imóvel no CAR" valor={k.pct_com_car === null ? "—" : `${fmtNumero(k.pct_com_car, 1)}%`} detalhe="área sobreposta a imóvel(is) do CAR" testId="kpi-com-car" />
        <Kpi rotulo="Sem autorização local" valor={k.pct_sem_autorizacao === null ? "—" : `${fmtNumero(k.pct_sem_autorizacao, 1)}%`} detalhe="sem licença/ASV municipal (exceto descartados)" testId="kpi-sem-autorizacao" />
      </div>

      <Card titulo="Mapa dos alertas" className="mb-4">
        <div data-testid="mapa-monitoramento" data-feicoes={feicoes.length}>
          <Mapa key={JSON.stringify(base)} centro={centro} zoom={10} altura="min(65vh, 560px)" feicoes={feicoes} enquadrarFeicoes={feicoes.length > 0} camadasIniciais={["car", "limite-municipio", "esri-rotulos"]} />
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-700" aria-label="Legenda">
          {Object.entries(ROTULO_STATUS_ALERTA).map(([k2, v]) => (
            <span key={k2} className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm border" style={{ background: COR_STATUS_ALERTA[k2 as keyof typeof COR_STATUS_ALERTA], opacity: 0.8 }} />{v}</span>
          ))}
          <span className="text-slate-500">· CAR (contornos azuis) a partir do zoom 11 · clique no polígono para abrir a ficha</span>
        </div>
        {lista.feicoesOmitidas > 0 && <p className="mt-2 text-xs text-amber-700">{lista.feicoesOmitidas} alerta(s) além do limite do mapa – refine os filtros.</p>}
      </Card>

      <Card titulo={`Alertas (${fmtNumero(lista.total)})`}>
        {lista.itens.length === 0 ? (
          <Vazio>Nenhum alerta no filtro.</Vazio>
        ) : (
          <>
            <ul className="divide-y divide-slate-100 md:hidden">
              {lista.itens.map((a) => (
                <li key={a.id} className="py-3" data-testid="alerta-linha" data-id-externo={a.id_externo}>
                  <Link href={`/monitoramento/${a.id}`} className="block">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{a.fonte} · {fmtData(a.data_deteccao)}</span>
                      <Badge cor={COR_BADGE_STATUS_ALERTA[a.status]}>{ROTULO_STATUS_ALERTA[a.status]}</Badge>
                    </div>
                    <div className="text-sm text-slate-600">{fmtNumero(a.area_ha, 2)} ha · {a.municipio.nome} · CAR: {a.imoveis_car}</div>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="tabela">
                <thead>
                  <tr><th>Detecção</th><th>Fonte / identificador</th><th>Município</th><th className="text-right">Área (ha)</th><th className="text-right">Imóveis CAR</th><th>Sugestão</th><th>Situação</th><th><span className="sr-only">Ações</span></th></tr>
                </thead>
                <tbody>
                  {lista.itens.map((a) => (
                    <tr key={a.id} data-testid="alerta-linha" data-id-externo={a.id_externo}>
                      <td>{fmtData(a.data_deteccao)}</td>
                      <td><span className="font-medium">{a.fonte}</span> <span className="text-xs text-slate-600">{a.id_externo}</span><div className="text-xs text-slate-500">{a.classe}</div></td>
                      <td>{a.municipio.nome}</td>
                      <td className="text-right">{fmtNumero(a.area_ha, 2)}</td>
                      <td className="text-right">{a.imoveis_car}</td>
                      <td>{a.status_sugerido ? <Badge cor={COR_SUGESTAO[a.status_sugerido as Sugestao] ?? "cinza"}>{ROTULO_SUGESTAO[a.status_sugerido as Sugestao]?.split(" (")[0] ?? a.status_sugerido}</Badge> : "—"}</td>
                      <td><Badge cor={COR_BADGE_STATUS_ALERTA[a.status]}>{ROTULO_STATUS_ALERTA[a.status]}</Badge></td>
                      <td><Link href={`/monitoramento/${a.id}`} className="text-primaria-700 hover:underline">Ficha</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginacao page={page} size={TAM} total={lista.total} href={(p) => `/monitoramento${qs(base, { page: p })}`} />
          </>
        )}
      </Card>

      <div className="mt-4">
        <Aviso>
          Fontes: INPE/TerraBrasilis – DETER Cerrado (alertas quase diários) e PRODES Cerrado (desmatamento anual), licença CC BY-SA 4.0; CAR/SICAR (autodeclaratório).
          A sugestão considera apenas licenças e autorizações emitidas neste sistema – autorizações estaduais (INEMA) precisam ser conferidas antes de concluir pela irregularidade.
        </Aviso>
      </div>
    </div>
  );
}
