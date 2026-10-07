import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import clsx from "clsx";
import { Aviso } from "@/components/ui";
import { ROTULO_METODO } from "@/lib/ged/assinaturas/folha";
import { permitirConsultaPublica, registrarConsultaSemResultado } from "@/lib/ged/assinaturas/limites";
import { fmtDataHoraBrasilia, normalizarCodigoGed } from "@/lib/ged/assinaturas/regras";
import { verificarPublico } from "@/lib/ged/assinaturas/verificacao";
import { ROTULO_STATUS_DOCUMENTO_GED } from "@/lib/ged/tipos";
import { ipDaRequisicao } from "@/lib/limite-login";
import { ConferirArquivo } from "./conferir-arquivo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Verificar documento assinado", robots: { index: false, follow: false }, referrer: "no-referrer" };

function Linha({ ok, children }: { ok: boolean | null; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <span aria-hidden="true" className={clsx("mt-0.5 font-bold", ok === true ? "text-emerald-700" : ok === false ? "text-red-700" : "text-slate-400")}>{ok === true ? "✔" : ok === false ? "✖" : "–"}</span>
      <span><span className="sr-only">{ok === true ? "Confere: " : ok === false ? "Não confere: " : "Não aplicável: "}</span>{children}</span>
    </li>
  );
}

export default async function VerificarCodigo({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo: bruto } = await params;
  const ip = ipDaRequisicao(await headers());

  if (!permitirConsultaPublica(ip)) {
    return (
      <div className="space-y-4">
        <h1 className="titulo-pagina">Verificar documento assinado</h1>
        <Aviso tipo="alerta">Muitas consultas em pouco tempo. Aguarde alguns minutos e tente novamente.</Aviso>
      </div>
    );
  }

  let texto = bruto;
  try { texto = decodeURIComponent(bruto); } catch { /* mantém */ }
  const codigo = normalizarCodigoGed(texto);
  const v = codigo ? await verificarPublico(codigo) : null;

  if (!v) {
    registrarConsultaSemResultado(ip);
    return (
      <div className="space-y-4">
        <h1 className="titulo-pagina">Verificar documento assinado</h1>
        <div className="rounded-lg border-2 border-red-600 bg-red-50 p-5 text-red-900" role="alert">
          <p className="text-2xl font-bold" data-testid="status-verificacao">NÃO ENCONTRADO</p>
          <p className="mt-1 text-sm">Nenhum documento assinado foi localizado com este código. Confira a digitação. Documento sem registro pode ser falso.</p>
        </div>
        <Link href="/verificar" className="btn-secundario">Verificar outro código</Link>
      </div>
    );
  }

  const valido = v.situacao === "VALIDO";
  return (
    <div className="space-y-6">
      <h1 className="titulo-pagina">Verificar documento assinado</h1>

      <div className={clsx("flex items-start gap-4 rounded-lg border-2 p-5", valido ? "border-emerald-600 bg-emerald-50 text-emerald-900" : "border-red-600 bg-red-50 text-red-900")} role="status" aria-live="polite">
        <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/70 text-3xl font-bold">{valido ? "✔" : "✖"}</span>
        <div className="min-w-0">
          <p className="text-sm font-medium uppercase tracking-wide">Resultado da verificação</p>
          <p className="text-3xl font-extrabold tracking-wide sm:text-4xl" data-testid="status-verificacao">{valido ? "AUTÊNTICO" : "INCONSISTENTE"}</p>
          <p className="mt-1 text-sm">
            {valido
              ? "O selo, a cadeia de assinaturas e o arquivo guardado pelo órgão conferem."
              : "Há divergência entre os registros e o arquivo selado. NÃO confie neste documento sem confirmar com o órgão emissor."}
          </p>
        </div>
      </div>

      <section className="card" aria-labelledby="dados">
        <h2 id="dados" className="border-b border-slate-100 px-4 py-3 text-base font-semibold">Documento</h2>
        <dl className="divide-y divide-slate-100 text-sm">
          {([
            ["Órgão / cliente", v.organizacao],
            ["Número", <strong key="n">{v.numero}</strong>],
            ["Título", v.titulo ?? <span key="t" className="text-slate-500">Não divulgado (documento não público)</span>],
            ["Selado em", `${fmtDataHoraBrasilia(v.selado_em)} (horário de Brasília)`],
            ["Situação do documento", ROTULO_STATUS_DOCUMENTO_GED[v.status_documento as keyof typeof ROTULO_STATUS_DOCUMENTO_GED] ?? v.status_documento],
            ["Código verificador", <span key="c" className="font-mono" data-testid="codigo-verificador">{v.codigo}</span>],
          ] as [string, React.ReactNode][]).map(([k, val]) => (
            <div key={k} className="grid gap-1 px-4 py-2.5 sm:grid-cols-3 sm:gap-4">
              <dt className="font-medium text-slate-600">{k}</dt>
              <dd className="min-w-0 break-words text-slate-900 sm:col-span-2">{val}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="card" aria-labelledby="signatarios">
        <h2 id="signatarios" className="border-b border-slate-100 px-4 py-3 text-base font-semibold">Signatários</h2>
        <ol className="divide-y divide-slate-100">
          {v.assinantes.map((a) => (
            <li key={a.ordem} className="px-4 py-3 text-sm" data-testid="signatario-publico">
              <div className="font-medium">{a.ordem}. {a.nome}</div>
              <div className="text-slate-600">{ROTULO_METODO[a.metodo ?? ""] ?? a.metodo ?? "—"} · {fmtDataHoraBrasilia(a.assinado_em)} (Brasília)</div>
              <div className="mt-1 break-all font-mono text-xs text-slate-500" title="Hash do elo da cadeia de assinaturas">elo: {a.hash_cadeia}</div>
            </li>
          ))}
        </ol>
        <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">Nomes abreviados para proteger dados pessoais (LGPD). O horário de cada assinatura é o do servidor no momento do ato.</p>
      </section>

      <section className="card p-4" aria-labelledby="checagens">
        <h2 id="checagens" className="mb-3 text-base font-semibold">Verificações feitas agora pelo servidor</h2>
        <ul className="space-y-2">
          <Linha ok={v.cadeia.ok}>Cadeia de hashes das assinaturas: {v.cadeia.ok ? `${v.cadeia.elos} elo(s) recalculado(s) a partir do SHA-256 do original` : v.cadeia.mensagens[0] ?? "inconsistente"}.</Linha>
          <Linha ok={v.arquivo_integro}>Arquivo selado guardado pelo órgão {v.arquivo_integro === null ? "não pôde ser lido agora" : v.arquivo_integro ? "confere com o hash registrado" : "NÃO confere com o hash registrado"}.</Linha>
          {v.pades ? (
            <Linha ok={v.pades_ok}>Assinatura digital PAdES do selo ({v.pades.signatario ?? "certificado do órgão"}): {v.pades_ok ? "íntegra, válida e cobre todo o arquivo" : "inválida ou não cobre todo o arquivo"}. A cadeia de certificação e a revogação são conferidas no validador do ITI.</Linha>
          ) : (
            <Linha ok={null}>Selo sem certificado digital ICP-Brasil: este documento tem <strong>assinatura eletrônica avançada</strong> (Lei nº 14.063/2020), conferida pela cadeia de hashes acima.</Linha>
          )}
        </ul>
      </section>

      <section className="card p-4" aria-labelledby="hashes">
        <h2 id="hashes" className="mb-3 text-base font-semibold">Hashes SHA-256</h2>
        <dl className="space-y-2 text-xs">
          <div><dt className="font-medium text-slate-600">Arquivo selado (com QR e folha de assinaturas)</dt><dd className="break-all font-mono" data-testid="hash-final">{v.sha256_final ?? "—"}</dd></div>
          <div><dt className="font-medium text-slate-600">Original enviado para assinatura</dt><dd className="break-all font-mono" data-testid="hash-alvo">{v.sha256_alvo}</dd></div>
        </dl>
      </section>

      <section className="card p-4"><ConferirArquivo sha256Final={v.sha256_final} sha256Alvo={v.sha256_alvo} /></section>

      <Aviso>
        Para validar a assinatura digital (quando houver) fora deste site, abra o PDF no Adobe Acrobat Reader ou envie-o ao validador oficial do ITI:{" "}
        <a className="font-medium underline" href="https://validar.iti.gov.br" target="_blank" rel="noopener noreferrer">validar.iti.gov.br</a>.
        A conferência do arquivo acima ocorre inteiramente no seu navegador.
      </Aviso>
      <Link href="/verificar" className="btn-secundario">Verificar outro código</Link>
    </div>
  );
}
