"use client";
// Formulário PÚBLICO do protocolo online. Envia multipart para /api/v1/publico/protocolo/{slug}; mostra o número, o código de
// consulta e o link do comprovante. Campo-isca "website" (honeypot) fica fora da tela e fora da ordem de tabulação.
import { useState } from "react";
import { Aviso } from "@/components/ui";

type Assunto = { id: string; nome: string; descricao: string | null };
type Resultado = { numero?: string; codigo_consulta?: string; comprovante_url?: string | null; consulta_url?: string };

const tam = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function mensagemDeErro(j: unknown, status: number): string {
  const o = (j ?? {}) as { message?: string; details?: unknown };
  if (Array.isArray(o.details) && o.details.length) {
    const m = (o.details[0] as { message?: string })?.message;
    if (m) return m;
  }
  if (status === 429) return o.message || "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.";
  if (status === 404) return "Este serviço não está disponível no momento.";
  return o.message || "Não foi possível enviar. Confira os dados e tente novamente.";
}

export function FormPortalProtocolo({ slug, assuntos, limites, textoLgpd }: {
  slug: string;
  assuntos: Assunto[];
  limites: { max_anexos: number; max_mb: number; max_bytes: number };
  textoLgpd: string;
}) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState<Resultado | null>(null);
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [assunto, setAssunto] = useState("");

  function aoEscolherArquivos(l: FileList | null) {
    setErro("");
    const novos = Array.from(l ?? []);
    if (novos.length > limites.max_anexos) { setErro(`Envie no máximo ${limites.max_anexos} arquivo(s).`); setArquivos([]); return; }
    const ruim = novos.find((f) => !/\.pdf$/i.test(f.name) || f.size > limites.max_bytes);
    if (ruim) { setErro(!/\.pdf$/i.test(ruim.name) ? "Envie apenas arquivos PDF." : `Cada arquivo pode ter até ${limites.max_mb} MB.`); setArquivos([]); return; }
    setArquivos(novos);
  }

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando) return;
    setErro("");
    setEnviando(true);
    try {
      const fd = new FormData(e.currentTarget);
      fd.delete("arquivos");
      for (const f of arquivos) fd.append("arquivos", f);
      const r = await fetch(`/api/v1/publico/protocolo/${slug}`, { method: "POST", body: fd });
      const j = await r.json().catch(() => null);
      if (!r.ok) { setErro(mensagemDeErro(j, r.status)); return; }
      setOk(j as Resultado);
    } catch {
      setErro("Falha de conexão. Verifique a internet e tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  if (ok) {
    return (
      <div className="space-y-4" data-testid="protocolo-enviado">
        {ok.numero ? (
          <>
            <Aviso tipo="sucesso">Protocolo recebido. Guarde o número e o código de consulta abaixo.</Aviso>
            <dl className="grid gap-2 text-sm sm:grid-cols-[180px_1fr]">
              <dt className="font-medium text-slate-600">Número do protocolo</dt>
              <dd className="text-lg font-bold" data-testid="numero-protocolo">{ok.numero}</dd>
              <dt className="font-medium text-slate-600">Código de consulta</dt>
              <dd className="font-mono text-lg font-bold" data-testid="codigo-consulta">{ok.codigo_consulta}</dd>
            </dl>
            <div className="flex flex-wrap gap-2">
              {ok.comprovante_url && <a href={ok.comprovante_url} className="btn-primario" data-testid="baixar-comprovante" download>Baixar comprovante (PDF)</a>}
              {ok.consulta_url && <a href={ok.consulta_url} className="btn-secundario" data-testid="ir-consulta">Acompanhar andamento</a>}
            </div>
            {!ok.comprovante_url && <Aviso tipo="alerta">O comprovante ainda está sendo gerado. Use &ldquo;Acompanhar andamento&rdquo; e tente baixá-lo em instantes.</Aviso>}
            <p className="text-sm text-slate-600">Se você informou um e-mail, enviamos a confirmação e vamos avisar quando a situação mudar.</p>
          </>
        ) : (
          <Aviso tipo="sucesso">Solicitação recebida.</Aviso>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="space-y-4" aria-label="Protocolar documentos" data-testid="form-portal" noValidate={false}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="pp-nome">Nome completo *</label>
          <input id="pp-nome" name="nome" className="input" required minLength={3} maxLength={200} autoComplete="name" />
        </div>
        <div>
          <label className="label" htmlFor="pp-doc">CPF ou CNPJ *</label>
          <input id="pp-doc" name="cpf_cnpj" className="input" required inputMode="numeric" maxLength={20} autoComplete="off" />
        </div>
        <div>
          <label className="label" htmlFor="pp-email">E-mail *</label>
          <input id="pp-email" name="email" type="email" className="input" required maxLength={200} autoComplete="email" />
        </div>
        <div>
          <label className="label" htmlFor="pp-tel">Telefone (opcional)</label>
          <input id="pp-tel" name="telefone" className="input" inputMode="tel" maxLength={30} autoComplete="tel" />
        </div>
        <div>
          <label className="label" htmlFor="pp-assunto">Assunto *</label>
          <select id="pp-assunto" name="assunto_id" className="input" required value={assunto} onChange={(e) => setAssunto(e.target.value)}>
            <option value="" disabled>Selecione…</option>
            {assuntos.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
          </select>
          {assunto && assuntos.find((a) => a.id === assunto)?.descricao && <p className="mt-1 text-xs text-slate-500">{assuntos.find((a) => a.id === assunto)?.descricao}</p>}
        </div>
      </div>
      <div>
        <label className="label" htmlFor="pp-desc">Descrição *</label>
        <textarea id="pp-desc" name="descricao" className="input min-h-28" rows={5} required minLength={10} maxLength={5000} />
      </div>
      {limites.max_anexos > 0 && (
        <div>
          <label className="label" htmlFor="pp-arq">Arquivos em PDF (opcional)</label>
          <input id="pp-arq" name="arquivos" type="file" accept="application/pdf,.pdf" multiple className="input" onChange={(e) => aoEscolherArquivos(e.target.files)} />
          <p className="mt-1 text-xs text-slate-500">Até {limites.max_anexos} arquivo(s), {limites.max_mb} MB cada, somente PDF.</p>
          {arquivos.length > 0 && <ul className="mt-1 text-xs text-slate-600">{arquivos.map((f) => <li key={f.name + f.size}>{f.name} ({tam(f.size)})</li>)}</ul>}
        </div>
      )}
      {/* Campo-isca: pessoas não o veem nem o alcançam; robôs costumam preenchê-lo. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", top: "auto", width: 1, height: 1, overflow: "hidden" }}>
        <label htmlFor="pp-website">Não preencha este campo</label>
        <input id="pp-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="aceite_lgpd" value="true" required className="mt-1 accent-emerald-700" data-testid="aceite-lgpd" />
        <span>{textoLgpd}</span>
      </label>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <button className="btn-primario" disabled={enviando} data-testid="enviar-protocolo">{enviando ? "Enviando…" : "Enviar protocolo"}</button>
    </form>
  );
}
