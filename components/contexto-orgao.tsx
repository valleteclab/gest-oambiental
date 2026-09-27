import Link from "next/link";
import { prisma } from "@/lib/db";
import { Brasao } from "./orgao";

/** Faixa "você está no portal do órgão X" nas páginas públicas abertas a partir de /orgao/[sigla]. */
export async function ContextoOrgao({ sigla }: { sigla?: string | string[] }) {
  const s = (Array.isArray(sigla) ? sigla[0] : sigla)?.trim().toUpperCase();
  if (!s || !/^[A-Z]{2,5}$/.test(s)) return null;
  const m = await prisma.municipio.findFirst({ where: { sigla: s, ativo: true }, select: { sigla: true, nome: true, orgao_ambiental_nome: true, brasao_url: true } });
  if (!m) return null;
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3" data-testid="contexto-orgao">
      <Brasao src={m.brasao_url} nome={m.nome} className="h-9 w-9" />
      <div className="min-w-0 flex-1 leading-tight">
        <p className="text-sm font-semibold text-slate-900">{m.orgao_ambiental_nome}</p>
        <p className="text-xs text-slate-600">Município de {m.nome}</p>
      </div>
      <Link href={`/orgao/${m.sigla}`} className="text-sm font-medium text-primaria-700 underline">Portal do órgão</Link>
    </div>
  );
}
