"use client";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Dica } from "./dica";
import { SERIES, TINTA } from "./paleta";

export type ItemBarra = { rotulo: string; valor: number; detalhe?: string };

/** Barras horizontais de uma única série (magnitude) – cor do slot 1, valor na ponta. */
export function BarrasHorizontais({ dados, unidade, casas = 0, rotuloLargura = 150, testId }: { dados: ItemBarra[]; unidade?: string; casas?: number; rotuloLargura?: number; testId?: string }) {
  const fmt = (v: number) => `${v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}${unidade ? ` ${unidade}` : ""}`;
  if (!dados.length) return <p className="py-8 text-center text-sm text-slate-500">Sem dados para os filtros aplicados.</p>;
  const altura = dados.length * 32 + 36;
  return (
    <div data-testid={testId} style={{ height: altura }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dados} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 4 }} barCategoryGap={6}>
          <CartesianGrid horizontal={false} stroke={TINTA.grade} strokeWidth={1} />
          <XAxis type="number" allowDecimals={casas > 0} tick={{ fill: TINTA.suave, fontSize: 11 }} axisLine={{ stroke: TINTA.eixo }} tickLine={false} tickFormatter={(v: number) => v.toLocaleString("pt-BR")} />
          <YAxis type="category" dataKey="rotulo" width={rotuloLargura} tick={{ fill: TINTA.secundaria, fontSize: 12 }} axisLine={{ stroke: TINTA.eixo }} tickLine={false} interval={0} />
          <Tooltip cursor={{ fill: "rgba(11,11,11,0.04)" }} content={<Dica formatar={fmt} />} />
          <Bar dataKey="valor" name="Valor" fill={SERIES[0]} radius={[0, 4, 4, 0]} maxBarSize={24} isAnimationActive={false} activeBar={{ fill: "#256abf" }}>
            <LabelList dataKey="valor" position="right" formatter={(v: unknown) => fmt(Number(v))} style={{ fill: TINTA.primaria, fontSize: 11 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
