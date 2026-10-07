import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Aviso, Badge, Card } from "@/components/ui";
import { ipDaRequisicao } from "@/lib/limite-login";
import { fmtDataHoraBrasilia } from "@/lib/ged/assinaturas/regras";
import { permitirConsultaProtocolo, registrarConsultaSemResultado } from "@/lib/ged/protocolo/limites";
import { carregarPortalCache, consultarPublico } from "@/lib/ged/protocolo/publico";
import { COR_SITUACAO, lerNumeroProtocolo } from "@/lib/ged/protocolo/regras";

export const dynamic = "force-dynamic";

export default async function PaginaConsultaProtocolo({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ numero?: string; codigo?: string }> }) {
  const { slug } = await params;
  const portal = await carregarPortalCache(slug);
  if (!portal) notFound();
  const sp = await searchParams;
  const numero = typeof sp.numero === "string" ? sp.numero.slice(0, 40) : "";
  const codigo = typeof sp.codigo === "string" ? sp.codigo.slice(0, 40) : "";
  const pesquisou = !!(numero || codigo);

  let resultado: Awaited<ReturnType<typeof consultarPublico>> = null;
  let bloqueado = false;
  if (pesquisou) {
    const ip = ipDaRequisicao(await headers());
    const n = lerNumeroProtocolo(numero)?.numero ?? null;
    if (!permitirConsultaProtocolo(ip, portal.organizacao_id, n)) bloqueado = true;
    else {
      resultado = await consultarPublico(portal, numero, codigo);
      if (!resultado) registrarConsultaSemResultado(ip, portal.organizacao_id, n);
    }
  }
  const q = `numero=${encodeURIComponent(numero)}&codigo=${encodeURIComponent(codigo)}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="titulo-pagina">Acompanhar protocolo</h1>
        <p className="mt-1 text-sm text-slate-600">Informe o número do protocolo e o código de consulta que você recebeu no comprovante e por e-mail.</p>
      </div>
      <Card>
        <form method="get" action={`/protocolo/${slug}/consulta`} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" aria-label="Consultar protocolo">
          <div>
            <label className="label" htmlFor="c-numero">Número do protocolo</label>
            <input id="c-numero" name="numero" className="input" defaultValue={numero} placeholder="PROT-ENT-2026-000001" maxLength={40} autoComplete="off" required />
          </div>
          <div>
            <label className="label" htmlFor="c-codigo">Código de consulta</label>
            <input id="c-codigo" name="codigo" className="input" defaultValue={codigo} placeholder="XXXX-XXXX-XXXX" maxLength={40} autoComplete="off" required />
          </div>
          <button className="btn-primario" data-testid="consultar">Consultar</button>
        </form>
      </Card>
      {bloqueado && <Aviso tipo="alerta">Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.</Aviso>}
      {pesquisou && !bloqueado && !resultado && <div data-testid="consulta-nao-encontrado"><Aviso tipo="erro">Protocolo não encontrado. Confira o número e o código de consulta.</Aviso></div>}
      {resultado && (
        <Card titulo="Situação do protocolo">
          <dl className="grid gap-2 text-sm sm:grid-cols-[180px_1fr]" data-testid="consulta-resultado">
            <dt className="font-medium text-slate-600">Número</dt><dd className="font-bold">{resultado.numero}</dd>
            <dt className="font-medium text-slate-600">Órgão</dt><dd>{resultado.organizacao}</dd>
            <dt className="font-medium text-slate-600">Assunto</dt><dd className="break-words">{resultado.assunto}</dd>
            <dt className="font-medium text-slate-600">Registrado em</dt><dd>{fmtDataHoraBrasilia(resultado.registrado_em)} (horário de Brasília)</dd>
            <dt className="font-medium text-slate-600">Situação</dt><dd data-testid="consulta-situacao"><Badge cor={COR_SITUACAO[resultado.situacao_codigo as keyof typeof COR_SITUACAO]}>{resultado.situacao}</Badge></dd>
            {resultado.prazo_resposta_em && !resultado.concluido && (<><dt className="font-medium text-slate-600">Prazo de resposta</dt><dd>{fmtDataHoraBrasilia(resultado.prazo_resposta_em).slice(0, 10)}</dd></>)}
          </dl>
          <h2 className="mb-2 mt-5 text-base font-semibold">Andamento</h2>
          <ol className="space-y-3" data-testid="consulta-andamento">
            {resultado.andamento.map((a, i) => (
              <li key={i} className="rounded-md border border-slate-200 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{a.rotulo}</span><span className="text-xs text-slate-500">{fmtDataHoraBrasilia(a.quando)}</span></div>
                {a.mensagem && <p className="mt-2 whitespace-pre-wrap text-slate-800">{a.mensagem}</p>}
              </li>
            ))}
          </ol>
          {resultado.comprovante_disponivel && (
            <p className="mt-4"><a className="btn-secundario" data-testid="baixar-comprovante" href={`/api/v1/publico/protocolo/${slug}/comprovante?${q}`} download>Baixar comprovante (PDF)</a></p>
          )}
        </Card>
      )}
      <p className="text-sm"><Link href={`/protocolo/${slug}`} prefetch={false} className="underline">Fazer um novo protocolo</Link></p>
    </div>
  );
}
