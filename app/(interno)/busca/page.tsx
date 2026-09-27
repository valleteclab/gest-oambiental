import Link from "next/link";
import { redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { buscaGlobal } from "@/lib/cadastros/busca";
import { BadgeStatus, CabecalhoPagina, Card, Vazio } from "@/components/ui";

export const metadata = { title: "Busca – LicenciaGov" };

export default async function PaginaBusca({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const u = await exigirUsuario({ interno: true });
  const q = ((await searchParams).q ?? "").trim();
  const r = await buscaGlobal(u, q);
  // Atalho: nº de processo exato → abre direto
  const exato = r.processos.find((p) => p.numero && p.numero.toUpperCase() === q.toUpperCase());
  if (exato && r.pessoas.length === 0 && r.empreendimentos.length === 0) redirect(`/processos/${exato.id}`);
  const total = r.processos.length + r.pessoas.length + r.empreendimentos.length;
  return (
    <>
      <CabecalhoPagina titulo="Busca" subtitulo={q ? <>Resultados para “{q}”{r.porDocumento ? " (CPF/CNPJ)" : ""} – {total} encontrado(s) no seu escopo</> : "Busque por nº de processo, CPF/CNPJ, nome ou empreendimento"} />
      <form className="mb-6 flex gap-2" role="search">
        <label htmlFor="q-busca" className="sr-only">Termo de busca</label>
        <input id="q-busca" name="q" defaultValue={q} className="input max-w-xl" placeholder="Ex.: ITB-2026-000042, 11.222.333/0001-81, Laticínio" autoFocus />
        <button className="btn-primario">Buscar</button>
      </form>
      {q.length > 0 && q.length < 2 && <Vazio>Digite ao menos 2 caracteres.</Vazio>}
      {q.length >= 2 && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card titulo={`Processos (${r.processos.length})`}>
            {r.processos.length === 0 ? <Vazio>Nenhum processo.</Vazio> : (
              <ul className="space-y-3 text-sm">
                {r.processos.map((p) => (
                  <li key={p.id}>
                    <Link href={`/processos/${p.id}`} className="font-mono font-medium text-primaria-700 hover:underline">{p.numero ?? "(rascunho)"}</Link>{" "}
                    <BadgeStatus status={p.status} />
                    <div className="text-xs text-slate-600">{p.tipo_ato.sigla} · {p.empreendimento.nome} · {p.municipio.sigla}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card titulo={`Pessoas (${r.pessoas.length})`}>
            {r.pessoas.length === 0 ? <Vazio>Nenhuma pessoa.</Vazio> : (
              <ul className="space-y-3 text-sm">
                {r.pessoas.map((p) => (
                  <li key={p.id}>
                    <Link href={`/pessoas/${p.id}`} className="font-medium text-primaria-700 hover:underline">{p.nome}</Link>
                    <div className="font-mono text-xs text-slate-600">{p.tipo} · {p.cpf_cnpj_mascara}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card titulo={`Empreendimentos (${r.empreendimentos.length})`}>
            {r.empreendimentos.length === 0 ? <Vazio>Nenhum empreendimento.</Vazio> : (
              <ul className="space-y-3 text-sm">
                {r.empreendimentos.map((e) => (
                  <li key={e.id}>
                    <Link href={`/empreendimentos/${e.id}`} className="font-medium text-primaria-700 hover:underline">{e.nome}</Link>
                    <div className="text-xs text-slate-600">{e.municipio.nome} · {e.requerente.nome}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
