import clsx from "clsx";
import Link from "next/link";
import type { StatusProcesso } from "@prisma/client";
import type { Semaforo } from "@/lib/dias";

export function Card({ titulo, acoes, children, className }: { titulo?: React.ReactNode; acoes?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={clsx("card", className)}>
      {(titulo || acoes) && (
        <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-base font-semibold">{titulo}</h2>
          {acoes}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function CabecalhoPagina({ titulo, subtitulo, acoes }: { titulo: string; subtitulo?: React.ReactNode; acoes?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="titulo-pagina">{titulo}</h1>
        {subtitulo && <p className="mt-1 text-sm text-slate-600">{subtitulo}</p>}
      </div>
      {acoes && <div className="flex flex-wrap gap-2">{acoes}</div>}
    </div>
  );
}

export function Badge({ cor = "cinza", children }: { cor?: "verde" | "amarelo" | "vermelho" | "azul" | "cinza" | "roxo"; children: React.ReactNode }) {
  const cores = {
    verde: "bg-emerald-100 text-emerald-800",
    amarelo: "bg-amber-100 text-amber-800",
    vermelho: "bg-red-100 text-red-800",
    azul: "bg-sky-100 text-sky-800",
    cinza: "bg-slate-100 text-slate-700",
    roxo: "bg-violet-100 text-violet-800",
  };
  return <span className={clsx("badge", cores[cor])}>{children}</span>;
}

export const ROTULO_STATUS: Record<StatusProcesso, string> = {
  RASCUNHO: "Rascunho",
  PROTOCOLADO: "Protocolado",
  EM_TRIAGEM: "Em triagem",
  AGUARDANDO_REQUERENTE: "Aguardando requerente",
  EM_ANALISE: "Em análise",
  AGUARDANDO_VISTORIA: "Aguardando vistoria",
  AGUARDANDO_DECISAO: "Aguardando decisão",
  DEFERIDO: "Deferido",
  INDEFERIDO: "Indeferido",
  CONCLUIDO: "Concluído",
  ARQUIVADO: "Arquivado",
};

/** Status "amigável" exibido ao requerente e no portal público (SPEC 6 regra 5). */
export function statusAmigavel(s: StatusProcesso): string {
  if (s === "RASCUNHO") return "Rascunho";
  if (s === "PROTOCOLADO") return "Protocolado";
  if (s === "AGUARDANDO_REQUERENTE") return "Pendência – ação necessária";
  if (s === "CONCLUIDO" || s === "DEFERIDO" || s === "INDEFERIDO") return "Concluído";
  if (s === "ARQUIVADO") return "Arquivado";
  return "Em análise";
}

export function BadgeStatus({ status }: { status: StatusProcesso }) {
  const cor = ({
    RASCUNHO: "cinza", PROTOCOLADO: "azul", EM_TRIAGEM: "azul", AGUARDANDO_REQUERENTE: "amarelo", EM_ANALISE: "azul",
    AGUARDANDO_VISTORIA: "roxo", AGUARDANDO_DECISAO: "roxo", DEFERIDO: "verde", INDEFERIDO: "vermelho", CONCLUIDO: "verde", ARQUIVADO: "cinza",
  } as const)[status];
  return <Badge cor={cor}>{ROTULO_STATUS[status]}</Badge>;
}

export function PontoSemaforo({ s, titulo }: { s: Semaforo; titulo?: string }) {
  const cor = { verde: "bg-emerald-500", amarelo: "bg-amber-400", vermelho: "bg-red-600", cinza: "bg-slate-300" }[s];
  const rotulo = { verde: "Em dia", amarelo: "Vencendo", vermelho: "Vencido", cinza: "Sem prazo/pausado" }[s];
  return <span role="img" aria-label={titulo ?? rotulo} title={titulo ?? rotulo} className={clsx("inline-block h-3 w-3 rounded-full", cor)} />;
}

export function Vazio({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-sm text-slate-500">{children}</p>;
}

export function Paginacao({ page, size, total, href }: { page: number; size: number; total: number; href: (p: number) => string }) {
  const paginas = Math.max(1, Math.ceil(total / size));
  if (paginas <= 1) return null;
  return (
    <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Paginação">
      <span className="text-slate-600">{total} registro(s) · página {page} de {paginas}</span>
      <div className="flex gap-2">
        {page > 1 && <Link className="btn-secundario btn-sm" href={href(page - 1)}>Anterior</Link>}
        {page < paginas && <Link className="btn-secundario btn-sm" href={href(page + 1)}>Próxima</Link>}
      </div>
    </nav>
  );
}

export function Campo({ label, children, dica }: { label: string; children: React.ReactNode; dica?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {dica && <span className="mt-1 block text-xs text-slate-500">{dica}</span>}
    </label>
  );
}

export function Aviso({ tipo = "info", children }: { tipo?: "info" | "erro" | "sucesso" | "alerta"; children: React.ReactNode }) {
  const c = { info: "border-sky-200 bg-sky-50 text-sky-900", erro: "border-red-200 bg-red-50 text-red-900", sucesso: "border-emerald-200 bg-emerald-50 text-emerald-900", alerta: "border-amber-200 bg-amber-50 text-amber-900" }[tipo];
  return <div role={tipo === "erro" ? "alert" : "status"} className={clsx("rounded-md border px-4 py-3 text-sm", c)}>{children}</div>;
}
