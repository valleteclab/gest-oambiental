import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { usuarioAdminPagina } from "@/lib/admin/guard";
import { VARIAVEIS_MODELO } from "@/lib/documentos/modelo";
import { AcessoNegado } from "@/components/acesso-negado";
import { Badge, CabecalhoPagina, Card } from "@/components/ui";
import { FormAdmin } from "../../_comp/form-admin";
import { AreaTexto, Marcador, Selecao, Texto } from "../../_comp/campos";
import { salvarNovaVersao } from "../actions";

export const metadata = { title: "Modelo de documento – Administração" };

const TIPOS = ["LICENCA", "AUTORIZACAO", "CERTIDAO", "AUTO_INFRACAO", "NOTIFICACAO", "PARECER", "OFICIO", "RECIBO"].map((t) => ({ valor: t, rotulo: t }));
const EXEMPLO = `<h1>{{titulo}} nº {{numero}}</h1>
<p>O {{municipio.orgao}} concede a <strong>{{titular.nome}}</strong> ({{titular.documento}}) a presente licença para o empreendimento
<strong>{{empreendimento.nome}}</strong>, tipologia {{empreendimento.tipologia}}, porte {{empreendimento.porte}}.</p>
<p>Processo {{processo.numero}} · Validade: {{validade}}</p>
<h2>Condicionantes</h2>
{{{condicionantes_html}}}`;

export default async function Modelo({ params }: { params: Promise<{ id: string }> }) {
  const { ok } = await usuarioAdminPagina();
  if (!ok) return <AcessoNegado />;
  const { id } = await params;
  const novo = id === "novo";
  const m = novo ? null : await prisma.modeloDocumento.findUnique({ where: { id } }).catch(() => null);
  if (!novo && !m) notFound();
  return (
    <>
      <CabecalhoPagina
        titulo={m ? `${m.nome} (v${m.versao})` : "Novo modelo de documento"}
        subtitulo={<><Link href="/admin/modelos" className="underline">Modelos</Link>{m && <> · {m.tipo} {m.ativo ? <Badge cor="verde">Ativo</Badge> : <Badge>Inativo</Badge>}</>}</>}
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <Card titulo={m ? "Editar como nova versão" : "Conteúdo"}>
          <FormAdmin action={salvarNovaVersao} botao="Salvar nova versão">
            {m && <input type="hidden" name="origem_id" value={m.id} />}
            {m && <input type="hidden" name="tipo" value={m.tipo} />}
            <div className="grid gap-3 sm:grid-cols-3">
              {!m && <Selecao name="tipo" label="Tipo de documento" required opcoes={TIPOS} />}
              <Texto className={m ? "sm:col-span-3" : "sm:col-span-2"} name="nome" label="Nome" required defaultValue={m?.nome ?? ""} />
            </div>
            <AreaTexto name="html" label="HTML do modelo" required rows={22} className="font-mono text-xs" defaultValue={m?.html ?? EXEMPLO} spellCheck={false} />
            <Marcador name="ativar" label="Ativar esta versão (desativa as demais do mesmo tipo)" defaultChecked />
            <p className="text-xs text-slate-500">Versões anteriores nunca são alteradas – documentos já emitidos guardam seu próprio PDF.</p>
          </FormAdmin>
          {m && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-medium">Pré-visualizar HTML (sem dados)</summary>
              <iframe title="Pré-visualização do modelo" sandbox="" srcDoc={m.html} className="mt-2 h-96 w-full rounded border border-slate-200 bg-white" />
            </details>
          )}
        </Card>
        <Card titulo="Variáveis disponíveis">
          <p className="mb-2 text-xs text-slate-600">Use <code>{"{{variavel}}"}</code> (texto escapado) ou <code>{"{{{variavel_html}}}"}</code> (HTML). Fragmentos (sem &lt;html&gt;) recebem automaticamente cabeçalho institucional, brasão, QR Code e rodapé de autenticidade.</p>
          <dl className="space-y-2 text-xs">
            {VARIAVEIS_MODELO.map(([v, d]) => (
              <div key={v}><dt className="font-mono text-primaria-700">{v.startsWith("{") ? v : v.split(" / ").map((x) => `{{${x}}}`).join(" ")}</dt><dd className="text-slate-600">{d}</dd></div>
            ))}
          </dl>
        </Card>
      </div>
    </>
  );
}
