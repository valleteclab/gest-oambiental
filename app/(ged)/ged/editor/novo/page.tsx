import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { Aviso, CabecalhoPagina, Card } from "@/components/ui";
import { FormGed } from "@/components/ged/form-ged";
import { ErroApi } from "@/lib/http";
import { exigirGed } from "@/lib/ged/escopo";
import { podeCriarDocumento } from "@/lib/ged/papeis";
import { exigirPasta } from "@/lib/ged/permissoes";
import { ROTULO_SENSIBILIDADE_GED, SENSIBILIDADES_GED } from "@/lib/ged/tipos";
import { criarDocumentoEditorAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Novo documento no editor" };

export default async function NovoNoEditor({ searchParams }: { searchParams: Promise<{ pasta?: string }> }) {
  const ctx = await exigirGed();
  if (!podeCriarDocumento(ctx)) forbidden();
  const { pasta: pastaId } = await searchParams;
  let pasta: { id: string; caminho_nome: string; sensibilidade_padrao: (typeof SENSIBILIDADES_GED)[number] } | null = null;
  if (pastaId) {
    try {
      await exigirPasta(ctx, pastaId, "EDITAR");
      const p = await ctx.db.gedPasta.findUnique({ where: { id: pastaId }, select: { id: true, caminho_nome: true, sensibilidade_padrao: true } });
      if (!p) notFound();
      pasta = p;
    } catch (e) {
      if (e instanceof ErroApi && e.status === 404) notFound();
      if (e instanceof ErroApi && e.status === 403) forbidden();
      throw e;
    }
  }
  const tipos = await ctx.db.gedTipoDocumento.findMany({ orderBy: { nome: "asc" }, select: { id: true, nome: true } });

  return (
    <>
      <CabecalhoPagina titulo="Novo documento no editor" subtitulo="Informe os dados do documento. Em seguida você escreve o texto; ao finalizar, o sistema gera o PDF com o papel timbrado da organização." />
      <div className="max-w-2xl">
        <Card>
          <FormGed action={criarDocumentoEditorAction} botao="Criar e abrir o editor" rotuloAcessivel="Dados do novo documento">
            {pasta && (
              <>
                <input type="hidden" name="pasta_id" value={pasta.id} />
                <Aviso tipo="info">O documento será criado na pasta <strong>{pasta.caminho_nome}</strong>.</Aviso>
              </>
            )}
            <div>
              <label className="label" htmlFor="titulo">Título *</label>
              <input id="titulo" name="titulo" className="input" required minLength={3} maxLength={200} autoComplete="off" />
            </div>
            <div>
              <label className="label" htmlFor="tipo_id">Tipo de documento</label>
              <select id="tipo_id" name="tipo_id" className="input" defaultValue="">
                <option value="">— não informado —</option>
                {tipos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="remetente">Remetente / origem</label>
                <input id="remetente" name="remetente" className="input" maxLength={200} autoComplete="off" />
              </div>
              <div>
                <label className="label" htmlFor="data_documento">Data do documento</label>
                <input id="data_documento" name="data_documento" type="date" className="input" />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="sensibilidade">Sensibilidade</label>
              <select id="sensibilidade" name="sensibilidade" className="input" defaultValue={pasta?.sensibilidade_padrao ?? "RESTRITO"}>
                {SENSIBILIDADES_GED.map((s) => <option key={s} value={s}>{ROTULO_SENSIBILIDADE_GED[s]}</option>)}
              </select>
            </div>
          </FormGed>
        </Card>
        <p className="mt-3 text-sm"><Link href="/ged/documentos" className="text-primaria-700 hover:underline">Cancelar e voltar aos documentos</Link></p>
      </div>
    </>
  );
}
