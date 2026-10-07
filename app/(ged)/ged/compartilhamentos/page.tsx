import Link from "next/link";
import { forbidden } from "next/navigation";
import { Badge, CabecalhoPagina, Card, Paginacao, Vazio } from "@/components/ui";
import { BotaoRevogar } from "@/components/ged/compartilhamento/botao-revogar";
import { exigirGed } from "@/lib/ged/escopo";
import { fmtDataHoraBrasilia } from "@/lib/ged/assinaturas/regras";
import { podeCompartilhar } from "@/lib/ged/papeis";
import { listarCompartilhamentos } from "@/lib/ged/compartilhamento/servico";

export const dynamic = "force-dynamic";
export const metadata = { title: "Compartilhamentos – Gestão de Documentos" };

const COR = { ATIVO: "verde", EXPIRADO: "cinza", REVOGADO: "vermelho" } as const;
const ABAS: { v: string; rotulo: string }[] = [{ v: "", rotulo: "Todos" }, { v: "ATIVO", rotulo: "Ativos" }, { v: "EXPIRADO", rotulo: "Expirados" }, { v: "REVOGADO", rotulo: "Revogados" }];

export default async function PaginaCompartilhamentos({ searchParams }: { searchParams: Promise<{ status?: string; escopo?: string; recurso_id?: string; page?: string }> }) {
  const ctx = await exigirGed();
  if (!podeCompartilhar(ctx)) forbidden();
  const sp = await searchParams;
  const status = sp.status === "ATIVO" || sp.status === "EXPIRADO" || sp.status === "REVOGADO" ? sp.status : null;
  const escopo = sp.escopo === "todos" ? "todos" : "meus";
  const page = Math.max(1, Number(sp.page) || 1);
  const r = await listarCompartilhamentos(ctx, { escopo, status, recurso_id: sp.recurso_id ?? null, page, size: 20 });
  const qs = (o: Record<string, string | number | null | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ status, escopo: escopo === "todos" ? "todos" : null, recurso_id: sp.recurso_id, ...o })) if (v) p.set(k, String(v));
    const s = p.toString();
    return `/ged/compartilhamentos${s ? `?${s}` : ""}`;
  };
  return (
    <>
      <CabecalhoPagina
        titulo="Compartilhamentos"
        subtitulo="Links públicos que você criou. O destinatário só vê os arquivos depois de confirmar um código enviado ao WhatsApp que você cadastrou."
        acoes={r.pode_ver_todos ? <Link className="btn-secundario" prefetch={false} href={qs({ escopo: escopo === "todos" ? null : "todos", page: null })}>{escopo === "todos" ? "Ver só os meus" : "Ver os de todos"}</Link> : undefined}
      />
      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Filtrar por situação">
        {ABAS.map((a) => (
          <Link key={a.v} prefetch={false} href={qs({ status: a.v || null, page: null })} aria-current={(status ?? "") === a.v ? "page" : undefined} className={(status ?? "") === a.v ? "btn-primario btn-sm" : "btn-secundario btn-sm"}>{a.rotulo}</Link>
        ))}
      </nav>
      <Card>
        {r.itens.length === 0 ? (
          <Vazio>Nenhum compartilhamento por aqui. Abra um documento ou uma pasta e use o botão &ldquo;Compartilhar&rdquo;.</Vazio>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela" data-testid="tabela-compartilhamentos">
              <thead>
                <tr><th>Recurso</th><th>Destinatário</th>{escopo === "todos" && <th>Criado por</th>}<th>Situação</th><th>Validade</th><th>Acessos</th><th><span className="sr-only">Ações</span></th></tr>
              </thead>
              <tbody>
                {r.itens.map((c) => (
                  <tr key={c.id}>
                    <td className="max-w-xs break-words"><Link className="text-primaria-700 underline" prefetch={false} href={`/ged/compartilhamentos/${c.id}`}>{c.recurso_rotulo}</Link><div className="text-xs text-slate-500">{c.recurso_tipo === "PASTA" ? "Pasta" : "Documento"}{c.congelado ? " · lista congelada" : ""}</div></td>
                    <td>{c.destinatario_nome ? <div>{c.destinatario_nome}</div> : null}<div className="text-xs text-slate-500">{c.destinatario_mascarado}</div></td>
                    {escopo === "todos" && <td>{c.criado_por_nome}</td>}
                    <td><Badge cor={COR[c.status]}>{c.status_rotulo}</Badge></td>
                    <td>{fmtDataHoraBrasilia(c.expira_em).slice(0, 10)}</td>
                    <td className="text-xs">{c.primeiro_acesso_em ? <>1º: {fmtDataHoraBrasilia(c.primeiro_acesso_em)}<br />{c.downloads} download(s)</> : "Ainda não acessado"}</td>
                    <td>{c.status === "ATIVO" && <BotaoRevogar id={c.id} rotulo="Revogar" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Paginacao page={r.page} size={r.size} total={r.total} href={(p) => qs({ page: p })} />
      </Card>
    </>
  );
}
