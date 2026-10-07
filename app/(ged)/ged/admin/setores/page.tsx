import { forbidden } from "next/navigation";
import { Badge, CabecalhoPagina, Card } from "@/components/ui";
import { FormGed } from "@/components/ged/form-ged";
import { opcoesAcl } from "@/lib/ged/acl";
import { exigirGed } from "@/lib/ged/escopo";
import { podeGerirEstruturaGed } from "@/lib/ged/papeis";
import { listarSetores } from "@/lib/ged/setores";
import { ROTULO_PAPEL_GED } from "@/lib/ged/tipos";
import { adicionarMembroSetorAction, alternarSetorAtivoAction, atualizarSetorAction, criarSetorAction, removerMembroSetorAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Setores – Gestão de Documentos" };

export default async function PaginaSetores() {
  const ctx = await exigirGed();
  if (!podeGerirEstruturaGed(ctx)) forbidden();
  const [setores, { usuarios }] = await Promise.all([listarSetores(ctx, { incluirInativos: true }), opcoesAcl(ctx)]);

  return (
    <>
      <CabecalhoPagina titulo="Setores" subtitulo="Setores agrupam pessoas para permissões e trâmite de documentos." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card titulo="Novo setor" className="lg:col-span-1 self-start">
          <FormGed action={criarSetorAction} botao="Criar setor" limparAoSalvar rotuloAcessivel="Novo setor">
            <div><label className="label" htmlFor="novo-nome">Nome</label><input id="novo-nome" name="nome" className="input" required maxLength={120} /></div>
            <div><label className="label" htmlFor="novo-sigla">Sigla</label><input id="novo-sigla" name="sigla" className="input uppercase" required maxLength={12} /></div>
          </FormGed>
        </Card>
        <div className="space-y-4 lg:col-span-2">
          {setores.length === 0 && <Card><p className="text-sm text-slate-600">Nenhum setor cadastrado.</p></Card>}
          {setores.map((s) => {
            const disponiveis = usuarios.filter((u) => !s.membros.some((m) => m.usuario_id === u.id));
            return (
              <Card
                key={s.id}
                titulo={<span>{s.nome} <span className="text-sm font-normal text-slate-500">({s.sigla})</span></span>}
                acoes={s.ativo ? <Badge cor="verde">Ativo</Badge> : <Badge cor="cinza">Inativo</Badge>}
              >
                <h3 className="mb-2 text-sm font-semibold">Participantes ({s.membros.length})</h3>
                {s.membros.length === 0 ? <p className="mb-3 text-sm text-slate-600">Nenhum participante.</p> : (
                  <ul className="mb-3 divide-y divide-slate-100">
                    {s.membros.map((m) => (
                      <li key={m.usuario_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                        <span>{m.nome}{m.cargo ? <span className="text-slate-500"> – {m.cargo}</span> : null}{m.chefe && <> <Badge cor="azul">Chefe</Badge></>}</span>
                        <FormGed action={removerMembroSetorAction} botao="Remover" classeBotao="btn-secundario" inline confirmar={`Remover ${m.nome} do setor ${s.sigla}?`} rotuloAcessivel={`Remover ${m.nome}`}>
                          <input type="hidden" name="setor_id" value={s.id} />
                          <input type="hidden" name="usuario_id" value={m.usuario_id} />
                        </FormGed>
                      </li>
                    ))}
                  </ul>
                )}
                {disponiveis.length > 0 && (
                  <FormGed action={adicionarMembroSetorAction} botao="Adicionar" classeBotao="btn-secundario" inline rotuloAcessivel={`Adicionar participante ao setor ${s.sigla}`}>
                    <input type="hidden" name="setor_id" value={s.id} />
                    <div>
                      <label className="label" htmlFor={`add-${s.id}`}>Participante</label>
                      <select id={`add-${s.id}`} name="usuario_id" className="input" required defaultValue="">
                        <option value="" disabled>Escolha…</option>
                        {disponiveis.map((u) => <option key={u.id} value={u.id}>{u.nome} ({ROTULO_PAPEL_GED[u.papel]})</option>)}
                      </select>
                    </div>
                    <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="chefe" /> Chefe do setor</label>
                  </FormGed>
                )}
                <details className="mt-4 border-t border-slate-100 pt-3">
                  <summary className="cursor-pointer text-sm font-medium text-primaria-700">Editar setor</summary>
                  <div className="mt-3 space-y-3">
                    <FormGed action={atualizarSetorAction} inline botao="Salvar" rotuloAcessivel={`Editar setor ${s.sigla}`}>
                      <input type="hidden" name="id" value={s.id} />
                      <div><label className="label" htmlFor={`nome-${s.id}`}>Nome</label><input id={`nome-${s.id}`} name="nome" className="input" defaultValue={s.nome} required maxLength={120} /></div>
                      <div><label className="label" htmlFor={`sigla-${s.id}`}>Sigla</label><input id={`sigla-${s.id}`} name="sigla" className="input uppercase" defaultValue={s.sigla} required maxLength={12} /></div>
                    </FormGed>
                    <FormGed action={alternarSetorAtivoAction} botao={s.ativo ? "Desativar setor" : "Reativar setor"} classeBotao={s.ativo ? "btn-perigo" : "btn-secundario"} confirmar={s.ativo ? "Desativar? O setor deixa de conceder permissões." : undefined} rotuloAcessivel="Situação do setor">
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="ativo" value={s.ativo ? "false" : "true"} />
                    </FormGed>
                  </div>
                </details>
              </Card>
            );
          })}
        </div>
      </div>
    </>
  );
}
