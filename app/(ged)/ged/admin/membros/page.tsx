import Link from "next/link";
import { forbidden } from "next/navigation";
import { Badge, CabecalhoPagina, Card } from "@/components/ui";
import { FormGed } from "@/components/ged/form-ged";
import { listarMembros } from "@/lib/ged/admin/membros";
import { exigirGed } from "@/lib/ged/escopo";
import { podeAdministrarGed } from "@/lib/ged/papeis";
import { listarSetores } from "@/lib/ged/setores";
import { PAPEIS_GED, ROTULO_PAPEL_GED } from "@/lib/ged/tipos";
import { fmtDataHora } from "@/lib/format";
import { alterarPapelAction, alternarAtivoAction, criarMembroAction, definirSetoresAction, redefinirSenhaAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Membros – Gestão de Documentos" };

export default async function PaginaMembros() {
  const ctx = await exigirGed();
  if (!podeAdministrarGed(ctx)) forbidden();
  const [membros, setores] = await Promise.all([listarMembros(ctx), listarSetores(ctx)]);

  return (
    <>
      <CabecalhoPagina
        titulo="Membros"
        subtitulo={<><Link href="/ged/admin" prefetch={false} className="underline">Administração</Link> · pessoas com acesso ao módulo, seus papéis e setores</>}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card titulo="Novo membro" className="self-start lg:col-span-1">
          <FormGed action={criarMembroAction} botao="Criar membro" limparAoSalvar rotuloAcessivel="Novo membro">
            <div><label className="label" htmlFor="m-nome">Nome completo</label><input id="m-nome" name="nome" className="input" required minLength={3} maxLength={120} autoComplete="off" /></div>
            <div><label className="label" htmlFor="m-email">E-mail</label><input id="m-email" name="email" type="email" className="input" required maxLength={160} autoComplete="off" /></div>
            <div><label className="label" htmlFor="m-cargo">Cargo (opcional)</label><input id="m-cargo" name="cargo" className="input" maxLength={120} /></div>
            <div>
              <label className="label" htmlFor="m-papel">Papel</label>
              <select id="m-papel" name="papel" className="input" defaultValue="GED_USUARIO" required>
                {PAPEIS_GED.map((p) => <option key={p} value={p}>{ROTULO_PAPEL_GED[p]}</option>)}
              </select>
            </div>
            {setores.length > 0 && (
              <fieldset>
                <legend className="label">Setores (opcional)</legend>
                <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
                  {setores.map((s) => <label key={s.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="setor_id" value={s.id} /> {s.nome} ({s.sigla})</label>)}
                </div>
              </fieldset>
            )}
            <p className="text-xs text-slate-500">Uma senha provisória é gerada e mostrada uma única vez; a pessoa troca no primeiro acesso. O e-mail deve ser único na plataforma.</p>
          </FormGed>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <ul className="space-y-4" data-testid="lista-membros">
            {membros.map((m) => (
              <li key={m.id}>
                <Card
                  titulo={<span className="break-words">{m.nome}{m.cargo ? <span className="text-sm font-normal text-slate-500"> – {m.cargo}</span> : null}</span>}
                  acoes={<span className="flex flex-wrap gap-1"><Badge cor="azul">{ROTULO_PAPEL_GED[m.papel]}</Badge>{m.ativo ? <Badge cor="verde">Ativo</Badge> : <Badge cor="cinza">Inativo</Badge>}</span>}
                >
                  <p className="break-all text-sm text-slate-600">{m.email}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {m.trocar_senha ? "Senha provisória pendente de troca · " : ""}Último acesso: {fmtDataHora(m.ultimo_login)}
                    {m.whatsapp_confirmado ? " · WhatsApp confirmado" : ""}{m.tambem_licenciamento ? " · também usa o licenciamento" : ""}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">Setores: {m.setores.length ? m.setores.map((s) => s.sigla).join(", ") : "nenhum"}</p>
                  <details className="mt-3 border-t border-slate-100 pt-3">
                    <summary className="cursor-pointer text-sm font-medium text-primaria-700">Gerenciar</summary>
                    <div className="mt-3 space-y-4">
                      <FormGed action={alterarPapelAction} botao="Alterar papel" classeBotao="btn-secundario" inline rotuloAcessivel={`Alterar papel de ${m.nome}`}>
                        <input type="hidden" name="id" value={m.id} />
                        <div>
                          <label className="label" htmlFor={`papel-${m.id}`}>Papel</label>
                          <select id={`papel-${m.id}`} name="papel" className="input" defaultValue={m.papel}>
                            {PAPEIS_GED.map((p) => <option key={p} value={p}>{ROTULO_PAPEL_GED[p]}</option>)}
                          </select>
                        </div>
                      </FormGed>
                      {m.ativo && setores.length > 0 && (
                        <FormGed action={definirSetoresAction} botao="Salvar setores" classeBotao="btn-secundario" rotuloAcessivel={`Setores de ${m.nome}`}>
                          <input type="hidden" name="id" value={m.id} />
                          <fieldset>
                            <legend className="label">Setores</legend>
                            <div className="grid gap-1 sm:grid-cols-2">
                              {setores.map((s) => (
                                <label key={s.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="setor_id" value={s.id} defaultChecked={m.setores.some((x) => x.id === s.id)} /> {s.nome} ({s.sigla})</label>
                              ))}
                            </div>
                          </fieldset>
                        </FormGed>
                      )}
                      <div className="flex flex-wrap gap-3">
                        {!m.tambem_licenciamento && m.usuario_id !== ctx.usuario.id && (
                          <FormGed action={redefinirSenhaAction} botao="Redefinir senha" classeBotao="btn-secundario" confirmar={`Gerar nova senha provisória para ${m.nome}? A senha atual deixa de valer.`} rotuloAcessivel={`Redefinir senha de ${m.nome}`}>
                            <input type="hidden" name="id" value={m.id} />
                          </FormGed>
                        )}
                        {m.usuario_id !== ctx.usuario.id && (
                          <FormGed action={alternarAtivoAction} botao={m.ativo ? "Desativar acesso" : "Reativar acesso"} classeBotao={m.ativo ? "btn-perigo" : "btn-secundario"} confirmar={m.ativo ? `Desativar o acesso de ${m.nome} ao módulo?` : undefined} rotuloAcessivel={`Situação de ${m.nome}`}>
                            <input type="hidden" name="id" value={m.id} />
                            <input type="hidden" name="ativo" value={m.ativo ? "false" : "true"} />
                          </FormGed>
                        )}
                      </div>
                    </div>
                  </details>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
