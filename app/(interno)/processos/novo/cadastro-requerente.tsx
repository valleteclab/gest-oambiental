"use client";
import Link from "next/link";
import { useState } from "react";
import { cadastrarRequerenteBalcaoAcao } from "@/lib/processo/actions";
import { CampoTexto, CamposEndereco, MensagemEstado, useFormAcao } from "../../pessoas/_form/campos";

/** Balcão – cadastro rápido do requerente (PF/PJ). Reusa os campos e o serviço do cadastro de pessoas. */
export function CadastroRequerenteBalcao({ municipioId }: { municipioId: string }) {
  const [estado, onSubmit, pendente] = useFormAcao(cadastrarRequerenteBalcaoAcao);
  const [tipo, setTipo] = useState<"PF" | "PJ">("PF");
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate aria-label="Cadastrar novo requerente">
      <input type="hidden" name="municipio_id" value={municipioId} />
      <MensagemEstado estado={estado} />
      {estado?.extra?.existente && (
        <p className="text-sm">
          <Link className="text-primaria-700 underline" href={`/processos/novo?municipio=${municipioId}&requerente=${estado.extra.existente}`}>Usar o cadastro existente</Link>
        </p>
      )}
      <fieldset>
        <legend className="label">Tipo de pessoa</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {(["PF", "PJ"] as const).map((t) => (
            <label key={t} className="inline-flex items-center gap-2">
              <input type="radio" name="tipo" value={t} checked={tipo === t} onChange={() => setTipo(t)} />
              {t === "PF" ? "Pessoa física" : "Pessoa jurídica"}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <CampoTexto key={`doc-${tipo}`} name="cpf_cnpj" label={tipo === "PF" ? "CPF" : "CNPJ"} required estado={estado} inputMode="numeric" placeholder={tipo === "PF" ? "000.000.000-00" : "00.000.000/0000-00"} dica="Validado pelo dígito verificador. Armazenado criptografado." />
        <CampoTexto name="nome" label={tipo === "PF" ? "Nome completo" : "Razão social"} required estado={estado} />
        {tipo === "PJ" && <CampoTexto name="nome_fantasia" label="Nome fantasia" estado={estado} />}
        <CampoTexto name="email" type="email" label="E-mail" estado={estado} autoComplete="off" />
        <CampoTexto name="telefone" type="tel" label="Telefone" estado={estado} autoComplete="off" />
      </div>
      <details className="rounded-md border border-slate-200 p-3">
        <summary className="cursor-pointer text-sm font-medium text-slate-800">Endereço (opcional)</summary>
        <div className="mt-3"><CamposEndereco /></div>
      </details>
      <button className="btn-primario" disabled={pendente}>{pendente ? "Cadastrando…" : "Cadastrar e continuar"}</button>
    </form>
  );
}
