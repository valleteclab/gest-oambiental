import { AclPainel } from "@/components/ged/acl-painel";
import { acoesConcediveis, listarAcl, opcoesAcl } from "@/lib/ged/acl";
import type { CtxGed } from "@/lib/ged/escopo";
import type { AlvoAcl } from "@/lib/ged/tipos";

/**
 * Carrega (no servidor) as ACLs e as opções e renderiza o <AclPainel/>. Renderiza nada se o usuário não tiver ADMINISTRAR
 * no recurso. `herda`: herda_acl da pasta ou !acl_propria do documento (omita para não mostrar o controle).
 */
export async function AclPainelServidor({ ctx, alvo, caminho, herda }: { ctx: CtxGed; alvo: AlvoAcl; caminho: string; herda?: boolean }) {
  let dados;
  try {
    const [entradas, opcoes, acoesPermitidas] = await Promise.all([listarAcl(ctx, alvo), opcoesAcl(ctx), acoesConcediveis(ctx, alvo)]);
    dados = { entradas, opcoes, acoesPermitidas };
  } catch {
    return null; // sem ADMINISTRAR (404/403): o painel simplesmente não aparece
  }
  return (
    <AclPainel
      alvo={alvo}
      caminho={caminho}
      herda={herda}
      acoesPermitidas={dados.acoesPermitidas}
      usuarios={dados.opcoes.usuarios.map((u) => ({ id: u.id, nome: u.nome, papel: u.papel }))}
      setores={dados.opcoes.setores}
      entradas={dados.entradas.map((e) => ({
        id: e.id,
        principal_tipo: e.principal_tipo,
        principal_nome: e.principal_nome,
        acoes: e.acoes,
        expira_em: e.expira_em ? e.expira_em.toISOString() : null,
        vigente: e.vigente,
        concedido_por_nome: e.concedido_por_nome,
      }))}
    />
  );
}
