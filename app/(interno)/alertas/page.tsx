import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtData, fmtDataHora } from "@/lib/format";
import { listarMeusAlertas, linkAlerta } from "@/lib/alertas/consultas";
import { ROTULO_TIPO_ALERTA, type TipoAlerta } from "@/lib/alertas/regras";
import { Badge, CabecalhoPagina, Card, Paginacao, Vazio } from "@/components/ui";
import { acaoMarcarLido, acaoMarcarTodosLidos } from "./actions";

export const metadata = { title: "Alertas – LicenciaGov" };

const COR: Record<string, "vermelho" | "amarelo" | "azul" | "roxo" | "cinza"> = {
  PRAZO_VENCIDO: "vermelho",
  PENDENCIA_VENCIDA: "vermelho",
  PRAZO_VENCENDO: "amarelo",
  PENDENCIA_VENCENDO: "amarelo",
  LICENCA_RENOVACAO: "azul",
  CONDICIONANTE: "roxo",
  NOTIFICACAO: "roxo",
  DESMATAMENTO: "vermelho",
};

export default async function PaginaAlertas({ searchParams }: { searchParams: Promise<{ page?: string; filtro?: string }> }) {
  const u = await exigirUsuario({ interno: true });
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const size = 30;
  const somenteNaoLidos = sp.filtro === "nao-lidos";
  const { itens, total, naoLidos } = await listarMeusAlertas(u.id, { skip: (page - 1) * size, take: size, somenteNaoLidos });

  // Processo de pendências/condicionantes/documentos para montar o link
  const refs = (tipo: string) => itens.filter((a) => a.referencia_tipo === tipo).map((a) => a.referencia_id);
  const [pend, cond, docs] = await Promise.all([
    prisma.pendencia.findMany({ where: { id: { in: refs("PENDENCIA") } }, select: { id: true, processo_id: true } }),
    prisma.condicionante.findMany({ where: { id: { in: refs("CONDICIONANTE") } }, select: { id: true, processo_id: true } }),
    prisma.documentoOficial.findMany({ where: { id: { in: refs("DOCUMENTO") } }, select: { id: true, processo_id: true } }),
  ]);
  const procDe = new Map<string, string | null>([...pend, ...cond, ...docs].map((x) => [x.id, x.processo_id]));

  return (
    <>
      <CabecalhoPagina
        titulo="Meus alertas"
        subtitulo={`${naoLidos} não lido(s) · ${total} ${somenteNaoLidos ? "não lido(s)" : "no total"}`}
        acoes={
          naoLidos > 0 && (
            <form action={acaoMarcarTodosLidos}>
              <button className="btn-secundario" data-testid="marcar-todos-lidos">Marcar todos como lidos</button>
            </form>
          )
        }
      />
      <div className="mb-3 flex gap-2 text-sm" role="tablist" aria-label="Filtro de alertas">
        <Link role="tab" aria-selected={!somenteNaoLidos} className={!somenteNaoLidos ? "btn-primario btn-sm" : "btn-secundario btn-sm"} href="/alertas">Todos</Link>
        <Link role="tab" aria-selected={somenteNaoLidos} className={somenteNaoLidos ? "btn-primario btn-sm" : "btn-secundario btn-sm"} href="/alertas?filtro=nao-lidos">Não lidos ({naoLidos})</Link>
      </div>
      <Card>
        {itens.length === 0 ? (
          <Vazio>Nenhum alerta {somenteNaoLidos ? "não lido" : "por enquanto"}.</Vazio>
        ) : (
          <ul className="divide-y divide-slate-100" data-testid="lista-alertas">
            {itens.map((a) => (
              <li key={a.id} className={`flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between ${a.lido ? "opacity-70" : ""}`} data-testid="alerta-item" data-lido={a.lido ? "1" : "0"}>
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    {!a.lido && <span className="inline-block h-2 w-2 rounded-full bg-red-600" aria-label="Não lido" />}
                    <Badge cor={COR[a.tipo] ?? "cinza"}>{ROTULO_TIPO_ALERTA[a.tipo as TipoAlerta] ?? a.tipo}</Badge>
                    <span className="text-xs text-slate-500">{fmtDataHora(a.created_at)}</span>
                    {a.vence_em && <span className="text-xs text-slate-500">· prazo {fmtData(a.vence_em)}</span>}
                    {a.enviado_email && <span className="text-xs text-slate-500">· e-mail enviado</span>}
                  </div>
                  <Link href={linkAlerta(a, procDe.get(a.referencia_id))} className={`text-sm ${a.lido ? "text-slate-700" : "font-medium text-slate-900"} hover:underline`}>
                    {a.mensagem}
                  </Link>
                </div>
                {!a.lido && (
                  <form action={acaoMarcarLido} className="shrink-0">
                    <input type="hidden" name="id" value={a.id} />
                    <button className="btn-secundario btn-sm">Marcar como lido</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        <Paginacao page={page} size={size} total={total} href={(p) => `/alertas?page=${p}${somenteNaoLidos ? "&filtro=nao-lidos" : ""}`} />
      </Card>
    </>
  );
}
