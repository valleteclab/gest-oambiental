import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import clsx from "clsx";
import { Aviso } from "@/components/ui";
import { fmtDataHoraBrasilia, normalizarCodigoGed } from "@/lib/ged/assinaturas/regras";
import { permitirConsultaPublica, registrarConsultaSemResultado } from "@/lib/ged/assinaturas/limites";
import { verificarComprovantePublico } from "@/lib/ged/protocolo/publico";
import { ipDaRequisicao } from "@/lib/limite-login";
import { ConferirComprovante } from "./conferir-comprovante";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Verificar comprovante de protocolo", robots: { index: false, follow: false }, referrer: "no-referrer" };

// Verificação PÚBLICA do comprovante de protocolo (QR Code). Mostra só número, data, órgão, livro e situação e confere o hash do
// PDF guardado pelo órgão; nunca o assunto, o interessado, os anexos ou qualquer dado pessoal.
export default async function VerificarProtocolo({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo: bruto } = await params;
  const ip = ipDaRequisicao(await headers());
  if (!permitirConsultaPublica(ip)) {
    return (
      <div className="space-y-4">
        <h1 className="titulo-pagina">Verificar comprovante de protocolo</h1>
        <Aviso tipo="alerta">Muitas consultas em pouco tempo. Aguarde alguns minutos e tente novamente.</Aviso>
      </div>
    );
  }
  let texto = bruto;
  try { texto = decodeURIComponent(bruto); } catch { /* mantém */ }
  const codigo = normalizarCodigoGed(texto);
  const v = codigo ? await verificarComprovantePublico(codigo) : null;
  if (!v) {
    registrarConsultaSemResultado(ip);
    return (
      <div className="space-y-4">
        <h1 className="titulo-pagina">Verificar comprovante de protocolo</h1>
        <div className="rounded-lg border-2 border-red-600 bg-red-50 p-5 text-red-900" role="alert">
          <p className="text-2xl font-bold" data-testid="status-verificacao">NÃO ENCONTRADO</p>
          <p className="mt-1 text-sm">Nenhum comprovante foi localizado com este código. Confira a digitação. Comprovante sem registro pode ser falso.</p>
        </div>
      </div>
    );
  }
  const valido = v.situacao === "VALIDO";
  return (
    <div className="space-y-6">
      <h1 className="titulo-pagina">Verificar comprovante de protocolo</h1>
      <div className={clsx("flex items-start gap-4 rounded-lg border-2 p-5", valido ? "border-emerald-600 bg-emerald-50 text-emerald-900" : "border-red-600 bg-red-50 text-red-900")} role="status" aria-live="polite">
        <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/70 text-3xl font-bold">{valido ? "✔" : "✖"}</span>
        <div className="min-w-0">
          <p className="text-sm font-medium uppercase tracking-wide">Resultado da verificação</p>
          <p className="text-3xl font-extrabold tracking-wide sm:text-4xl" data-testid="status-verificacao">{valido ? "AUTÊNTICO" : "INCONSISTENTE"}</p>
          <p className="mt-1 text-sm">{valido ? "O comprovante guardado pelo órgão confere com o hash registrado no livro de protocolo." : "O comprovante guardado não confere com o registro (ou ainda não foi emitido). Confirme com o órgão emissor."}</p>
        </div>
      </div>
      <section className="card" aria-labelledby="dados">
        <h2 id="dados" className="border-b border-slate-100 px-4 py-3 text-base font-semibold">Protocolo</h2>
        <dl className="divide-y divide-slate-100 text-sm">
          {([
            ["Órgão", v.organizacao],
            ["Número", <strong key="n" data-testid="numero-verificado">{v.numero}</strong>],
            ["Livro", v.livro],
            ["Registrado em", `${fmtDataHoraBrasilia(v.registrado_em)} (horário de Brasília)`],
            ["Situação atual", <span key="s" data-testid="situacao-verificada">{v.situacao_protocolo}</span>],
            ["Comprovante emitido em", v.emitido_em ? `${fmtDataHoraBrasilia(v.emitido_em)} (horário de Brasília)` : "—"],
            ["Código de verificação", <span key="c" className="font-mono">{v.codigo}</span>],
          ] as [string, React.ReactNode][]).map(([k, val]) => (
            <div key={k} className="grid gap-1 px-4 py-2.5 sm:grid-cols-3 sm:gap-4"><dt className="font-medium text-slate-600">{k}</dt><dd className="min-w-0 break-words text-slate-900 sm:col-span-2">{val}</dd></div>
          ))}
        </dl>
      </section>
      <section className="card p-4" aria-labelledby="hash">
        <h2 id="hash" className="mb-3 text-base font-semibold">Hash SHA-256 do comprovante</h2>
        <p className="break-all font-mono text-xs" data-testid="hash-comprovante">{v.sha256 ?? "—"}</p>
        <ul className="mt-3 space-y-1 text-sm">
          <li>{v.arquivo_integro === true ? "✔ O arquivo guardado pelo órgão confere com este hash." : v.arquivo_integro === false ? "✖ O arquivo guardado NÃO confere com este hash." : "– O arquivo guardado não pôde ser lido agora."}</li>
          <li>{v.assinado_pades ? (v.pades_ok ? `✔ Assinatura digital PAdES do órgão íntegra${v.signatario ? ` (${v.signatario})` : ""}.` : "✖ Assinatura digital PAdES inválida.") : "– Comprovante com assinatura eletrônica simples (sem certificado ICP-Brasil)."}</li>
        </ul>
      </section>
      <section className="card p-4"><ConferirComprovante sha256={v.sha256} /></section>
      <Link href="/verificar" className="btn-secundario">Verificar outro código</Link>
    </div>
  );
}
