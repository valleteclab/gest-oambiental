import Link from "next/link";
import { exigirUsuario, getOrgaoAtivo } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can, escopoMunicipios, filtroMunicipioPadrao, isSomenteLeitura } from "@/lib/rbac";
import { fmtData } from "@/lib/format";
import { semaforo } from "@/lib/dias";
import { formatarEndereco } from "@/lib/cadastros/validacao";
import { BadgeStatus, CabecalhoPagina, Card, Paginacao, PontoSemaforo, Vazio } from "@/components/ui";
import { diasAlertaDe, mapaDiasAlerta } from "@/lib/processo/consultas";
import { listarDemandas } from "@/lib/demandas/consultas";
import { ehDemandaUrbana, lerDadosDemanda, SIGLAS_DEMANDAS, type SiglaDemanda } from "@/lib/demandas/catalogo";
import { FormAcao } from "../processos/_componentes/acoes-processo";
import { Proibido } from "../processos/_componentes/proibido";

export const metadata = { title: "Demandas urbanas" };

type Busca = { municipio?: string; servico?: string; situacao?: string; tecnico?: string; q?: string; page?: string };

const NOME: Record<SiglaDemanda, string> = { APC: "Poda/corte de árvore", ASE: "Som em evento", ACS: "Carro de som" };

/** Resumo de uma linha dos dados do pedido (espécie/quantidade, data do evento, placa). */
function resumo(sigla: string, descricao: string | null): string {
  const d = lerDadosDemanda(descricao)?.dados ?? {};
  if (sigla === "APC") return [d.intervencao, d.especie && `${d.especie}${d.quantidade ? ` (${d.quantidade})` : ""}`, d.motivo].filter(Boolean).join(" · ");
  if (sigla === "ASE") return [d.evento, d.data_inicio && `${d.data_inicio.split("-").reverse().join("/")}${d.horario_inicio ? ` ${d.horario_inicio}–${d.horario_fim ?? ""}` : ""}`, d.publico && `${d.publico} pessoas`].filter(Boolean).join(" · ");
  return [d.placa && `Placa ${d.placa}`, d.periodo_dias, d.finalidade].filter(Boolean).join(" · ");
}

/** Fila das demandas urbanas (APC/ASE/ACS): alto volume, ordenada por prazo, com ações rápidas. Mobile-first (cartões). */
export default async function PaginaDemandas({ searchParams }: { searchParams: Promise<Busca> }) {
  const u = await exigirUsuario({ interno: true });
  if (!can(u, "ver", "processo")) return <Proibido voltar="/dashboard" mensagem="Seu perfil não tem acesso a processos." />;
  const bruto = await searchParams;
  const orgao = await getOrgaoAtivo();
  const sp: Busca = { ...bruto, municipio: filtroMunicipioPadrao(u, bruto.municipio, orgao?.id) };
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const size = 30;
  const situacao = sp.situacao === "concluidas" || sp.situacao === "todas" ? sp.situacao : "ativas";
  const tecnico = sp.tecnico === "meus" ? u.id : sp.tecnico === "sem" ? "sem" : null;
  const [alertas, municipios, r] = await Promise.all([
    mapaDiasAlerta(u.organizacao_id),
    prisma.municipio.findMany({ where: { id: { in: escopoMunicipios(u) } }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
    listarDemandas(u, { municipio: sp.municipio || undefined, sigla: sp.servico, situacao, tecnico, q: sp.q, skip: (page - 1) * size, take: size }),
  ]);
  const somenteLeitura = isSomenteLeitura(u);
  const qs = (extra: Partial<Busca>) => {
    const q = new URLSearchParams(Object.entries({ ...sp, ...extra }).filter(([k, v]) => v || (k === "municipio" && v === "")) as [string, string][]);
    return `/demandas?${q}`;
  };
  const total = Object.values(r.contagem).reduce((a, b) => a + b, 0);

  return (
    <>
      <CabecalhoPagina titulo="Demandas urbanas" subtitulo={`Poda/corte de árvore, som em eventos e carro de som · ${r.total} na fila${somenteLeitura ? " · somente leitura" : ""}`} acoes={<Link href="/servicos" className="btn-secundario">Ver serviços no portal</Link>} />

      <nav aria-label="Filtrar por serviço" className="mb-3 flex flex-wrap gap-2" data-testid="chips-servico">
        <Link href={qs({ servico: undefined, page: undefined })} aria-current={!ehDemandaUrbana(sp.servico) ? "page" : undefined} className={!ehDemandaUrbana(sp.servico) ? "btn-primario btn-sm" : "btn-secundario btn-sm"}>Todos ({total})</Link>
        {SIGLAS_DEMANDAS.map((s) => (
          <Link key={s} href={qs({ servico: s, page: undefined })} aria-current={sp.servico === s ? "page" : undefined} className={sp.servico === s ? "btn-primario btn-sm" : "btn-secundario btn-sm"}>
            {s} – {NOME[s]} ({r.contagem[s] ?? 0})
          </Link>
        ))}
      </nav>

      <Card className="mb-4">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" role="search" aria-label="Filtrar demandas">
          {sp.servico && <input type="hidden" name="servico" value={sp.servico} />}
          <div className="lg:col-span-2">
            <label htmlFor="d-q" className="label">Busca</label>
            <input id="d-q" name="q" defaultValue={sp.q} className="input" placeholder="Nº, local, requerente, espécie, placa…" />
          </div>
          <div>
            <label htmlFor="d-mun" className="label">Município</label>
            <select id="d-mun" name="municipio" defaultValue={sp.municipio ?? ""} className="input">
              <option value="">Todos</option>
              {municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="d-sit" className="label">Situação</label>
            <select id="d-sit" name="situacao" defaultValue={situacao} className="input">
              <option value="ativas">Em andamento</option>
              <option value="concluidas">Concluídas/arquivadas</option>
              <option value="todas">Todas</option>
            </select>
          </div>
          <div>
            <label htmlFor="d-tec" className="label">Técnico</label>
            <select id="d-tec" name="tecnico" defaultValue={sp.tecnico ?? ""} className="input">
              <option value="">Todos</option>
              <option value="meus">Minhas demandas</option>
              <option value="sem">Sem técnico</option>
            </select>
          </div>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-5">
            <button className="btn-primario" type="submit">Filtrar</button>
            <Link href="/demandas?municipio=" className="btn-secundario">Limpar</Link>
          </div>
        </form>
      </Card>

      {r.itens.length === 0 ? (
        <Card><Vazio>Nenhuma demanda urbana com os filtros informados.</Vazio></Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2" data-testid="lista-demandas">
          {r.itens.map((p) => {
            const sem = semaforo(p.prazo_etapa_ate, diasAlertaDe(alertas, p.municipio.id, p.etapa_atual), p.prazo_pausado);
            const podeAceitar = !somenteLeitura && p.status === "EM_TRIAGEM" && can(u, "triar", "processo", p.municipio.id);
            const podeDistribuir = !somenteLeitura && p.status === "PROTOCOLADO" && can(u, "triar", "processo", p.municipio.id);
            return (
              <li key={p.id} className="card flex flex-col gap-2 p-4" data-testid="demanda-item" data-numero={p.numero ?? ""}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Link href={`/demandas/${p.id}`} className="font-mono text-sm font-semibold text-primaria-700 hover:underline">{p.numero}</Link>
                    <p className="text-sm font-medium text-slate-900">{p.tipo_ato.sigla} – {NOME[p.tipo_ato.sigla as SiglaDemanda] ?? p.tipo_ato.nome}</p>
                  </div>
                  <BadgeStatus status={p.status} />
                </div>
                <p className="text-sm text-slate-700">{resumo(p.tipo_ato.sigla, p.descricao_atividade) || "—"}</p>
                <p className="text-xs text-slate-500">{p.empreendimento.nome} · {formatarEndereco(p.empreendimento.endereco) || p.municipio.nome}</p>
                <p className="text-xs text-slate-500">Requerente: {p.requerente.nome} · Técnico: {p.tecnico?.nome ?? "sem técnico"}</p>
                <p className="inline-flex items-center gap-2 text-xs text-slate-600">
                  <PontoSemaforo s={sem} /> {p.prazo_etapa_ate ? `Prazo: ${fmtData(p.prazo_etapa_ate)}${p.prazo_pausado ? " (pausado)" : ""}` : "Sem prazo em curso"}
                </p>
                <div className="mt-auto flex flex-wrap items-end gap-2 pt-2">
                  <Link href={`/demandas/${p.id}`} className="btn-primario btn-sm">Atender</Link>
                  {podeAceitar && <FormAcao processoId={p.id} acao="aceitar" payload={{ despacho: "Documentação conferida (triagem simplificada)." }} rotuloBotao="Aceitar" />}
                  {podeDistribuir && <FormAcao processoId={p.id} acao="distribuir" payload={{ tecnico_id: null }} rotuloBotao="Distribuir (rodízio)" />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-4"><Paginacao page={page} size={size} total={r.total} href={(n) => qs({ page: String(n) })} /></div>
    </>
  );
}
