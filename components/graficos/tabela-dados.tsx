/** Visão em tabela de um gráfico (acessibilidade: todo valor acessível sem hover/cor). */
export function TabelaDados({ titulo, colunas, linhas }: { titulo: string; colunas: string[]; linhas: (string | number)[][] }) {
  if (!linhas.length) return null;
  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer text-xs font-medium text-slate-600 hover:text-slate-900">Ver dados em tabela</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="tabela">
          <caption className="sr-only">{titulo}</caption>
          <thead><tr>{colunas.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
          <tbody>
            {linhas.map((l, i) => (
              <tr key={i}>{l.map((v, j) => <td key={j} className={typeof v === "number" ? "text-right tabular-nums" : ""}>{typeof v === "number" ? v.toLocaleString("pt-BR") : v}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
