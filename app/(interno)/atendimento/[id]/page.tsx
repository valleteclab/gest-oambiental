import Link from "next/link";
import { notFound } from "next/navigation";
import clsx from "clsx";
import { exigirUsuario } from "@/lib/auth";
import { ErroApi } from "@/lib/http";
import { fmtDataHora } from "@/lib/format";
import { Badge, CabecalhoPagina, Card, Vazio } from "@/components/ui";
import { Mapa } from "@/components/mapa";
import { TextoWhats } from "@/components/chat-denuncia";
import { ehUuid } from "@/lib/fiscalizacao/api";
import { obterConversaAtendimento } from "@/lib/agente/atendimento";
import { COR_ESTADO, ROTULO_AUTOR, ROTULO_ESTADO } from "@/lib/agente/rotulos";
import { ROTULO_TIPO_CANAL } from "@/lib/canais";
import { rotuloTipo } from "@/lib/agente/tipos";
import { COR_BADGE_DENUNCIA, ROTULO_STATUS_DENUNCIA } from "@/lib/fiscalizacao/regras";
import { SemAcesso } from "../../fiscalizacao/_componentes/sem-acesso";
import { AcoesConversa } from "./acoes";

export const metadata = { title: "Conversa – Atendimento" };
export const dynamic = "force-dynamic";

const COR_ENVIO: Record<string, string> = { ERRO: "text-red-700", IGNORADA: "text-amber-700", SIMULADA: "text-slate-500", PENDENTE: "text-slate-500", ENVIADA: "text-emerald-700" };

export default async function PaginaConversa({ params }: { params: Promise<{ id: string }> }) {
  const u = await exigirUsuario({ interno: true });
  const { id } = await params;
  if (!ehUuid(id)) notFound();
  let c: Awaited<ReturnType<typeof obterConversaAtendimento>>;
  try {
    c = await obterConversaAtendimento(u, id);
  } catch (e) {
    if (e instanceof ErroApi && e.status === 404) notFound();
    if (e instanceof ErroApi && e.status === 403) return <SemAcesso />;
    throw e;
  }
  const d = c.dados;
  const pontos = [
    ...(d.latitude != null && d.longitude != null ? [{ id: "local", lat: d.latitude, lng: d.longitude, titulo: "Local informado", cor: "#b91c1c" }] : []),
    ...c.mensagens.filter((m) => m.latitude != null && m.longitude != null && !(m.latitude === d.latitude && m.longitude === d.longitude)).map((m) => ({ id: m.id, lat: m.latitude!, lng: m.longitude!, titulo: `Localização ${fmtDataHora(m.created_at)}` })),
  ];
  const pausada = c.estado === "HUMANO" && c.ia_pausada_ate ? `IA pausada até ${fmtDataHora(c.ia_pausada_ate)}` : null;
  return (
    <div>
      <CabecalhoPagina
        titulo={c.nome ?? c.contato ?? "Conversa"}
        subtitulo={<>{ROTULO_TIPO_CANAL[c.canal.tipo]} · {c.municipio?.nome ?? "município a definir"} · iniciada {fmtDataHora(c.created_at)} <Badge cor={COR_ESTADO[c.estado]}>{ROTULO_ESTADO[c.estado]}</Badge></>}
        acoes={<Link href="/atendimento" className="btn-secundario">Voltar</Link>}
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <Card titulo="Mensagens">
          <ol className="max-h-[65vh] space-y-2 overflow-y-auto rounded-md bg-slate-50 p-3" data-testid="mensagens-conversa">
            {c.mensagens.map((m) => (
              <li key={m.id} className={clsx("flex", m.direcao === "IN" ? "justify-start" : "justify-end")}>
                <div className={clsx("max-w-[85%] rounded-xl px-3 py-2 text-sm shadow-sm ring-1", m.direcao === "IN" ? "bg-white ring-slate-200" : m.autor === "ATENDENTE" ? "bg-amber-50 ring-amber-200" : "bg-emerald-50 ring-emerald-200")}>
                  <p className="mb-0.5 text-[11px] font-semibold text-slate-500">{m.atendente ?? ROTULO_AUTOR[m.autor]} · {fmtDataHora(m.created_at)}</p>
                  {m.midia_key && m.midia_mime?.startsWith("image/") && (
                    <a href={`/api/v1/atendimento/midia/${m.id}`} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/v1/atendimento/midia/${m.id}`} alt="Foto recebida" className="mb-1 max-h-56 rounded-md" />
                    </a>
                  )}
                  {m.midia_key && m.midia_mime?.startsWith("audio/") && <audio controls src={`/api/v1/atendimento/midia/${m.id}`} className="mb-1 w-64 max-w-full" />}
                  {m.midia_key && m.midia_mime === "application/pdf" && <a href={`/api/v1/atendimento/midia/${m.id}`} className="underline" target="_blank" rel="noreferrer">📎 Documento PDF</a>}
                  {m.texto ? <div className="whitespace-pre-wrap break-words"><TextoWhats texto={m.texto} /></div> : m.latitude != null ? <span>📍 {m.latitude?.toFixed(5)}, {m.longitude?.toFixed(5)}</span> : !m.midia_key ? <span className="italic text-slate-400">[{m.tipo.toLowerCase()}]</span> : null}
                  {Array.isArray(m.botoes) && m.botoes.length > 0 && <p className="mt-1 text-xs text-slate-500">Botões: {(m.botoes as { rotulo: string }[]).map((b) => b.rotulo).join(" · ")}</p>}
                  {m.direcao === "OUT" && m.status_envio && m.status_envio !== "ENVIADA" && <p className={clsx("mt-1 text-[11px]", COR_ENVIO[m.status_envio])} title={m.erro ?? undefined}>{m.status_envio.toLowerCase()}{m.erro ? `: ${m.erro}` : ""}</p>}
                </div>
              </li>
            ))}
          </ol>
          <AcoesConversa id={c.id} estado={c.estado} podeAtender={c.podeAtender} temDenuncia={!!c.denuncia} pausada={pausada} dados={{ descricao: d.descricao ?? "", endereco: d.endereco ?? "" }} />
        </Card>
        <div className="space-y-4">
          <Card titulo="Denúncia">
            {c.denuncia ? (
              <p className="text-sm"><Link href={`/fiscalizacao/denuncias/${c.denuncia.id}`} className="font-medium text-primaria-700 underline" data-testid="link-denuncia">{c.denuncia.protocolo}</Link> <Badge cor={COR_BADGE_DENUNCIA[c.denuncia.status]}>{ROTULO_STATUS_DENUNCIA[c.denuncia.status]}</Badge></p>
            ) : <Vazio>Ainda não registrada.</Vazio>}
            <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-x-2 gap-y-1 text-sm">
              <dt className="text-slate-500">Tipo</dt><dd>{d.tipo_ocorrencia ? rotuloTipo(d.tipo_ocorrencia) : "—"}</dd>
              <dt className="text-slate-500">Descrição</dt><dd className="whitespace-pre-wrap">{d.descricao ?? "—"}</dd>
              <dt className="text-slate-500">Endereço</dt><dd>{d.endereco ?? "—"}{d.referencia ? ` (ref.: ${d.referencia})` : ""}</dd>
              <dt className="text-slate-500">Fotos</dt><dd>{d.fotos?.length ?? 0}</dd>
              <dt className="text-slate-500">Identificação</dt><dd>{d.anonima === false ? d.nome ?? "—" : d.anonima ? "Anônima" : "—"}</dd>
              <dt className="text-slate-500">Contato</dt><dd>{c.contato ?? "—"}</dd>
              <dt className="text-slate-500">LGPD</dt><dd>{c.lgpd_consentimento_em ? `consentiu em ${fmtDataHora(c.lgpd_consentimento_em)}` : "sem consentimento"}</dd>
            </dl>
          </Card>
          <Card titulo="Local">
            {pontos.length ? <Mapa centro={[pontos[0].lat, pontos[0].lng]} zoom={15} altura="260px" pontos={pontos} /> : <Vazio>Nenhuma localização recebida.</Vazio>}
          </Card>
        </div>
      </div>
    </div>
  );
}
