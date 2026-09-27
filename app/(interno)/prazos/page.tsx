import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can, escopoMunicipios, whereMunicipio } from "@/lib/rbac";
import { configPrazo } from "@/lib/prazos";
import { diasRestantes, rotuloDiasRestantes, semaforo } from "@/lib/dias";
import { fmtData } from "@/lib/format";
import { STATUS_COM_PRAZO, abaDoPrazo, etapaDoStatus, type AbaPrazo } from "@/lib/alertas/regras";
import { Aviso, BadgeStatus, CabecalhoPagina, Card, PontoSemaforo, Vazio } from "@/components/ui";

export const metadata = { title: "Prazos – LicenciaGov" };

const ABAS: { id: AbaPrazo; rotulo: string }[] = [
  { id: "vencidos", rotulo: "Vencidos" },
  { id: "vencendo", rotulo: "Vencem em 7 dias" },
  { id: "em-dia", rotulo: "Em dia" },
  { id: "pausados", rotulo: "Pausados" },
];

type SP = { aba?: string; municipio?: string; tecnico?: string };

export default async function PaginaPrazos({ searchParams }: { searchParams: Promise<SP> }) {
  const u = await exigirUsuario({ interno: true });
  if (!can(u, "ver", "processo")) return <Aviso tipo="erro">Acesso negado (403).</Aviso>;
  const sp = await searchParams;
  const aba: AbaPrazo = (ABAS.find((a) => a.id === sp.aba)?.id ?? "vencidos") as AbaPrazo;
  const municipio = sp.municipio || null;
  const tecnico = sp.tecnico || null;
  const hoje = new Date();

  const escopo = whereMunicipio(u, municipio);
  const [processos, municipios, tecnicos] = await Promise.all([
    prisma.processo.findMany({
      where: {
        ...escopo,
        status: { in: [...STATUS_COM_PRAZO, "AGUARDANDO_REQUERENTE"] },
        ...(tecnico === "sem" ? { tecnico_id: null } : tecnico ? { tecnico_id: tecnico } : {}),
      },
      orderBy: [{ prazo_etapa_ate: "asc" }],
      take: 2000,
      select: {
        id: true, numero: true, status: true, organizacao_id: true, municipio_id: true, prazo_etapa_ate: true, prazo_pausado: true, prazo_saldo_dias: true,
        tipo_ato: { select: { sigla: true, prazo_analise_dias: true } },
        empreendimento: { select: { nome: true } },
        municipio: { select: { nome: true, sigla: true } },
        tecnico: { select: { nome: true } },
      },
    }),
    prisma.municipio.findMany({ where: { ativo: true, ...(escopoMunicipios(u) === "TODOS" ? {} : { id: { in: escopoMunicipios(u) as string[] } }) }, orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
    prisma.usuario.findMany({ where: { processos_tecnico: { some: whereMunicipio(u, municipio) } }, orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
  ]);

  // dias_alerta por (organização, município, etapa) – município sobrepõe organização
  const cache = new Map<string, number>();
  const linhas = [] as (typeof processos[number] & { aba: AbaPrazo; dias: number | null; diasAlerta: number; etapa: string | null })[];
  let semPrazo = 0;
  for (const p of processos) {
    const pausado = p.prazo_pausado || p.status === "AGUARDANDO_REQUERENTE";
    const a = abaDoPrazo(p.prazo_etapa_ate, pausado, hoje);
    if (!a) {
      semPrazo++;
      continue;
    }
    const etapa = etapaDoStatus(p.status, p.tipo_ato);
    let diasAlerta = 5;
    if (etapa) {
      const k = `${p.organizacao_id}|${p.municipio_id}|${etapa}`;
      if (!cache.has(k)) cache.set(k, (await configPrazo(prisma, p.organizacao_id, p.municipio_id, etapa)).dias_alerta);
      diasAlerta = cache.get(k)!;
    }
    const dias = pausado ? p.prazo_saldo_dias : p.prazo_etapa_ate ? diasRestantes(p.prazo_etapa_ate, false, new Set(), hoje) : null;
    linhas.push({ ...p, aba: a, dias, diasAlerta, etapa });
  }
  const contagem = Object.fromEntries(ABAS.map((x) => [x.id, linhas.filter((l) => l.aba === x.id).length])) as Record<AbaPrazo, number>;
  const visiveis = linhas.filter((l) => l.aba === aba);
  if (aba === "vencidos") visiveis.sort((a, b) => (a.dias ?? 0) - (b.dias ?? 0));

  const href = (o: Partial<SP>) => {
    const q = new URLSearchParams();
    const v = { aba, municipio: municipio ?? undefined, tecnico: tecnico ?? undefined, ...o };
    for (const [k, x] of Object.entries(v)) if (x) q.set(k, x);
    return `/prazos?${q}`;
  };

  return (
    <>
      <CabecalhoPagina titulo="Prazos" subtitulo="Processos por situação do prazo da etapa atual (SPEC 6.1). Vermelho = vencido; amarelo = dentro da janela de alerta." />

      <form method="get" className="card mb-4 grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end" aria-label="Filtros">
        <input type="hidden" name="aba" value={aba} />
        <label className="block">
          <span className="label">Município</span>
          <select name="municipio" defaultValue={municipio ?? ""} className="input" data-testid="filtro-municipio">
            <option value="">Todos do meu escopo</option>
            {municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label">Técnico responsável</span>
          <select name="tecnico" defaultValue={tecnico ?? ""} className="input" data-testid="filtro-tecnico">
            <option value="">Todos</option>
            <option value={u.id}>Meus processos</option>
            <option value="sem">Sem técnico</option>
            {tecnicos.filter((t) => t.id !== u.id).map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
        </label>
        <div className="flex gap-2">
          <button className="btn-primario">Filtrar</button>
          <Link href="/prazos" className="btn-secundario">Limpar</Link>
        </div>
      </form>

      <div role="tablist" aria-label="Situação do prazo" className="mb-4 flex flex-wrap gap-2">
        {ABAS.map((x) => (
          <Link key={x.id} role="tab" aria-selected={x.id === aba} href={href({ aba: x.id })} data-testid={`aba-${x.id}`}
            className={x.id === aba ? "btn-primario btn-sm" : "btn-secundario btn-sm"}>
            {x.rotulo} <span className={`rounded-full px-1.5 text-xs ${x.id === aba ? "bg-white/20" : x.id === "vencidos" && contagem.vencidos ? "bg-red-100 text-red-800" : "bg-slate-100"}`}>{contagem[x.id]}</span>
          </Link>
        ))}
      </div>

      <Card>
        {visiveis.length === 0 ? (
          <Vazio>Nenhum processo nesta situação.</Vazio>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela" data-testid="tabela-prazos">
              <thead>
                <tr>
                  <th scope="col"><span className="sr-only">Semáforo</span></th>
                  <th scope="col">Processo</th>
                  <th scope="col" className="hidden md:table-cell">Empreendimento</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="hidden sm:table-cell">Técnico</th>
                  <th scope="col">Prazo</th>
                  <th scope="col">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((p) => {
                  const pausado = p.aba === "pausados";
                  const s = semaforo(p.prazo_etapa_ate, p.diasAlerta, pausado, hoje);
                  return (
                    <tr key={p.id} data-testid="linha-prazo" data-semaforo={s} className={s === "vermelho" ? "bg-red-50/60" : undefined}>
                      <td><PontoSemaforo s={s} /></td>
                      <td>
                        <Link href={`/processos/${p.id}`} className="font-medium text-primaria-700 hover:underline">{p.numero ?? "(sem número)"}</Link>
                        <div className="text-xs text-slate-500">{p.tipo_ato.sigla} · {p.municipio.nome}</div>
                      </td>
                      <td className="hidden md:table-cell">{p.empreendimento.nome}</td>
                      <td><BadgeStatus status={p.status} /></td>
                      <td className="hidden sm:table-cell">{p.tecnico?.nome ?? <span className="text-slate-400">—</span>}</td>
                      <td className="whitespace-nowrap">{pausado ? <span className="text-slate-500">pausado</span> : fmtData(p.prazo_etapa_ate)}</td>
                      <td className={`whitespace-nowrap ${s === "vermelho" ? "font-semibold text-red-700" : s === "amarelo" ? "font-medium text-amber-700" : ""}`}>
                        {pausado ? (p.dias !== null ? `saldo ${p.dias} dia(s)` : "—") : rotuloDiasRestantes(p.dias)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {semPrazo > 0 && <p className="mt-3 text-xs text-slate-500">{semPrazo} processo(s) ativo(s) sem prazo de etapa definido não aparecem nas abas.</p>}
      </Card>
    </>
  );
}
