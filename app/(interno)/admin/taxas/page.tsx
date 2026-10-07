import Link from "next/link";
import type { FaseCobranca, PotencialPoluidor, Porte } from "@prisma/client";
import { prisma } from "@/lib/db";
import { usuarioAdminPagina } from "@/lib/admin/guard";
import { whereMunicipiosAdmin } from "@/lib/admin/escopo";
import { whereOrganizacao } from "@/lib/rbac";
import { fmtMoeda } from "@/lib/format";
import { ROTULO_PORTE } from "@/lib/processo/porte";
import { calcularTaxa, FASES, rotuloTaxa } from "@/lib/cobranca/regras";
import { AcessoNegado } from "@/components/acesso-negado";
import { Aviso, Badge, CabecalhoPagina, Card, Vazio } from "@/components/ui";
import { FormAdmin } from "../_comp/form-admin";
import { Marcador, Selecao, Texto } from "../_comp/campos";
import { criarTaxa, editarTaxa, removerTaxa } from "./actions";

export const metadata = { title: "Tabela de taxas – Administração" };
export const dynamic = "force-dynamic";

const PORTES: Porte[] = ["MICRO", "PEQUENO", "MEDIO", "GRANDE", "EXCEPCIONAL"];
const POTENCIAIS: PotencialPoluidor[] = ["BAIXO", "MEDIO", "ALTO"];
const ROTULO_POTENCIAL: Record<PotencialPoluidor, string> = { BAIXO: "Baixo", MEDIO: "Médio", ALTO: "Alto" };
const DICA_FASE: Record<FaseCobranca, string> = {
  UNICA: "cobrada no protocolo; substitui as demais fases",
  ANALISE: "cobrada no protocolo; libera o aceite da triagem",
  VISTORIA: "cobrada ao agendar a vistoria; libera a conclusão da vistoria",
  EMISSAO: "cobrada no deferimento; libera a emissão do documento",
};

export default async function PaginaTaxas({ searchParams }: { searchParams: Promise<{ sim_tipo?: string; sim_porte?: string; sim_potencial?: string; sim_municipio?: string }> }) {
  const { u, ok } = await usuarioAdminPagina();
  if (!ok) return <AcessoNegado mensagem="A tabela de taxas é restrita ao administrador." />;
  const sp = await searchParams;
  const [linhas, tipos, municipios] = await Promise.all([
    prisma.tabelaTaxa.findMany({ where: whereOrganizacao(u), include: { tipo_ato: { select: { sigla: true, nome: true } }, municipio: { select: { nome: true } } }, orderBy: [{ fase: "asc" }, { valor: "asc" }] }),
    prisma.tipoAto.findMany({ where: { ...whereOrganizacao(u), ativo: true }, orderBy: { sigla: "asc" }, select: { id: true, sigla: true, nome: true } }),
    prisma.municipio.findMany({ where: whereMunicipiosAdmin(u), orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
  ]);
  const ordem = (f: FaseCobranca) => FASES.indexOf(f);
  linhas.sort((a, b) => ordem(a.fase) - ordem(b.fase) || Number(a.valor) - Number(b.valor));

  // Simulador: qual valor cada fase teria para uma combinação
  const simTipo = tipos.find((t) => t.id === sp.sim_tipo);
  const simMun = municipios.find((m) => m.id === sp.sim_municipio);
  const simPorte = PORTES.includes(sp.sim_porte as Porte) ? (sp.sim_porte as Porte) : null;
  const simPot = POTENCIAIS.includes(sp.sim_potencial as PotencialPoluidor) ? (sp.sim_potencial as PotencialPoluidor) : null;
  const simulacao = simTipo && simMun ? FASES.map((fase) => ({ fase, linha: calcularTaxa(linhas, { municipio_id: simMun.id, tipo_ato_id: simTipo.id, porte: simPorte, potencial: simPot }, fase) })) : null;

  const opcoesPorte = PORTES.map((p) => ({ valor: p, rotulo: ROTULO_PORTE[p] }));
  const opcoesPot = POTENCIAIS.map((p) => ({ valor: p, rotulo: ROTULO_POTENCIAL[p] }));
  return (
    <div className="space-y-6">
      <CabecalhoPagina titulo="Tabela de taxas" subtitulo={<><Link href="/admin" className="underline">Administração</Link> · <Link href="/admin/cobranca" className="underline">Cobrança (Asaas)</Link> · a linha mais específica vence: município &gt; organização; tipo de ato, porte e potencial definidos &gt; “qualquer”</>} />
      <Aviso tipo="info">Os valores devem seguir a <strong>lei municipal</strong> que institui a taxa (informe a base legal). Só geram cobrança nos municípios com a cobrança ativa. Taxa única, quando existir, dispensa as demais fases.</Aviso>
      <Card titulo={`Taxas cadastradas (${linhas.length})`}>
        {linhas.length === 0 ? <Vazio>Nenhuma taxa cadastrada – adicione abaixo.</Vazio> : (
          <ul className="divide-y divide-slate-100" data-testid="tabela-taxas">
            {linhas.map((l) => (
              <li key={l.id} className="py-3">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                  <Badge cor="azul">{rotuloTaxa(l.fase)}</Badge>
                  <span>{l.tipo_ato ? `${l.tipo_ato.sigla} – ${l.tipo_ato.nome}` : "Qualquer tipo de ato"}</span>
                  <span className="text-slate-500">· {l.porte ? ROTULO_PORTE[l.porte] : "qualquer porte"} · potencial {l.potencial ? ROTULO_POTENCIAL[l.potencial].toLowerCase() : "qualquer"} · {l.municipio ? l.municipio.nome : "toda a organização"}</span>
                  {!l.ativo && <Badge cor="cinza">inativa</Badge>}
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <FormAdmin action={editarTaxa} inline rotuloAcessivel={`Editar taxa ${l.id}`}>
                    <input type="hidden" name="id" value={l.id} />
                    <Texto name="valor" label="Valor (R$)" inputMode="decimal" defaultValue={Number(l.valor).toFixed(2).replace(".", ",")} className="w-32" required />
                    <Texto name="descricao" label="Descrição" defaultValue={l.descricao ?? ""} maxLength={200} className="w-56" />
                    <Texto name="base_legal" label="Base legal" defaultValue={l.base_legal ?? ""} maxLength={300} className="w-56" />
                    <Marcador name="ativo" label="Ativa" defaultChecked={l.ativo} className="pb-2" />
                  </FormAdmin>
                  <FormAdmin action={removerTaxa} inline botao="Remover" classeBotao="btn-secundario" confirmar="Remover esta linha da tabela de taxas?" rotuloAcessivel="Remover taxa">
                    <input type="hidden" name="id" value={l.id} />
                  </FormAdmin>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card titulo="Nova taxa">
        <FormAdmin action={criarTaxa} botao="Adicionar" limparAoSalvar>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Selecao name="fase" label="Fase" required opcoes={FASES.map((f) => ({ valor: f, rotulo: `${rotuloTaxa(f)} – ${DICA_FASE[f]}` }))} />
            <Selecao name="tipo_ato_id" label="Tipo de ato" vazio="(qualquer)" opcoes={tipos.map((t) => ({ valor: t.id, rotulo: `${t.sigla} – ${t.nome}` }))} />
            <Selecao name="municipio_id" label="Município" vazio="(toda a organização)" opcoes={municipios.map((m) => ({ valor: m.id, rotulo: m.nome }))} />
            <Selecao name="porte" label="Porte" vazio="(qualquer)" opcoes={opcoesPorte} />
            <Selecao name="potencial" label="Potencial poluidor" vazio="(qualquer)" opcoes={opcoesPot} />
            <Texto name="valor" label="Valor (R$)" inputMode="decimal" placeholder="350,00" required />
            <Texto name="descricao" label="Descrição" maxLength={200} placeholder="Análise de licença – porte pequeno" />
            <Texto name="base_legal" label="Base legal" maxLength={300} placeholder="Lei Municipal nº …/…, anexo …" className="lg:col-span-2" />
          </div>
        </FormAdmin>
      </Card>

      <Card titulo="Simular valor">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Simular taxa">
          <label className="block"><span className="label">Tipo de ato</span>
            <select name="sim_tipo" className="input" defaultValue={sp.sim_tipo ?? ""} required>
              <option value="">Selecione</option>
              {tipos.map((t) => <option key={t.id} value={t.id}>{t.sigla} – {t.nome}</option>)}
            </select>
          </label>
          <label className="block"><span className="label">Município</span>
            <select name="sim_municipio" className="input" defaultValue={sp.sim_municipio ?? ""} required>
              <option value="">Selecione</option>
              {municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          </label>
          <label className="block"><span className="label">Porte</span>
            <select name="sim_porte" className="input" defaultValue={sp.sim_porte ?? ""}>
              <option value="">(não informado)</option>
              {opcoesPorte.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
            </select>
          </label>
          <label className="block"><span className="label">Potencial poluidor</span>
            <select name="sim_potencial" className="input" defaultValue={sp.sim_potencial ?? ""}>
              <option value="">(não informado)</option>
              {opcoesPot.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
            </select>
          </label>
          <div className="flex items-end"><button className="btn-secundario w-full">Simular</button></div>
        </form>
        {simulacao && (
          <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4" data-testid="simulacao-taxas">
            {simulacao.map((s) => (
              <li key={s.fase} className="rounded-md border border-slate-200 p-3">
                <p className="text-slate-500">{rotuloTaxa(s.fase)}</p>
                <p className="text-lg font-semibold">{s.linha ? fmtMoeda(s.linha.valor) : "—"}</p>
                {s.linha && <p className="text-xs text-slate-500">{s.linha.municipio ? "exceção do município" : "organização"}{s.linha.tipo_ato ? ` · ${s.linha.tipo_ato.sigla}` : ""}{s.linha.porte ? ` · ${ROTULO_PORTE[s.linha.porte]}` : ""}{s.linha.potencial ? ` · ${ROTULO_POTENCIAL[s.linha.potencial]}` : ""}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
