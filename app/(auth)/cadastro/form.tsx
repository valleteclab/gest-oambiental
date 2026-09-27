"use client";
import { useActionState, useState } from "react";
import { cadastrarRequerente } from "./actions";

export function FormCadastro({ municipios }: { municipios: { id: string; nome: string }[] }) {
  const [estado, acao, pendente] = useActionState(cadastrarRequerente, undefined);
  const [tipo, setTipo] = useState<"PF" | "PJ">("PJ");
  const erro = (c: string) => estado?.campos?.[c] && <p id={`erro-${c}`} className="mt-1 text-xs text-red-700">{estado.campos[c]}</p>;
  const aria = (c: string) => (estado?.campos?.[c] ? { "aria-invalid": true, "aria-describedby": `erro-${c}` } : {});
  return (
    <form action={acao} className="space-y-4" noValidate>
      <fieldset className="flex gap-4 text-sm">
        <legend className="label">Tipo de requerente</legend>
        <label className="inline-flex items-center gap-2"><input type="radio" name="tipo" value="PJ" checked={tipo === "PJ"} onChange={() => setTipo("PJ")} /> Empresa (CNPJ)</label>
        <label className="inline-flex items-center gap-2"><input type="radio" name="tipo" value="PF" checked={tipo === "PF"} onChange={() => setTipo("PF")} /> Pessoa física (CPF)</label>
      </fieldset>
      <div>
        <label htmlFor="nome" className="label">{tipo === "PJ" ? "Razão social" : "Nome completo"}</label>
        <input id="nome" name="nome" className="input" required autoComplete={tipo === "PF" ? "name" : "organization"} {...aria("nome")} />
        {erro("nome")}
      </div>
      {tipo === "PJ" && (
        <div>
          <label htmlFor="nome_fantasia" className="label">Nome fantasia (opcional)</label>
          <input id="nome_fantasia" name="nome_fantasia" className="input" />
        </div>
      )}
      <div>
        <label htmlFor="cpf_cnpj" className="label">{tipo === "PJ" ? "CNPJ" : "CPF"}</label>
        <input id="cpf_cnpj" name="cpf_cnpj" className="input" inputMode="numeric" required placeholder={tipo === "PJ" ? "00.000.000/0000-00" : "000.000.000-00"} {...aria("cpf_cnpj")} />
        {erro("cpf_cnpj")}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="email" className="label">E-mail</label>
          <input id="email" name="email" type="email" className="input" required autoComplete="email" {...aria("email")} />
          {erro("email")}
        </div>
        <div>
          <label htmlFor="telefone" className="label">Telefone</label>
          <input id="telefone" name="telefone" type="tel" className="input" autoComplete="tel" />
        </div>
      </div>
      <div>
        <label htmlFor="municipio_id" className="label">Município principal</label>
        <select id="municipio_id" name="municipio_id" className="input">
          <option value="">Selecione…</option>
          {municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="senha" className="label">Senha</label>
          <input id="senha" name="senha" type="password" className="input" required minLength={10} autoComplete="new-password" {...aria("senha")} />
          {erro("senha") ?? <p className="mt-1 text-xs text-slate-500">Mínimo de 10 caracteres.</p>}
        </div>
        <div>
          <label htmlFor="confirmacao" className="label">Confirmar senha</label>
          <input id="confirmacao" name="confirmacao" type="password" className="input" required autoComplete="new-password" {...aria("confirmacao")} />
          {erro("confirmacao")}
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="aceite" value="1" className="mt-1" />
        <span>Li e aceito os termos de uso e a política de privacidade. Meus dados pessoais serão tratados conforme a LGPD.</span>
      </label>
      {erro("aceite")}
      {estado?.erro && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{estado.erro}</p>}
      <button className="btn-primario w-full" disabled={pendente}>{pendente ? "Cadastrando…" : "Criar conta"}</button>
    </form>
  );
}
