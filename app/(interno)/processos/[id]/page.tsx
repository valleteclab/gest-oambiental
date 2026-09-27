import Link from "next/link";
import { forbidden } from "next/navigation";
import clsx from "clsx";
import { exigirUsuario } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { fmtData, fmtDataHora, fmtNumero } from "@/lib/format";
import { semaforo, diasRestantes } from "@/lib/dias";
import { isInterno, isSomenteLeitura } from "@/lib/rbac";
import { Aviso, Badge, BadgeStatus, Card, PontoSemaforo, Vazio } from "@/components/ui";
import { formatarEndereco } from "@/lib/cadastros/validacao";
import { ROTULO_PORTE } from "@/lib/processo/porte";
import { acoesDoProcesso, diasAlertaDe, documentosExigidos, mapaDiasAlerta, tecnicosElegiveis } from "@/lib/processo/consultas";
import { itensChecklistPendentes, lerItensChecklist } from "@/lib/processo/maquina";
import { podeEditarChecklist } from "@/lib/processo/checklist";
import { podeAnexar } from "@/lib/processo/anexos";
import { formatarTamanho } from "@/lib/processo/upload-cliente";
import { carregarProcessoPagina } from "../_componentes/carregar";
import { Proibido } from "../_componentes/proibido";
import { LinhaDoTempo } from "../_componentes/linha-do-tempo";
import { AcoesProcesso, FormParecer } from "../_componentes/acoes-processo";
import { BotaoReemitir, FormChecklist, UploadAnexo } from "../_componentes/formularios";

export const metadata = { title: "Processo" };

const ABAS = [
  ["dados", "Dados"],
  ["documentos", "Documentos"],
  ["tramitacao", "Tramitação"],
  ["pendencias", "Pendências"],
  ["checklist", "Checklist"],
  ["parecer", "Parecer"],
  ["vistorias", "Vistorias"],
  ["emitidos", "Documentos emitidos"],
  ["log", "Log"],
] as const;
type Aba = (typeof ABAS)[number][0];

const ROTULO_ETAPA: Record<string, string> = { TRIAGEM: "triagem", ANALISE_CURTA: "análise", ANALISE_LONGA: "análise", PENDENCIA: "pendência do requerente", VISTORIA: "vistoria", DECISAO: "decisão" };
const ROTULO_CONCLUSAO = { FAVORAVEL: "Favorável", DESFAVORAVEL: "Desfavorável", FAVORAVEL_COM_CONDICIONANTES: "Favorável com condicionantes" } as const;
const ROTULO_DOC: Record<string, string> = { LICENCA: "Licença", AUTORIZACAO: "Autorização", CERTIDAO: "Certidão", PARECER: "Parecer técnico", OFICIO: "Ofício", RECIBO: "Recibo de protocolo", NOTIFICACAO: "Notificação", AUTO_INFRACAO: "Auto de infração" };

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-[14rem_1fr]">
      <dt className="text-sm text-slate-500">{rotulo}</dt>
      <dd className="text-sm text-slate-900">{children ?? "—"}</dd>
    </div>
  );
}

export default async function PaginaProcesso({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ aba?: string }> }) {
  const u = await exigirUsuario({ interno: true });
  const { id } = await params;
  const { aba: abaParam } = await searchParams;
  const aba: Aba = (ABAS.find(([k]) => k === abaParam)?.[0] ?? "dados") as Aba;
  const r = await carregarProcessoPagina(id, u);
  // 403 real (T7): fora do escopo → status HTTP 403 + app/forbidden.tsx
  if (r.proibido) forbidden();
  if (!isInterno(u)) return <Proibido />;
  const p = r.p;

  const [tramitacoes, anexos, pendencias, pareceres, condicionantes, fiscalizacoes, documentos, exigidos, checklist] = await Promise.all([
    prisma.tramitacao.findMany({ where: { processo_id: p.id }, orderBy: { created_at: "asc" } }),
    prisma.anexo.findMany({ where: { processo_id: p.id }, orderBy: { created_at: "asc" } }),
    prisma.pendencia.findMany({ where: { processo_id: p.id }, include: { anexos: true }, orderBy: { created_at: "asc" } }),
    prisma.parecer.findMany({ where: { processo_id: p.id }, orderBy: { created_at: "desc" } }),
    prisma.condicionante.findMany({ where: { processo_id: p.id }, orderBy: { created_at: "asc" } }),
    prisma.fiscalizacao.findMany({ where: { processo_id: p.id }, orderBy: { data_hora: "desc" } }),
    prisma.documentoOficial.findMany({ where: { processo_id: p.id }, orderBy: { emitido_em: "asc" } }),
    documentosExigidos(p.tipo_ato_id, p.empreendimento.tipologia_id),
    p.tipo_ato.checklist_modelo ? prisma.checklistPreenchido.findFirst({ where: { processo_id: p.id, checklist_modelo_id: p.tipo_ato.checklist_modelo.id }, orderBy: { updated_at: "desc" } }) : null,
  ]);
  const idsUsuarios = [...new Set([...tramitacoes.flatMap((t) => [t.de_usuario_id, t.para_usuario_id]), ...pareceres.map((x) => x.autor_id), ...anexos.map((a) => a.enviado_por), checklist?.preenchido_por].filter((x): x is string => !!x))];
  const usuarios = new Map((await prisma.usuario.findMany({ where: { id: { in: idsUsuarios } }, select: { id: true, nome: true } })).map((x) => [x.id, x.nome]));
  const nome = (id: string | null | undefined) => (id ? usuarios.get(id) ?? "—" : null);

  const somenteLeitura = isSomenteLeitura(u);
  const acoes = somenteLeitura ? [] : acoesDoProcesso(p, u);
  const tecnicos = acoes.includes("distribuir") ? (await tecnicosElegiveis(p.municipio_id)).map((t) => ({ id: t.id, nome: t.nome })) : [];
  const itensChecklist = lerItensChecklist(p.tipo_ato.checklist_modelo?.itens);
  const respostas = (checklist?.respostas as Record<string, unknown>) ?? {};
  const checklistPendente = itensChecklistPendentes(itensChecklist, respostas).map((i) => i.texto);
  const sem = semaforo(p.prazo_etapa_ate, diasAlertaDe(await mapaDiasAlerta(), p.municipio_id, p.etapa_atual), p.prazo_pausado);
  const restantes = p.prazo_etapa_ate ? diasRestantes(p.prazo_etapa_ate) : null;
  const abertas = pendencias.filter((x) => x.status === "ABERTA" || x.status === "VENCIDA");
  const logs = aba === "log" ? await prisma.logAuditoria.findMany({
    where: { entidade_id: { in: [p.id, ...anexos.map((a) => a.id), ...pendencias.map((x) => x.id), ...pareceres.map((x) => x.id), ...condicionantes.map((x) => x.id), ...(checklist ? [checklist.id] : []), ...fiscalizacoes.map((f) => f.id)] } },
    include: { usuario: { select: { nome: true } } },
    orderBy: { created_at: "desc" },
    take: 300,
  }) : [];
  const temRecibo = documentos.some((d) => d.tipo === "RECIBO");
  const podeUpload = podeAnexar(u, p);

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500"><Link href="/processos" className="hover:underline">Processos</Link> / {p.municipio.nome}</p>
            <h1 className="titulo-pagina" data-testid="numero-processo">{p.numero ?? "Rascunho (não protocolado)"}</h1>
            <p className="mt-1 text-sm text-slate-700">{p.tipo_ato.sigla} – {p.tipo_ato.nome} · {p.empreendimento.nome}</p>
            <p className="text-sm text-slate-600">Requerente: {p.requerente.nome} · Técnico: {p.tecnico?.nome ?? "não distribuído"}</p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <span data-testid="status-processo"><BadgeStatus status={p.status} /></span>
            <span className="inline-flex items-center gap-2 text-sm text-slate-700" data-testid="prazo-processo">
              <PontoSemaforo s={sem} />
              {p.prazo_etapa_ate ? (
                <>
                  Prazo da etapa{p.etapa_atual ? ` (${ROTULO_ETAPA[p.etapa_atual] ?? p.etapa_atual.toLowerCase()})` : ""}: {fmtData(p.prazo_etapa_ate)}
                  {p.prazo_pausado ? <Badge cor="amarelo">relógio pausado{p.prazo_saldo_dias !== null ? ` · saldo ${p.prazo_saldo_dias} d` : ""}</Badge> : restantes !== null && <span className="text-xs text-slate-500">({restantes >= 0 ? `${restantes} dia(s)` : `vencido há ${-restantes} dia(s)`})</span>}
                </>
              ) : (
                "Sem prazo em curso"
              )}
            </span>
          </div>
        </div>
        {!somenteLeitura && acoes.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <AcoesProcesso processoId={p.id} acoes={acoes} tecnicos={tecnicos} parecerDesfavoravel={pareceres[0]?.conclusao === "DESFAVORAVEL"} />
          </div>
        )}
      </div>

      {/* Abas */}
      <nav aria-label="Seções do processo" className="-mx-1 overflow-x-auto">
        <ul className="flex min-w-max gap-1 border-b border-slate-200 px-1">
          {ABAS.map(([k, rot]) => (
            <li key={k}>
              <Link
                href={`/processos/${p.id}?aba=${k}`}
                aria-current={aba === k ? "page" : undefined}
                className={clsx("inline-block rounded-t-md px-3 py-2 text-sm", aba === k ? "border-b-2 border-primaria-700 font-semibold text-primaria-800" : "text-slate-600 hover:bg-slate-100")}
              >
                {rot}
                {k === "pendencias" && abertas.length > 0 && <span className="ml-1 rounded-full bg-amber-200 px-1.5 text-xs">{abertas.length}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {aba === "dados" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card titulo="Processo">
            <dl className="divide-y divide-slate-100">
              <Linha rotulo="Número">{p.numero ?? "—"}</Linha>
              <Linha rotulo="Tipo de ato">{p.tipo_ato.sigla} – {p.tipo_ato.nome}</Linha>
              <Linha rotulo="Município">{p.municipio.nome}</Linha>
              <Linha rotulo="Protocolo">{fmtDataHora(p.data_protocolo)}</Linha>
              <Linha rotulo="Conclusão">{fmtDataHora(p.data_conclusao)}</Linha>
              <Linha rotulo="Técnico">{p.tecnico?.nome ?? "—"}</Linha>
              <Linha rotulo="Gestor">{p.gestor?.nome ?? "—"}</Linha>
              <Linha rotulo="Exige vistoria / parecer">{p.tipo_ato.exige_vistoria ? "Sim" : "Não"} / {p.tipo_ato.exige_parecer ? "Sim" : "Não"}</Linha>
              <Linha rotulo="Descrição da atividade"><span className="whitespace-pre-line">{p.descricao_atividade ?? "—"}</span></Linha>
            </dl>
          </Card>
          <Card titulo="Empreendimento e requerente">
            <dl className="divide-y divide-slate-100">
              <Linha rotulo="Empreendimento"><Link className="text-primaria-700 hover:underline" href={`/empreendimentos/${p.empreendimento.id}`}>{p.empreendimento.nome}</Link></Linha>
              <Linha rotulo="Endereço">{formatarEndereco(p.empreendimento.endereco)}</Linha>
              <Linha rotulo="Coordenadas">{p.empreendimento.latitude && p.empreendimento.longitude ? `${p.empreendimento.latitude}, ${p.empreendimento.longitude}` : "—"}</Linha>
              <Linha rotulo="Tipologia">{p.empreendimento.tipologia.codigo} – {p.empreendimento.tipologia.descricao}</Linha>
              <Linha rotulo="Porte / grandeza">{ROTULO_PORTE[p.empreendimento.porte]} · {p.empreendimento.grandeza_porte ? `${fmtNumero(p.empreendimento.grandeza_porte, 2)} ${p.empreendimento.tipologia.unidade_porte}` : "—"}</Linha>
              <Linha rotulo="Potencial poluidor">{p.empreendimento.potencial_poluidor}</Linha>
              <Linha rotulo="Requerente">{p.requerente.nome} ({p.requerente.tipo}) · {p.requerente.cpf_cnpj_mascara}</Linha>
              <Linha rotulo="Responsável técnico">{p.rt ? `${p.rt.pessoa.nome} – ${p.rt.conselho} ${p.rt.registro_conselho}/${p.rt.uf_conselho}` : "—"}</Linha>
            </dl>
          </Card>
        </div>
      )}

      {aba === "documentos" && (
        <Card titulo="Documentos anexados" acoes={podeUpload && !somenteLeitura ? <UploadAnexo processoId={p.id} meta={{ tipo: "OUTRO" }} rotulo="Anexar documento" /> : null}>
          {exigidos.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 text-sm font-semibold">Documentos exigidos ({p.tipo_ato.sigla})</h3>
              <ul className="space-y-1 text-sm">
                {exigidos.map((d) => {
                  const ok = anexos.some((a) => a.documento_exigido_id === d.id);
                  return (
                    <li key={d.id} className="flex items-center gap-2">
                      <Badge cor={ok ? "verde" : d.obrigatorio ? "vermelho" : "cinza"}>{ok ? "Anexado" : d.obrigatorio ? "Faltando" : "Opcional"}</Badge>
                      {d.nome}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {anexos.length === 0 ? <Vazio>Nenhum arquivo anexado.</Vazio> : (
            <div className="overflow-x-auto">
              <table className="tabela">
                <thead><tr><th>Arquivo</th><th>Tipo</th><th>Tamanho</th><th>Enviado</th><th>SHA-256</th></tr></thead>
                <tbody>
                  {anexos.map((a) => (
                    <tr key={a.id}>
                      <td><a className="text-primaria-700 hover:underline" href={`/api/v1/anexos/${a.id}`}>{a.nome_arquivo}</a>{a.documento_exigido_id && <div className="text-xs text-slate-500">{exigidos.find((d) => d.id === a.documento_exigido_id)?.nome}</div>}</td>
                      <td>{a.tipo.replace(/_/g, " ").toLowerCase()}</td>
                      <td>{formatarTamanho(a.tamanho)}</td>
                      <td>{fmtDataHora(a.created_at)}<div className="text-xs text-slate-500">{nome(a.enviado_por)}</div></td>
                      <td className="font-mono text-xs" title={a.sha256}>{a.sha256.slice(0, 12)}…</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {aba === "tramitacao" && (
        <Card titulo="Tramitação">
          <LinhaDoTempo itens={tramitacoes.map((t) => ({ ...t, de_usuario: nome(t.de_usuario_id), para_usuario: nome(t.para_usuario_id) }))} />
        </Card>
      )}

      {aba === "pendencias" && (
        <Card titulo="Pendências">
          {pendencias.length === 0 ? <Vazio>Nenhuma pendência aberta para este processo.</Vazio> : (
            <ul className="space-y-3">
              {pendencias.map((x) => (
                <li key={x.id} className="rounded-md border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge cor={x.status === "ABERTA" ? "amarelo" : x.status === "RESPONDIDA" ? "verde" : x.status === "VENCIDA" ? "vermelho" : "cinza"}>{x.status.toLowerCase()}</Badge>
                    <Badge cor="azul">{x.tipo === "DOCUMENTAL" ? "Documental" : "Técnica"}</Badge>
                    <span className="text-xs text-slate-500">aberta em {fmtData(x.created_at)} · prazo {x.prazo_dias} dias (até {fmtData(x.prazo_ate)})</span>
                  </div>
                  <p className="mt-2 whitespace-pre-line text-sm">{x.descricao}</p>
                  {x.resposta && (
                    <div className="mt-2 rounded-md bg-emerald-50 p-2 text-sm">
                      <p className="text-xs font-semibold text-emerald-900">Resposta em {fmtDataHora(x.respondida_em)}</p>
                      <p className="whitespace-pre-line">{x.resposta}</p>
                    </div>
                  )}
                  {x.anexos.length > 0 && (
                    <ul className="mt-2 text-sm">
                      {x.anexos.map((a) => <li key={a.id}>Anexo: <a className="text-primaria-700 hover:underline" href={`/api/v1/anexos/${a.id}`}>{a.nome_arquivo}</a></li>)}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {aba === "checklist" && (
        <Card titulo={p.tipo_ato.checklist_modelo?.nome ?? "Checklist"}>
          {!p.tipo_ato.checklist_modelo ? <Vazio>Este tipo de ato não possui checklist.</Vazio> : (
            <>
              {checklist && <p className="mb-3 text-xs text-slate-500">Última atualização em {fmtDataHora(checklist.updated_at)} por {nome(checklist.preenchido_por)}.</p>}
              {checklistPendente.length > 0 && <div className="mb-3"><Aviso tipo="alerta">Itens obrigatórios pendentes: {checklistPendente.length}. O parecer só pode ser emitido com o checklist completo.</Aviso></div>}
              <FormChecklist processoId={p.id} itens={itensChecklist} respostas={respostas} editavel={podeEditarChecklist(u, p)} />
            </>
          )}
        </Card>
      )}

      {aba === "parecer" && (
        <div className="space-y-5">
          {pareceres.map((par) => (
            <Card key={par.id} titulo={`Parecer ${par.numero}`} acoes={<Badge cor={par.conclusao === "DESFAVORAVEL" ? "vermelho" : "verde"}>{ROTULO_CONCLUSAO[par.conclusao]}</Badge>}>
              <p className="mb-2 text-xs text-slate-500">Emitido em {fmtDataHora(par.created_at)} por {nome(par.autor_id)}</p>
              <div className="prose prose-sm max-w-none text-sm [&_p]:mb-2" dangerouslySetInnerHTML={{ __html: par.texto_html }} />
              {condicionantes.length > 0 && (
                <div className="mt-4">
                  <h3 className="mb-2 text-sm font-semibold">Condicionantes</h3>
                  <ol className="list-decimal space-y-1 pl-5 text-sm">
                    {condicionantes.map((c) => <li key={c.id}>{c.descricao}{c.periodicidade ? ` – ${c.periodicidade}` : ""}{c.prazo_ate ? ` (prazo: ${fmtData(c.prazo_ate)})` : ""}</li>)}
                  </ol>
                </div>
              )}
              <div className="mt-3">
                {par.documento_id ? (
                  <a className="btn-secundario btn-sm" href={`/api/v1/documentos/${par.documento_id}/pdf`}>Baixar PDF do parecer</a>
                ) : (
                  !somenteLeitura && <BotaoReemitir processoId={p.id} parecerId={par.id} rotulo="Gerar PDF do parecer" />
                )}
              </div>
            </Card>
          ))}
          {acoes.includes("parecer") ? (
            <Card titulo="Emitir parecer técnico">
              <FormParecer processoId={p.id} checklistPendente={checklistPendente} />
            </Card>
          ) : (
            pareceres.length === 0 && <Card><Vazio>Nenhum parecer emitido. O parecer é emitido durante a análise técnica (status “Em análise”).</Vazio></Card>
          )}
        </div>
      )}

      {aba === "vistorias" && (
        <Card titulo="Vistorias" acoes={!somenteLeitura && p.status !== "RASCUNHO" ? <Link href={`/fiscalizacao/nova?processo=${p.id}`} className="btn-secundario btn-sm">Registrar vistoria</Link> : null}>
          {p.tipo_ato.exige_vistoria && !fiscalizacoes.some((f) => f.status === "REALIZADA") && <div className="mb-3"><Aviso tipo="info">Este tipo de ato prevê vistoria técnica.</Aviso></div>}
          {fiscalizacoes.length === 0 ? <Vazio>Nenhuma vistoria vinculada.</Vazio> : (
            <div className="overflow-x-auto">
              <table className="tabela">
                <thead><tr><th>Data</th><th>Status</th><th>Constatação</th><th>Relato</th><th></th></tr></thead>
                <tbody>
                  {fiscalizacoes.map((f) => (
                    <tr key={f.id}>
                      <td>{fmtDataHora(f.data_hora)}</td>
                      <td><Badge cor={f.status === "REALIZADA" ? "verde" : f.status === "AGENDADA" ? "azul" : "cinza"}>{f.status.toLowerCase()}</Badge></td>
                      <td>{f.constatacao?.toLowerCase() ?? "—"}</td>
                      <td className="max-w-md truncate">{f.relato ?? "—"}</td>
                      <td><Link className="text-primaria-700 hover:underline" href={`/fiscalizacao/${f.id}`}>Abrir</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {aba === "emitidos" && (
        <Card titulo="Documentos emitidos" acoes={p.numero && !temRecibo && !somenteLeitura ? <BotaoReemitir processoId={p.id} rotulo="Gerar recibo de protocolo" /> : null}>
          {documentos.length === 0 ? <Vazio>Nenhum documento oficial emitido.</Vazio> : (
            <div className="overflow-x-auto">
              <table className="tabela">
                <thead><tr><th>Documento</th><th>Número</th><th>Emissão</th><th>Validade</th><th>Status</th><th>Código</th><th></th></tr></thead>
                <tbody>
                  {documentos.map((d) => (
                    <tr key={d.id}>
                      <td>{ROTULO_DOC[d.tipo] ?? d.tipo}</td>
                      <td>{d.numero}</td>
                      <td>{fmtDataHora(d.emitido_em)}<div className="text-xs text-slate-500">{d.emitido_por_nome}</div></td>
                      <td>{fmtData(d.validade_ate)}</td>
                      <td><Badge cor={d.status === "VALIDO" ? "verde" : "vermelho"}>{d.status.toLowerCase()}</Badge></td>
                      <td><Link className="font-mono text-xs text-primaria-700 hover:underline" href={`/validar/${d.codigo_verificador}`}>{d.codigo_verificador}</Link></td>
                      <td><a className="btn-secundario btn-sm" href={`/api/v1/documentos/${d.id}/pdf`}>PDF</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {aba === "log" && (
        <Card titulo="Log de auditoria">
          {logs.length === 0 ? <Vazio>Nenhum registro.</Vazio> : (
            <div className="overflow-x-auto">
              <table className="tabela">
                <thead><tr><th>Data/hora</th><th>Usuário</th><th>Ação</th><th>Entidade</th><th>IP</th></tr></thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id}>
                      <td className="whitespace-nowrap">{fmtDataHora(l.created_at)}</td>
                      <td>{l.usuario?.nome ?? "Sistema"}</td>
                      <td className="font-mono text-xs">{l.acao}</td>
                      <td>{l.entidade}</td>
                      <td className="text-xs">{l.ip ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
