import Link from "next/link";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { FaixaDemo, LogoOrganizacao } from "@/components/orgao";
import { Aviso, Badge, Card } from "@/components/ui";
import { BotaoSair } from "@/components/compartilhado/botao-sair";
import { GateOtp } from "@/components/compartilhado/gate-otp";
import { fmtData } from "@/lib/format";
import { logoProprio } from "@/lib/imagem";
import { ErroApi } from "@/lib/http";
import { carregarEscopoLink } from "@/lib/ged/compartilhamento/conteudo";
import { metaDaRequisicao } from "@/lib/ged/compartilhamento/http";
import { exigirVolumePermitido, registrarTokenRuim } from "@/lib/ged/compartilhamento/limites";
import { carregarLinkPublico, sessaoValida, visaoPublica } from "@/lib/ged/compartilhamento/publico";
import { NOME_COOKIE_SESSAO } from "@/lib/ged/compartilhamento/regras";

export const dynamic = "force-dynamic";

const tam = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const AVISO_LGPD =
  "Os acessos a estes documentos (data, hora, endereço de rede resumido e navegador) são registrados e informados a quem compartilhou. O WhatsApp cadastrado é usado apenas para enviar o código de acesso (Lei nº 13.709/2018 – LGPD).";

function Moldura({ nome, logo, children }: { nome: string; logo: string | null; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <FaixaDemo />
      <header className="border-b border-primaria-900/20 bg-primaria-800 text-white">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          {logo && <span className="rounded bg-white p-1"><LogoOrganizacao src={logo} nome={nome} className="h-8 w-auto max-w-[140px] object-contain" /></span>}
          <div className="min-w-0">
            <div className="truncate text-lg font-bold tracking-tight" data-testid="comp-orgao">{nome}</div>
            <div className="text-xs text-emerald-100">Documentos compartilhados</div>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 space-y-4 p-4 sm:p-6">{children}</main>
      <footer className="border-t border-slate-200 bg-white px-4 py-4 text-center text-xs text-slate-500">{AVISO_LGPD}</footer>
    </div>
  );
}

// /compartilhado/{token}: link público (sem login). Antes do código só aparecem o órgão, quem compartilhou e o título – NENHUM arquivo.
// Link inexistente, vencido, revogado ou com o recurso excluído = o mesmo 404.
export default async function PaginaCompartilhado({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ pasta?: string; ver?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const h = await headers();
  const meta = metaDaRequisicao(h);
  try {
    exigirVolumePermitido(meta.ip);
  } catch (e) {
    if (e instanceof ErroApi && e.status === 429) {
      return (
        <Moldura nome="Documentos compartilhados" logo={null}>
          <Aviso tipo="alerta">Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.</Aviso>
        </Moldura>
      );
    }
    throw e;
  }
  const l = await carregarLinkPublico(token);
  if (!l) {
    registrarTokenRuim(meta.ip);
    notFound();
  }
  const logo = logoProprio(l.organizacao.logo_url);
  const cookie = (await cookies()).get(NOME_COOKIE_SESSAO)?.value;
  const logado = await sessaoValida(l, cookie, meta.user_agent);

  if (!logado) {
    return (
      <Moldura nome={l.organizacao.nome} logo={logo}>
        <Card titulo="Acesso protegido">
          <dl className="mb-4 grid gap-1 text-sm sm:grid-cols-[170px_1fr]">
            <dt className="font-medium text-slate-600">Compartilhado por</dt><dd data-testid="comp-quem">{l.criador_nome}</dd>
            <dt className="font-medium text-slate-600">{l.link.recurso_tipo === "PASTA" ? "Pasta" : "Documento"}</dt><dd className="break-words" data-testid="comp-titulo">{l.link.recurso_rotulo}</dd>
            <dt className="font-medium text-slate-600">Disponível até</dt><dd>{fmtData(l.link.expira_em)}</dd>
          </dl>
          <GateOtp token={token} />
        </Card>
      </Moldura>
    );
  }

  const escopo = await carregarEscopoLink(l.link);
  if (!escopo) notFound();
  const pasta = sp.pasta && /^[0-9a-f-]{36}$/i.test(sp.pasta) ? sp.pasta : null;
  let visao;
  try {
    visao = await visaoPublica(l, escopo, pasta);
  } catch (e) {
    if (e instanceof ErroApi && e.status === 404) notFound();
    throw e;
  }
  const api = `/api/v1/publico/compartilhado/${token}`;
  const q = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (pasta) p.set("pasta", pasta);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/compartilhado/${token}?${p.toString()}`;
  };
  const verId = sp.ver && /^[0-9a-f-]{36}$/i.test(sp.ver) ? sp.ver : null;
  const verDoc = verId ? visao.documentos.find((d) => d.id === verId) : null;
  const zipPasta = visao.pasta_atual?.id ?? "";

  return (
    <Moldura nome={l.organizacao.nome} logo={logo}>
      <Card
        titulo={<span className="break-words" data-testid="comp-titulo">{visao.rotulo}</span>}
        acoes={<BotaoSair token={token} />}
      >
        <p className="text-sm text-slate-600">Compartilhado por <strong>{visao.compartilhado_por}</strong> · disponível até {fmtData(visao.expira_em)}{visao.downloads_restantes !== null ? ` · downloads restantes: ${visao.downloads_restantes}` : ""}</p>
        {visao.mensagem && <p className="mt-2 whitespace-pre-wrap rounded-md bg-slate-100 p-3 text-sm" data-testid="comp-mensagem">{visao.mensagem}</p>}
        {visao.tipo === "PASTA" && visao.pasta_atual && (
          <nav aria-label="Caminho" className="mt-3 flex flex-wrap items-center gap-1 text-sm">
            {visao.pasta_atual.caminho.map((c, i) => (
              <span key={c.id}>
                {i > 0 && <span aria-hidden> / </span>}
                {i < visao.pasta_atual!.caminho.length - 1 ? <Link className="underline" prefetch={false} href={i === 0 ? `/compartilhado/${token}` : `/compartilhado/${token}?pasta=${c.id}`}>{c.nome}</Link> : <strong>{c.nome}</strong>}
              </span>
            ))}
          </nav>
        )}
        {visao.permissoes.pode_zip && (
          <p className="mt-3">
            <a className="btn-secundario btn-sm" data-testid="baixar-zip" href={`${api}/zip${zipPasta ? `?pasta=${zipPasta}` : ""}`} download>Baixar esta pasta em ZIP</a>
          </p>
        )}
      </Card>

      {visao.subpastas.length > 0 && (
        <Card titulo="Pastas">
          <ul className="grid gap-2 sm:grid-cols-2" data-testid="comp-subpastas">
            {visao.subpastas.map((s) => (
              <li key={s.id}><Link className="block rounded-md border border-slate-200 p-3 text-sm hover:bg-slate-50" prefetch={false} href={`/compartilhado/${token}?pasta=${s.id}`}><strong>{s.nome}</strong> <span className="text-slate-500">({s.documentos} doc.)</span></Link></li>
            ))}
          </ul>
        </Card>
      )}

      <Card titulo={`Documentos (${visao.total_documentos})`}>
        {visao.documentos.length === 0 ? (
          <p className="text-sm text-slate-600">Nenhum documento disponível aqui.</p>
        ) : (
          <ul className="divide-y divide-slate-200" data-testid="comp-documentos">
            {visao.documentos.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-3" data-doc={d.numero}>
                <div className="min-w-0">
                  <div className="break-words font-medium">{d.titulo}</div>
                  <div className="text-xs text-slate-500">{d.numero}{d.data_documento ? ` · ${fmtData(d.data_documento)}` : ""} · {tam(d.tamanho)}{d.paginas ? ` · ${d.paginas} pág.` : ""} {d.status === "ASSINADO" && <Badge cor="verde">Assinado</Badge>}</div>
                </div>
                <div className="flex gap-2">
                  {visao.permissoes.pode_visualizar && <Link className="btn-secundario btn-sm" prefetch={false} href={q({ ver: d.id })}>Visualizar</Link>}
                  {visao.permissoes.pode_baixar && <a className="btn-primario btn-sm" href={`${api}/arquivo?doc=${d.id}`} download>Baixar</a>}
                </div>
              </li>
            ))}
          </ul>
        )}
        {visao.truncado && <p className="mt-2 text-xs text-slate-500">Mostrando os primeiros {visao.documentos.length} documentos desta pasta.</p>}
      </Card>

      {verDoc && visao.permissoes.pode_visualizar && (
        <Card titulo={`Visualizando: ${verDoc.titulo}`}>
          <iframe title={`Pré-visualização de ${verDoc.titulo}`} src={`${api}/arquivo?doc=${verDoc.id}&inline=1`} className="h-[75vh] w-full rounded-md border border-slate-200" data-testid="comp-preview" />
        </Card>
      )}
      <p className="text-xs text-slate-500">Por segurança, esta sessão expira após 30 minutos sem uso (e no máximo em 2 horas).</p>
    </Moldura>
  );
}
