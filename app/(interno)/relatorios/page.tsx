import { FileSpreadsheet, FileText } from "lucide-react";
import { exigirUsuario } from "@/lib/auth";
import { can, temEscopoOrganizacao } from "@/lib/rbac";
import { fmtData } from "@/lib/format";
import { opcoesFiltros, resolverEscopo } from "@/lib/indicadores/calcular";
import { lerFiltros, municipioPermitido, queryFiltros } from "@/lib/indicadores/filtros";
import { TIPOS_RELATORIO } from "@/lib/relatorios/modelo";
import { Aviso, CabecalhoPagina } from "@/components/ui";
import { FiltrosGlobais } from "../dashboard/filtros";

export const dynamic = "force-dynamic";
export const metadata = { title: "Relatórios – LicenciaGov" };

export default async function PaginaRelatorios({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const u = await exigirUsuario({ interno: true });
  const filtros = lerFiltros(await searchParams);
  if (!can(u, "ver", "relatorio") || !municipioPermitido(u, filtros)) {
    return <Aviso tipo="erro"><span data-testid="acesso-negado">Acesso negado (403): você não tem permissão para emitir relatórios.</span></Aviso>;
  }
  const [opcoes, e] = await Promise.all([opcoesFiltros(u), resolverEscopo(u, filtros)]);
  const podeExportar = can(u, "exportar", "relatorio");
  const q = (tipo: string, formato: string) => `/api/v1/relatorios/${tipo}${queryFiltros({ ...filtros, de: e.deStr, ate: e.ateStr }, { formato })}`;

  return (
    <div>
      <CabecalhoPagina titulo="Relatórios" subtitulo="Todos os relatórios saem em PDF e XLSX com cabeçalho institucional, filtros aplicados, data de emissão e usuário." />
      <FiltrosGlobais
        acao="/relatorios"
        municipios={opcoes.municipios}
        tiposAto={opcoes.tiposAto}
        tecnicos={opcoes.tecnicos}
        mostrarTodos={temEscopoOrganizacao(u) || opcoes.municipios.length > 1}
        valores={{ municipio: filtros.municipio_id ?? "", de: e.deStr, ate: e.ateStr, tipo_ato: filtros.tipo_ato_id ?? "", tecnico: filtros.tecnico_id ?? "" }}
      />
      <p className="mb-4 text-sm text-slate-600" data-testid="relatorios-filtros">
        <b>Filtros:</b> {e.descricao.municipio} · {fmtData(e.de)} a {fmtData(e.ate)} · Tipo de ato: {e.descricao.tipo_ato} · Técnico: {e.descricao.tecnico}
      </p>
      {!podeExportar && <Aviso tipo="alerta">Seu perfil não permite exportar relatórios.</Aviso>}
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {TIPOS_RELATORIO.map((r, i) => (
          <li key={r.tipo} className="card flex flex-col p-4" data-testid={`relatorio-${r.tipo}`}>
            <h2 className="text-base font-semibold">{i + 1}. {r.titulo}</h2>
            <p className="mt-1 flex-1 text-sm text-slate-600">{r.descricao}</p>
            {r.tipo === "fiscalizacao" && <p className="mt-1 text-xs text-slate-500">Filtros de tipo de ato e técnico não se aplicam.</p>}
            {podeExportar && (
              <div className="mt-3 flex gap-2">
                <a href={q(r.tipo, "pdf")} className="btn-primario btn-sm" data-testid={`relatorio-${r.tipo}-pdf`} download>
                  <FileText className="h-4 w-4" aria-hidden /> PDF
                </a>
                <a href={q(r.tipo, "xlsx")} className="btn-secundario btn-sm" data-testid={`relatorio-${r.tipo}-xlsx`} download>
                  <FileSpreadsheet className="h-4 w-4" aria-hidden /> XLSX
                </a>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
