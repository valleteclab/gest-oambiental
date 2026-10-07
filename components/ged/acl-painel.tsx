"use client";
import { Badge } from "@/components/ui";
import { FormGed } from "@/components/ged/form-ged";
import { alternarHerancaAction, concederAclAction, revogarAclAction } from "@/app/(ged)/ged/_acoes/acl";
import { DESCRICAO_ACAO_GED, ROTULO_ACAO_GED, ROTULO_PAPEL_GED, type AlvoAcl, type GedAcao, type GedPapel } from "@/lib/ged/tipos";

export type EntradaAclSerial = {
  id: string;
  principal_tipo: "USUARIO" | "SETOR";
  principal_nome: string;
  acoes: GedAcao[];
  expira_em: string | null; // ISO
  vigente: boolean;
  concedido_por_nome: string;
};

const fmt = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

/**
 * Painel de permissões (ACL) de uma pasta ou documento. Preencha com <AclPainelServidor/> (componentes/ged/acl-painel-servidor).
 * `herda`: estado atual da herança (pasta: herda_acl; documento: !acl_propria); omita para esconder o controle.
 * `caminho`: página a revalidar após alterar (ex.: "/ged/documentos/<id>").
 */
export function AclPainel({ alvo, entradas, usuarios, setores, acoesPermitidas, caminho, herda }: {
  alvo: AlvoAcl;
  entradas: EntradaAclSerial[];
  usuarios: { id: string; nome: string; papel: GedPapel }[];
  setores: { id: string; nome: string; sigla: string }[];
  acoesPermitidas: GedAcao[];
  caminho: string;
  herda?: boolean;
}) {
  const rotuloAlvo = alvo.tipo === "pasta" ? "pasta" : "documento";
  return (
    <section aria-label={`Permissões do ${rotuloAlvo}`} className="space-y-4" data-testid="acl-painel">
      {herda !== undefined && (
        <FormGed action={alternarHerancaAction} inline classeBotao="btn-secundario" botao={herda ? "Parar de herdar permissões" : "Voltar a herdar permissões"} rotuloAcessivel="Herança de permissões">
          <input type="hidden" name="alvo_tipo" value={alvo.tipo} />
          <input type="hidden" name="alvo_id" value={alvo.id} />
          <input type="hidden" name="caminho" value={caminho} />
          <input type="hidden" name="herda" value={herda ? "false" : "true"} />
          <p className="basis-full text-sm text-slate-600">
            {herda
              ? alvo.tipo === "pasta" ? "Esta pasta herda as permissões da pasta superior." : "Este documento herda as permissões da sua pasta."
              : alvo.tipo === "pasta" ? "Esta pasta tem permissões próprias (não herda da pasta superior)." : "Este documento tem permissões próprias (não herda da pasta)."}
          </p>
        </FormGed>
      )}

      {entradas.length === 0 ? (
        <p className="text-sm text-slate-600">Nenhuma permissão direta concedida.</p>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="tabela">
            <caption className="sr-only">Permissões concedidas</caption>
            <thead>
              <tr><th scope="col">Quem</th><th scope="col">Ações</th><th scope="col">Validade</th><th scope="col"><span className="sr-only">Remover</span></th></tr>
            </thead>
            <tbody>
              {entradas.map((e) => (
                <tr key={e.id}>
                  <td>
                    <div className="font-medium">{e.principal_nome}</div>
                    <div className="text-xs text-slate-500">{e.principal_tipo === "SETOR" ? "Setor" : "Usuário"} · concedido por {e.concedido_por_nome}</div>
                  </td>
                  <td><div className="flex flex-wrap gap-1">{e.acoes.map((a) => <Badge key={a} cor="azul">{ROTULO_ACAO_GED[a]}</Badge>)}</div></td>
                  <td className="text-sm">{e.expira_em ? (e.vigente ? `até ${fmt(e.expira_em)}` : <Badge cor="vermelho">Expirada em {fmt(e.expira_em)}</Badge>) : "Sem prazo"}</td>
                  <td>
                    <FormGed action={revogarAclAction} botao="Remover" classeBotao="btn-secundario" inline confirmar={`Remover a permissão de ${e.principal_nome}?`} rotuloAcessivel={`Remover permissão de ${e.principal_nome}`}>
                      <input type="hidden" name="acl_id" value={e.id} />
                      <input type="hidden" name="caminho" value={caminho} />
                    </FormGed>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {acoesPermitidas.length > 0 ? (
        <FormGed action={concederAclAction} botao="Conceder permissão" limparAoSalvar rotuloAcessivel="Conceder permissão" className="rounded-md border border-slate-200 p-3">
          <input type="hidden" name="alvo_tipo" value={alvo.tipo} />
          <input type="hidden" name="alvo_id" value={alvo.id} />
          <input type="hidden" name="caminho" value={caminho} />
          <div>
            <label className="label" htmlFor={`acl-principal-${alvo.id}`}>Usuário ou setor</label>
            <select id={`acl-principal-${alvo.id}`} name="principal" className="input" required defaultValue="">
              <option value="" disabled>Escolha…</option>
              <optgroup label="Usuários">{usuarios.map((u) => <option key={u.id} value={`USUARIO:${u.id}`}>{u.nome} ({ROTULO_PAPEL_GED[u.papel]})</option>)}</optgroup>
              {setores.length > 0 && <optgroup label="Setores">{setores.map((s) => <option key={s.id} value={`SETOR:${s.id}`}>{s.nome} ({s.sigla})</option>)}</optgroup>}
            </select>
          </div>
          <fieldset>
            <legend className="label">Ações permitidas</legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {acoesPermitidas.map((a) => (
                <label key={a} className="flex items-start gap-2 text-sm" title={DESCRICAO_ACAO_GED[a]}>
                  <input type="checkbox" name="acoes" value={a} defaultChecked={a === "VER"} className="mt-1" />
                  <span><span className="font-medium">{ROTULO_ACAO_GED[a]}</span><span className="block text-xs text-slate-500">{DESCRICAO_ACAO_GED[a]}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label className="label" htmlFor={`acl-expira-${alvo.id}`}>Válida até (opcional)</label>
            <input id={`acl-expira-${alvo.id}`} name="expira_em" type="date" className="input max-w-[12rem]" />
          </div>
        </FormGed>
      ) : (
        <p className="text-sm text-slate-600">Você não pode conceder permissões neste {rotuloAlvo}.</p>
      )}
    </section>
  );
}
