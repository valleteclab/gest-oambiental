import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { ErroApi } from "@/lib/http";
import { fmtData, fmtDataHora, fmtMoeda } from "@/lib/format";
import { Aviso, Badge, CabecalhoPagina, Card, Vazio } from "@/components/ui";
import { Mapa } from "@/components/mapa";
import { ROTULO_STATUS } from "@/components/ui";
import { obterFiscalizacao } from "@/lib/fiscalizacao/servico";
import { ehUuid } from "@/lib/fiscalizacao/api";
import {
  COR_BADGE_CONSTATACAO, COR_PIN_CONSTATACAO, ROTULO_CONSTATACAO, ROTULO_ORIGEM, ROTULO_PENALIDADE, ROTULO_STATUS_AUTO, ROTULO_STATUS_DENUNCIA, ROTULO_STATUS_NOTIFICACAO,
  podeEmitirFiscalizacao,
} from "@/lib/fiscalizacao/regras";
import { SemAcesso } from "../_componentes/sem-acesso";
import { BotaoPdf } from "../_componentes/botao-pdf";
import { sp1, type SP } from "../_componentes/util";

export const metadata = { title: "Ficha da vistoria – LicenciaGov" };

export default async function FichaFiscalizacao({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await exigirUsuario({ interno: true });
  const { id } = await params;
  const s = await searchParams;
  if (!ehUuid(id)) notFound();
  let f: Awaited<ReturnType<typeof obterFiscalizacao>>;
  try {
    f = await obterFiscalizacao(u, id);
  } catch (e) {
    if (e instanceof ErroApi && e.status === 404) notFound();
    if (e instanceof ErroApi && e.status === 403) return <SemAcesso />;
    throw e;
  }
  const emitir = podeEmitirFiscalizacao(u, f.municipio_id);
  const temPonto = f.latitude != null && f.longitude != null;

  return (
    <div>
      <CabecalhoPagina
        titulo={`Vistoria de ${fmtData(f.data_hora)}`}
        subtitulo={<>{f.municipio.nome} · {ROTULO_ORIGEM[f.origem]} {f.constatacao && <Badge cor={COR_BADGE_CONSTATACAO[f.constatacao]}>{ROTULO_CONSTATACAO[f.constatacao]}</Badge>}</>}
        acoes={emitir && (
          <>
            <Link href={`/fiscalizacao/${f.id}/auto`} className="btn-perigo" data-testid="gerar-auto">Gerar Auto de Infração</Link>
            <Link href={`/fiscalizacao/${f.id}/notificacao`} className="btn-primario" data-testid="gerar-notificacao">Gerar Notificação</Link>
          </>
        )}
      />
      {sp1(s.criada) && <div className="mb-4"><Aviso tipo="sucesso">Vistoria registrada com sucesso{f.denuncia ? ` – denúncia ${f.denuncia.protocolo} em apuração` : ""}.</Aviso></div>}
      {sp1(s.erro_pdf) && <div className="mb-4"><Aviso tipo="alerta">O registro foi salvo, mas o PDF não pôde ser gerado agora ({sp1(s.erro_pdf)}). Use “Gerar PDF novamente”.</Aviso></div>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card titulo="Dados da vistoria">
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-slate-500">Data/hora</dt><dd>{fmtDataHora(f.data_hora)}</dd>
            <dt className="text-slate-500">Município</dt><dd>{f.municipio.nome}</dd>
            <dt className="text-slate-500">Origem</dt>
            <dd>
              {ROTULO_ORIGEM[f.origem]}
              {f.denuncia && <> · <Link className="text-primaria-700 underline" href={`/fiscalizacao/denuncias/${f.denuncia.id}`}>{f.denuncia.protocolo}</Link> ({ROTULO_STATUS_DENUNCIA[f.denuncia.status]})</>}
              {f.processo && <> · <Link className="text-primaria-700 underline" href={`/processos/${f.processo.id}`}>{f.processo.numero ?? "processo"}</Link> ({ROTULO_STATUS[f.processo.status]})</>}
            </dd>
            <dt className="text-slate-500">Empreendimento</dt><dd>{f.empreendimento ? <Link className="text-primaria-700 underline" href={`/empreendimentos/${f.empreendimento.id}`}>{f.empreendimento.nome}</Link> : "—"}</dd>
            <dt className="text-slate-500">Coordenadas</dt><dd className="font-mono" data-testid="ficha-coordenadas">{temPonto ? `${f.latitude!.toFixed(6)}, ${f.longitude!.toFixed(6)}` : "—"}{f.precisao_m != null && <span className="font-sans text-slate-500"> (±{Math.round(f.precisao_m)} m)</span>}</dd>
            <dt className="text-slate-500">Equipe</dt><dd>{f.equipe.map((m) => m.nome).join(", ") || "—"}</dd>
            <dt className="text-slate-500">Constatação</dt><dd>{f.constatacao ? ROTULO_CONSTATACAO[f.constatacao] : "—"}</dd>
          </dl>
          <h3 className="mt-4 text-sm font-semibold">Relato</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{f.relato}</p>
        </Card>
        <Card titulo="Local">
          {temPonto ? <Mapa centro={[f.latitude!, f.longitude!]} zoom={16} altura="320px" pontos={[{ id: f.id, lat: f.latitude!, lng: f.longitude!, titulo: "Vistoria", descricao: fmtDataHora(f.data_hora), cor: COR_PIN_CONSTATACAO[f.constatacao ?? "SEM"] }]} /> : <Vazio>Sem coordenadas.</Vazio>}
        </Card>
      </div>

      <Card titulo={`Fotos (${f.anexos.length})`} className="mt-4">
        {f.anexos.length === 0 ? <Vazio>Nenhuma foto.</Vazio> : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="galeria">
            {f.anexos.map((a, i) => (
              <li key={a.id}>
                <a href={`/api/v1/fiscalizacoes/${f.id}/fotos/${a.id}`} target="_blank" rel="noopener">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/v1/fiscalizacoes/${f.id}/fotos/${a.id}`} alt={`Foto ${i + 1} da vistoria`} loading="lazy" className="aspect-square w-full rounded-md border border-slate-200 object-cover" />
                </a>
                <div className="mt-1 text-[11px] text-slate-500" title={`SHA-256 ${a.sha256}`}>
                  {a.latitude != null && a.longitude != null ? `${a.latitude.toFixed(5)}, ${a.longitude.toFixed(5)}` : "sem coord."} · {Math.round(a.tamanho / 1024)} KB
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card titulo={`Autos de infração (${f.autos.length})`}>
          {f.autos.length === 0 ? <Vazio>Nenhum auto lavrado.</Vazio> : (
            <ul className="divide-y divide-slate-100" data-testid="lista-autos">
              {f.autos.map((a) => (
                <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm" id={`auto-${a.id}`}>
                  <div>
                    <div className="font-medium">{a.numero}</div>
                    <div className="text-slate-600">{a.autuado.nome} · {a.autuado.cpf_cnpj_mascara}</div>
                    <div className="text-slate-600">{ROTULO_PENALIDADE[a.penalidade]}{a.valor_multa ? ` · ${fmtMoeda(a.valor_multa)}` : ""} · <Badge>{ROTULO_STATUS_AUTO[a.status]}</Badge></div>
                  </div>
                  <BotaoPdf tipo="autos-infracao" id={a.id} documentoId={a.documento_id} podeEmitir={emitir} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card titulo={`Notificações (${f.notificacoes.length})`}>
          {f.notificacoes.length === 0 ? <Vazio>Nenhuma notificação.</Vazio> : (
            <ul className="divide-y divide-slate-100" data-testid="lista-notificacoes">
              {f.notificacoes.map((n) => (
                <li key={n.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm" id={`notificacao-${n.id}`}>
                  <div>
                    <div className="font-medium">{n.numero}</div>
                    <div className="text-slate-600">{n.notificado.nome} · {n.notificado.cpf_cnpj_mascara}</div>
                    <div className="text-slate-600">Prazo: {n.prazo_dias} dias (até {fmtData(n.prazo_ate)}) · <Badge>{ROTULO_STATUS_NOTIFICACAO[n.status]}</Badge></div>
                  </div>
                  <BotaoPdf tipo="notificacoes" id={n.id} documentoId={n.documento_id} podeEmitir={emitir} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
