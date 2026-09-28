import Link from "next/link";
import type { StatusProcesso } from "@prisma/client";
import { exigirUsuario, getOrgaoAtivo } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can, escopoMunicipios, filtroMunicipioPadrao, isSomenteLeitura, podeProtocolarNoBalcao } from "@/lib/rbac";
import { CabecalhoPagina, Card, Paginacao, ROTULO_STATUS } from "@/components/ui";
import { listarProcessos, mapaDiasAlerta } from "@/lib/processo/consultas";
import { TabelaProcessos } from "./_componentes/tabela-processos";
import { Proibido } from "./_componentes/proibido";

export const metadata = { title: "Processos" };

type Busca = { municipio?: string; status?: string; tipo?: string; tecnico?: string; q?: string; page?: string };

export default async function PaginaProcessos({ searchParams }: { searchParams: Promise<Busca> }) {
  const u = await exigirUsuario({ interno: true });
  if (!can(u, "ver", "processo")) return <Proibido voltar="/dashboard" mensagem="Seu perfil não tem acesso a processos." />;
  const bruto = await searchParams;
  // Sem ?municipio= na URL: padrão = órgão ativo (escopo amplo); "Todos" (municipio=) continua disponível.
  const orgao = await getOrgaoAtivo();
  const sp: Busca = { ...bruto, municipio: filtroMunicipioPadrao(u, bruto.municipio, orgao?.id) };
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const size = 20;
  const status = sp.status && sp.status in ROTULO_STATUS ? (sp.status as StatusProcesso) : null;
  const escopo = escopoMunicipios(u);
  const [alertas, municipios, tipos, tecnicos, { total, itens }] = await Promise.all([
    mapaDiasAlerta(),
    prisma.municipio.findMany({ where: escopo === "TODOS" ? { ativo: true } : { id: { in: escopo } }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
    prisma.tipoAto.findMany({ where: { ativo: true }, select: { id: true, sigla: true, nome: true }, orderBy: { sigla: "asc" } }),
    prisma.usuario.findMany({
      where: { ativo: true, papeis: { some: escopo === "TODOS" ? { papel: { in: ["TEC_MUNICIPAL", "TEC_CONSORCIO"] } } : { OR: [{ papel: "TEC_MUNICIPAL", municipio_id: { in: escopo } }, { papel: "TEC_CONSORCIO" }] } } },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
    listarProcessos(u, { municipio: sp.municipio || undefined, status, tipo: sp.tipo, tecnico: sp.tecnico, q: sp.q, skip: (page - 1) * size, take: size }),
  ]);
  const href = (p: number) => {
    const q = new URLSearchParams(Object.entries({ ...sp, page: String(p) }).filter(([k, v]) => v || (k === "municipio" && v === "")) as [string, string][]);
    return `/processos?${q}`;
  };
  return (
    <>
      <CabecalhoPagina
        titulo="Processos"
        subtitulo={`${total} processo(s) no seu escopo${isSomenteLeitura(u) ? " · acesso somente leitura" : ""}`}
        acoes={podeProtocolarNoBalcao(u, orgao?.id) ? <Link href="/processos/novo" className="btn-primario">Novo processo (balcão)</Link> : null}
      />
      <Card className="mb-4">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6" role="search" aria-label="Filtrar processos">
          <div className="lg:col-span-2">
            <label htmlFor="f-q" className="label">Busca</label>
            <input id="f-q" name="q" defaultValue={sp.q} className="input" placeholder="Nº, empreendimento ou requerente" />
          </div>
          <div>
            <label htmlFor="f-mun" className="label">Município</label>
            <select id="f-mun" name="municipio" defaultValue={sp.municipio ?? ""} className="input">
              <option value="">Todos</option>
              {municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="f-status" className="label">Status</label>
            <select id="f-status" name="status" defaultValue={sp.status ?? ""} className="input">
              <option value="">Todos (exceto rascunhos)</option>
              {Object.entries(ROTULO_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="f-tipo" className="label">Tipo de ato</label>
            <select id="f-tipo" name="tipo" defaultValue={sp.tipo ?? ""} className="input">
              <option value="">Todos</option>
              {tipos.map((t) => <option key={t.id} value={t.id}>{t.sigla} – {t.nome}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="f-tec" className="label">Técnico</label>
            <select id="f-tec" name="tecnico" defaultValue={sp.tecnico ?? ""} className="input">
              <option value="">Todos</option>
              <option value="sem">Sem técnico</option>
              {tecnicos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select>
          </div>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-6">
            <button className="btn-primario">Filtrar</button>
            <Link href="/processos" className="btn-secundario">Limpar</Link>
          </div>
        </form>
      </Card>
      <Card>
        <TabelaProcessos itens={itens} alertas={alertas} continuar={Object.fromEntries(itens.filter((p) => p.status === "RASCUNHO" && podeProtocolarNoBalcao(u, p.municipio.id)).map((p) => [p.id, `/processos/novo?rascunho=${p.id}`]))} />
        <Paginacao page={page} size={size} total={total} href={href} />
      </Card>
    </>
  );
}
