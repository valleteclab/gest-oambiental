"use client";
// Editor de texto do GED (TipTap). Carregado só no cliente (ver editor-carregador.tsx).
// Acessibilidade: barra com role="toolbar", botões com aria-label/aria-pressed/title (inclui atalho), foco visível,
// área editável com role="textbox" aria-multiline e rótulo. Atalhos do TipTap: Ctrl+B/I/U, Ctrl+Z/Y, Ctrl+Shift+7/8 (listas) etc.
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { Aviso } from "@/components/ui";
import { finalizarAction, salvarRascunhoAction } from "@/app/(ged)/ged/editor/actions";

const ATRASO_AUTOSAVE_MS = 1500;
type SituacaoSalvo = "salvo" | "pendente" | "salvando" | "erro" | "conflito";

const hora = (d: Date) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "America/Bahia" });

function Botao({ rotulo, atalho, ativo, desabilitado, onClick, children }: { rotulo: string; atalho?: string; ativo?: boolean; desabilitado?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      aria-pressed={ativo === undefined ? undefined : ativo}
      title={atalho ? `${rotulo} (${atalho})` : rotulo}
      disabled={desabilitado}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={clsx(
        "inline-flex h-9 min-w-9 items-center justify-center rounded border px-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primaria-600 disabled:opacity-40",
        ativo ? "border-primaria-600 bg-primaria-100 text-primaria-800" : "border-slate-300 bg-white text-slate-800 hover:bg-slate-100",
      )}
    >
      {children}
    </button>
  );
}

const Grupo = ({ rotulo, children }: { rotulo: string; children: React.ReactNode }) => (
  <div role="group" aria-label={rotulo} className="flex flex-wrap gap-1">{children}</div>
);

export default function EditorTexto({ documentoId, htmlInicial, atualizadoEm }: { documentoId: string; htmlInicial: string; atualizadoEm: string | null }) {
  const [situacao, setSituacao] = useState<SituacaoSalvo>("salvo");
  const [salvoEm, setSalvoEm] = useState<Date | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [finalizando, setFinalizando] = useState(false);
  const [painelLink, setPainelLink] = useState(false);
  const [url, setUrl] = useState("https://");
  const baseEm = useRef<string | null>(atualizadoEm);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emVoo = useRef(false);
  const sujo = useRef(false);

  const editor = useEditor({
    immediatelyRender: true, // componente só no cliente (dynamic ssr:false)
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" } } }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: htmlInicial,
    editorProps: { attributes: { class: "ged-prosemirror", role: "textbox", "aria-multiline": "true", "aria-label": "Conteúdo do documento", spellcheck: "true", lang: "pt-BR" } },
    onUpdate: () => {
      sujo.current = true;
      setSituacao("pendente");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void salvar(), ATRASO_AUTOSAVE_MS);
    },
  });

  const salvar = useCallback(
    async (forcar = false): Promise<boolean> => {
      if (!editor) return false;
      if (emVoo.current) {
        // reprograma: há um salvamento em andamento
        timer.current = setTimeout(() => void salvar(forcar), 400);
        return false;
      }
      emVoo.current = true;
      setSituacao("salvando");
      const html = editor.getHTML();
      sujo.current = false;
      try {
        const r = await salvarRascunhoAction({ documento_id: documentoId, html, base_em: baseEm.current, forcar });
        if (r.ok) {
          baseEm.current = r.atualizado_em;
          setSalvoEm(new Date());
          setErro(null);
          setSituacao(sujo.current ? "pendente" : "salvo");
          return true;
        }
        if ("conflito" in r) {
          sujo.current = true;
          setSituacao("conflito");
          return false;
        }
        sujo.current = true;
        setErro(r.erro);
        setSituacao("erro");
        return false;
      } catch {
        sujo.current = true;
        setErro("Sem conexão com o servidor. Tentaremos novamente.");
        setSituacao("erro");
        timer.current = setTimeout(() => void salvar(), 5000);
        return false;
      } finally {
        emVoo.current = false;
      }
    },
    [editor, documentoId],
  );

  useEffect(() => {
    const aviso = (e: BeforeUnloadEvent) => {
      if (sujo.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", aviso);
    return () => {
      window.removeEventListener("beforeunload", aviso);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const estadoBruto = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            negrito: e.isActive("bold"), italico: e.isActive("italic"), sublinhado: e.isActive("underline"), tachado: e.isActive("strike"),
            lista: e.isActive("bulletList"), listaNum: e.isActive("orderedList"), citacao: e.isActive("blockquote"), link: e.isActive("link"),
            h1: e.isActive("heading", { level: 1 }), h2: e.isActive("heading", { level: 2 }), h3: e.isActive("heading", { level: 3 }),
            esq: e.isActive({ textAlign: "left" }), cen: e.isActive({ textAlign: "center" }), dir: e.isActive({ textAlign: "right" }), jus: e.isActive({ textAlign: "justify" }),
            tabela: e.isActive("table"), desfazer: e.can().undo(), refazer: e.can().redo(),
          }
        : null,
  });

  const estado = estadoBruto ?? ESTADO_INICIAL;

  async function finalizar() {
    if (!editor || finalizando) return;
    if (!window.confirm("Finalizar o documento? Será gerado o PDF e uma nova versão. Você poderá editar depois (isso cria outra versão).")) return;
    setFinalizando(true);
    setErro(null);
    if (timer.current) clearTimeout(timer.current);
    const r = await finalizarAction({ documento_id: documentoId, html: editor.getHTML() });
    sujo.current = false;
    if (r?.erro) {
      setErro(r.erro);
      setFinalizando(false);
    }
  }

  if (!editor) return <div className="card p-6 text-sm text-slate-600" role="status">Carregando o editor…</div>;
  const c = () => editor.chain().focus();
  const rotuloSituacao = {
    salvo: salvoEm ? `Rascunho salvo às ${hora(salvoEm)}` : "Rascunho salvo",
    pendente: "Alterações ainda não salvas…",
    salvando: "Salvando…",
    erro: "Não foi possível salvar",
    conflito: "Conflito de edição",
  }[situacao];

  return (
    <div className="space-y-3">
      <style>{CSS_EDITOR}</style>
      <div role="toolbar" aria-label="Formatação do texto" aria-controls="ged-editor-area" className="sm:sticky sm:top-0 sm:z-10 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
        <Grupo rotulo="Histórico">
          <Botao rotulo="Desfazer" atalho="Ctrl+Z" desabilitado={!estado.desfazer} onClick={() => c().undo().run()}>↶</Botao>
          <Botao rotulo="Refazer" atalho="Ctrl+Y" desabilitado={!estado.refazer} onClick={() => c().redo().run()}>↷</Botao>
        </Grupo>
        <Grupo rotulo="Parágrafo e títulos">
          <label className="sr-only" htmlFor="ged-estilo">Estilo do parágrafo</label>
          <select
            id="ged-estilo"
            className="h-9 rounded border border-slate-300 bg-white px-2 text-sm"
            value={estado.h1 ? "1" : estado.h2 ? "2" : estado.h3 ? "3" : "0"}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "0") c().setParagraph().run();
              else c().toggleHeading({ level: Number(v) as 1 | 2 | 3 }).run();
            }}
          >
            <option value="0">Parágrafo</option>
            <option value="1">Título 1</option>
            <option value="2">Título 2</option>
            <option value="3">Título 3</option>
          </select>
        </Grupo>
        <Grupo rotulo="Texto">
          <Botao rotulo="Negrito" atalho="Ctrl+B" ativo={estado.negrito} onClick={() => c().toggleBold().run()}><b>N</b></Botao>
          <Botao rotulo="Itálico" atalho="Ctrl+I" ativo={estado.italico} onClick={() => c().toggleItalic().run()}><i>I</i></Botao>
          <Botao rotulo="Sublinhado" atalho="Ctrl+U" ativo={estado.sublinhado} onClick={() => c().toggleUnderline().run()}><u>S</u></Botao>
          <Botao rotulo="Tachado" atalho="Ctrl+Shift+S" ativo={estado.tachado} onClick={() => c().toggleStrike().run()}><s>T</s></Botao>
        </Grupo>
        <Grupo rotulo="Listas e citação">
          <Botao rotulo="Lista com marcadores" atalho="Ctrl+Shift+8" ativo={estado.lista} onClick={() => c().toggleBulletList().run()}>• Lista</Botao>
          <Botao rotulo="Lista numerada" atalho="Ctrl+Shift+7" ativo={estado.listaNum} onClick={() => c().toggleOrderedList().run()}>1. Lista</Botao>
          <Botao rotulo="Citação" ativo={estado.citacao} onClick={() => c().toggleBlockquote().run()}>“ ”</Botao>
        </Grupo>
        <Grupo rotulo="Alinhamento">
          <Botao rotulo="Alinhar à esquerda" atalho="Ctrl+Shift+L" ativo={estado.esq} onClick={() => c().setTextAlign("left").run()}>⇤</Botao>
          <Botao rotulo="Centralizar" atalho="Ctrl+Shift+E" ativo={estado.cen} onClick={() => c().setTextAlign("center").run()}>↔</Botao>
          <Botao rotulo="Alinhar à direita" atalho="Ctrl+Shift+R" ativo={estado.dir} onClick={() => c().setTextAlign("right").run()}>⇥</Botao>
          <Botao rotulo="Justificar" atalho="Ctrl+Shift+J" ativo={estado.jus} onClick={() => c().setTextAlign("justify").run()}>☰</Botao>
        </Grupo>
        <Grupo rotulo="Link">
          <Botao rotulo="Inserir ou editar link" ativo={estado.link} onClick={() => { setUrl(editor.getAttributes("link").href ?? "https://"); setPainelLink((v) => !v); }}>🔗 Link</Botao>
          {estado.link && <Botao rotulo="Remover link" onClick={() => c().unsetLink().run()}>Sem link</Botao>}
        </Grupo>
        <Grupo rotulo="Tabela">
          <Botao rotulo="Inserir tabela 3 por 3" onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>▦ Tabela</Botao>
          {estado.tabela && (
            <>
              <Botao rotulo="Adicionar linha abaixo" onClick={() => c().addRowAfter().run()}>+ Linha</Botao>
              <Botao rotulo="Adicionar coluna à direita" onClick={() => c().addColumnAfter().run()}>+ Coluna</Botao>
              <Botao rotulo="Excluir linha" onClick={() => c().deleteRow().run()}>− Linha</Botao>
              <Botao rotulo="Excluir coluna" onClick={() => c().deleteColumn().run()}>− Coluna</Botao>
              <Botao rotulo="Excluir tabela" onClick={() => c().deleteTable().run()}>Excluir tabela</Botao>
            </>
          )}
        </Grupo>
      </div>

      {painelLink && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const v = url.trim();
            if (!/^(https?:\/\/|mailto:)/i.test(v)) { setErro("O link deve começar com http://, https:// ou mailto:."); return; }
            setErro(null);
            editor.chain().focus().extendMarkRange("link").setLink({ href: v }).run();
            setPainelLink(false);
          }}
        >
          <label className="min-w-0 flex-1 basis-60">
            <span className="label">Endereço do link</span>
            <input className="input" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>
          <button className="btn-primario btn-sm">Aplicar</button>
          <button type="button" className="btn-secundario btn-sm" onClick={() => setPainelLink(false)}>Cancelar</button>
        </form>
      )}

      <div id="ged-editor-area" className="ged-folha rounded-lg border border-slate-300 bg-white shadow-sm">
        <EditorContent editor={editor} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className={clsx("text-sm", situacao === "erro" || situacao === "conflito" ? "text-red-700" : "text-slate-600")} role="status" aria-live="polite" data-testid="estado-autosave">
          {rotuloSituacao}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secundario" onClick={() => void salvar()} disabled={situacao === "salvando" || finalizando}>Salvar agora</button>
          <button type="button" className="btn-primario" onClick={finalizar} disabled={finalizando} data-testid="finalizar">{finalizando ? "Gerando PDF…" : "Finalizar e gerar PDF"}</button>
        </div>
      </div>

      {situacao === "conflito" && (
        <Aviso tipo="alerta">
          Este rascunho foi alterado em outra janela ou por outra pessoa depois do seu último salvamento.{" "}
          <button type="button" className="font-medium underline" onClick={() => void salvar(true)}>Sobrescrever com o meu texto</button>
          {" · "}
          <button type="button" className="font-medium underline" onClick={() => window.location.reload()}>Recarregar a versão salva</button>
        </Aviso>
      )}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
    </div>
  );
}

const ESTADO_INICIAL = {
  negrito: false, italico: false, sublinhado: false, tachado: false, lista: false, listaNum: false, citacao: false, link: false,
  h1: false, h2: false, h3: false, esq: false, cen: false, dir: false, jus: false, tabela: false, desfazer: false, refazer: false,
};

const CSS_EDITOR = `
.ged-folha .ged-prosemirror { min-height: 50vh; padding: 16px; outline: none; font-size: 16px; line-height: 1.55; overflow-wrap: anywhere; }
.ged-folha .ged-prosemirror:focus-visible { box-shadow: inset 0 0 0 2px #047857; border-radius: 8px; }
.ged-folha .ged-prosemirror > * + * { margin-top: .6em; }
.ged-folha h1 { font-size: 1.6em; font-weight: 700; } .ged-folha h2 { font-size: 1.35em; font-weight: 700; } .ged-folha h3 { font-size: 1.15em; font-weight: 700; }
.ged-folha ul { list-style: disc; padding-left: 1.5em; } .ged-folha ol { list-style: decimal; padding-left: 1.5em; }
.ged-folha blockquote { border-left: 3px solid #94a3b8; padding-left: .8em; color: #334155; }
.ged-folha a { color: #0f4c81; text-decoration: underline; }
.ged-folha pre { background: #f1f5f9; padding: .5em; border-radius: 4px; white-space: pre-wrap; }
.ged-folha .tableWrapper { overflow-x: auto; max-width: 100%; }
.ged-folha table { border-collapse: collapse; width: 100%; table-layout: fixed; }
.ged-folha th, .ged-folha td { border: 1px solid #64748b; padding: 4px 6px; vertical-align: top; min-width: 3em; position: relative; }
.ged-folha th { background: #e2e8f0; font-weight: 700; text-align: left; }
.ged-folha .selectedCell:after { content: ""; position: absolute; inset: 0; background: rgba(4,120,87,.18); pointer-events: none; }
`;
