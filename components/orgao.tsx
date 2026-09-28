import Link from "next/link";
import { connection } from "next/server";
import clsx from "clsx";
import type { OrgaoResumo } from "@/lib/auth";

/** DEMO_MODE=true → faixa "Ambiente de demonstração". Lida em tempo de execução (não no build). */
export async function FaixaDemo({ className }: { className?: string }) {
  await connection();
  if (process.env.DEMO_MODE !== "true") return null;
  return (
    <div role="note" data-testid="faixa-demo" className={clsx("bg-amber-100 px-4 py-1.5 text-center text-xs font-medium text-amber-900", className)}>
      Ambiente de demonstração – dados fictícios
    </div>
  );
}

export function demoAtivo() {
  return process.env.DEMO_MODE === "true";
}

/** Brasão do órgão (img simples: pode ser caminho público ou URL externa configurada no admin). */
export function Brasao({ src, nome, className }: { src: string | null | undefined; nome: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src || "/brasao-generico.svg"} alt={`Brasão de ${nome}`} className={clsx("shrink-0 object-contain", className ?? "h-8 w-8")} />
  );
}

/** Logo horizontal da organização (cliente) – usado onde há espaço (portal do órgão, login); nos lugares pequenos, o brasão. */
export function LogoOrganizacao({ src, nome, className }: { src: string; nome: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={`Logo – ${nome}`} className={clsx("shrink-0 object-contain", className ?? "h-12 w-auto max-w-[220px]")} />
  );
}

/** Órgão ativo no cabeçalho das áreas logadas, com o link "Trocar órgão". */
export function OrgaoAtivo({ orgao, tema = "claro" }: { orgao: OrgaoResumo | null; tema?: "claro" | "escuro" }) {
  const escuro = tema === "escuro";
  if (!orgao) {
    return (
      <Link href="/trocar-orgao" className={clsx("text-sm font-medium underline", escuro ? "text-white" : "text-primaria-700")} data-testid="orgao-ativo">
        Escolher órgão
      </Link>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-2" data-testid="orgao-ativo" data-sigla={orgao.sigla}>
      <Brasao src={orgao.brasao_url} nome={orgao.nome} className="h-8 w-8" />
      <div className="min-w-0 leading-tight">
        <div className={clsx("truncate text-sm font-semibold", escuro ? "text-white" : "text-slate-900")} title={orgao.orgao_ambiental_nome}>{orgao.nome}</div>
        <div className={clsx("flex items-center gap-2 text-xs", escuro ? "text-emerald-100" : "text-slate-500")}>
          <span className="hidden truncate md:inline" title={orgao.orgao_ambiental_nome}>{orgao.orgao_ambiental_nome}</span>
          <Link href="/trocar-orgao" className={clsx("shrink-0 font-medium underline", escuro ? "text-white" : "text-primaria-700")} data-testid="trocar-orgao">Trocar órgão</Link>
        </div>
      </div>
    </div>
  );
}
