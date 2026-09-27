import Link from "next/link";
import { prisma } from "@/lib/db";
import { usuarioAdminPagina } from "@/lib/admin/guard";
import { AcessoNegado } from "@/components/acesso-negado";
import { CabecalhoPagina, Card, Vazio } from "@/components/ui";
import { FormAdmin } from "../_comp/form-admin";
import { Marcador, Selecao, Texto } from "../_comp/campos";
import { removerDocumentoExigido, salvarDocumentoExigido } from "./actions";

export const metadata = { title: "Documentos exigidos – Administração" };

export default async function DocumentosExigidos({ searchParams }: { searchParams: Promise<{ tipo_ato?: string }> }) {
  const { ok } = await usuarioAdminPagina();
  if (!ok) return <AcessoNegado />;
  const [tipos, tipologias] = await Promise.all([
    prisma.tipoAto.findMany({ orderBy: { sigla: "asc" }, select: { id: true, sigla: true, nome: true } }),
    prisma.tipologia.findMany({ where: { ativo: true }, orderBy: { codigo: "asc" }, select: { id: true, codigo: true, descricao: true } }),
  ]);
  const sp = await searchParams;
  const tipoId = tipos.some((t) => t.id === sp.tipo_ato) ? sp.tipo_ato! : tipos[0]?.id;
  const docs = tipoId ? await prisma.documentoExigido.findMany({ where: { tipo_ato_id: tipoId }, include: { tipologia: { select: { codigo: true } } }, orderBy: [{ tipologia_id: { sort: "asc", nulls: "first" } }, { created_at: "asc" }] }) : [];
  const opTip = tipologias.map((t) => ({ valor: t.id, rotulo: `${t.codigo} – ${t.descricao}` }));
  return (
    <>
      <CabecalhoPagina titulo="Documentos exigidos" subtitulo={<Link href="/admin" className="underline">Administração</Link>} />
      <Card>
        <form className="mb-4 flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="tipo_ato" className="label">Tipo de ato</label>
            <select id="tipo_ato" name="tipo_ato" defaultValue={tipoId} className="input">{tipos.map((t) => <option key={t.id} value={t.id}>{t.sigla} – {t.nome}</option>)}</select>
          </div>
          <button className="btn-secundario">Exibir</button>
        </form>
        {docs.length === 0 ? <Vazio>Nenhum documento configurado para este tipo de ato.</Vazio> : (
          <ul className="divide-y divide-slate-100">
            {docs.map((d) => (
              <li key={d.id} className="flex flex-wrap items-end gap-2 py-3">
                <FormAdmin action={salvarDocumentoExigido} inline botao="Salvar" rotuloAcessivel={`Editar ${d.nome}`}>
                  <input type="hidden" name="id" value={d.id} />
                  <Texto name="nome" label="Documento" defaultValue={d.nome} className="min-w-64 flex-1" />
                  <Texto name="formatos" label="Formatos" defaultValue={d.formatos} className="w-36" />
                  <Selecao name="tipologia_id" label="Só para a tipologia" vazio="(todas)" defaultValue={d.tipologia_id ?? ""} opcoes={opTip} className="w-56" />
                  <Marcador name="obrigatorio" label="Obrigatório" defaultChecked={d.obrigatorio} className="pb-2" />
                </FormAdmin>
                <FormAdmin action={removerDocumentoExigido} inline botao="Remover" classeBotao="btn-secundario" confirmar={`Remover "${d.nome}"?`} rotuloAcessivel={`Remover ${d.nome}`}>
                  <input type="hidden" name="id" value={d.id} />
                </FormAdmin>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {tipoId && (
        <Card titulo="Adicionar documento" className="mt-6">
          <FormAdmin action={salvarDocumentoExigido} botao="Adicionar" limparAoSalvar>
            <input type="hidden" name="tipo_ato_id" value={tipoId} />
            <div className="grid gap-3 sm:grid-cols-4">
              <Texto className="sm:col-span-2" name="nome" label="Documento" required />
              <Texto name="formatos" label="Formatos" defaultValue="pdf" dica="pdf, jpg, png, dwg, kml, kmz, zip" />
              <Selecao name="tipologia_id" label="Só para a tipologia" vazio="(todas)" opcoes={opTip} />
            </div>
            <Marcador name="obrigatorio" label="Obrigatório" defaultChecked />
          </FormAdmin>
        </Card>
      )}
    </>
  );
}
