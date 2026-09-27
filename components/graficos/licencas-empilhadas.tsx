"use client";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Dica } from "./dica";
import { SIGLAS_FIXAS, TINTA, agruparSigla, corSigla } from "./paleta";

type Entrada = { municipio: string; sigla: string; total: number };

/** Licenças emitidas por tipo × município (barra horizontal empilhada). Cor fixa por sigla; excedentes em "Outros". */
export function LicencasEmpilhadas({ dados }: { dados: Entrada[] }) {
  if (!dados.length) return <p className="py-8 text-center text-sm text-slate-500">Nenhuma licença emitida no período.</p>;
  const linhas = new Map<string, Record<string, number | string>>();
  const presentes = new Set<string>();
  for (const d of dados) {
    const s = agruparSigla(d.sigla);
    presentes.add(s);
    const l = linhas.get(d.municipio) ?? { municipio: d.municipio, _total: 0 };
    l[s] = Number(l[s] ?? 0) + d.total;
    l._total = Number(l._total) + d.total;
    linhas.set(d.municipio, l);
  }
  const serie = SIGLAS_FIXAS.filter((s) => presentes.has(s));
  const data = [...linhas.values()].sort((a, b) => Number(b._total) - Number(a._total));
  return (
    <div style={{ height: data.length * 36 + 80 }} className="w-full" data-testid="grafico-licencas">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 4 }} barCategoryGap={8}>
          <CartesianGrid horizontal={false} stroke={TINTA.grade} />
          <XAxis type="number" allowDecimals={false} tick={{ fill: TINTA.suave, fontSize: 11 }} axisLine={{ stroke: TINTA.eixo }} tickLine={false} />
          <YAxis type="category" dataKey="municipio" width={120} tick={{ fill: TINTA.secundaria, fontSize: 12 }} axisLine={{ stroke: TINTA.eixo }} tickLine={false} interval={0} />
          <Tooltip cursor={{ fill: "rgba(11,11,11,0.04)" }} content={<Dica />} />
          <Legend verticalAlign="top" align="left" iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12, color: TINTA.secundaria, paddingBottom: 8 }} />
          {serie.map((s) => (
            <Bar key={s} dataKey={s} name={s === "CERT_DISP" ? "Certidão" : s} stackId="lic" fill={corSigla(s)} stroke={TINTA.superficie} strokeWidth={1} maxBarSize={24} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
