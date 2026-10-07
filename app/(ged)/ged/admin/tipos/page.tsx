import { forbidden } from "next/navigation";
import { CabecalhoPagina, Card } from "@/components/ui";
import { FormGed } from "@/components/ged/form-ged";
import { exigirGed } from "@/lib/ged/escopo";
import { podeGed } from "@/lib/ged/papeis";
import { listarTiposDocumentoAdmin } from "@/lib/ged/tipos-documento";
import { atualizarTipoAction, criarTipoAction, excluirTipoAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tipos de documento – Gestão de Documentos" };

export default async function PaginaTipos() {
  const ctx = await exigirGed();
  if (!podeGed(ctx, "tipos")) forbidden();
  const tipos = await listarTiposDocumentoAdmin(ctx);
  return (
    <>
      <CabecalhoPagina titulo="Tipos de documento" subtitulo="Classificação usada no envio e nos filtros (ofício, contrato, parecer…)." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card titulo="Novo tipo" className="self-start">
          <FormGed action={criarTipoAction} botao="Criar tipo" limparAoSalvar rotuloAcessivel="Novo tipo de documento">
            <div><label className="label" htmlFor="t-nome">Nome</label><input id="t-nome" name="nome" className="input" required minLength={2} maxLength={80} /></div>
          </FormGed>
        </Card>
        <div className="space-y-3 lg:col-span-2">
          {tipos.length === 0 && <Card><p className="text-sm text-slate-600">Nenhum tipo cadastrado.</p></Card>}
          {tipos.map((t) => (
            <Card key={t.id} titulo={t.nome} acoes={<span className="text-xs text-slate-500">{t.usos} documento(s)</span>}>
              <FormGed action={atualizarTipoAction} botao="Salvar" classeBotao="btn-secundario" inline rotuloAcessivel={`Renomear tipo ${t.nome}`}>
                <input type="hidden" name="id" value={t.id} />
                <div><label className="label" htmlFor={`tn-${t.id}`}>Nome</label><input id={`tn-${t.id}`} name="nome" className="input" defaultValue={t.nome} required minLength={2} maxLength={80} /></div>
              </FormGed>
              {t.usos === 0 && (
                <div className="mt-3">
                  <FormGed action={excluirTipoAction} botao="Excluir tipo" classeBotao="btn-perigo" inline confirmar={`Excluir o tipo "${t.nome}"?`} rotuloAcessivel={`Excluir tipo ${t.nome}`}>
                    <input type="hidden" name="id" value={t.id} />
                  </FormGed>
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}
