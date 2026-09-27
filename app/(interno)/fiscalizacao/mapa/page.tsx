import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can, whereMunicipio } from "@/lib/rbac";
import { fmtDataHora } from "@/lib/format";
import { CabecalhoPagina, Card } from "@/components/ui";
import { Mapa, type PontoMapa } from "@/components/mapa";
import { municipiosDoUsuario } from "@/lib/fiscalizacao/servico";
import { COR_PIN_CONSTATACAO, COR_PIN_DENUNCIA, ROTULO_CONSTATACAO, ROTULO_STATUS_DENUNCIA } from "@/lib/fiscalizacao/regras";
import { AbasFiscalizacao } from "../_componentes/abas";
import { SemAcesso } from "../_componentes/sem-acesso";
import { sp1, type SP } from "../_componentes/util";

export const metadata = { title: "Mapa da fiscalização – LicenciaGov" };
const LIMITE = 2000;

export default async function MapaFiscalizacao({ searchParams }: { searchParams: SP }) {
  const u = await exigirUsuario({ interno: true });
  if (!can(u, "ver", "fiscalizacao")) return <SemAcesso mensagem="Seu perfil não tem acesso à fiscalização." />;
  const s = await searchParams;
  const municipio = sp1(s.municipio);
  const tipo = sp1(s.tipo) ?? "todos"; // todos | vistorias | denuncias
  const constatacao = sp1(s.constatacao);
  const status = sp1(s.status);
  const escopo = whereMunicipio(u, municipio);
  const coords = { latitude: { not: null }, longitude: { not: null } } as const;

  const [municipios, fisc, dens] = await Promise.all([
    municipiosDoUsuario(u),
    tipo === "denuncias" ? [] : prisma.fiscalizacao.findMany({
      where: { ...escopo, ...coords, ...(constatacao && constatacao in ROTULO_CONSTATACAO ? { constatacao: constatacao as never } : {}) },
      orderBy: { data_hora: "desc" }, take: LIMITE,
      select: { id: true, latitude: true, longitude: true, data_hora: true, constatacao: true, municipio: { select: { sigla: true } }, empreendimento: { select: { nome: true } } },
    }),
    tipo === "vistorias" ? [] : prisma.denuncia.findMany({
      where: { ...escopo, ...coords, ...(status && status in ROTULO_STATUS_DENUNCIA ? { status: status as never } : {}) },
      orderBy: { created_at: "desc" }, take: LIMITE,
      select: { id: true, protocolo: true, latitude: true, longitude: true, status: true, endereco: true },
    }),
  ]);

  const pontos: PontoMapa[] = [
    ...fisc.map((f) => ({
      id: `f-${f.id}`, lat: Number(f.latitude), lng: Number(f.longitude), cor: COR_PIN_CONSTATACAO[f.constatacao ?? "SEM"],
      titulo: `Vistoria ${fmtDataHora(f.data_hora)} (${f.municipio.sigla})`,
      descricao: `${f.constatacao ? ROTULO_CONSTATACAO[f.constatacao] : "Sem constatação"}${f.empreendimento ? ` · ${f.empreendimento.nome}` : ""}`,
      href: `/fiscalizacao/${f.id}`,
    })),
    ...dens.map((d) => ({
      id: `d-${d.id}`, lat: Number(d.latitude), lng: Number(d.longitude), cor: COR_PIN_DENUNCIA[d.status],
      titulo: `Denúncia ${d.protocolo}`, descricao: `${ROTULO_STATUS_DENUNCIA[d.status]}${d.endereco ? ` · ${d.endereco}` : ""}`, href: `/fiscalizacao/denuncias/${d.id}`,
    })),
  ];
  const mun = municipios.find((m) => m.id === municipio);
  const centro: [number, number] = mun?.latitude != null && mun.longitude != null ? [mun.latitude, mun.longitude] : pontos.length === 1 ? [pontos[0].lat, pontos[0].lng] : [-12.45, -40.2];

  return (
    <div>
      <CabecalhoPagina titulo="Mapa da fiscalização" subtitulo={`${fisc.length} vistoria(s) e ${dens.length} denúncia(s) georreferenciadas`} />
      <AbasFiscalizacao ativa="/fiscalizacao/mapa" />
      <form className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5" method="get">
        <label className="block"><span className="label">Município</span>
          <select name="municipio" defaultValue={municipio ?? ""} className="input"><option value="">Todos</option>{municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</select>
        </label>
        <label className="block"><span className="label">Exibir</span>
          <select name="tipo" defaultValue={tipo} className="input"><option value="todos">Vistorias e denúncias</option><option value="vistorias">Somente vistorias</option><option value="denuncias">Somente denúncias</option></select>
        </label>
        <label className="block"><span className="label">Constatação (vistorias)</span>
          <select name="constatacao" defaultValue={constatacao ?? ""} className="input"><option value="">Todas</option>{Object.entries(ROTULO_CONSTATACAO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <label className="block"><span className="label">Situação (denúncias)</span>
          <select name="status" defaultValue={status ?? ""} className="input"><option value="">Todas</option>{Object.entries(ROTULO_STATUS_DENUNCIA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <div className="flex items-end gap-2"><button className="btn-primario">Filtrar</button><Link href="/fiscalizacao/mapa" className="btn-secundario">Limpar</Link></div>
      </form>
      <Card>
        <div data-testid="mapa-fiscalizacao" data-pontos={pontos.length}>
          <Mapa key={`${municipio}-${tipo}-${constatacao}-${status}`} centro={centro} zoom={mun ? 12 : 8} altura="min(70vh, 600px)" pontos={pontos} />
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-700" aria-label="Legenda">
          <span className="font-semibold">Vistorias:</span>
          {Object.entries(ROTULO_CONSTATACAO).map(([k, v]) => <span key={k} className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full" style={{ background: COR_PIN_CONSTATACAO[k as keyof typeof ROTULO_CONSTATACAO] }} />{v}</span>)}
          <span className="font-semibold">Denúncias:</span>
          {Object.entries(ROTULO_STATUS_DENUNCIA).map(([k, v]) => <span key={k} className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full" style={{ background: COR_PIN_DENUNCIA[k as keyof typeof ROTULO_STATUS_DENUNCIA] }} />{v}</span>)}
        </div>
      </Card>
    </div>
  );
}
