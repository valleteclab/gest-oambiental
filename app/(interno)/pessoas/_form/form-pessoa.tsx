"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { salvarPessoa } from "../actions";
import { CampoSelect, CampoTexto, CamposEndereco, MensagemEstado } from "./campos";

export type ValorPessoa = {
  id?: string;
  tipo: "PF" | "PJ";
  cpf_cnpj?: string | null;
  nome?: string;
  nome_fantasia?: string | null;
  email?: string | null;
  telefone?: string | null;
  municipio_id?: string | null;
  endereco?: Record<string, string | null> | null;
};

export function FormPessoa({ valor, municipios, exigeMunicipio }: { valor?: ValorPessoa; municipios: { id: string; nome: string }[]; exigeMunicipio: boolean }) {
  const [estado, acao, pendente] = useActionState(salvarPessoa, undefined);
  const [tipo, setTipo] = useState<"PF" | "PJ">(valor?.tipo ?? "PJ");
  return (
    <form action={acao} className="space-y-5" noValidate>
      {valor?.id && <input type="hidden" name="id" value={valor.id} />}
      <MensagemEstado estado={estado} />
      {estado?.extra?.existente && (
        <p className="text-sm"><Link className="text-primaria-700 underline" href={`/pessoas/${estado.extra.existente}`}>Abrir o cadastro existente</Link></p>
      )}
      <fieldset>
        <legend className="label">Tipo de pessoa</legend>
        <div className="flex gap-4 text-sm">
          {(["PJ", "PF"] as const).map((t) => (
            <label key={t} className="inline-flex items-center gap-2">
              <input type="radio" name="tipo" value={t} checked={tipo === t} onChange={() => setTipo(t)} />
              {t === "PF" ? "Pessoa física" : "Pessoa jurídica"}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <CampoTexto name="cpf_cnpj" label={tipo === "PF" ? "CPF" : "CNPJ"} required defaultValue={valor?.cpf_cnpj ?? ""} estado={estado} inputMode="numeric" placeholder={tipo === "PF" ? "000.000.000-00" : "00.000.000/0000-00"} dica="Validado pelo dígito verificador. Armazenado criptografado." />
        <CampoSelect name="municipio_id" label="Município" required={exigeMunicipio} defaultValue={valor?.municipio_id ?? ""} estado={estado} vazio={exigeMunicipio ? "Selecione…" : "(não vinculado)"} opcoes={municipios.map((m) => ({ valor: m.id, rotulo: m.nome }))} />
        <CampoTexto className="sm:col-span-2" name="nome" label={tipo === "PF" ? "Nome completo" : "Razão social"} required defaultValue={valor?.nome ?? ""} estado={estado} />
        {tipo === "PJ" && <CampoTexto className="sm:col-span-2" name="nome_fantasia" label="Nome fantasia" defaultValue={valor?.nome_fantasia ?? ""} estado={estado} />}
        <CampoTexto name="email" type="email" label="E-mail" defaultValue={valor?.email ?? ""} estado={estado} autoComplete="email" />
        <CampoTexto name="telefone" type="tel" label="Telefone" defaultValue={valor?.telefone ?? ""} estado={estado} autoComplete="tel" dica={tipo === "PF" ? "E-mail e telefone de pessoa física são criptografados." : undefined} />
      </div>
      <CamposEndereco valor={valor?.endereco} estado={estado} />
      <div className="flex flex-wrap gap-2">
        <button className="btn-primario" disabled={pendente}>{pendente ? "Salvando…" : "Salvar"}</button>
        <Link href={valor?.id ? `/pessoas/${valor.id}` : "/pessoas"} className="btn-secundario">Cancelar</Link>
      </div>
    </form>
  );
}
