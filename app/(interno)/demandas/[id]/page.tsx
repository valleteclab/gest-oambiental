import Link from "next/link";
import { forbidden, redirect } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtData, fmtDataHora } from "@/lib/format";
import { semaforo } from "@/lib/dias";
import { isInterno, isSomenteLeitura } from "@/lib/rbac";
import { formatarEndereco } from "@/lib/cadastros/validacao";
import { Aviso, Badge, BadgeStatus, Card, PontoSemaforo, Vazio } from "@/components/ui";
import { acoesDoProcesso, diasAlertaDe, mapaDiasAlerta } from "@/lib/processo/consultas";
import { itensChecklistPendentes, lerItensChecklist } from "@/lib/processo/maquina";
import { condicionantesPadrao, ehDemandaUrbana, lerDadosDemanda, paresDemanda, resumoVistoriaPoda } from "@/lib/demandas/catalogo";
import { carregarProcessoPagina } from "../../processos/_componentes/carregar";
import { Proibido } from "../../processos/_componentes/proibido";
import { FormAcao } from "../../processos/_componentes/acoes-processo";
import { FormChecklist } from "../../processos/_componentes/formularios";
import { DecisaoDemanda, VistoriaDemanda } from "../_componentes";

export const metadata = { title: "Demanda urbana" };

const ROTULO_DOC: Record<string, string> = { AUTORIZACAO: "Autorização", OFICIO: "Ofício de indeferimento", RECIBO: "Recibo de protocolo", PARECER: "Parecer técnico" };

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 py-1.5 sm:grid-cols-[13rem_1fr]">
      <dt className="text-xs text-slate-500 sm:text-sm">{rotulo}</dt>
      <dd className="text-sm text-slate-900">{children || "—"}</dd>
    </div>
  );
}

/** Ficha de atendimento da demanda urbana – mobile-first: dados do pedido, vistoria (checklist) e decisão simplificada. */
export default async function PaginaDemanda({ params }: { params: Promise<{ id: string }> }) {
  const u = await exigirUsuario({ interno: true });
  const { id } = await params;
  const r = await carregarProcessoPagina(id, u);
  if (r.proibido) forbidden();
  if (!isInterno(u)) return <Proibido />;
  const p = r.p;
  if (!ehDemandaUrbana(p.tipo_ato.sigla)) redirect(`/processos/${p.id}`);
  const sigla = p.tipo_ato.sigla;

  const [anexos, documentos, fiscalizacoes, condicionantes, checklist, alertas] = await Promise.all([
    prisma.anexo.findMany({ where: { processo_id: p.id }, orderBy: { created_at: "asc" }, select: { id: true, nome_arquivo: true, tipo: true, documento_exigido_id: true } }),
    prisma.documentoOficial.findMany({ where: { processo_id: p.id }, orderBy: { emitido_em: "asc" } }),
    prisma.fiscalizacao.findMany({ where: { processo_id: p.id }, orderBy: { data_hora: "desc" }, select: { id: true, status: true, data_hora: true, relato: true } }),
    prisma.condicionante.findMany({ where: { processo_id: p.id, status: { not: "CANCELADA" } }, orderBy: { created_at: "asc" } }),
    p.tipo_ato.checklist_modelo ? prisma.checklistPreenchido.findFirst({ where: { processo_id: p.id, checklist_modelo_id: p.tipo_ato.checklist_modelo.id }, orderBy: { updated_at: "desc" } }) : null,
    mapaDiasAlerta(p.organizacao_id),
  ]);
  const exigidos = await prisma.documentoExigido.findMany({ where: { id: { in: anexos.map((a) => a.documento_exigido_id).filter((x): x is string => !!x) } }, select: { id: true, nome: true } });
  const lido = lerDadosDemanda(p.descricao_atividade);
  const dados = lido?.sigla === sigla ? lido.dados : {};
  const somenteLeitura = isSomenteLeitura(u);
  const acoes = somenteLeitura ? [] : acoesDoProcesso(p, u);
  const itens = lerItensChecklist(p.tipo_ato.checklist_modelo?.itens);
  const respostas = (checklist?.respostas as Record<string, unknown>) ?? {};
  const pendentes = itensChecklistPendentes(itens, respostas);
  const vistoriaFeita = fiscalizacoes.some((f) => f.status === "REALIZADA");
  const precisaVistoria = p.tipo_ato.exige_vistoria && !vistoriaFeita;
  const emAnalise = p.status === "EM_ANALISE" || p.status === "AGUARDANDO_VISTORIA";
  const podeAnalisar = acoes.includes("agendar_vistoria") || acoes.includes("concluir_vistoria") || acoes.includes("parecer") || acoes.includes("deferir");
  const sem = semaforo(p.prazo_etapa_ate, diasAlertaDe(alertas, p.municipio_id, p.etapa_atual), p.prazo_pausado);
  const vistoria = sigla === "APC" ? resumoVistoriaPoda(respostas) : null;
  const lat = p.empreendimento.latitude?.toString();
  const lng = p.empreendimento.longitude?.toString();

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="card p-4">
        <p className="text-xs text-slate-500"><Link href="/demandas" className="hover:underline">Demandas urbanas</Link> / {p.municipio.nome}</p>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="titulo-pagina font-mono" data-testid="numero-processo">{p.numero ?? "Rascunho"}</h1>
            <p className="text-sm text-slate-700">{sigla} – {p.tipo_ato.nome}</p>
          </div>
          <span data-testid="status-processo"><BadgeStatus status={p.status} /></span>
        </div>
        <p className="mt-2 inline-flex items-center gap-2 text-sm text-slate-700"><PontoSemaforo s={sem} /> {p.prazo_etapa_ate ? `Prazo da etapa: ${fmtData(p.prazo_etapa_ate)}${p.prazo_pausado ? " (relógio pausado)" : ""}` : "Sem prazo em curso"}</p>
        <p className="mt-1 text-sm text-slate-600">Requerente: {p.requerente.nome} · Técnico: {p.tecnico?.nome ?? "não distribuído"}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={`/processos/${p.id}`} className="btn-secundario btn-sm">Processo completo</Link>
          {lat && lng && <a href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`} target="_blank" rel="noopener noreferrer" className="btn-secundario btn-sm">Abrir local no mapa</a>}
        </div>
      </div>

      <Card titulo="Pedido">
        <dl className="divide-y divide-slate-100" data-testid="dados-pedido">
          <Linha rotulo="Local">{p.empreendimento.nome}</Linha>
          <Linha rotulo="Endereço">{formatarEndereco(p.empreendimento.endereco)}</Linha>
          {paresDemanda(sigla, dados).map(([k, v]) => <Linha key={k} rotulo={k}>{v}</Linha>)}
          {lido?.livre && <Linha rotulo="Observações do requerente"><span className="whitespace-pre-line">{lido.livre}</span></Linha>}
          <Linha rotulo="Protocolo">{fmtDataHora(p.data_protocolo)}</Linha>
        </dl>
        <h3 className="mb-1 mt-3 text-sm font-semibold">Documentos enviados</h3>
        {anexos.length === 0 ? <p className="text-sm text-slate-500">Nenhum.</p> : (
          <ul className="space-y-1 text-sm">
            {anexos.map((a) => <li key={a.id}><a className="text-primaria-700 underline" href={`/api/v1/anexos/${a.id}`}>{a.nome_arquivo}</a>{a.documento_exigido_id && <span className="text-xs text-slate-500"> – {exigidos.find((d) => d.id === a.documento_exigido_id)?.nome}</span>}</li>)}
          </ul>
        )}
      </Card>

      {/* Etapas do fluxo simplificado */}
      {!somenteLeitura && p.status === "PROTOCOLADO" && acoes.includes("distribuir") && (
        <Card titulo="Distribuição">
          <FormAcao processoId={p.id} acao="distribuir" payload={{ tecnico_id: null }} rotuloBotao="Distribuir (rodízio)" />
        </Card>
      )}
      {!somenteLeitura && p.status === "EM_TRIAGEM" && (
        <Card titulo="Triagem">
          <p className="mb-3 text-sm text-slate-700">Confira os documentos enviados. Faltando algo, abra uma pendência no <Link className="underline" href={`/processos/${p.id}`}>processo completo</Link>.</p>
          {acoes.includes("aceitar") ? <FormAcao processoId={p.id} acao="aceitar" payload={{ despacho: "Documentação conferida (triagem simplificada)." }} rotuloBotao="Aceitar e iniciar análise" /> : <Aviso tipo="info">Aguardando a triagem pela equipe técnica.</Aviso>}
        </Card>
      )}

      {emAnalise && itens.length > 0 && (
        <Card titulo={sigla === "APC" ? "Vistoria de campo" : "Análise (checklist)"}>
          {sigla === "APC" && vistoriaFeita ? (
            <>
              <Aviso tipo="sucesso">Vistoria registrada em {fmtDataHora(fiscalizacoes.find((f) => f.status === "REALIZADA")!.data_hora)}.</Aviso>
              <dl className="mt-3 divide-y divide-slate-100" data-testid="resumo-vistoria">
                <Linha rotulo="Espécie">{vistoria?.especie}</Linha>
                <Linha rotulo="DAP / altura">{vistoria?.dap_cm ?? "—"} cm / {vistoria?.altura_m ?? "—"} m</Linha>
                <Linha rotulo="Estado / risco">{vistoria?.fitossanidade} / {vistoria?.risco}</Linha>
                <Linha rotulo="Recomendação">{vistoria?.recomendacao}</Linha>
                <Linha rotulo="Compensação">{vistoria?.mudas ?? 0} muda(s)</Linha>
              </dl>
            </>
          ) : sigla === "APC" && podeAnalisar ? (
            <VistoriaDemanda processoId={p.id} itens={itens} respostas={respostas} />
          ) : (
            <FormChecklist processoId={p.id} itens={itens} respostas={respostas} editavel={podeAnalisar} />
          )}
        </Card>
      )}

      {p.status === "EM_ANALISE" && (acoes.includes("deferir") || acoes.includes("indeferir")) && (
        <Card titulo="Decisão">
          {precisaVistoria ? (
            <Aviso tipo="info">Conclua a vistoria para liberar o deferimento. Se o pedido não tiver fundamento, é possível indeferir já.</Aviso>
          ) : pendentes.length > 0 ? (
            <Aviso tipo="alerta">Checklist incompleto – preencha: {pendentes.map((i) => i.texto).join("; ")}.</Aviso>
          ) : null}
          <div className="mt-3">
            <DecisaoDemanda
              key={`${checklist?.updated_at.getTime() ?? 0}-${vistoriaFeita}`} // sugestões mudam após checklist/vistoria
              processoId={p.id}
              sugeridas={condicionantesPadrao(sigla, dados, respostas)}
              podeDeferir={acoes.includes("deferir") && !precisaVistoria && pendentes.length === 0 && vistoria?.recomendacao !== "Indeferir"}
              podeIndeferir={acoes.includes("indeferir")}
            />
          </div>
        </Card>
      )}

      {!somenteLeitura && (p.status === "DEFERIDO" || p.status === "INDEFERIDO") && acoes.includes("emitir_documento") && (
        <Card titulo="Emissão do documento">
          <FormAcao processoId={p.id} acao="emitir_documento" payload={{}} rotuloBotao="Emitir documento" />
        </Card>
      )}

      {p.status === "AGUARDANDO_REQUERENTE" && <Aviso tipo="alerta">Aguardando resposta do requerente a uma pendência (prazo pausado).</Aviso>}

      {condicionantes.length > 0 && (
        <Card titulo="Condicionantes">
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {condicionantes.map((c) => <li key={c.id}>{c.descricao}{c.prazo_ate ? ` (prazo: ${fmtData(c.prazo_ate)})` : ""}</li>)}
          </ol>
        </Card>
      )}

      <Card titulo="Documentos emitidos">
        {documentos.length === 0 ? <Vazio>Nenhum documento emitido.</Vazio> : (
          <ul className="space-y-2" data-testid="documentos-emitidos">
            {documentos.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge cor={d.status === "VALIDO" ? "verde" : "vermelho"}>{d.status.toLowerCase()}</Badge>
                <span>{ROTULO_DOC[d.tipo] ?? d.tipo} nº <strong>{d.numero}</strong>{d.validade_ate ? ` · válido até ${fmtData(d.validade_ate)}` : ""}</span>
                <Link className="font-mono text-xs text-primaria-700 underline" href={`/validar/${d.codigo_verificador}`}>{d.codigo_verificador}</Link>
                <a className="btn-secundario btn-sm" href={`/api/v1/documentos/${d.id}/pdf`}>PDF</a>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
