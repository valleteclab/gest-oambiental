"use client";
import Link from "next/link";
import { salvarResponsavel } from "../actions";
import { useFormAcao, CampoSelect, CampoTexto, MensagemEstado, UFS } from "../../pessoas/_form/campos";

const CONSELHOS = ["CREA", "CRBio", "CRQ", "CAU", "CFT", "CRMV", "CORECON", "Outro"];

export type ValorRt = { id?: string; pessoa_id?: string; formacao?: string; conselho?: string; registro_conselho?: string; uf_conselho?: string };

export function FormRt({ valor, pessoas }: { valor?: ValorRt; pessoas: { id: string; nome: string; cpf_cnpj_mascara: string }[] }) {
  const [estado, onSubmit, pendente] = useFormAcao(salvarResponsavel);
  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {valor?.id && <input type="hidden" name="id" value={valor.id} />}
      <MensagemEstado estado={estado} />
      <div className="grid gap-3 sm:grid-cols-2">
        <CampoSelect
          className="sm:col-span-2"
          name="pessoa_id"
          label="Pessoa física"
          required
          defaultValue={valor?.pessoa_id ?? ""}
          estado={estado}
          vazio="Selecione…"
          opcoes={pessoas.map((p) => ({ valor: p.id, rotulo: `${p.nome} (${p.cpf_cnpj_mascara})` }))}
          dica="Não encontrou? Cadastre antes a pessoa física em Pessoas."
        />
        <CampoTexto name="formacao" label="Formação" required defaultValue={valor?.formacao ?? ""} estado={estado} placeholder="Ex.: Engenheiro(a) Ambiental" />
        <CampoSelect name="conselho" label="Conselho de classe" required defaultValue={valor?.conselho ?? "CREA"} estado={estado} opcoes={CONSELHOS.map((c) => ({ valor: c, rotulo: c }))} />
        <CampoTexto name="registro_conselho" label="Nº de registro no conselho" required defaultValue={valor?.registro_conselho ?? ""} estado={estado} />
        <CampoSelect name="uf_conselho" label="UF do registro" required defaultValue={valor?.uf_conselho ?? "BA"} estado={estado} opcoes={UFS.map((u) => ({ valor: u, rotulo: u }))} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn-primario" disabled={pendente}>{pendente ? "Salvando…" : "Salvar"}</button>
        <Link href={valor?.id ? `/responsaveis-tecnicos/${valor.id}` : "/responsaveis-tecnicos"} className="btn-secundario">Cancelar</Link>
        <Link href="/pessoas/nova?tipo=PF" className="btn-secundario">Cadastrar pessoa física</Link>
      </div>
    </form>
  );
}
