import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { Aviso, Badge, CabecalhoPagina, Card, Vazio } from "@/components/ui";
import { BotaoRevogar } from "@/components/ged/compartilhamento/botao-revogar";
import { ErroApi } from "@/lib/http";
import { exigirGed } from "@/lib/ged/escopo";
import { fmtDataHoraBrasilia } from "@/lib/ged/assinaturas/regras";
import { podeCompartilhar } from "@/lib/ged/papeis";
import { detalharCompartilhamento } from "@/lib/ged/compartilhamento/servico";

export const dynamic = "force-dynamic";
export const metadata = { title: "Compartilhamento – Gestão de Documentos" };
const COR = { ATIVO: "verde", EXPIRADO: "cinza", REVOGADO: "vermelho" } as const;

export default async function PaginaCompartilhamento({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await exigirGed();
  if (!podeCompartilhar(ctx)) forbidden();
  const { id } = await params;
  let r;
  try {
    r = await detalharCompartilhamento(ctx, id);
  } catch (e) {
    if (e instanceof ErroApi) notFound();
    throw e;
  }
  const c = r.compartilhamento;
  const recursoHref = c.recurso_id ? (c.recurso_tipo === "PASTA" ? `/ged/pastas?pasta=${c.recurso_id}` : `/ged/documentos/${c.recurso_id}`) : null;
  return (
    <>
      <CabecalhoPagina
        titulo="Compartilhamento"
        subtitulo={<><Link href="/ged/compartilhamentos" prefetch={false} className="underline">Compartilhamentos</Link> · {c.recurso_tipo === "PASTA" ? "pasta" : "documento"}</>}
        acoes={c.status === "ATIVO" ? <BotaoRevogar id={c.id} /> : undefined}
      />
      {c.status === "REVOGADO" && <div className="mb-4"><Aviso tipo="alerta">Link revogado{c.revogado_em ? ` em ${fmtDataHoraBrasilia(c.revogado_em)}` : ""}{c.revogado_motivo ? ` (${c.revogado_motivo})` : ""}. Ninguém consegue mais abri-lo.</Aviso></div>}
      {c.status === "EXPIRADO" && <div className="mb-4"><Aviso tipo="info">Este link expirou em {fmtDataHoraBrasilia(c.expira_em)}.</Aviso></div>}
      <Card titulo={<span className="break-words">{recursoHref ? <Link className="underline" prefetch={false} href={recursoHref}>{c.recurso_rotulo}</Link> : c.recurso_rotulo}</span>} acoes={<Badge cor={COR[c.status]}>{c.status_rotulo}</Badge>}>
        <dl className="grid gap-2 text-sm sm:grid-cols-[220px_1fr]" data-testid="compartilhamento-detalhe">
          <dt className="font-medium text-slate-600">Destinatário</dt><dd>{c.destinatario_nome ? `${c.destinatario_nome} · ` : ""}{c.destinatario_mascarado}</dd>
          <dt className="font-medium text-slate-600">Criado por</dt><dd>{c.criado_por_nome} em {fmtDataHoraBrasilia(c.created_at)}</dd>
          <dt className="font-medium text-slate-600">Válido até</dt><dd>{fmtDataHoraBrasilia(c.expira_em)}</dd>
          <dt className="font-medium text-slate-600">Permissões</dt><dd>{[c.pode_visualizar && "visualizar", c.pode_baixar && "baixar", c.pode_zip && "ZIP da pasta"].filter(Boolean).join(", ")}</dd>
          <dt className="font-medium text-slate-600">Downloads</dt><dd>{c.downloads}{c.limite_downloads !== null ? ` de ${c.limite_downloads}` : ""}</dd>
          {c.recurso_tipo === "PASTA" && (<><dt className="font-medium text-slate-600">Conteúdo da pasta</dt><dd>{c.congelado ? `Lista congelada na criação (${c.itens_congelados} documento(s))` : "Dinâmico: o destinatário vê o que você pode ver no momento do acesso (documentos novos entram)"}</dd></>)}
          <dt className="font-medium text-slate-600">Primeiro acesso</dt><dd>{c.primeiro_acesso_em ? fmtDataHoraBrasilia(c.primeiro_acesso_em) : "Ainda não acessado"}</dd>
          {c.mensagem && (<><dt className="font-medium text-slate-600">Mensagem</dt><dd className="whitespace-pre-wrap">{c.mensagem}</dd></>)}
        </dl>
        <p className="mt-3 text-xs text-slate-500">O endereço do link não pode ser recuperado depois da criação. Se perdeu o link, revogue e crie outro.</p>
      </Card>
      <div className="mt-4" />
      <Card titulo="Acessos e eventos">
        {r.eventos.length === 0 ? (
          <Vazio>Nenhum evento registrado.</Vazio>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela" data-testid="tabela-eventos">
              <thead><tr><th>Quando</th><th>Evento</th><th>Documento</th><th>Origem</th></tr></thead>
              <tbody>
                {r.eventos.map((e) => (
                  <tr key={e.id} data-evento={e.tipo}>
                    <td className="whitespace-nowrap">{fmtDataHoraBrasilia(e.created_at)}</td>
                    <td>{e.rotulo}{e.detalhe ? <span className="text-xs text-slate-500"> · {e.detalhe}</span> : null}</td>
                    <td className="max-w-xs break-words">{e.documento_titulo ?? "—"}</td>
                    <td className="text-xs">{[e.user_agent, e.ip].filter(Boolean).join(" · ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500">O registro guarda o endereço de rede truncado e um resumo do navegador; nunca o número de WhatsApp completo.</p>
      </Card>
    </>
  );
}
