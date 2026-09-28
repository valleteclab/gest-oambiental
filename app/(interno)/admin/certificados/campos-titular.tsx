"use client";
import { useState } from "react";

/** Titular do certificado: e-CNPJ do órgão (município opcional) ou e-CPF de um servidor da organização. */
export function CamposTitular({ municipios, usuarios }: { municipios: { id: string; nome: string }[]; usuarios: { id: string; nome: string; email: string }[] }) {
  const [titular, setTitular] = useState<"ORGAO" | "USUARIO">("ORGAO");
  return (
    <>
      <fieldset>
        <legend className="label">Titular do certificado</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="titular" value="ORGAO" checked={titular === "ORGAO"} onChange={() => setTitular("ORGAO")} className="h-4 w-4" />
            Órgão (e-CNPJ)
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="titular" value="USUARIO" checked={titular === "USUARIO"} onChange={() => setTitular("USUARIO")} className="h-4 w-4" />
            Servidor (e-CPF)
          </label>
        </div>
      </fieldset>
      {titular === "ORGAO" ? (
        <div>
          <label htmlFor="cert-municipio" className="label">Órgão / município</label>
          <select id="cert-municipio" name="municipio_id" className="input" defaultValue="">
            <option value="">Todos os órgãos da organização</option>
            {municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
          <span className="mt-1 block text-xs text-slate-500">O certificado de um município tem prioridade sobre o da organização.</span>
        </div>
      ) : (
        <div>
          <label htmlFor="cert-usuario" className="label">Servidor<span className="text-red-700" aria-hidden> *</span></label>
          <select id="cert-usuario" name="usuario_id" className="input" required defaultValue="">
            <option value="">Selecione…</option>
            {usuarios.map((x) => <option key={x.id} value={x.id}>{x.nome} ({x.email})</option>)}
          </select>
          <span className="mt-1 block text-xs text-slate-500">Documentos emitidos por este servidor serão assinados com o e-CPF dele (prioridade sobre o e-CNPJ).</span>
        </div>
      )}
    </>
  );
}
