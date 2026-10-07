import { forbidden } from "next/navigation";
import { CabecalhoPagina, Card } from "@/components/ui";
import { FormGed } from "@/components/ged/form-ged";
import { PontoCor } from "@/components/ged/seletor-marcadores";
import { exigirGed } from "@/lib/ged/escopo";
import { COR_MARCADOR_PADRAO, listarMarcadoresAdmin } from "@/lib/ged/marcadores";
import { podeGed } from "@/lib/ged/papeis";
import { atualizarMarcadorAction, criarMarcadorAction, excluirMarcadorAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Marcadores – Gestão de Documentos" };

export default async function PaginaMarcadores() {
  const ctx = await exigirGed();
  if (!podeGed(ctx, "marcadores")) forbidden();
  const marcadores = await listarMarcadoresAdmin(ctx);
  return (
    <>
      <CabecalhoPagina titulo="Marcadores" subtitulo="Etiquetas coloridas para classificar documentos. Quem pode editar um documento aplica e remove marcadores nele." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card titulo="Novo marcador" className="self-start">
          <FormGed action={criarMarcadorAction} botao="Criar marcador" limparAoSalvar rotuloAcessivel="Novo marcador">
            <div><label className="label" htmlFor="m-nome">Nome</label><input id="m-nome" name="nome" className="input" required maxLength={60} /></div>
            <div><label className="label" htmlFor="m-cor">Cor</label><input id="m-cor" name="cor" type="color" defaultValue={COR_MARCADOR_PADRAO} className="h-10 w-20 cursor-pointer rounded-md border border-slate-300 bg-white p-1" /></div>
          </FormGed>
        </Card>
        <div className="space-y-3 lg:col-span-2">
          {marcadores.length === 0 && <Card><p className="text-sm text-slate-600">Nenhum marcador cadastrado.</p></Card>}
          {marcadores.map((m) => (
            <Card key={m.id} titulo={<span className="flex items-center gap-2"><PontoCor cor={m.cor} />{m.nome}</span>} acoes={<span className="text-xs text-slate-500">{m.usos} documento(s)</span>}>
              <FormGed action={atualizarMarcadorAction} botao="Salvar" classeBotao="btn-secundario" inline rotuloAcessivel={`Editar marcador ${m.nome}`}>
                <input type="hidden" name="id" value={m.id} />
                <div><label className="label" htmlFor={`n-${m.id}`}>Nome</label><input id={`n-${m.id}`} name="nome" className="input" defaultValue={m.nome} required maxLength={60} /></div>
                <div><label className="label" htmlFor={`c-${m.id}`}>Cor</label><input id={`c-${m.id}`} name="cor" type="color" defaultValue={m.cor} className="h-10 w-20 cursor-pointer rounded-md border border-slate-300 bg-white p-1" /></div>
              </FormGed>
              <div className="mt-3">
                <FormGed action={excluirMarcadorAction} botao="Excluir marcador" classeBotao="btn-perigo" inline confirmar={`Excluir "${m.nome}"? Ele será removido de ${m.usos} documento(s).`} rotuloAcessivel={`Excluir marcador ${m.nome}`}>
                  <input type="hidden" name="id" value={m.id} />
                </FormGed>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}
