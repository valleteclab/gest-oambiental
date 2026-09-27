import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { can, isSomenteLeitura } from "@/lib/rbac";
import { fichaEmpreendimento, obterEmpreendimentoBasico } from "@/lib/cadastros/empreendimentos";
import { podeVerPessoa } from "@/lib/cadastros/pessoas";
import { ROTULO_PORTE } from "@/lib/cadastros/porte";
import { formatarEndereco } from "@/lib/cadastros/validacao";
import { fmtDataPura } from "@/lib/cadastros/datas";
import { fmtData, fmtDataHora, fmtNumero } from "@/lib/format";
import { AcessoNegado } from "@/components/acesso-negado";
import { Mapa } from "@/components/mapa";
import { Aviso, Badge, BadgeStatus, CabecalhoPagina, Card, Vazio } from "@/components/ui";

export const metadata = { title: "Ficha do empreendimento – LicenciaGov" };

const ROTULO_PP = { BAIXO: "Baixo", MEDIO: "Médio", ALTO: "Alto" } as const;
const ROTULO_DOC: Record<string, string> = { LICENCA: "Licença", AUTORIZACAO: "Autorização", CERTIDAO: "Certidão" };

function statusDocumento(d: { status: string; validade_ate: Date | null }) {
  if (d.status === "CANCELADO") return <Badge cor="vermelho">Cancelado</Badge>;
  if (d.status === "SUBSTITUIDO") return <Badge cor="cinza">Substituído</Badge>;
  if (d.validade_ate && d.validade_ate < new Date()) return <Badge cor="amarelo">Vencido</Badge>;
  return <Badge cor="verde">Válido</Badge>;
}

export default async function FichaEmpreendimento({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ salvo?: string }> }) {
  const u = await exigirUsuario({ interno: true });
  const { id } = await params;
  const { salvo } = await searchParams;
  const basico = await obterEmpreendimentoBasico(u, id);
  if (basico === null) notFound();
  if (basico === "PROIBIDO" || !can(u, "ver", "empreendimento", basico.municipio_id)) return <AcessoNegado />;
  const e = await fichaEmpreendimento(id);
  if (!e) notFound();
  const verRequerente = await podeVerPessoa(u, e.requerente_id);
  const rtAtual = e.rts.find((r) => !r.ate);
  const lat = e.latitude ? Number(e.latitude) : null;
  const lng = e.longitude ? Number(e.longitude) : null;
  const podeEditar = !isSomenteLeitura(u) && can(u, "editar", "empreendimento", e.municipio_id);

  return (
    <>
      <CabecalhoPagina
        titulo={e.nome}
        subtitulo={<>{e.municipio.nome}/BA · {e.tipologia.codigo} – {e.tipologia.descricao} {e.status === "INATIVO" ? <Badge>Inativo</Badge> : <Badge cor="verde">Ativo</Badge>}</>}
        acoes={podeEditar ? <Link href={`/empreendimentos/${id}/editar`} className="btn-secundario">Editar</Link> : undefined}
      />
      <div className="space-y-6">
        {salvo && <Aviso tipo="sucesso">Empreendimento salvo.</Aviso>}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card titulo="Requerente e responsável técnico">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-slate-500">Requerente</dt>
                <dd data-testid="ficha-requerente">
                  {verRequerente ? <Link href={`/pessoas/${e.requerente.id}`} className="font-medium text-primaria-700 hover:underline">{e.requerente.nome}</Link> : <span className="font-medium">{e.requerente.nome}</span>}
                  <span className="ml-2 font-mono text-xs text-slate-500">{e.requerente.cpf_cnpj_mascara}</span>
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Responsável técnico atual</dt>
                <dd data-testid="ficha-rt">
                  {rtAtual ? (
                    <>
                      <Link href={`/responsaveis-tecnicos/${rtAtual.rt.id}`} className="font-medium text-primaria-700 hover:underline">{rtAtual.rt.pessoa.nome}</Link>
                      <div>{rtAtual.rt.formacao} · <strong>{rtAtual.rt.conselho} nº {rtAtual.rt.registro_conselho}/{rtAtual.rt.uf_conselho}</strong></div>
                      <div className="text-xs text-slate-500">desde {fmtDataPura(rtAtual.desde)}</div>
                    </>
                  ) : "—"}
                </dd>
              </div>
              {e.rts.length > 1 && (
                <div>
                  <dt className="text-slate-500">Histórico de RTs</dt>
                  <dd>
                    <ul className="list-inside list-disc">
                      {e.rts.filter((r) => r.ate).map((r) => (
                        <li key={r.id}>{r.rt.pessoa.nome} ({r.rt.conselho} {r.rt.registro_conselho}/{r.rt.uf_conselho}) – {fmtDataPura(r.desde)} a {fmtDataPura(r.ate)}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
            </dl>
          </Card>
          <Card titulo="Atividade">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="sm:col-span-2"><dt className="text-slate-500">Tipologia</dt><dd>{e.tipologia.codigo} – {e.tipologia.descricao} <span className="text-slate-500">({e.tipologia.divisao})</span></dd></div>
              <div><dt className="text-slate-500">Grandeza</dt><dd>{e.grandeza_porte ? `${fmtNumero(e.grandeza_porte, 2)} ${e.tipologia.unidade_porte}` : "—"}</dd></div>
              <div><dt className="text-slate-500">Porte</dt><dd>{ROTULO_PORTE[e.porte]} {e.porte_justificativa && <Badge cor="amarelo">Ajustado pelo técnico</Badge>}</dd></div>
              <div><dt className="text-slate-500">Potencial poluidor</dt><dd>{ROTULO_PP[e.potencial_poluidor]}</dd></div>
              <div><dt className="text-slate-500">Área</dt><dd>{e.area_m2 ? `${fmtNumero(e.area_m2, 2)} m²` : "—"}</dd></div>
              <div><dt className="text-slate-500">CAR</dt><dd>{e.numero_car ?? "—"}</dd></div>
              {e.porte_justificativa && <div className="sm:col-span-2"><dt className="text-slate-500">Justificativa do porte</dt><dd>{e.porte_justificativa}</dd></div>}
            </dl>
          </Card>
        </div>

        <Card titulo="Localização">
          <p className="mb-3 text-sm">
            <span className="text-slate-500">Endereço:</span> {formatarEndereco(e.endereco)}<br />
            <span className="text-slate-500">Coordenadas:</span>{" "}
            <span data-testid="ficha-coordenadas" className="font-mono">{lat !== null && lng !== null ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : "não informadas"}</span>
          </p>
          {lat !== null && lng !== null ? (
            <Mapa centro={[lat, lng]} zoom={14} altura="320px" pontos={[{ id: e.id, lat, lng, titulo: e.nome, descricao: e.municipio.nome }]} poligono={(e.poligono_geojson as GeoJSON.GeoJsonObject | null) ?? null} />
          ) : (
            <Vazio>Sem coordenadas cadastradas.</Vazio>
          )}
        </Card>

        <Card titulo={`Processos (${e.processos.length})`}>
          {e.processos.length === 0 ? <Vazio>Nenhum processo para este empreendimento.</Vazio> : (
            <div className="overflow-x-auto">
              <table className="tabela" data-testid="ficha-processos">
                <thead><tr><th>Número</th><th>Tipo de ato</th><th>Protocolo</th><th>RT</th><th>Status</th></tr></thead>
                <tbody>
                  {e.processos.map((p) => (
                    <tr key={p.id}>
                      <td><Link href={`/processos/${p.id}`} className="font-mono text-primaria-700 hover:underline">{p.numero ?? "(rascunho)"}</Link></td>
                      <td><abbr title={p.tipo_ato.nome} className="no-underline">{p.tipo_ato.sigla}</abbr></td>
                      <td>{fmtData(p.data_protocolo)}</td>
                      <td>{p.rt?.pessoa.nome ?? "—"}</td>
                      <td><BadgeStatus status={p.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card titulo={`Licenças e documentos vinculados (${e.documentos.length})`}>
          {e.documentos.length === 0 ? <Vazio>Nenhuma licença emitida.</Vazio> : (
            <div className="overflow-x-auto">
              <table className="tabela" data-testid="ficha-licencas">
                <thead><tr><th>Documento</th><th>Tipo</th><th>Processo</th><th>Emissão</th><th>Validade</th><th>Situação</th><th>Autenticidade</th></tr></thead>
                <tbody>
                  {e.documentos.map((d) => (
                    <tr key={d.id}>
                      <td className="font-mono">{d.numero}</td>
                      <td>{ROTULO_DOC[d.tipo] ?? d.tipo}{d.sigla_ato ? ` (${d.sigla_ato})` : ""}</td>
                      <td>{d.processo ? <Link href={`/processos/${d.processo.id}`} className="font-mono text-primaria-700 hover:underline">{d.processo.numero}</Link> : "—"}</td>
                      <td>{fmtData(d.emitido_em)}</td>
                      <td>{fmtData(d.validade_ate)}</td>
                      <td>{statusDocumento(d)}</td>
                      <td><Link href={`/validar/${d.codigo_verificador}`} className="font-mono text-xs text-primaria-700 hover:underline" target="_blank">{d.codigo_verificador}</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card titulo={`Fiscalizações (${e.fiscalizacoes.length})`}>
          {e.fiscalizacoes.length === 0 ? <Vazio>Nenhuma fiscalização registrada.</Vazio> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {e.fiscalizacoes.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span><Link href={`/fiscalizacao/${f.id}`} className="text-primaria-700 hover:underline">{fmtDataHora(f.data_hora)}</Link> · origem {f.origem.toLowerCase()} · {f._count.autos} auto(s), {f._count.notificacoes} notificação(ões)</span>
                  {f.constatacao && <Badge cor={f.constatacao === "IRREGULAR" ? "vermelho" : f.constatacao === "REGULAR" ? "verde" : "amarelo"}>{f.constatacao.toLowerCase()}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
