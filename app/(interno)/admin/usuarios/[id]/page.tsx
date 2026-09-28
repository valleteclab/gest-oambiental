import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { usuarioAdminPagina } from "@/lib/admin/guard";
import { obterUsuarioAdmin, PAPEIS } from "@/lib/admin/usuarios";
import { whereMunicipiosAdmin } from "@/lib/admin/escopo";
import { ROTULO_PAPEL } from "@/lib/rbac";
import { fmtDataHora } from "@/lib/format";
import { AcessoNegado } from "@/components/acesso-negado";
import { Badge, CabecalhoPagina, Card, Vazio } from "@/components/ui";
import { FormAdmin } from "../../_comp/form-admin";
import { Selecao, Texto } from "../../_comp/campos";
import { acaoAdicionarPapel, acaoAtivacao, acaoEditarUsuario, acaoRedefinirSenha, acaoRemoverPapel } from "../actions";

export const metadata = { title: "Usuário – Administração" };

export default async function Usuario({ params }: { params: Promise<{ id: string }> }) {
  const { u: admin, ok } = await usuarioAdminPagina();
  if (!ok) return <AcessoNegado />;
  const { id } = await params;
  const u = await obterUsuarioAdmin(admin, id);
  if (!u) notFound();
  const [municipios, logs] = await Promise.all([
    prisma.municipio.findMany({ where: whereMunicipiosAdmin(admin), orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
    prisma.logAuditoria.findMany({ where: { entidade: "usuario", entidade_id: id }, orderBy: { created_at: "desc" }, take: 10 }),
  ]);
  return (
    <>
      <CabecalhoPagina
        titulo={u.nome}
        subtitulo={<><Link href="/admin/usuarios" className="underline">Usuários</Link> · {u.email} {u.ativo ? <Badge cor="verde">Ativo</Badge> : <Badge cor="vermelho">Inativo</Badge>} {u.bloqueado_ate && u.bloqueado_ate > new Date() && <Badge cor="amarelo">Bloqueado até {fmtDataHora(u.bloqueado_ate)}</Badge>}</>}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card titulo="Dados">
          <FormAdmin action={acaoEditarUsuario}>
            <input type="hidden" name="id" value={u.id} />
            <Texto name="nome" label="Nome" required defaultValue={u.nome} />
            <Texto name="email" type="email" label="E-mail (login)" required defaultValue={u.email} />
            <Texto name="cargo" label="Cargo" defaultValue={u.cargo ?? ""} />
          </FormAdmin>
          <p className="mt-3 text-xs text-slate-500">Criado em {fmtDataHora(u.created_at)} · último acesso {fmtDataHora(u.ultimo_login)}{u.pessoa_id && <> · <Link className="underline" href={`/pessoas/${u.pessoa_id}`}>cadastro de pessoa vinculado</Link></>}</p>
        </Card>
        <Card titulo="Acesso">
          <div className="space-y-4">
            <FormAdmin action={acaoRedefinirSenha} botao="Redefinir senha" classeBotao="btn-secundario" confirmar="Gerar nova senha temporária para este usuário?">
              <input type="hidden" name="id" value={u.id} />
              <p className="text-sm text-slate-600">Gera uma senha temporária, desbloqueia a conta e exige troca no próximo acesso.</p>
            </FormAdmin>
            {u.id !== admin.id && (
              <FormAdmin action={acaoAtivacao} botao={u.ativo ? "Desativar usuário" : "Reativar usuário"} classeBotao={u.ativo ? "btn-perigo" : "btn-primario"} confirmar={u.ativo ? "Desativar este usuário? Ele não poderá mais entrar (o histórico é mantido)." : undefined}>
                <input type="hidden" name="id" value={u.id} />
                <input type="hidden" name="ativo" value={u.ativo ? "0" : "1"} />
                <p className="text-sm text-slate-600">Usuários nunca são excluídos – apenas desativados, preservando o histórico.</p>
              </FormAdmin>
            )}
          </div>
        </Card>
        <Card titulo="Papéis e municípios" className="lg:col-span-2">
          {u.papeis.length === 0 ? <Vazio>Sem papéis – o usuário não acessa nenhuma área.</Vazio> : (
            <ul className="mb-4 divide-y divide-slate-100">
              {u.papeis.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span><strong>{ROTULO_PAPEL[p.papel]}</strong> · {p.municipio ? p.municipio.nome : "toda a organização"}</span>
                  <FormAdmin action={acaoRemoverPapel} botao="Remover" classeBotao="btn-secundario" inline confirmar={`Remover o papel ${ROTULO_PAPEL[p.papel]}?`} rotuloAcessivel={`Remover papel ${ROTULO_PAPEL[p.papel]}`}>
                    <input type="hidden" name="id" value={u.id} />
                    <input type="hidden" name="papel_id" value={p.id} />
                  </FormAdmin>
                </li>
              ))}
            </ul>
          )}
          <FormAdmin action={acaoAdicionarPapel} botao="Adicionar papel" inline rotuloAcessivel="Adicionar papel">
            <input type="hidden" name="id" value={u.id} />
            <Selecao name="papel" label="Papel" required opcoes={PAPEIS.map((p) => ({ valor: p, rotulo: ROTULO_PAPEL[p] }))} />
            <Selecao name="municipio_id" label="Município" vazio="(organização)" opcoes={municipios.map((m) => ({ valor: m.id, rotulo: m.nome }))} />
          </FormAdmin>
        </Card>
        <Card titulo="Últimas alterações" className="lg:col-span-2" acoes={<Link href={`/admin/auditoria?entidade=usuario&entidade_id=${u.id}`} className="btn-secundario btn-sm">Ver log completo</Link>}>
          {logs.length === 0 ? <Vazio>Sem registros.</Vazio> : (
            <ul className="text-sm">{logs.map((l) => <li key={l.id}>{fmtDataHora(l.created_at)} – {l.acao}</li>)}</ul>
          )}
        </Card>
      </div>
    </>
  );
}
