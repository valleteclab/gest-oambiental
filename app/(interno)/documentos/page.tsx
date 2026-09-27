import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma, StatusDocumento, TipoDocumento } from "@prisma/client";
import { exigirUsuario } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can, escopoMunicipios, whereMunicipio } from "@/lib/rbac";
import { ROTULO_TIPO_DOCUMENTO, statusPublico, ROTULO_STATUS_PUBLICO } from "@/lib/documentos/render";
import { fmtData, fmtDataHora } from "@/lib/format";
import { Aviso, Badge, CabecalhoPagina, Paginacao, Vazio } from "@/components/ui";

export const metadata: Metadata = { title: "Documentos emitidos" };

const TIPOS = Object.keys(ROTULO_TIPO_DOCUMENTO) as TipoDocumento[];
const STATUS: StatusDocumento[] = ["VALIDO", "CANCELADO", "SUBSTITUIDO"];
const COR = { VALIDO: "verde", VENCIDO: "amarelo", CANCELADO: "vermelho", SUBSTITUIDO: "amarelo" } as const;
const TAMANHO = 25;

type SP = { tipo?: string; status?: string; municipio?: string; de?: string; ate?: string; q?: string; page?: string };

export default async function DocumentosPage({ searchParams }: { searchParams: Promise<SP> }) {
  const u = await exigirUsuario({ interno: true });
  if (!can(u, "ver", "documento")) return <Aviso tipo="erro">Acesso negado (403): seu perfil não pode consultar documentos emitidos.</Aviso>;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const data = (v: string | undefined, fim = false) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T${fim ? "23:59:59" : "00:00:00"}-03:00`) : undefined);
  const de = data(sp.de);
  const ate = data(sp.ate, true);
  const q = sp.q?.trim();
  const where: Prisma.DocumentoOficialWhereInput = {
    ...whereMunicipio(u, sp.municipio || null),
    ...(sp.tipo && TIPOS.includes(sp.tipo as TipoDocumento) ? { tipo: sp.tipo as TipoDocumento } : {}),
    ...(sp.status && STATUS.includes(sp.status as StatusDocumento) ? { status: sp.status as StatusDocumento } : {}),
    ...(de || ate ? { emitido_em: { ...(de ? { gte: de } : {}), ...(ate ? { lte: ate } : {}) } } : {}),
    ...(q ? { OR: [{ numero: { contains: q, mode: "insensitive" } }, { codigo_verificador: { contains: q.toUpperCase() } }, { processo: { numero: { contains: q.toUpperCase() } } }] } : {}),
  };
  const escopo = escopoMunicipios(u);
  const [total, docs, municipios] = await Promise.all([
    prisma.documentoOficial.count({ where }),
    prisma.documentoOficial.findMany({
      where,
      orderBy: { emitido_em: "desc" },
      skip: (page - 1) * TAMANHO,
      take: TAMANHO,
      select: { id: true, tipo: true, numero: true, status: true, validade_ate: true, emitido_em: true, emitido_por_nome: true, codigo_verificador: true, municipio: { select: { sigla: true } }, processo: { select: { numero: true } } },
    }),
    prisma.municipio.findMany({ where: escopo === "TODOS" ? {} : { id: { in: escopo } }, orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
  ]);
  const href = (p: number) => `/documentos?${new URLSearchParams(Object.entries({ ...sp, page: String(p) }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <div>
      <CabecalhoPagina titulo="Documentos emitidos" subtitulo="Licenças, autorizações, certidões, pareceres, autos, notificações, ofícios e recibos com código verificador." />
      <form method="get" className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-7 lg:items-end">
        <label className="block lg:col-span-2"><span className="label">Nº, código ou processo</span><input name="q" defaultValue={sp.q ?? ""} className="input" /></label>
        {municipios.length > 1 && (
          <label className="block"><span className="label">Município</span>
            <select name="municipio" defaultValue={sp.municipio ?? ""} className="input">
              <option value="">Todos</option>
              {municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          </label>
        )}
        <label className="block"><span className="label">Tipo</span>
          <select name="tipo" defaultValue={sp.tipo ?? ""} className="input">
            <option value="">Todos</option>
            {TIPOS.map((t) => <option key={t} value={t}>{ROTULO_TIPO_DOCUMENTO[t]}</option>)}
          </select>
        </label>
        <label className="block"><span className="label">Situação</span>
          <select name="status" defaultValue={sp.status ?? ""} className="input">
            <option value="">Todas</option>
            <option value="VALIDO">Válido</option>
            <option value="CANCELADO">Cancelado</option>
            <option value="SUBSTITUIDO">Substituído</option>
          </select>
        </label>
        <label className="block"><span className="label">De</span><input type="date" name="de" defaultValue={sp.de ?? ""} className="input" /></label>
        <label className="block"><span className="label">Até</span><input type="date" name="ate" defaultValue={sp.ate ?? ""} className="input" /></label>
        <div className="flex gap-2 lg:col-span-7">
          <button className="btn-primario" type="submit">Filtrar</button>
          <Link className="btn-secundario" href="/documentos">Limpar</Link>
        </div>
      </form>
      <section className="card">
        {docs.length === 0 ? (
          <Vazio>Nenhum documento encontrado.</Vazio>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead><tr><th scope="col">Número</th><th scope="col">Tipo</th><th scope="col">Processo</th><th scope="col">Mun.</th><th scope="col">Emissão</th><th scope="col">Validade</th><th scope="col">Situação</th></tr></thead>
              <tbody>
                {docs.map((d) => {
                  const s = statusPublico(d);
                  return (
                    <tr key={d.id}>
                      <td className="whitespace-nowrap font-mono"><Link className="text-primaria-700 underline" href={`/documentos/${d.id}`}>{d.numero}</Link></td>
                      <td>{ROTULO_TIPO_DOCUMENTO[d.tipo]}</td>
                      <td className="whitespace-nowrap font-mono">{d.processo?.numero ?? "—"}</td>
                      <td>{d.municipio.sigla}</td>
                      <td className="whitespace-nowrap">{fmtDataHora(d.emitido_em)}<span className="block text-xs text-slate-500">{d.emitido_por_nome}</span></td>
                      <td className="whitespace-nowrap">{fmtData(d.validade_ate)}</td>
                      <td><Badge cor={COR[s]}>{ROTULO_STATUS_PUBLICO[s]}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 pb-4"><Paginacao page={page} size={TAMANHO} total={total} href={href} /></div>
      </section>
    </div>
  );
}
