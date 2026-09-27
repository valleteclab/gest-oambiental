"use client";
import Form from "next/form";
import { useRef } from "react";

type Opcao = { id: string; nome: string };

/** Filtros globais do painel/relatórios (GET → searchParams). Selects aplicam ao mudar. */
export function FiltrosGlobais({
  acao,
  municipios,
  tiposAto,
  tecnicos,
  valores,
  mostrarTodos,
}: {
  acao: string;
  municipios: Opcao[];
  tiposAto: { id: string; sigla: string; nome: string }[];
  tecnicos: Opcao[];
  valores: { municipio: string; de: string; ate: string; tipo_ato: string; tecnico: string };
  mostrarTodos: boolean;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const aplicar = () => ref.current?.requestSubmit();
  return (
    <Form ref={ref} action={acao} className="card mb-6 grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6" aria-label="Filtros">
      <label className="block lg:col-span-1">
        <span className="label">Município</span>
        <select name="municipio" className="input" defaultValue={valores.municipio} onChange={aplicar} data-testid="filtro-municipio">
          {mostrarTodos && <option value="">Todos</option>}
          {municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="label">De</span>
        <input type="date" name="de" className="input" defaultValue={valores.de} data-testid="filtro-de" />
      </label>
      <label className="block">
        <span className="label">Até</span>
        <input type="date" name="ate" className="input" defaultValue={valores.ate} data-testid="filtro-ate" />
      </label>
      <label className="block">
        <span className="label">Tipo de ato</span>
        <select name="tipo_ato" className="input" defaultValue={valores.tipo_ato} onChange={aplicar} data-testid="filtro-tipo-ato">
          <option value="">Todos</option>
          {tiposAto.map((t) => <option key={t.id} value={t.id}>{t.sigla} – {t.nome}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="label">Técnico</span>
        <select name="tecnico" className="input" defaultValue={valores.tecnico} onChange={aplicar} data-testid="filtro-tecnico">
          <option value="">Todos</option>
          {tecnicos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
        </select>
      </label>
      <div className="flex items-end gap-2">
        <button type="submit" className="btn-primario w-full" data-testid="filtro-aplicar">Aplicar</button>
      </div>
    </Form>
  );
}
