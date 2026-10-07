import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { ErroApi } from "@/lib/http";
import { fmtDataHora } from "@/lib/format";
import { Badge, CabecalhoPagina, Card, Vazio } from "@/components/ui";
import { Mapa } from "@/components/mapa";
import { obterDenuncia } from "@/lib/fiscalizacao/servico";
import { ehUuid } from "@/lib/fiscalizacao/api";
import { COR_BADGE_CONSTATACAO, COR_BADGE_DENUNCIA, COR_PIN_DENUNCIA, ROTULO_CANAL, ROTULO_CONSTATACAO, ROTULO_STATUS_DENUNCIA, podeEditarDenuncia, podeRegistrarVistoria } from "@/lib/fiscalizacao/regras";
import { SemAcesso } from "../../_componentes/sem-acesso";
import { FormStatusDenuncia } from "./status-form";

export const metadata = { title: "Denúncia – LicenciaGov" };

const ROTULO_ACAO: Record<string, string> = { CRIAR_DENUNCIA_PUBLICA: "Registrada pelo portal", CRIAR_DENUNCIA: "Registrada internamente", ALTERAR_STATUS_DENUNCIA: "Situação alterada", DENUNCIA_CANAL: "Registrada pelo assistente (atendimento)", CRIAR_DENUNCIA_ATENDIMENTO: "Registrada pelo atendente" };

export default async function DetalheDenuncia({ params }: { params: Promise<{ id: string }> }) {
  const u = await exigirUsuario({ interno: true });
  const { id } = await params;
  if (!ehUuid(id)) notFound();
  let d: Awaited<ReturnType<typeof obterDenuncia>>;
  try {
    d = await obterDenuncia(u, id);
  } catch (e) {
    if (e instanceof ErroApi && e.status === 404) notFound();
    if (e instanceof ErroApi && e.status === 403) return <SemAcesso />;
    throw e;
  }
  const temPonto = d.latitude != null && d.longitude != null;
  return (
    <div>
      <CabecalhoPagina
        titulo={`Denúncia ${d.protocolo}`}
        subtitulo={<>{d.municipio.nome} · {ROTULO_CANAL[d.canal]} · {fmtDataHora(d.created_at)} <Badge cor={COR_BADGE_DENUNCIA[d.status]}>{ROTULO_STATUS_DENUNCIA[d.status]}</Badge></>}
        acoes={<>
          {podeRegistrarVistoria(u, d.municipio_id) && <Link href={`/fiscalizacao/nova?denuncia=${d.id}`} className="btn-primario" data-testid="registrar-vistoria">Registrar vistoria</Link>}
          <Link href="/fiscalizacao/denuncias" className="btn-secundario">Voltar</Link>
        </>}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card titulo="Relato do denunciante">
          <p className="whitespace-pre-wrap text-sm">{d.descricao}</p>
          <dl className="mt-4 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[9rem_1fr]">
            <dt className="text-slate-500">Endereço</dt><dd>{d.endereco ?? "—"}</dd>
            <dt className="text-slate-500">Coordenadas</dt><dd className="font-mono">{temPonto ? `${d.latitude!.toFixed(6)}, ${d.longitude!.toFixed(6)}` : "—"}</dd>
            <dt className="text-slate-500">Denunciante</dt><dd>{d.anonima ? "Anônimo" : d.denunciante_nome ?? "—"}</dd>
            {!d.anonima && <><dt className="text-slate-500">Contato</dt><dd>{d.contato ?? "—"}</dd></>}
            {d.conversa_id && <><dt className="text-slate-500">Atendimento</dt><dd><Link href={`/atendimento/${d.conversa_id}`} className="text-primaria-700 underline" data-testid="link-conversa">Ver conversa</Link></dd></>}
          </dl>
          {d.anexos.length > 0 && (
            <div className="mt-4" data-testid="fotos-denuncia">
              <p className="mb-2 text-sm font-medium text-slate-700">Fotos enviadas pelo cidadão ({d.anexos.length})</p>
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {d.anexos.map((a) => (
                  <li key={a.id}>
                    <a href={`/api/v1/denuncias/${d.id}/fotos/${a.id}`} target="_blank" rel="noreferrer" title={`${a.nome_arquivo} · sha256 ${a.sha256.slice(0, 12)}…`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/v1/denuncias/${d.id}/fotos/${a.id}`} alt={a.nome_arquivo} className="aspect-square w-full rounded-md object-cover ring-1 ring-slate-200" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
        <Card titulo="Local">
          {temPonto ? <Mapa centro={[d.latitude!, d.longitude!]} zoom={15} altura="300px" pontos={[{ id: d.id, lat: d.latitude!, lng: d.longitude!, titulo: d.protocolo, cor: COR_PIN_DENUNCIA[d.status] }]} /> : <Vazio>Local não marcado no mapa.</Vazio>}
        </Card>
        <Card titulo={`Vistorias (${d.fiscalizacoes.length})`}>
          {d.fiscalizacoes.length === 0 ? <Vazio>Nenhuma vistoria registrada.</Vazio> : (
            <ul className="divide-y divide-slate-100">
              {d.fiscalizacoes.map((f) => (
                <li key={f.id} className="flex items-center justify-between py-2 text-sm">
                  <Link href={`/fiscalizacao/${f.id}`} className="text-primaria-700 underline">{fmtDataHora(f.data_hora)}</Link>
                  {f.constatacao && <Badge cor={COR_BADGE_CONSTATACAO[f.constatacao]}>{ROTULO_CONSTATACAO[f.constatacao]}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card titulo="Histórico e despachos">
          <ol className="space-y-3 text-sm">
            {d.historico.map((h) => (
              <li key={h.id} className="border-l-2 border-primaria-600 pl-3">
                <div className="font-medium">{ROTULO_ACAO[h.acao] ?? h.acao}{h.depois?.status ? ` → ${ROTULO_STATUS_DENUNCIA[h.depois.status as keyof typeof ROTULO_STATUS_DENUNCIA] ?? h.depois.status}` : ""}</div>
                <div className="text-xs text-slate-500">{fmtDataHora(h.em)} · {h.usuario}</div>
                {typeof h.depois?.despacho === "string" && <p className="mt-1 whitespace-pre-wrap">{h.depois.despacho}</p>}
              </li>
            ))}
          </ol>
          {podeEditarDenuncia(u, d.municipio_id) && (
            <div className="mt-4 border-t border-slate-100 pt-4"><FormStatusDenuncia id={d.id} status={d.status} /></div>
          )}
        </Card>
      </div>
    </div>
  );
}
