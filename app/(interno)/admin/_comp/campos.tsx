// Campos simples (server components) para formulários do admin – sempre com <label>.
import clsx from "clsx";

let seq = 0;
const novoId = (name: string) => `adm-${name}-${++seq}`;

export function Texto({ name, label, className, dica, ...rest }: { name: string; label: string; className?: string; dica?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "name">) {
  const id = rest.id ?? novoId(name);
  return (
    <div className={className}>
      <label htmlFor={id} className="label">{label}{rest.required && <span className="text-red-700" aria-hidden> *</span>}</label>
      <input id={id} name={name} className="input" {...rest} />
      {dica && <span className="mt-1 block text-xs text-slate-500">{dica}</span>}
    </div>
  );
}

export function Selecao({ name, label, opcoes, vazio, className, ...rest }: { name: string; label: string; opcoes: { valor: string; rotulo: string }[]; vazio?: string; className?: string } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "name">) {
  const id = rest.id ?? novoId(name);
  return (
    <div className={className}>
      <label htmlFor={id} className="label">{label}{rest.required && <span className="text-red-700" aria-hidden> *</span>}</label>
      <select id={id} name={name} className="input" {...rest}>
        {vazio !== undefined && <option value="">{vazio}</option>}
        {opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
      </select>
    </div>
  );
}

export function Marcador({ name, label, defaultChecked, className }: { name: string; label: string; defaultChecked?: boolean; className?: string }) {
  return (
    <label className={clsx("inline-flex items-center gap-2 text-sm", className)}>
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="h-4 w-4" />
      {label}
    </label>
  );
}

export function AreaTexto({ name, label, className, ...rest }: { name: string; label: string; className?: string } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "name">) {
  const id = rest.id ?? novoId(name);
  return (
    <div className={className}>
      <label htmlFor={id} className="label">{label}{rest.required && <span className="text-red-700" aria-hidden> *</span>}</label>
      <textarea id={id} name={name} className="input" {...rest} />
    </div>
  );
}
