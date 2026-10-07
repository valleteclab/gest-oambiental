import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { ErroApi } from "@/lib/http";
import { isSomenteLeitura } from "@/lib/rbac";
import { fmtData, fmtDataHora, fmtNumero } from "@/lib/format";
import { Aviso, Badge, CabecalhoPagina, Card, Vazio } from "@/components/ui";
import { CompararImagens, Mapa } from "@/components/mapa";
import { documentosVinculaveis, obterAlerta } from "@/lib/monitoramento/servico";
import { COR_BADGE_STATUS_ALERTA, ROTULO_FONTE, ROTULO_STATUS_ALERTA, ROTULO_SUGESTAO, podeTratarAlerta, type Sugestao } from "@/lib/monitoramento/regras";
import { AcoesAlerta } from "../_componentes/acoes-alerta";

export const dynamic = "force-dynamic";
export const metadata = { title: "Alerta de desmatamento – LicenciaGov" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COR_SUGESTAO: Record<Sugestao, "sucesso" | "erro" | "alerta" | "info"> = { AUTORIZADO: "sucesso", POSSIVEL_IRREGULAR: "erro", SEM_CAR: "alerta", INDETERMINADO: "info" };

export default async function FichaAlerta({ params }: { params: Promise<{ id: string }> }) {
  const u = await exigirUsuario({ interno: true });
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  let a: Awaited<ReturnType<typeof obterAlerta>>;
  try {
    a = await obterAlerta(u, id);
  } catch (e) {
    if (e instanceof ErroApi && e.status === 404) notFound();
    if (e instanceof ErroApi && e.status === 403) forbidden();
    throw e;
  }
  const c = a.cruzamento;
  const tratar = podeTratarAlerta(u, a.municipio_id) && !isSomenteLeitura(u);
  const docs = tratar ? await documentosVinculaveis(u, a.municipio_id, c?.empreendimentos?.map((e) => e.id) ?? []) : [];
  const df = a.dados_fonte;
  const ficticio = df.ficticio === true;
  const imoveis = c?.car?.imoveis ?? [];

  return (
    <div data-testid="ficha-alerta" data-id-externo={a.id_externo}>
      <CabecalhoPagina
        titulo={`Alerta ${a.fonte} ${a.id_externo}`}
        subtitulo={<>{a.municipio.nome} · detectado em {fmtData(a.data_deteccao)} · <strong>{fmtNumero(a.area_ha, 2)} ha</strong> · <Badge cor={COR_BADGE_STATUS_ALERTA[a.status]}><span data-testid="status-alerta">{ROTULO_STATUS_ALERTA[a.status]}</span></Badge></>}
        acoes={<Link href="/monitoramento" className="btn-secundario btn-sm">Voltar</Link>}
      />
      {ficticio && <div className="mb-4"><Aviso tipo="alerta">Alerta <strong>fictício</strong> de demonstração – não é dado do INPE.</Aviso></div>}

      {c && (
        <div className="mb-4" data-testid="sugestao">
          <Aviso tipo={COR_SUGESTAO[c.sugestao]}>
            <strong>Sugestão do cruzamento: {ROTULO_SUGESTAO[c.sugestao]}.</strong> {c.motivo}
            <span className="block text-xs text-slate-600">Cruzamento em {fmtDataHora(c.consultado_em)}. A decisão é do técnico – a sugestão não altera a situação do alerta.</span>
          </Aviso>
        </div>
      )}

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card titulo="Área do alerta sobre o satélite" className="lg:col-span-2">
          {a.geometria ? (
            <Mapa poligono={a.geometria} centro={[a.latitude, a.longitude]} zoom={14} altura="420px" camadasIniciais={["car", "esri-rotulos"]} />
          ) : <Vazio>Alerta sem polígono (apenas o ponto {a.latitude}, {a.longitude}).</Vazio>}
          <p className="mt-2 text-xs text-slate-600">Contorno amarelo: área do alerta. Contornos azuis: imóveis do CAR (a partir do zoom 11).</p>
        </Card>
        <Card titulo="Dados do alerta">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-slate-500">Fonte</dt><dd>{ROTULO_FONTE[a.fonte]}</dd>
            <dt className="text-slate-500">Identificador</dt><dd className="break-all">{a.id_externo}</dd>
            <dt className="text-slate-500">Classe</dt><dd>{a.classe}</dd>
            <dt className="text-slate-500">Detecção</dt><dd>{fmtData(a.data_deteccao)}</dd>
            <dt className="text-slate-500">Área</dt><dd>{fmtNumero(a.area_ha, 4)} ha</dd>
            <dt className="text-slate-500">Centroide</dt><dd>{a.latitude.toFixed(6)}, {a.longitude.toFixed(6)}</dd>
            {typeof df.satellite === "string" && <><dt className="text-slate-500">Satélite</dt><dd>{df.satellite}{typeof df.sensor === "string" ? ` / ${df.sensor}` : ""}</dd></>}
            {typeof df.publish_month === "string" && <><dt className="text-slate-500">Publicação</dt><dd>{fmtData(`${df.publish_month}T12:00:00Z`)}</dd></>}
            <dt className="text-slate-500">Município</dt><dd>{a.municipio.nome}</dd>
            <dt className="text-slate-500">Registrado em</dt><dd>{fmtDataHora(a.created_at)}</dd>
          </dl>
        </Card>
      </div>

      <Card titulo="Comparar imagens (antes/depois)" className="mb-4">
        <CompararImagens lat={a.latitude} lng={a.longitude} zoom={15} poligono={a.geometria} titulo={`Alerta ${a.id_externo}`} />
      </Card>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card titulo={`Imóveis do CAR intersectados (${imoveis.length})`}>
          {!c || c.car.status === "NAO_CONSULTADO" ? <Vazio>Cruzamento com o CAR ainda não realizado.</Vazio>
            : c.car.status === "ERRO" ? <Aviso tipo="alerta">Consulta ao SICAR falhou ({c.car.erro}). Será refeita na próxima sincronização.</Aviso>
            : imoveis.length === 0 ? <Vazio>Nenhum imóvel do CAR intersecta a área do alerta.</Vazio>
            : (
              <div className="overflow-x-auto">
                <table className="tabela" data-testid="tabela-car">
                  <thead><tr><th>Imóvel (CAR)</th><th>Situação</th><th className="text-right">Área do imóvel (ha)</th><th className="text-right">Sobreposição (ha)</th><th className="text-right">% do alerta</th></tr></thead>
                  <tbody>
                    {imoveis.map((i) => (
                      <tr key={i.cod_imovel}>
                        <td className="break-all text-xs">{i.cod_imovel}<div className="text-slate-500">{i.tipo}{i.condicao ? ` · ${i.condicao}` : ""}</div></td>
                        <td>{i.situacao}</td>
                        <td className="text-right">{i.area_imovel_ha == null ? "—" : fmtNumero(i.area_imovel_ha, 2)}</td>
                        <td className="text-right font-medium">{fmtNumero(i.sobreposicao_ha, 2)}</td>
                        <td className="text-right">{fmtNumero(i.percentual_alerta, 1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </Card>
        <Card titulo="Empreendimentos e licenças locais relacionados">
          {!c?.empreendimentos?.length ? <Vazio>Nenhum empreendimento do cadastro municipal relacionado (pelo nº do CAR ou pela localização).</Vazio> : (
            <ul className="divide-y divide-slate-100" data-testid="empreendimentos-relacionados">
              {c.empreendimentos.map((e) => (
                <li key={e.id} className="py-2 text-sm">
                  <Link href={`/empreendimentos/${e.id}`} className="font-medium text-primaria-700 hover:underline">{e.nome}</Link>
                  <span className="ml-2 text-xs text-slate-500">{e.via === "CAR" ? "mesmo nº do CAR" : "localização dentro do alerta"}</span>
                  {e.processos.length > 0 && <div className="mt-1 text-xs">Processos: {e.processos.map((p, i) => <span key={p.id}>{i > 0 && ", "}<Link href={`/processos/${p.id}`} className="hover:underline">{p.sigla} {p.numero ?? "(rascunho)"}</Link></span>)}</div>}
                  {e.documentos.length > 0 && (
                    <div className="mt-1 text-xs">Documentos: {e.documentos.map((d, i) => <span key={d.id}>{i > 0 && ", "}{d.sigla_ato} {d.numero} ({d.status === "VALIDO" ? `válida${d.validade_ate ? ` até ${fmtData(d.validade_ate)}` : ""}` : d.status.toLowerCase()})</span>)}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card titulo="Tratamento">
        <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-slate-500">Situação</dt><dd>{ROTULO_STATUS_ALERTA[a.status]}{a.atualizado_por_nome ? <span className="text-slate-500"> – por {a.atualizado_por_nome} em {fmtDataHora(a.updated_at)}</span> : null}</dd>
          {a.observacao && <><dt className="text-slate-500">Observação</dt><dd className="whitespace-pre-wrap" data-testid="observacao-alerta">{a.observacao}</dd></>}
          {a.documento && <><dt className="text-slate-500">Autorização</dt><dd><Link href={`/documentos/${a.documento.id}`} className="text-primaria-700 hover:underline" data-testid="documento-vinculado">{a.documento.sigla_ato} {a.documento.numero}</Link>{a.documento.validade_ate ? ` (até ${fmtData(a.documento.validade_ate)})` : ""}</dd></>}
          {a.fiscalizacao && <><dt className="text-slate-500">Fiscalização</dt><dd><Link href={`/fiscalizacao/${a.fiscalizacao.id}`} className="text-primaria-700 hover:underline" data-testid="link-fiscalizacao">Vistoria {a.fiscalizacao.status.toLowerCase()} – {fmtDataHora(a.fiscalizacao.data_hora)}</Link></dd></>}
          {a.denuncia && <><dt className="text-slate-500">Denúncia</dt><dd><Link href={`/fiscalizacao/denuncias/${a.denuncia.id}`} className="text-primaria-700 hover:underline">{a.denuncia.protocolo}</Link></dd></>}
        </dl>
        {tratar ? (
          <AcoesAlerta
            id={a.id}
            status={a.status}
            temFiscalizacao={!!a.fiscalizacao_id}
            documentoSugerido={c?.documento_sugerido?.id ?? null}
            documentos={docs.map((d) => ({ id: d.id, numero: d.numero, sigla_ato: d.sigla_ato, validade: d.validade_ate ? fmtData(d.validade_ate) : null, empreendimento: d.empreendimento, relacionado: d.relacionado }))}
          />
        ) : (
          <p className="text-sm text-slate-600" data-testid="somente-leitura">Seu perfil tem acesso somente de leitura ao monitoramento.</p>
        )}
      </Card>
    </div>
  );
}
