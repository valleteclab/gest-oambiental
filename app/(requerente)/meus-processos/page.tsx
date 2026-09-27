import Link from "next/link";
import clsx from "clsx";
import { exigirUsuario } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtData } from "@/lib/format";
import { Aviso, Badge, CabecalhoPagina, Vazio, statusAmigavel } from "@/components/ui";
import { whereTitular } from "@/lib/processo/consultas";

export const metadata = { title: "Meus processos" };

export default async function MeusProcessos() {
  const u = await exigirUsuario();
  const processos = await prisma.processo.findMany({
    where: whereTitular(u),
    select: {
      id: true, numero: true, status: true, data_protocolo: true, created_at: true, updated_at: true,
      tipo_ato: { select: { sigla: true, nome: true } },
      empreendimento: { select: { nome: true } },
      municipio: { select: { nome: true } },
      pendencias: { where: { status: { in: ["ABERTA", "VENCIDA"] } }, select: { id: true, prazo_ate: true } },
    },
    orderBy: { updated_at: "desc" },
  });
  const comAcao = processos.filter((p) => p.status === "AGUARDANDO_REQUERENTE" || p.status === "RASCUNHO");
  return (
    <>
      <CabecalhoPagina titulo="Meus processos" subtitulo="Acompanhe seus requerimentos de licenciamento ambiental." acoes={<Link href="/novo-requerimento" className="btn-primario">Novo requerimento</Link>} />
      {!u.pessoa_id && <div className="mb-4"><Aviso tipo="alerta">Seu usuário não está vinculado a um cadastro de CPF/CNPJ. Procure o órgão ambiental do seu município.</Aviso></div>}
      {comAcao.some((p) => p.status === "AGUARDANDO_REQUERENTE") && (
        <div className="mb-4"><Aviso tipo="alerta">Você tem processo(s) com <strong>pendência – ação necessária</strong>. Responda dentro do prazo para evitar o arquivamento.</Aviso></div>
      )}
      {processos.length === 0 ? (
        <div className="card"><Vazio>Você ainda não possui requerimentos. Clique em “Novo requerimento” para começar.</Vazio></div>
      ) : (
        <ul className="space-y-3" data-testid="lista-meus-processos">
          {processos.map((p) => {
            const pendente = p.status === "AGUARDANDO_REQUERENTE";
            const prazo = p.pendencias.map((x) => x.prazo_ate).sort((a, b) => a.getTime() - b.getTime())[0];
            return (
              <li key={p.id}>
                <Link
                  href={p.status === "RASCUNHO" ? `/novo-requerimento?id=${p.id}` : `/meus-processos/${p.id}`}
                  className={clsx("card block p-4 transition hover:shadow-md focus-visible:outline-2 focus-visible:outline-primaria-600", pendente && "border-amber-400 bg-amber-50")}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-900">{p.numero ?? "Rascunho – não protocolado"}</p>
                      <p className="text-sm text-slate-700">{p.tipo_ato.sigla} – {p.tipo_ato.nome}</p>
                      <p className="text-sm text-slate-600">{p.empreendimento.nome} · {p.municipio.nome}</p>
                    </div>
                    <div className="text-right">
                      <Badge cor={pendente ? "amarelo" : p.status === "RASCUNHO" ? "cinza" : ["CONCLUIDO", "DEFERIDO", "INDEFERIDO"].includes(p.status) ? "verde" : p.status === "ARQUIVADO" ? "cinza" : "azul"}>{statusAmigavel(p.status)}</Badge>
                      <p className="mt-1 text-xs text-slate-500">{p.data_protocolo ? `Protocolado em ${fmtData(p.data_protocolo)}` : `Criado em ${fmtData(p.created_at)}`}</p>
                    </div>
                  </div>
                  {pendente && <p className="mt-2 text-sm font-medium text-amber-900">Responda a pendência{prazo ? ` até ${fmtData(prazo)}` : ""} →</p>}
                  {p.status === "RASCUNHO" && <p className="mt-2 text-sm font-medium text-primaria-700">Continuar preenchimento →</p>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
