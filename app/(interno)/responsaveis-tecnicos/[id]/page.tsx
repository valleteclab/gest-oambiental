import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can, isSomenteLeitura, whereProcessoEscopo } from "@/lib/rbac";
import { obterResponsavel } from "@/lib/cadastros/responsaveis";
import { whereEmpreendimentoEscopo } from "@/lib/cadastros/escopo";
import { podeVerPessoa } from "@/lib/cadastros/pessoas";
import { fmtData } from "@/lib/format";
import { AcessoNegado } from "@/components/acesso-negado";
import { Aviso, Badge, BadgeStatus, CabecalhoPagina, Card, Vazio } from "@/components/ui";

export const metadata = { title: "Responsável técnico – LicenciaGov" };

export default async function PaginaRt({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ salvo?: string }> }) {
  const u = await exigirUsuario({ interno: true });
  const { id } = await params;
  const { salvo } = await searchParams;
  const rt = await obterResponsavel(u, id);
  if (rt === null) notFound();
  if (rt === "PROIBIDO") return <AcessoNegado />;
  const [vinculos, processos, verPessoa] = await Promise.all([
    prisma.empreendimentoRt.findMany({
      where: { rt_id: id, empreendimento: whereEmpreendimentoEscopo(u) },
      include: { empreendimento: { select: { id: true, nome: true, municipio: { select: { nome: true } } } } },
      orderBy: { desde: "desc" },
    }),
    prisma.processo.findMany({ where: { AND: [{ rt_id: id }, whereProcessoEscopo(u)] }, include: { tipo_ato: { select: { sigla: true } }, empreendimento: { select: { nome: true } } }, orderBy: { created_at: "desc" }, take: 50 }),
    podeVerPessoa(u, rt.pessoa_id),
  ]);
  return (
    <>
      <CabecalhoPagina
        titulo={rt.pessoa.nome}
        subtitulo={`Responsável técnico · ${rt.formacao}`}
        acoes={can(u, "editar", "pessoa") && !isSomenteLeitura(u) ? <Link href={`/responsaveis-tecnicos/${id}/editar`} className="btn-secundario">Editar</Link> : undefined}
      />
      <div className="space-y-6">
        {salvo && <Aviso tipo="sucesso">Cadastro salvo.</Aviso>}
        <Card titulo="Registro profissional">
          <dl className="grid gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-slate-500">Conselho</dt><dd>{rt.conselho}</dd></div>
            <div><dt className="text-slate-500">Nº de registro</dt><dd className="font-mono" data-testid="rt-registro">{rt.registro_conselho}</dd></div>
            <div><dt className="text-slate-500">UF</dt><dd>{rt.uf_conselho}</dd></div>
            <div><dt className="text-slate-500">CPF</dt><dd className="font-mono">{rt.pessoa.cpf_cnpj_mascara}</dd></div>
          </dl>
          {verPessoa && <p className="mt-3 text-sm"><Link href={`/pessoas/${rt.pessoa_id}`} className="text-primaria-700 underline">Ver cadastro da pessoa</Link></p>}
        </Card>
        <Card titulo="Empreendimentos (histórico de responsabilidade)">
          {vinculos.length === 0 ? <Vazio>Nenhum empreendimento no seu escopo.</Vazio> : (
            <div className="overflow-x-auto">
              <table className="tabela">
                <thead><tr><th>Empreendimento</th><th>Município</th><th>Desde</th><th>Até</th></tr></thead>
                <tbody>
                  {vinculos.map((v) => (
                    <tr key={v.id}>
                      <td><Link href={`/empreendimentos/${v.empreendimento.id}`} className="text-primaria-700 hover:underline">{v.empreendimento.nome}</Link></td>
                      <td>{v.empreendimento.municipio.nome}</td>
                      <td>{fmtData(v.desde)}</td>
                      <td>{v.ate ? fmtData(v.ate) : <Badge cor="verde">Atual</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card titulo={`Processos (${processos.length})`}>
          {processos.length === 0 ? <Vazio>Nenhum processo no seu escopo.</Vazio> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {processos.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span><Link href={`/processos/${p.id}`} className="font-mono text-primaria-700 hover:underline">{p.numero ?? "(rascunho)"}</Link> · {p.tipo_ato.sigla} · {p.empreendimento.nome}</span>
                  <BadgeStatus status={p.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
