// Marcadores como "chips" marcáveis (checkboxes acessíveis: o input fica oculto só visualmente e recebe foco).
// Serve a formulários GET (filtros: name="marcador") e de Server Action (name="marcador_ids"). Não precisa de JavaScript.
import clsx from "clsx";

export type MarcadorChip = { id: string; nome: string; cor: string };

export function PontoCor({ cor }: { cor: string }) {
  return <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-black/10" style={{ backgroundColor: cor }} />;
}

/** Marcador somente leitura (em listas e na ficha). */
export function ChipMarcador({ marcador }: { marcador: MarcadorChip }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700">
      <PontoCor cor={marcador.cor} />
      <span className="truncate">{marcador.nome}</span>
    </span>
  );
}

export function SeletorMarcadores({ marcadores, selecionados = [], name = "marcador_ids", legenda = "Marcadores", className }: {
  marcadores: MarcadorChip[];
  selecionados?: string[];
  name?: string;
  legenda?: string;
  className?: string;
}) {
  if (marcadores.length === 0) {
    return <p className="text-sm text-slate-500">Nenhum marcador cadastrado{legenda ? "" : "."}</p>;
  }
  return (
    <fieldset className={className}>
      <legend className="label">{legenda}</legend>
      <div className="flex flex-wrap gap-2">
        {marcadores.map((m) => (
          <label key={m.id} className="cursor-pointer">
            <input type="checkbox" name={name} value={m.id} defaultChecked={selecionados.includes(m.id)} className="peer sr-only" />
            <span
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700",
                "peer-checked:border-primaria-600 peer-checked:bg-primaria-50 peer-checked:font-medium peer-checked:before:content-['✓'] peer-checked:before:text-primaria-700 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primaria-600",
              )}
            >
              <PontoCor cor={m.cor} />
              {m.nome}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
