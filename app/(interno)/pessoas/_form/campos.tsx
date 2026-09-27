"use client";
import clsx from "clsx";
import { Aviso } from "@/components/ui";

// Campos de formulário compartilhados pelos cadastros (pessoas, RTs, empreendimentos).

export type Estado = { ok?: boolean; erro?: string; mensagem?: string; campos?: Record<string, string>; extra?: Record<string, string> } | undefined;

export function Erro({ id, msg }: { id: string; msg?: string }) {
  if (!msg) return null;
  return <span id={id} className="mt-1 block text-xs text-red-700">{msg}</span>;
}

type PropsTexto = { name: string; label: string; estado?: Estado; dica?: string; className?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "name">;

export function CampoTexto({ name, label, estado, dica, className, ...rest }: PropsTexto) {
  const erro = estado?.campos?.[name];
  const id = `f-${name.replace(/\W/g, "-")}`;
  return (
    <div className={className}>
      <label htmlFor={id} className="label">{label}{rest.required && <span className="text-red-700" aria-hidden> *</span>}</label>
      <input id={id} name={name} className={clsx("input", erro && "border-red-500")} aria-invalid={!!erro} aria-describedby={erro ? `${id}-erro` : dica ? `${id}-dica` : undefined} {...rest} />
      {dica && !erro && <span id={`${id}-dica`} className="mt-1 block text-xs text-slate-500">{dica}</span>}
      <Erro id={`${id}-erro`} msg={erro} />
    </div>
  );
}

type PropsSelect = { name: string; label: string; estado?: Estado; opcoes: { valor: string; rotulo: string }[]; vazio?: string; className?: string; dica?: string } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "name">;

export function CampoSelect({ name, label, estado, opcoes, vazio, className, dica, ...rest }: PropsSelect) {
  const erro = estado?.campos?.[name];
  const id = `f-${name.replace(/\W/g, "-")}`;
  return (
    <div className={className}>
      <label htmlFor={id} className="label">{label}{rest.required && <span className="text-red-700" aria-hidden> *</span>}</label>
      <select id={id} name={name} className={clsx("input", erro && "border-red-500")} aria-invalid={!!erro} aria-describedby={erro ? `${id}-erro` : undefined} {...rest}>
        {vazio !== undefined && <option value="">{vazio}</option>}
        {opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
      </select>
      {dica && !erro && <span className="mt-1 block text-xs text-slate-500">{dica}</span>}
      <Erro id={`${id}-erro`} msg={erro} />
    </div>
  );
}

export const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];

export function CamposEndereco({ valor, estado }: { valor?: Record<string, string | null> | null; estado?: Estado }) {
  const v = valor ?? {};
  return (
    <fieldset className="grid gap-3 sm:grid-cols-6">
      <legend className="mb-2 text-sm font-semibold text-slate-800">Endereço</legend>
      <CampoTexto className="sm:col-span-4" name="endereco.logradouro" label="Logradouro" defaultValue={v.logradouro ?? ""} estado={estado} autoComplete="address-line1" />
      <CampoTexto className="sm:col-span-2" name="endereco.numero" label="Número" defaultValue={v.numero ?? ""} estado={estado} />
      <CampoTexto className="sm:col-span-3" name="endereco.complemento" label="Complemento" defaultValue={v.complemento ?? ""} estado={estado} />
      <CampoTexto className="sm:col-span-3" name="endereco.bairro" label="Bairro" defaultValue={v.bairro ?? ""} estado={estado} />
      <CampoTexto className="sm:col-span-3" name="endereco.cidade" label="Cidade" defaultValue={v.cidade ?? ""} estado={estado} autoComplete="address-level2" />
      <CampoSelect className="sm:col-span-1" name="endereco.uf" label="UF" defaultValue={v.uf ?? "BA"} estado={estado} opcoes={UFS.map((u) => ({ valor: u, rotulo: u }))} vazio="—" />
      <CampoTexto className="sm:col-span-2" name="endereco.cep" label="CEP" defaultValue={v.cep ?? ""} estado={estado} inputMode="numeric" placeholder="00000-000" autoComplete="postal-code" />
    </fieldset>
  );
}

export function MensagemEstado({ estado }: { estado: Estado }) {
  if (estado?.erro) return <Aviso tipo="erro">{estado.erro}</Aviso>;
  if (estado?.mensagem) return <Aviso tipo="sucesso">{estado.mensagem}</Aviso>;
  return null;
}
