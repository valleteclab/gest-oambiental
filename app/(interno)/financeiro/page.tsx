import Link from "next/link";
import { exigirUsuario, getOrgaoAtivo } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can, escopoMunicipios, filtroMunicipioPadrao, isSomenteLeitura } from "@/lib/rbac";
import { fmtData, fmtDataCivil, fmtMoeda } from "@/lib/format";
import { listarCobrancas, STATUS_COBRANCA } from "@/lib/cobranca/consultas";
import { COR_STATUS_COBRANCA, ehSimulada, FASES, ROTULO_STATUS_COBRANCA, rotuloForma, rotuloTaxa, STATUS_EM_ABERTO } from "@/lib/cobranca/regras";
import { podeGerirCobrancas } from "@/lib/cobranca/servico";
import { AcoesCobranca } from "@/components/cobranca/acoes-cobranca";
import { Badge, CabecalhoPagina, Card, Paginacao, Vazio } from "@/components/ui";
import { AcessoNegado } from "@/components/acesso-negado";

export const metadata = { title: "Financeiro – taxas – LicenciaGov" };
export const dynamic = "force-dynamic";

type Busca = { municipio?: string; status?: string; fase?: string; de?: string; ate?: string; q?: string; page?: string };

export default async function PaginaFinanceiro({ searchParams }: { searchParams: Promise<Busca> }) {
  const u = await exigirUsuario({ interno: true });
  if (!can(u, "ver", "cobranca")) return <AcessoNegado mensagem="Seu perfil não tem acesso às cobranças." />;
  const bruto = await searchParams;
  const orgao = await getOrgaoAtivo();
  const sp: Busca = { ...bruto, municipio: filtroMunicipioPadrao(u, bruto.municipio, orgao?.id) };
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const size = 25;
  const [municipios, { total, itens, totais }] = await Promise.all([
    prisma.municipio.findMany({ where: { id: { in: escopoMunicipios(u) } }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
    listarCobrancas(u, { municipio: sp.municipio || null, status: sp.status, fase: sp.fase, de: sp.de, ate: sp.ate, q: sp.q }, { skip: (page - 1) * size, take: size }),
  ]);
  const somenteLeitura = isSomenteLeitura(u);
  const href = (p: number) => {
    const q = new URLSearchParams(Object.entries({ ...sp, page: String(p) }).filter(([k, v]) => v || (k === "municipio" && v === "")) as [string, string][]);
    return `/financeiro?${q}`;
  };
  const cartoes = [
    { rotulo: "Arrecadado", valor: totais.arrecadado, qtd: totais.quantidade.PAGA, cor: "text-emerald-700", testid: "total-arrecadado" },
    { rotulo: "Pendente", valor: totais.pendente, qtd: totais.quantidade.PENDENTE, cor: "text-amber-700", testid: "total-pendente" },
    { rotulo: "Vencido", valor: totais.vencido, qtd: totais.quantidade.VENCIDA, cor: "text-red-700", testid: "total-vencido" },
    { rotulo: "Isento", valor: totais.isento, qtd: totais.quantidade.ISENTA, cor: "text-sky-700", testid: "total-isento" },
  ];
  return (
    <>
      <CabecalhoPagina
        titulo="Financeiro – taxas de licenciamento"
        subtitulo={`${total} cobrança(s) no filtro${somenteLeitura ? " · acesso somente leitura" : ""}`}
        acoes={can(u, "configurar", "admin") ? <><Link href="/admin/cobranca" className="btn-secundario">Configurar cobrança</Link><Link href="/admin/taxas" className="btn-secundario">Tabela de taxas</Link></> : null}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cartoes.map((c) => (
          <div key={c.rotulo} className="card p-4" data-testid={c.testid}>
            <p className="text-sm text-slate-500">{c.rotulo}</p>
            <p className={`text-2xl font-semibold ${c.cor}`}>{fmtMoeda(c.valor)}</p>
            <p className="text-xs text-slate-500">{c.qtd} cobrança(s)</p>
          </div>
        ))}
      </div>
      <Card className="mb-4">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7" role="search" aria-label="Filtrar cobranças">
          <div className="lg:col-span-2">
            <label htmlFor="f-q" className="label">Busca</label>
            <input id="f-q" name="q" defaultValue={sp.q} className="input" placeholder="Nº da cobrança ou do processo" />
          </div>
          <div>
            <label htmlFor="f-mun" className="label">Município</label>
            <select id="f-mun" name="municipio" defaultValue={sp.municipio ?? ""} className="input">
              <option value="">Todos</option>
              {municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="f-status" className="label">Situação</label>
            <select id="f-status" name="status" defaultValue={sp.status ?? ""} className="input">
              <option value="">Todas</option>
              {STATUS_COBRANCA.map((s) => <option key={s} value={s}>{ROTULO_STATUS_COBRANCA[s]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="f-fase" className="label">Fase</label>
            <select id="f-fase" name="fase" defaultValue={sp.fase ?? ""} className="input">
              <option value="">Todas</option>
              {FASES.map((f) => <option key={f} value={f}>{rotuloTaxa(f)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="f-de" className="label">Gerada de</label>
            <input id="f-de" type="date" name="de" defaultValue={sp.de} className="input" />
          </div>
          <div>
            <label htmlFor="f-ate" className="label">até</label>
            <input id="f-ate" type="date" name="ate" defaultValue={sp.ate} className="input" />
          </div>
          <div className="flex items-end gap-2 lg:col-span-7">
            <button className="btn-primario">Filtrar</button>
            <Link href="/financeiro?municipio=" className="btn-secundario">Limpar</Link>
          </div>
        </form>
      </Card>
      <Card>
        {itens.length === 0 ? <Vazio>Nenhuma cobrança encontrada.</Vazio> : (
          <div className="overflow-x-auto">
            <table className="tabela" data-testid="tabela-cobrancas">
              <thead>
                <tr><th>Cobrança</th><th>Processo</th><th>Fase</th><th className="text-right">Valor</th><th>Vencimento</th><th>Situação</th><th>Ações</th></tr>
              </thead>
              <tbody>
                {itens.map((c) => {
                  const aberta = STATUS_EM_ABERTO.includes(c.status);
                  const gerir = !somenteLeitura && podeGerirCobrancas(u, c.municipio.id);
                  return (
                    <tr key={c.id}>
                      <td className="whitespace-nowrap"><span className="font-medium">{c.numero}</span><div className="text-xs text-slate-500">{c.municipio.nome}</div></td>
                      <td>{c.processo ? <Link className="text-primaria-700 hover:underline" href={`/processos/${c.processo.id}?aba=taxas`}>{c.processo.numero ?? "—"}</Link> : "—"}<div className="max-w-56 truncate text-xs text-slate-500">{c.processo?.requerente.nome}</div></td>
                      <td>{rotuloTaxa(c.fase)}</td>
                      <td className="whitespace-nowrap text-right">{fmtMoeda(c.valor)}{c.status === "PAGA" && c.valor_pago && Number(c.valor_pago) !== Number(c.valor) ? <div className="text-xs text-slate-500">pago {fmtMoeda(c.valor_pago)}</div> : null}</td>
                      <td className="whitespace-nowrap">{fmtDataCivil(c.vencimento)}</td>
                      <td>
                        <Badge cor={COR_STATUS_COBRANCA[c.status]}>{ROTULO_STATUS_COBRANCA[c.status]}</Badge>
                        {c.status === "PAGA" && <div className="text-xs text-slate-500">{fmtData(c.pago_em)} · {rotuloForma(c.forma_pagamento)}</div>}
                        {c.erro_gateway && aberta && <div className="text-xs text-red-700" title={c.erro_gateway}>erro no gateway</div>}
                      </td>
                      <td>
                        {aberta && gerir ? (
                          <details className="group">
                            <summary className="btn-secundario btn-sm cursor-pointer list-none">Ações</summary>
                            <div className="mt-2 w-72 max-w-[80vw]">
                              <AcoesCobranca gerir c={{ id: c.id, numero: c.numero, processo_id: c.processo?.id ?? null, aberta, simulada: ehSimulada(c.asaas_payment_id), erroGateway: !!c.erro_gateway, gatewayAsaas: c.gateway === "ASAAS", semRegistro: !c.asaas_payment_id }} />
                            </div>
                          </details>
                        ) : c.invoice_url && aberta ? (
                          <a className="text-primaria-700 hover:underline" href={c.invoice_url} target="_blank" rel="noopener noreferrer">Fatura</a>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Paginacao page={page} size={size} total={total} href={href} />
      </Card>
    </>
  );
}
