"use client";
import { useState } from "react";
import { fmtNumero } from "@/lib/format";
import type { PoligonoGeo } from "@/components/mapa";

type Imovel = { cod_imovel: string; area_ha: number | null; situacao: string; condicao: string | null; tipo: string; municipio: string; uf: string; geometria: PoligonoGeo | null; cadastro_local?: { empreendimento_id: string; nome: string; requerente: string } | null };

/** "Buscar imóvel no CAR neste ponto" – consulta /api/v1/mapas/car e permite usar o nº do CAR e o limite do imóvel. */
export function BuscaCar({ ponto, onUsarCar, onUsarPoligono }: { ponto: [number, number] | null; onUsarCar: (cod: string) => void; onUsarPoligono: (g: PoligonoGeo) => void }) {
  const [estado, setEstado] = useState<{ carregando?: boolean; erro?: string; imoveis?: Imovel[] }>({});

  async function buscar() {
    if (!ponto) return;
    setEstado({ carregando: true });
    try {
      const r = await fetch(`/api/v1/mapas/car?lat=${ponto[0]}&lng=${ponto[1]}`, { credentials: "same-origin" });
      const j = await r.json().catch(() => null);
      if (!r.ok) return setEstado({ erro: j?.message ?? "Falha ao consultar o CAR." });
      setEstado({ imoveis: j.imoveis as Imovel[] });
    } catch {
      setEstado({ erro: "Falha de rede ao consultar o CAR." });
    }
  }

  return (
    <div className="space-y-2" data-testid="busca-car">
      <button type="button" className="btn-secundario btn-sm" onClick={buscar} disabled={!ponto || estado.carregando} title={ponto ? undefined : "Marque o ponto no mapa primeiro"}>
        {estado.carregando ? "Consultando o SICAR…" : "Buscar imóvel no CAR neste ponto"}
      </button>
      {!ponto && <span className="ml-2 text-xs text-slate-500">Marque o ponto no mapa primeiro.</span>}
      {estado.erro && <p className="text-xs text-red-700" role="alert">{estado.erro}</p>}
      {estado.imoveis && estado.imoveis.length === 0 && <p className="text-xs text-slate-600" role="status">Nenhum imóvel do CAR contém este ponto.</p>}
      {estado.imoveis?.map((i) => (
        <div key={i.cod_imovel} className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm" role="status">
          <p className="break-all font-mono text-xs font-semibold">{i.cod_imovel}</p>
          {i.cadastro_local ? (
            <p className="mt-1 text-xs text-slate-800">
              Já cadastrado: <a className="font-semibold underline" href={`/empreendimentos/${i.cadastro_local.empreendimento_id}`}>{i.cadastro_local.nome}</a> · requerente {i.cadastro_local.requerente}
            </p>
          ) : (
            <p className="mt-1 text-xs text-slate-600">O CAR público não informa nome do imóvel nem proprietário (LGPD).</p>
          )}
          <p className="text-slate-700">
            {i.tipo} · {i.area_ha != null ? `${fmtNumero(i.area_ha, 2)} ha` : "área não informada"} · situação: {i.situacao}{i.condicao ? ` (${i.condicao})` : ""} · {i.municipio}/{i.uf}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn-primario btn-sm" onClick={() => onUsarCar(i.cod_imovel)}>Usar este nº do CAR</button>
            {i.geometria && <button type="button" className="btn-secundario btn-sm" onClick={() => onUsarPoligono(i.geometria!)}>Usar limite do imóvel como polígono</button>}
          </div>
        </div>
      ))}
    </div>
  );
}
