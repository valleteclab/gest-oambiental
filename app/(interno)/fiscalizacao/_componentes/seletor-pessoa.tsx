"use client";
import { useEffect, useState } from "react";
import { acaoBuscarPessoas } from "../actions";

export type PessoaSel = { id: string; nome: string; tipo: "PF" | "PJ"; cpf_cnpj_mascara: string };
export type NovaPessoa = { tipo: "PF" | "PJ"; cpf_cnpj: string; nome: string; telefone: string; email: string; logradouro: string };
export type ValorPessoa = { pessoa: PessoaSel | null; nova: NovaPessoa | null };

const digitos = (v: string) => v.replace(/\D/g, "");
function mascara(v: string, tipo: "PF" | "PJ") {
  const d = digitos(v).slice(0, tipo === "PF" ? 11 : 14);
  if (tipo === "PF") return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  return d.replace(/(\d{2})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1/$2").replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

/** Busca pessoa (nome ou CPF/CNPJ) ou cadastro rápido PF/PJ. CPF/CNPJ é validado e cifrado no servidor. */
export function SeletorPessoa({ rotulo, valor, onChange, sugestao }: { rotulo: string; valor: ValorPessoa; onChange: (v: ValorPessoa) => void; sugestao?: PessoaSel | null }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<PessoaSel[]>([]);
  const [buscando, setBuscando] = useState(false);
  const modoNovo = !!valor.nova;

  useEffect(() => {
    if (q.trim().length < 3) {
      setRes([]);
      return;
    }
    const t = setTimeout(async () => {
      setBuscando(true);
      setRes((await acaoBuscarPessoas(q)) as PessoaSel[]);
      setBuscando(false);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  if (valor.pessoa)
    return (
      <div>
        <span className="label">{rotulo} *</span>
        <div className="flex items-center justify-between gap-2 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm" data-testid="pessoa-selecionada">
          <span><strong>{valor.pessoa.nome}</strong> · {valor.pessoa.tipo} · {valor.pessoa.cpf_cnpj_mascara}</span>
          <button type="button" className="btn-sm btn-secundario" onClick={() => onChange({ pessoa: null, nova: null })}>Trocar</button>
        </div>
      </div>
    );

  const nova = valor.nova;
  const set = (p: Partial<NovaPessoa>) => onChange({ pessoa: null, nova: { ...nova!, ...p } });

  return (
    <fieldset className="rounded-md border border-slate-200 p-3">
      <legend className="px-1 text-sm font-medium text-slate-700">{rotulo} *</legend>
      <div className="mb-3 flex gap-2 text-sm">
        <button type="button" className={modoNovo ? "btn-sm btn-secundario" : "btn-sm btn-primario"} onClick={() => onChange({ pessoa: null, nova: null })}>Buscar cadastrada</button>
        <button type="button" className={modoNovo ? "btn-sm btn-primario" : "btn-sm btn-secundario"} data-testid="nova-pessoa"
          onClick={() => onChange({ pessoa: null, nova: { tipo: "PF", cpf_cnpj: "", nome: "", telefone: "", email: "", logradouro: "" } })}>Cadastrar nova</button>
      </div>
      {!modoNovo ? (
        <div className="relative">
          {sugestao && (
            <button type="button" className="mb-2 block w-full rounded-md border border-dashed border-primaria-600 px-3 py-2 text-left text-sm text-primaria-800" onClick={() => onChange({ pessoa: sugestao, nova: null })}>
              Usar responsável pelo empreendimento: <strong>{sugestao.nome}</strong> ({sugestao.cpf_cnpj_mascara})
            </button>
          )}
          <input className="input" aria-label="Buscar por nome ou CPF/CNPJ" placeholder="Nome ou CPF/CNPJ (mín. 3 caracteres)" value={q} onChange={(e) => setQ(e.target.value)} data-testid="busca-pessoa" />
          {buscando && <p className="mt-1 text-xs text-slate-500">Buscando…</p>}
          {!buscando && q.trim().length >= 3 && res.length === 0 && <p className="mt-1 text-xs text-slate-500">Nenhuma pessoa encontrada. Use “Cadastrar nova”.</p>}
          {res.length > 0 && (
            <ul className="mt-1 max-h-60 overflow-auto rounded-md border border-slate-200 bg-white">
              {res.map((p) => (
                <li key={p.id}><button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100" onClick={() => { onChange({ pessoa: p, nova: null }); setQ(""); }}>{p.nome} <span className="text-xs text-slate-500">{p.tipo} · {p.cpf_cnpj_mascara}</span></button></li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <span className="label">Tipo</span>
            <div className="flex gap-4 text-sm">
              {(["PF", "PJ"] as const).map((t) => (
                <label key={t} className="flex items-center gap-1"><input type="radio" checked={nova!.tipo === t} onChange={() => set({ tipo: t, cpf_cnpj: "" })} /> {t === "PF" ? "Pessoa física" : "Pessoa jurídica"}</label>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="np-doc" className="label">{nova!.tipo === "PF" ? "CPF" : "CNPJ"} *</label>
            <input id="np-doc" className="input" inputMode="numeric" value={nova!.cpf_cnpj} onChange={(e) => set({ cpf_cnpj: mascara(e.target.value, nova!.tipo) })} data-testid="np-doc" />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="np-nome" className="label">{nova!.tipo === "PF" ? "Nome completo" : "Razão social"} *</label>
            <input id="np-nome" className="input" value={nova!.nome} onChange={(e) => set({ nome: e.target.value })} maxLength={200} data-testid="np-nome" />
          </div>
          <div>
            <label htmlFor="np-tel" className="label">Telefone</label>
            <input id="np-tel" className="input" inputMode="tel" value={nova!.telefone} onChange={(e) => set({ telefone: e.target.value })} maxLength={40} />
          </div>
          <div>
            <label htmlFor="np-email" className="label">E-mail</label>
            <input id="np-email" className="input" type="email" value={nova!.email} onChange={(e) => set({ email: e.target.value })} maxLength={150} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="np-end" className="label">Endereço</label>
            <input id="np-end" className="input" value={nova!.logradouro} onChange={(e) => set({ logradouro: e.target.value })} maxLength={200} />
          </div>
          <p className="text-xs text-slate-500 sm:col-span-2">CPF/CNPJ, e-mail e telefone de pessoa física são armazenados criptografados. Se o documento já estiver cadastrado, o cadastro existente é usado.</p>
        </div>
      )}
    </fieldset>
  );
}

export function refPessoa(v: ValorPessoa) {
  if (v.pessoa) return { pessoa_id: v.pessoa.id };
  if (v.nova) return { nova_pessoa: { ...v.nova, email: v.nova.email || null, telefone: v.nova.telefone || null, logradouro: v.nova.logradouro || null } };
  return {};
}
