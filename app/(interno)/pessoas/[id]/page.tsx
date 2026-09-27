import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { auditar } from "@/lib/audit";
import { can, isSomenteLeitura, whereProcessoEscopo } from "@/lib/rbac";
import { obterPessoa } from "@/lib/cadastros/pessoas";
import { whereEmpreendimentoEscopo } from "@/lib/cadastros/escopo";
import { formatarEndereco } from "@/lib/cadastros/validacao";
import { fmtData } from "@/lib/format";
import { AcessoNegado } from "@/components/acesso-negado";
import { Aviso, Badge, BadgeStatus, CabecalhoPagina, Card, Vazio } from "@/components/ui";

export const metadata = { title: "Pessoa – LicenciaGov" };

export default async function PaginaPessoa({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ salvo?: string }> }) {
  const u = await exigirUsuario({ interno: true });
  const { id } = await params;
  const { salvo } = await searchParams;
  const r = await obterPessoa(u, id);
  if (r === null) notFound();
  if (r === "PROIBIDO") return <AcessoNegado />;
  const { dados: p, emClaro } = r;
  if (emClaro) await auditar({ usuario_id: u.id, acao: "VISUALIZAR_DADOS_PESSOAIS", entidade: "pessoa", entidade_id: p.id });

  const [municipio, rt, empreendimentos, processos] = await Promise.all([
    p.municipio_id ? prisma.municipio.findUnique({ where: { id: p.municipio_id }, select: { nome: true } }) : null,
    prisma.responsavelTecnico.findUnique({ where: { pessoa_id: p.id } }),
    prisma.empreendimento.findMany({ where: { AND: [{ requerente_id: p.id }, whereEmpreendimentoEscopo(u)] }, include: { municipio: { select: { nome: true } } }, orderBy: { nome: "asc" } }),
    prisma.processo.findMany({
      where: { AND: [{ OR: [{ requerente_id: p.id }, { rt: { pessoa_id: p.id } }] }, whereProcessoEscopo(u)] },
      include: { tipo_ato: { select: { sigla: true } }, empreendimento: { select: { nome: true } } },
      orderBy: { created_at: "desc" },
      take: 50,
    }),
  ]);
  const podeEditar = emClaro && !isSomenteLeitura(u) && can(u, "editar", "pessoa", p.municipio_id ?? undefined);

  return (
    <>
      <CabecalhoPagina
        titulo={p.nome}
        subtitulo={<>{p.tipo === "PF" ? "Pessoa física" : "Pessoa jurídica"}{p.nome_fantasia ? ` · ${p.nome_fantasia}` : ""}</>}
        acoes={
          <>
            {podeEditar && <Link href={`/pessoas/${p.id}/editar`} className="btn-secundario">Editar</Link>}
            {podeEditar && p.tipo === "PF" && !rt && <Link href={`/responsaveis-tecnicos/novo?pessoa=${p.id}`} className="btn-secundario">Cadastrar como RT</Link>}
            {!isSomenteLeitura(u) && can(u, "criar", "empreendimento") && <Link href={`/empreendimentos/novo?requerente=${p.id}`} className="btn-primario">Novo empreendimento</Link>}
          </>
        }
      />
      <div className="space-y-6">
        {salvo && <Aviso tipo="sucesso">Cadastro salvo.</Aviso>}
        {!emClaro && <Aviso tipo="info">Dados pessoais exibidos de forma mascarada (LGPD).</Aviso>}
        <Card titulo="Dados cadastrais">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div><dt className="text-slate-500">{p.tipo === "PF" ? "CPF" : "CNPJ"}</dt><dd className="font-mono" data-testid="pessoa-doc">{p.cpf_cnpj_formatado}</dd></div>
            <div><dt className="text-slate-500">Município</dt><dd>{municipio?.nome ?? "—"}</dd></div>
            <div><dt className="text-slate-500">E-mail</dt><dd>{p.email ?? (emClaro ? "—" : "••••")}</dd></div>
            <div><dt className="text-slate-500">Telefone</dt><dd>{p.telefone ?? (emClaro ? "—" : "••••")}</dd></div>
            <div className="sm:col-span-2"><dt className="text-slate-500">Endereço</dt><dd>{formatarEndereco(p.endereco)}</dd></div>
            <div><dt className="text-slate-500">Cadastrado em</dt><dd>{fmtData(p.created_at)}</dd></div>
            <div><dt className="text-slate-500">Atualizado em</dt><dd>{fmtData(p.updated_at)}</dd></div>
          </dl>
        </Card>
        {rt && (
          <Card titulo="Responsável técnico" acoes={<Link href={`/responsaveis-tecnicos/${rt.id}`} className="btn-secundario btn-sm">Abrir</Link>}>
            <p className="text-sm">{rt.formacao} · {rt.conselho} nº {rt.registro_conselho}/{rt.uf_conselho}</p>
          </Card>
        )}
        <Card titulo={`Empreendimentos (${empreendimentos.length})`}>
          {empreendimentos.length === 0 ? <Vazio>Nenhum empreendimento no seu escopo.</Vazio> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {empreendimentos.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link href={`/empreendimentos/${e.id}`} className="font-medium text-primaria-700 hover:underline">{e.nome}</Link>
                  <span className="text-slate-500">{e.municipio.nome} {e.status === "INATIVO" && <Badge>Inativo</Badge>}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card titulo={`Processos (${processos.length})`}>
          {processos.length === 0 ? <Vazio>Nenhum processo no seu escopo.</Vazio> : (
            <div className="overflow-x-auto">
              <table className="tabela">
                <thead><tr><th>Número</th><th>Ato</th><th>Empreendimento</th><th>Papel</th><th>Status</th></tr></thead>
                <tbody>
                  {processos.map((pr) => (
                    <tr key={pr.id}>
                      <td><Link href={`/processos/${pr.id}`} className="font-mono text-primaria-700 hover:underline">{pr.numero ?? "(rascunho)"}</Link></td>
                      <td>{pr.tipo_ato.sigla}</td>
                      <td>{pr.empreendimento.nome}</td>
                      <td>{pr.requerente_id === p.id ? "Requerente" : "RT"}</td>
                      <td><BadgeStatus status={pr.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
