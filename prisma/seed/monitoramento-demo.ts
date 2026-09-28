// Alertas de desmatamento FICTÍCIOS para a organização de demonstração (CID-DEMO), para que /monitoramento não fique vazio:
// os municípios da demo têm códigos IBGE fictícios (99…), então a sincronização real (INPE) os ignora.
// Polígonos inventados perto dos centros dos municípios fictícios; imóveis do CAR fictícios (formato oficial, UF-99…).
// O cruzamento local (empreendimentos/licenças) e a sugestão usam as funções reais de lib/monitoramento.
// NÃO gera avisos no sino (o T3 conta os alertas do tecnico.lor).
// DEMO-LOR-02 e DEMO-SSR-01 são detectados no dia do seed: as licenças da demo são emitidas nesse dia, então a
// sugestão é AUTORIZADO (licença vigente na data da detecção).
//
// Chamado ao fim de prisma/seed/demo.ts; também avulso: `npm run seed:monitoramento-demo` (idempotente por id_externo).
import path from "node:path";
import type { FonteAlertaDesmatamento, Prisma, StatusAlertaDesmatamento } from "@prisma/client";

try {
  process.loadEnvFile(path.resolve(__dirname, "../../.env"));
} catch {
  /* variáveis já no ambiente */
}

type Pos = [number, number];
type Demo = {
  id: string;
  mun: string;
  fonte: FonteAlertaDesmatamento;
  classe: string;
  dias: number;
  /** Deslocamento do centro do polígono em relação ao centro do município (graus) ou ao empreendimento `emp`. */
  dLat: number;
  dLng: number;
  /** Raio aproximado (graus) – define a área. */
  raio: number;
  status: StatusAlertaDesmatamento;
  /** Imóvel do CAR fictício intersectado: `emp:<chave>` usa o nº do CAR do empreendimento; senão um código fictício; null = fora do CAR. */
  car: string | null;
  /** Centraliza no empreendimento (nome) em vez do centro do município. */
  emp?: string;
  observacao?: string;
};

export const ALERTAS_DEMO: Demo[] = [
  { id: "DEMO-LOR-01", mun: "LOR", fonte: "DETER", classe: "DESMATAMENTO_CR", dias: 6, dLat: 0.045, dLng: -0.052, raio: 0.006, status: "NOVO", car: "BA-9900101-7C1D2E3F4A5B6C7D8E9F0A1B2C3D4E5F" },
  { id: "DEMO-LOR-02", mun: "LOR", fonte: "DETER", classe: "DESMATAMENTO_CR", dias: 0, dLat: 0, dLng: 0, raio: 0.0025, status: "NOVO", car: null, emp: "Laticínio Boa Vista – Lagoa do Orvalho" },
  { id: "DEMO-LOR-03", mun: "LOR", fonte: "DETER", classe: "DESMATAMENTO_CR", dias: 21, dLat: -0.061, dLng: 0.038, raio: 0.004, status: "NOVO", car: null },
  { id: "DEMO-LOR-04", mun: "LOR", fonte: "DETER", classe: "DESMATAMENTO_CR", dias: 40, dLat: 0.072, dLng: 0.064, raio: 0.005, status: "EM_ANALISE", car: "BA-9900101-0A9B8C7D6E5F4A3B2C1D0E9F8A7B6C5D" },
  { id: "DEMO-LOR-05", mun: "LOR", fonte: "PRODES", classe: "d2025", dias: 75, dLat: -0.083, dLng: -0.071, raio: 0.007, status: "DESCARTADO", car: "BA-9900101-11223344556677889900AABBCCDDEEFF", observacao: "Falso positivo: área de pastagem já consolidada em 2008 (imagem Wayback conferida)." },
  { id: "DEMO-SSR-01", mun: "SSR", fonte: "DETER", classe: "DESMATAMENTO_CR", dias: 0, dLat: 0.004, dLng: -0.003, raio: 0.005, status: "NOVO", car: "emp:Granja Santa Luzia – Serra Serena", emp: "Granja Santa Luzia – Serra Serena" },
  { id: "DEMO-SSR-02", mun: "SSR", fonte: "PRODES", classe: "d2025", dias: 110, dLat: 0.052, dLng: 0.047, raio: 0.008, status: "IRREGULAR", car: "BA-9900202-ABCDEF0123456789ABCDEF0123456789", observacao: "Supressão sem ASV confirmada em vistoria de rotina." },
  { id: "DEMO-AUM-01", mun: "AUM", fonte: "DETER", classe: "DESMATAMENTO_CR", dias: 12, dLat: 0.006, dLng: 0.005, raio: 0.006, status: "NOVO", car: "emp:Fazenda Leiteira Bom Jesus – Alto do Umbuzeiro", emp: "Fazenda Leiteira Bom Jesus – Alto do Umbuzeiro" },
  { id: "DEMO-CSE-01", mun: "CSE", fonte: "PRODES", classe: "d2025", dias: 95, dLat: -0.044, dLng: 0.058, raio: 0.009, status: "NOVO", car: "BA-9900303-FEDCBA9876543210FEDCBA9876543210" },
  { id: "DEMO-VMA-01", mun: "VMA", fonte: "DETER", classe: "DESMATAMENTO_CR", dias: 30, dLat: 0.035, dLng: -0.041, raio: 0.004, status: "NOVO", car: null },
];

/** Polígono irregular (octógono deformado) em torno de (lat, lng) – determinístico pelo id. */
function poligono(lat: number, lng: number, raio: number, semente: string): { type: "Polygon"; coordinates: Pos[][] } {
  let h = 0;
  for (const c of semente) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const anel: Pos[] = [];
  for (let i = 0; i < 8; i++) {
    const ang = (Math.PI * 2 * i) / 8;
    const f = 0.65 + (((h >> (i * 3)) & 7) / 7) * 0.5;
    anel.push([Math.round((lng + Math.cos(ang) * raio * f * 1.1) * 1e6) / 1e6, Math.round((lat + Math.sin(ang) * raio * f) * 1e6) / 1e6]);
  }
  anel.push(anel[0]);
  return { type: "Polygon", coordinates: [anel] };
}

/** Imóvel do CAR fictício que cobre o alerta (retângulo 3× maior que o alerta). */
function imovelFicticio(cod: string, lat: number, raio: number, areaAlertaHa: number) {
  const r = raio * 3;
  const areaImovel = Math.round(((r * 2 * 111_320 * Math.cos((lat * Math.PI) / 180)) * (r * 2 * 110_574)) / 10_000);
  return { cod_imovel: cod, area_imovel_ha: areaImovel, sobreposicao_ha: Math.round(areaAlertaHa * 10_000) / 10_000, percentual_alerta: 100, situacao: "Ativo", condicao: "Aguardando análise", tipo: "Imóvel rural", municipio: "(fictício)" };
}

export async function seedMonitoramentoDemo(opts: { log?: (...a: unknown[]) => void } = {}): Promise<number> {
  const log = opts.log ?? console.log;
  const { prisma } = await import("../../lib/db");
  const { contextoLocal, montarCruzamento } = await import("../../lib/monitoramento/sync");
  const { areaHa, centroide } = await import("../../lib/monitoramento/geo");
  const org = await prisma.organizacao.findFirst({ where: { sigla: "CID-DEMO" } });
  if (!org) {
    log("Organização CID-DEMO não encontrada – rode o seed base antes.");
    return 0;
  }
  const municipios = await prisma.municipio.findMany({ where: { organizacao_id: org.id } });
  const mun = Object.fromEntries(municipios.map((m) => [m.sigla, m]));
  const admin = await prisma.usuario.findUnique({ where: { email: "admin@licenciagov.demo" }, select: { id: true } });
  let criados = 0;
  for (const d of ALERTAS_DEMO) {
    const m = mun[d.mun];
    if (!m) continue;
    const existe = await prisma.alertaDesmatamento.findUnique({ where: { fonte_id_externo: { fonte: d.fonte, id_externo: d.id } }, select: { id: true } });
    if (existe) continue;
    let base: [number, number] = [Number(m.latitude), Number(m.longitude)];
    let numeroCar: string | null = d.car;
    if (d.emp) {
      const e = await prisma.empreendimento.findFirst({ where: { nome: d.emp, municipio_id: m.id }, select: { latitude: true, longitude: true, numero_car: true } });
      if (e?.latitude != null && e.longitude != null) base = [Number(e.latitude), Number(e.longitude)];
      if (d.car?.startsWith("emp:")) numeroCar = e?.numero_car ?? null;
    }
    const geometria = poligono(base[0] + d.dLat, base[1] + d.dLng, d.raio, d.id);
    const c = centroide(geometria);
    const area = Math.round(areaHa(geometria) * 10_000) / 10_000;
    const data = new Date(Date.now() - d.dias * 86_400_000);
    data.setUTCHours(0, 0, 0, 0);
    const car = { status: "OK" as const, metodo: "WFS_AREA" as const, imoveis: numeroCar ? [imovelFicticio(numeroCar, c.lat, d.raio, area)] : [] };
    const cruzamento = await montarCruzamento(await contextoLocal(m.id), geometria, car, data);
    const tratado = d.status !== "NOVO";
    const a = await prisma.alertaDesmatamento.create({
      data: {
        organizacao_id: org.id, municipio_id: m.id, fonte: d.fonte, id_externo: d.id, classe: d.classe, data_deteccao: data, area_ha: area,
        geometria, latitude: c.lat, longitude: c.lng, status: d.status, status_sugerido: cruzamento.sugestao,
        cruzamento: cruzamento as unknown as Prisma.InputJsonValue, cruzado_em: new Date(),
        dados_fonte: { ficticio: true, observacao: "Alerta FICTÍCIO de demonstração (não é dado do INPE)." },
        observacao: d.observacao ?? null, atualizado_por: tratado ? admin?.id ?? null : null,
      },
    });
    await prisma.logAuditoria.create({ data: { usuario_id: null, acao: "MONITORAMENTO_ALERTA_DEMO", entidade: "alerta_desmatamento", entidade_id: a.id, depois: { id_externo: d.id, municipio: d.mun, status: d.status, sugestao: cruzamento.sugestao } } });
    criados++;
  }
  log(`Monitoramento por satélite: ${criados} alerta(s) de desmatamento fictício(s) criado(s) (${ALERTAS_DEMO.length} no conjunto).`);
  return criados;
}

if (require.main === module) {
  seedMonitoramentoDemo()
    .then(async () => {
      const { prisma } = await import("../../lib/db");
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch((e) => {
      console.error("[seed:monitoramento-demo] falhou:", e);
      process.exit(1);
    });
}
