import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtData, fmtDataHora } from "@/lib/format";
import { Aviso, Badge, Card, Vazio, statusAmigavel } from "@/components/ui";
import { UUID_RE } from "@/lib/processo/consultas";
import { ehTitular } from "@/lib/processo/maquina";
import { formatarTamanho } from "@/lib/processo/upload-cliente";
import { LinhaDoTempo } from "../../../(interno)/processos/_componentes/linha-do-tempo";
import { Proibido } from "../../../(interno)/processos/_componentes/proibido";
import { BotaoReemitir } from "../../../(interno)/processos/_componentes/formularios";
import { ResponderPendencias } from "./responder";

export const metadata = { title: "Meu processo" };

const ROTULO_DOC: Record<string, string> = { LICENCA: "Licença", AUTORIZACAO: "Autorização", CERTIDAO: "Certidão", PARECER: "Parecer técnico", OFICIO: "Ofício", RECIBO: "Recibo de protocolo", NOTIFICACAO: "Notificação", AUTO_INFRACAO: "Auto de infração" };

export default async function MeuProcesso({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ protocolado?: string }> }) {
  const u = await exigirUsuario();
  const { id } = await params;
  const { protocolado } = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  const p = await prisma.processo.findUnique({
    where: { id },
    include: {
      tipo_ato: { select: { sigla: true, nome: true } },
      empreendimento: { select: { nome: true } },
      municipio: { select: { nome: true, orgao_ambiental_nome: true, email: true, telefone: true } },
      rt: { select: { pessoa_id: true } },
      pendencias: { include: { anexos: { select: { id: true, nome_arquivo: true } } }, orderBy: { created_at: "asc" } },
      anexos: { where: { pendencia_id: null }, orderBy: { created_at: "asc" } },
      documentos: { where: { status: { not: "SUBSTITUIDO" } }, orderBy: { emitido_em: "asc" } },
      tramitacoes: { where: { publico: true }, orderBy: { created_at: "asc" } },
    },
  });
  if (!p) notFound();
  if (!ehTitular(u, { requerente_id: p.requerente_id, rt_pessoa_id: p.rt?.pessoa_id })) return <Proibido voltar="/meus-processos" mensagem="Este processo não pertence ao seu cadastro." />;
  if (p.status === "RASCUNHO") {
    return (
      <Card titulo="Requerimento em rascunho">
        <p className="mb-4 text-sm">Este requerimento ainda não foi protocolado.</p>
        <Link href={`/novo-requerimento?id=${p.id}`} className="btn-primario">Continuar preenchimento</Link>
      </Card>
    );
  }
  const abertas = p.pendencias.filter((x) => x.status === "ABERTA" || x.status === "VENCIDA");
  const recibo = p.documentos.find((d) => d.tipo === "RECIBO");
  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm"><Link href="/meus-processos" className="text-primaria-700 hover:underline">← Meus processos</Link></p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="titulo-pagina" data-testid="numero-processo">Processo {p.numero}</h1>
            <p className="text-sm text-slate-700">{p.tipo_ato.sigla} – {p.tipo_ato.nome} · {p.empreendimento.nome}</p>
            <p className="text-sm text-slate-600">{p.municipio.orgao_ambiental_nome} · protocolado em {fmtDataHora(p.data_protocolo)}</p>
          </div>
          <span data-testid="status-amigavel"><Badge cor={p.status === "AGUARDANDO_REQUERENTE" ? "amarelo" : ["CONCLUIDO", "DEFERIDO", "INDEFERIDO"].includes(p.status) ? "verde" : "azul"}>{statusAmigavel(p.status)}</Badge></span>
        </div>
      </div>

      {protocolado && (
        <Aviso tipo="sucesso">
          Requerimento protocolado com sucesso sob o nº <strong>{p.numero}</strong>. {recibo ? "Baixe o recibo abaixo." : "O recibo em PDF estará disponível em “Documentos”."}
        </Aviso>
      )}

      {abertas.length > 0 && (
        <section className="rounded-lg border-2 border-amber-400 bg-amber-50 p-4" aria-labelledby="titulo-pendencias">
          <h2 id="titulo-pendencias" className="mb-1 text-lg font-semibold text-amber-900">Pendência – ação necessária</h2>
          <p className="mb-3 text-sm text-amber-900">O órgão ambiental solicitou as informações abaixo. O prazo de análise fica suspenso até a sua resposta.</p>
          <ResponderPendencias processoId={p.id} pendencias={abertas.map((x) => ({ id: x.id, descricao: x.descricao, prazo: fmtData(x.prazo_ate), anexos: x.anexos.map((a) => ({ id: a.id, nome: a.nome_arquivo })) }))} />
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <Card titulo="Andamento">
          <LinhaDoTempo publica itens={p.tramitacoes} />
        </Card>
        <div className="space-y-5">
          <Card titulo="Documentos">
            {p.documentos.length === 0 ? (
              <div className="space-y-2">
                <Vazio>Nenhum documento emitido ainda.</Vazio>
                {!recibo && <BotaoReemitir processoId={p.id} rotulo="Gerar recibo de protocolo" />}
              </div>
            ) : (
              <ul className="space-y-3 text-sm" data-testid="documentos-emitidos">
                {p.documentos.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <strong>{ROTULO_DOC[d.tipo] ?? d.tipo}</strong> {d.numero}
                      <span className="block text-xs text-slate-500">{fmtData(d.emitido_em)}{d.validade_ate ? ` · válido até ${fmtData(d.validade_ate)}` : ""}{d.status === "CANCELADO" ? " · CANCELADO" : ""}</span>
                    </span>
                    <span className="flex gap-2">
                      <a className="btn-secundario btn-sm" href={`/api/v1/documentos/${d.id}/pdf`}>Baixar PDF</a>
                      <Link className="btn-secundario btn-sm" href={`/validar/${d.codigo_verificador}`}>Validar</Link>
                    </span>
                  </li>
                ))}
                {!recibo && <li><BotaoReemitir processoId={p.id} rotulo="Gerar recibo de protocolo" /></li>}
              </ul>
            )}
          </Card>
          <Card titulo="Arquivos enviados">
            {p.anexos.length === 0 ? <Vazio>Nenhum arquivo.</Vazio> : (
              <ul className="space-y-1 text-sm">
                {p.anexos.map((a) => <li key={a.id}><a className="text-primaria-700 hover:underline" href={`/api/v1/anexos/${a.id}`}>{a.nome_arquivo}</a> <span className="text-xs text-slate-500">({formatarTamanho(a.tamanho)})</span></li>)}
              </ul>
            )}
          </Card>
          {p.pendencias.some((x) => x.status === "RESPONDIDA") && (
            <Card titulo="Pendências respondidas">
              <ul className="space-y-3 text-sm">
                {p.pendencias.filter((x) => x.status === "RESPONDIDA").map((x) => (
                  <li key={x.id}>
                    <p className="whitespace-pre-line text-slate-800">{x.descricao}</p>
                    <p className="mt-1 whitespace-pre-line rounded bg-slate-50 p-2 text-slate-700">Resposta ({fmtData(x.respondida_em)}): {x.resposta}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card titulo="Contato do órgão">
            <p className="text-sm">{p.municipio.orgao_ambiental_nome}</p>
            <p className="text-sm text-slate-600">{p.municipio.email} · {p.municipio.telefone}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
