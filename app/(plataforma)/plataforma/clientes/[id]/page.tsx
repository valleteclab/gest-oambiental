import Link from "next/link";
import { notFound } from "next/navigation";
import { operadorDaPagina } from "@/lib/plataforma/operador";
import { obterCliente, usuariosDoCliente } from "@/lib/plataforma/servico";
import { ROTULO_MODULO, type Modulo } from "@/lib/plataforma/regras";
import { ErroApi } from "@/lib/http";
import { ROTULO_PAPEL } from "@/lib/rbac";
import { fmtData, fmtDataHora } from "@/lib/format";
import { Aviso, Badge, CabecalhoPagina, Card } from "@/components/ui";
import { FormEditarCliente, FormModulos, FormMunicipio, FormReativar, FormReautenticar, FormRedefinirSenha, FormSuspender } from "../../_comp/forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cliente – Plataforma", robots: { index: false, follow: false } };

export default async function DetalheCliente({ params }: { params: Promise<{ id: string }> }) {
  const { reautenticado } = await operadorDaPagina();
  if (!reautenticado) return <Card titulo="Confirme sua senha"><FormReautenticar /></Card>;
  const { id } = await params;
  const c = await obterCliente(id).catch((e) => {
    if (e instanceof ErroApi && e.status === 404) notFound();
    throw e;
  });
  const usuarios = await usuariosDoCliente(c.id);
  const suspenso = c.status === "SUSPENSO";
  return (
    <>
      <CabecalhoPagina
        titulo={c.nome}
        subtitulo={<><Link href="/plataforma" className="underline">Clientes</Link> · {c.sigla} · criado em {fmtData(c.created_at)}</>}
        acoes={suspenso ? <Badge cor="vermelho">Suspenso</Badge> : <Badge cor="verde">Ativo</Badge>}
      />
      {suspenso && <div className="mb-4"><Aviso tipo="erro">Suspenso em {fmtDataHora(c.suspensa_em)}{c.suspensa_motivo ? ` – motivo: ${c.suspensa_motivo}` : ""}. Ninguém do cliente acessa; portais públicos fora do ar.</Aviso></div>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card titulo="Resumo (somente contagens)">
          <dl className="grid grid-cols-2 gap-3 text-sm" data-testid="contagens">
            <div><dt className="text-slate-500">Módulos</dt><dd className="flex flex-wrap gap-1">{c.modulos.map((m) => <Badge key={m} cor="azul">{ROTULO_MODULO[m as Modulo]}</Badge>)}</dd></div>
            <div><dt className="text-slate-500">Usuários</dt><dd>{c.contagens.usuarios}</dd></div>
            <div><dt className="text-slate-500">Órgãos/municípios</dt><dd>{c.contagens.municipios}</dd></div>
            <div><dt className="text-slate-500">Processos</dt><dd>{c.contagens.processos}</dd></div>
            <div><dt className="text-slate-500">Documentos (GED)</dt><dd>{c.contagens.documentos_ged}</dd></div>
            <div><dt className="text-slate-500">Endereço público</dt><dd>{c.slug_publico ?? "—"}</dd></div>
          </dl>
        </Card>
        <Card titulo="Dados do cliente"><FormEditarCliente id={c.id} nome={c.nome} cnpj={c.cnpj} slug={c.slug_publico} /></Card>
        <Card titulo="Módulos"><FormModulos id={c.id} modulos={c.modulos} /></Card>
        <Card titulo="Órgãos/municípios">
          {c.municipios.length > 0 && (
            <ul className="mb-4 divide-y divide-slate-100 text-sm" data-testid="lista-municipios">
              {c.municipios.map((m) => <li key={m.id} className="flex justify-between py-1"><span>{m.nome} <span className="text-xs text-slate-500">({m.sigla})</span></span><span className="text-xs text-slate-500">IBGE {m.codigo_ibge}</span></li>)}
            </ul>
          )}
          {c.modulos.includes("LICENCIAMENTO") ? <FormMunicipio id={c.id} /> : <p className="text-sm text-slate-500">Ative o módulo de licenciamento para cadastrar órgãos.</p>}
        </Card>
      </div>
      <div className="mt-6 space-y-6">
        <Card titulo="Usuários do cliente">
          <div className="overflow-x-auto">
            <table className="tabela" data-testid="tabela-usuarios">
              <thead><tr><th>Usuário</th><th>Papéis</th><th>Último acesso</th><th>Situação</th><th /></tr></thead>
              <tbody>
                {usuarios.map((u) => {
                  const admin = u.papeis.some((p) => p.papel === "ADMIN") || u.ged_membros.some((g) => g.papel === "GED_ADMIN" && g.ativo);
                  return (
                    <tr key={u.id}>
                      <td><div className="font-medium">{u.nome}</div><div className="text-xs text-slate-500">{u.email}</div></td>
                      <td className="text-xs">{[...u.papeis.map((p) => ROTULO_PAPEL[p.papel] + (p.municipio ? ` (${p.municipio.sigla})` : "")), ...u.ged_membros.map((g) => `GED: ${g.papel}`)].join("; ") || "—"}</td>
                      <td>{u.ultimo_login ? fmtDataHora(u.ultimo_login) : "nunca"}</td>
                      <td>{!u.ativo ? <Badge cor="vermelho">Inativo</Badge> : u.trocar_senha ? <Badge cor="amarelo">Troca de senha pendente</Badge> : <Badge cor="verde">Ativo</Badge>}</td>
                      <td className="min-w-64">{admin && u.ativo ? <FormRedefinirSenha id={c.id} usuarioId={u.id} email={u.email} /> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-500">Senhas existentes nunca são exibidas. A redefinição gera uma senha temporária (e/ou convite) mostrada uma única vez.</p>
        </Card>
        <Card titulo={suspenso ? "Reativar cliente" : "Suspender cliente"}>
          {suspenso ? <FormReativar id={c.id} sigla={c.sigla} /> : <FormSuspender id={c.id} sigla={c.sigla} />}
        </Card>
      </div>
    </>
  );
}
