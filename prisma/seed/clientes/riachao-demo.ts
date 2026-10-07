// Dados de DEMONSTRAÇÃO do cliente Riachão das Neves (BA) – apresentação à Prefeitura.
// Executar DEPOIS do onboarding:  npm run onboard -- riachao-das-neves --demo  &&  npm run seed:riachao-demo
// NUNCA rodar em produção do cliente após a implantação. Idempotente: não faz nada se o marcador já existir.
//
// Tudo é FICTÍCIO: empresas, pessoas, CPFs/CNPJs (gerados com dígitos verificadores válidos), responsáveis técnicos,
// números de CAR e coordenadas (pontos plausíveis no interior do município, sem relação com imóveis reais).
// Os dados são criados pelos SERVIÇOS REAIS (cadastros, rascunho, anexos, transicionar, emissão de documentos com
// PDF/QR, fiscalização, alertas) – como prisma/seed/demo.ts. Depois, só datas são ajustadas para espalhar o histórico.
//
// Os módulos de lib/ importam "server-only": rodar com `tsx --conditions=react-server` (ver package.json).
import path from "node:path";
import { readFileSync } from "node:fs";
import type { PrismaClient, StatusProcesso } from "@prisma/client";
import { dataIso, gerarCpf as cpfDemanda, semearDemandas } from "../demandas-demo";

try {
  process.loadEnvFile(path.resolve(__dirname, "../../../.env"));
} catch {
  /* variáveis já no ambiente */
}

const RAIZ = path.resolve(__dirname, "../../..");
const FIXTURES = path.join(RAIZ, "tests/fixtures");
const ORG_SIGLA = "PM-RDN";
const MUN = "RDN";
const MARCADOR = "Fazenda Chapadão Azul – Pivôs Centrais";
const DIA = 86400000;
const EMAIL = { admin: "admin.rdn@licenciagov.demo", tec: "tecnico.rdn@licenciagov.demo", gestor: "gestor.rdn@licenciagov.demo", fiscal: "fiscal.rdn@licenciagov.demo" };

function diasAtras(n: number, hora = 10, minuto = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hora, minuto, 0, 0);
  return d;
}
function fimDoDia(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(23, 59, 59, 0);
  return d;
}
/** CPF válido (fictício) a partir de 9 dígitos-base. */
function gerarCpf(base9: string): string {
  const d = base9.split("").map(Number);
  for (const n of [9, 10]) {
    let s = 0;
    for (let i = 0; i < n; i++) s += d[i] * (n + 1 - i);
    const r = (s * 10) % 11;
    d.push(r === 10 ? 0 : r);
  }
  return d.join("");
}
/** CNPJ válido (fictício) a partir de 8 dígitos de raiz + filial 0001. */
function gerarCnpj(raiz8: string, filial = "0001"): string {
  const d = (raiz8 + filial).split("").map(Number);
  for (const pesos of [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]]) {
    const s = pesos.reduce((acc, p, i) => acc + d[i] * p, 0);
    const r = s % 11;
    d.push(r < 2 ? 0 : 11 - r);
  }
  return d.join("");
}
/**
 * Nº do CAR no formato oficial "BA-2926202-<32 hex>" – FICTÍCIO: o sufixo é um hash hexadecimal derivado do nome
 * do empreendimento (não corresponde a nenhum imóvel cadastrado no SICAR).
 */
function carFicticio(semente: string): string {
  let h = 2166136261;
  let hex = "";
  for (let k = 0; hex.length < 32; k++) {
    for (const ch of `${semente}#${k}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    hex += h.toString(16).padStart(8, "0");
  }
  return `BA-2926202-${hex.slice(0, 32).toUpperCase()}`;
}

const PDF_EXEMPLO = readFileSync(path.join(FIXTURES, "documento-exemplo.pdf"));
const FOTOS = [readFileSync(path.join(FIXTURES, "vistoria-1.jpg")), readFileSync(path.join(FIXTURES, "vistoria-2.jpg"))];

// ───────────────────────── Dados (fictícios) ─────────────────────────

type PessoaDemo = { chave: string; tipo: "PF" | "PJ"; doc: string; nome: string; fantasia?: string; email: string; telefone: string; logradouro: string; bairro: string };
const PESSOAS: PessoaDemo[] = [
  { chave: "chapadao", tipo: "PJ", doc: gerarCnpj("61938274"), nome: "Agropecuária Chapadão Azul Ltda", fantasia: "Chapadão Azul", email: "ambiental@chapadaoazul.exemplo.com.br", telefone: "(77) 3555-0101", logradouro: "Rodovia BR-135, km 12, Fazenda Chapadão Azul", bairro: "Zona Rural" },
  { chave: "boqueirao", tipo: "PJ", doc: gerarCnpj("58207316"), nome: "Cerealista Boqueirão Armazéns Gerais Ltda", fantasia: "Armazéns Boqueirão", email: "operacoes@armazensboqueirao.exemplo.com.br", telefone: "(77) 3555-0202", logradouro: "Estrada do Boqueirão, km 8", bairro: "Zona Rural" },
  { chave: "boi_cerrado", tipo: "PJ", doc: gerarCnpj("47315829"), nome: "Pecuária Boi do Cerrado Ltda", fantasia: "Boi do Cerrado", email: "fazenda@boidocerrado.exemplo.com.br", telefone: "(77) 3555-0303", logradouro: "Estrada Vicinal da Baraúna, km 20", bairro: "Zona Rural" },
  { chave: "algodoeira", tipo: "PJ", doc: gerarCnpj("39462817"), nome: "Algodoeira Planalto Oeste Ltda", fantasia: "Algodoeira Planalto", email: "industrial@planaltooeste.exemplo.com.br", telefone: "(77) 3555-0404", logradouro: "Rodovia BR-135, km 31", bairro: "Zona Rural" },
  { chave: "aero", tipo: "PJ", doc: gerarCnpj("52718364"), nome: "Aero Cerrado Aviação Agrícola Ltda", fantasia: "Aero Cerrado", email: "operacoes@aerocerrado.exemplo.com.br", telefone: "(77) 3555-0505", logradouro: "Estrada da Pista, km 3", bairro: "Zona Rural" },
  { chave: "agroinsumos", tipo: "PJ", doc: gerarCnpj("63820415"), nome: "Vale do Cerrado Agroinsumos Ltda", fantasia: "Vale do Cerrado Agroinsumos", email: "loja@valedocerrado.exemplo.com.br", telefone: "(77) 3555-0606", logradouro: "Av. de Acesso Oeste, 1200", bairro: "Distrito Industrial" },
  { chave: "barauna", tipo: "PJ", doc: gerarCnpj("71043926"), nome: "Cascalheira Baraúna Ltda", email: "cascalheira@barauna.exemplo.com.br", telefone: "(77) 3555-0707", logradouro: "Estrada da Baraúna, km 6", bairro: "Zona Rural" },
  { chave: "posto", tipo: "PJ", doc: gerarCnpj("84159372"), nome: "Auto Posto Chapada Oeste Ltda", fantasia: "Posto Chapada Oeste", email: "gerencia@postochapadaoeste.exemplo.com.br", telefone: "(77) 3555-0808", logradouro: "Av. Principal de Entrada, 50", bairro: "Centro" },
  { chave: "helena", tipo: "PF", doc: gerarCpf("741852963"), nome: "Helena Martins Caldeira", email: "helena.caldeira@exemplo.com.br", telefone: "(77) 99000-1111", logradouro: "Fazenda Santa Clara do Cerrado, s/n", bairro: "Zona Rural" },
  { chave: "otavio", tipo: "PF", doc: gerarCpf("852963741"), nome: "Otávio Brandão Queiroz", email: "otavio.queiroz@exemplo.com.br", telefone: "(77) 99000-2222", logradouro: "Fazenda Cabeceira do Riacho, s/n", bairro: "Zona Rural" },
  { chave: "lucia", tipo: "PF", doc: gerarCpf("963741852"), nome: "Lúcia Ferraz Albuquerque", email: "lucia.albuquerque@exemplo.com.br", telefone: "(77) 99000-3333", logradouro: "Fazenda Vereda Bonita, s/n", bairro: "Zona Rural" },
  { chave: "rafael", tipo: "PF", doc: gerarCpf("159357486"), nome: "Rafael Nogueira Teles", email: "rafael.teles@exemplo.com.br", telefone: "(77) 99000-4444", logradouro: "Rua do Comércio, 210", bairro: "Centro" },
  { chave: "jorge", tipo: "PF", doc: gerarCpf("357159864"), nome: "Jorge Pimentel Sá", email: "jorge.oficina@exemplo.com.br", telefone: "(77) 99000-5555", logradouro: "Av. de Acesso Oeste, 780", bairro: "Bairro Novo" },
  // Responsáveis técnicos (fictícios)
  { chave: "rt_tiago", tipo: "PF", doc: gerarCpf("468135792"), nome: "Tiago Arruda Moreira", email: "tiago.agronomo@exemplo.com.br", telefone: "(77) 99000-6666", logradouro: "Rua das Palmeiras, 15", bairro: "Centro" },
  { chave: "rt_camila", tipo: "PF", doc: gerarCpf("579246813"), nome: "Camila Seixas Rocha", email: "camila.bio@exemplo.com.br", telefone: "(77) 99000-7777", logradouro: "Rua dos Ipês, 88", bairro: "Centro" },
];
const RTS = [
  { chave: "tiago", pessoa: "rt_tiago", formacao: "Engenheiro Agrônomo", conselho: "CREA", registro: "3000900111", uf: "BA" },
  { chave: "camila", pessoa: "rt_camila", formacao: "Bióloga", conselho: "CRBio", registro: "90123/08-D", uf: "BA" },
] as const;

type EmpDemo = { chave: string; nome: string; req: string; tip: string; grandeza: number; area: number; lat: number; lng: number; rt?: string; logradouro: string; bairro?: string; car?: boolean };
// Rurais: dentro do município, longe da sede (lat −11,40…−12,00; lng −45,60…−44,75). Urbanos: perto da sede (−11,7461; −44,9100).
const EMPREENDIMENTOS: EmpDemo[] = [
  { chave: "pivo_chapadao", nome: MARCADOR, req: "chapadao", tip: "R1.1", grandeza: 1800, area: 18_000_000, lat: -11.5835, lng: -45.3620, rt: "tiago", logradouro: "Rodovia BR-135, km 12 – Fazenda Chapadão Azul", car: true },
  { chave: "pivo_santa_clara", nome: "Fazenda Santa Clara do Cerrado – Irrigação", req: "helena", tip: "R1.1", grandeza: 420, area: 4_200_000, lat: -11.8920, lng: -45.2480, rt: "tiago", logradouro: "Estrada da Santa Clara, km 15", car: true },
  { chave: "silo_boqueirao", nome: "Armazém Graneleiro Serra do Boqueirão", req: "boqueirao", tip: "R1.2", grandeza: 45000, area: 60000, lat: -11.6410, lng: -45.1180, rt: "tiago", logradouro: "Estrada do Boqueirão, km 8" },
  { chave: "armazem_vereda", nome: "Unidade de Armazenagem Vereda Grande", req: "boqueirao", tip: "R1.2", grandeza: 18000, area: 25000, lat: -11.8260, lng: -45.4050, rt: "tiago", logradouro: "Estrada da Vereda Grande, km 22" },
  { chave: "confinamento", nome: "Confinamento Boi do Cerrado", req: "boi_cerrado", tip: "R1.3", grandeza: 3500, area: 350000, lat: -11.5120, lng: -45.0460, rt: "tiago", logradouro: "Estrada Vicinal da Baraúna, km 20", car: true },
  { chave: "algodoeira", nome: "Algodoeira Planalto Oeste", req: "algodoeira", tip: "R1.5", grandeza: 600, area: 80000, lat: -11.6980, lng: -45.2950, rt: "tiago", logradouro: "Rodovia BR-135, km 31" },
  { chave: "pista", nome: "Pista Agrícola Aero Cerrado", req: "aero", tip: "R1.4", grandeza: 3, area: 45000, lat: -11.6120, lng: -45.2150, rt: "camila", logradouro: "Estrada da Pista, km 3" },
  { chave: "revenda", nome: "Revenda Vale do Cerrado Agroinsumos", req: "agroinsumos", tip: "R1.6", grandeza: 450, area: 1200, lat: -11.7392, lng: -44.9235, rt: "tiago", logradouro: "Av. de Acesso Oeste, 1200", bairro: "Distrito Industrial" },
  { chave: "asv_cabeceira", nome: "Fazenda Cabeceira do Riacho – Abertura de Área", req: "otavio", tip: "R1.7", grandeza: 180, area: 1_800_000, lat: -11.4660, lng: -45.4820, rt: "camila", logradouro: "Fazenda Cabeceira do Riacho, estrada de acesso norte", car: true },
  { chave: "asv_vereda", nome: "Fazenda Vereda Bonita – Supressão de Vegetação", req: "lucia", tip: "R1.7", grandeza: 35, area: 350000, lat: -11.9460, lng: -45.5210, rt: "camila", logradouro: "Fazenda Vereda Bonita, s/n", car: true },
  { chave: "cascalho", nome: "Cascalheira Estrada da Baraúna", req: "barauna", tip: "F1.1", grandeza: 12000, area: 40000, lat: -11.7010, lng: -45.0120, rt: "camila", logradouro: "Estrada da Baraúna, km 6" },
  { chave: "posto", nome: "Posto Chapada Oeste – Riachão das Neves", req: "posto", tip: "E1.1", grandeza: 90, area: 1800, lat: -11.7436, lng: -44.9142, rt: "tiago", logradouro: "Av. Principal de Entrada, 50", bairro: "Centro" },
  { chave: "lavajato", nome: "Lava-Jato Cerrado Limpo", req: "rafael", tip: "E1.2", grandeza: 180, area: 260, lat: -11.7478, lng: -44.9081, logradouro: "Rua do Comércio, 210", bairro: "Centro" },
  { chave: "oficina", nome: "Oficina Mecânica Rota do Oeste", req: "jorge", tip: "E1.3", grandeza: 300, area: 420, lat: -11.7502, lng: -44.9168, logradouro: "Av. de Acesso Oeste, 780", bairro: "Bairro Novo" },
];

const DESCRICAO: Record<string, string> = {
  "R1.1": "Agricultura irrigada (soja, milho e algodão) por pivôs centrais com captação superficial, casa de bombas e controle de aplicação de fertirrigação.",
  "R1.2": "Recepção, secagem, beneficiamento e armazenagem de grãos em silos metálicos e armazém graneleiro, com controle de pó e de expurgo.",
  "R1.3": "Confinamento de bovinos para engorda com currais, fábrica de ração, esterqueira e lagoas de contenção de efluentes.",
  "R1.4": "Pista de pouso para aviação agrícola com pátio de descontaminação de aeronaves, depósito de agrotóxicos e sistema de tratamento de efluentes.",
  "R1.5": "Beneficiamento de algodão em caroço (descaroçamento e prensagem de plumas), com controle de emissão de particulados e destinação do caroço.",
  "R1.6": "Comércio e armazenamento de agrotóxicos e afins, com depósito ventilado, bacia de contenção e posto de recebimento de embalagens vazias.",
  "R1.7": "Supressão de vegetação nativa de Cerrado para uso alternativo do solo (agricultura de sequeiro), respeitadas a Reserva Legal e as APPs.",
  "F1.1": "Extração de cascalho laterítico a céu aberto para manutenção de estradas vicinais, com plano de recuperação de área degradada.",
  "E1.1": "Posto revendedor de combustíveis líquidos com tanques subterrâneos jaquetados e caixa separadora de água e óleo.",
  "E1.2": "Lavagem de veículos leves com caixa de areia e separador de água e óleo.",
  "E1.3": "Serviços de mecânica geral de veículos leves e máquinas agrícolas, com armazenamento temporário de resíduos oleosos.",
};

type Alvo = StatusProcesso;
type ProcDemo = { emp: string; ato: string; alvo: Alvo; dias: number; dur?: number; pendDoc?: boolean; conclusao?: "FAVORAVEL" | "FAVORAVEL_COM_CONDICIONANTES" | "DESFAVORAVEL"; prazo?: number; rotulo?: string };
const PROCESSOS: ProcDemo[] = [
  // ── Licenças emitidas (5) ──
  { emp: "pivo_chapadao", ato: "LO", alvo: "CONCLUIDO", dias: 210, dur: 45, conclusao: "FAVORAVEL_COM_CONDICIONANTES", rotulo: "LO pivôs – licença emitida" },
  { emp: "silo_boqueirao", ato: "LO", alvo: "CONCLUIDO", dias: 180, dur: 40, conclusao: "FAVORAVEL" },
  { emp: "confinamento", ato: "LO", alvo: "CONCLUIDO", dias: 155, dur: 50, conclusao: "FAVORAVEL_COM_CONDICIONANTES" },
  { emp: "algodoeira", ato: "LO", alvo: "CONCLUIDO", dias: 135, dur: 42, conclusao: "FAVORAVEL_COM_CONDICIONANTES" },
  { emp: "posto", ato: "LO", alvo: "CONCLUIDO", dias: 115, dur: 35, conclusao: "FAVORAVEL" },
  // ── ASV em análise (2) ──
  { emp: "asv_cabeceira", ato: "ASV", alvo: "EM_ANALISE", dias: 26, rotulo: "ASV – em análise" },
  { emp: "asv_vereda", ato: "ASV", alvo: "EM_ANALISE", dias: 19, rotulo: "ASV – em análise" },
  // ── Prazos do técnico (alertas: um vencendo, um vencido) ──
  { emp: "pivo_santa_clara", ato: "LP", alvo: "EM_ANALISE", dias: 52, prazo: 3, rotulo: "alerta – vence em 3 dias" },
  { emp: "armazem_vereda", ato: "LI", alvo: "EM_ANALISE", dias: 64, prazo: -2, rotulo: "alerta – vencido" },
  // ── Demais etapas ──
  { emp: "revenda", ato: "LO", alvo: "AGUARDANDO_DECISAO", dias: 45, conclusao: "FAVORAVEL_COM_CONDICIONANTES" },
  { emp: "pista", ato: "LO", alvo: "AGUARDANDO_VISTORIA", dias: 36 },
  { emp: "cascalho", ato: "LP", alvo: "AGUARDANDO_REQUERENTE", dias: 30, pendDoc: true },
  { emp: "lavajato", ato: "LS", alvo: "EM_TRIAGEM", dias: 6 },
  { emp: "oficina", ato: "LS", alvo: "PROTOCOLADO", dias: 3 },
  { emp: "pivo_chapadao", ato: "AA", alvo: "RASCUNHO", dias: 1 },
];

const CONDICIONANTES = [
  { descricao: "Apresentar relatório anual de monitoramento da qualidade da água superficial a montante e a jusante da captação.", periodicidade: "Anual", prazo_dias: 365 },
  { descricao: "Manter o registro de recebimento e devolução de embalagens vazias de agrotóxicos (Lei nº 7.802/1989) e apresentá-lo quando solicitado.", periodicidade: "Semestral", prazo_dias: 180 },
];

// ───────────────────────── Execução ─────────────────────────

async function main() {
  const t0 = Date.now();
  const { prisma } = await import("../../../lib/db");
  const org = await prisma.organizacao.findFirst({ where: { sigla: ORG_SIGLA } });
  const municipio = await prisma.municipio.findUnique({ where: { sigla: MUN } });
  if (!org || !municipio || municipio.organizacao_id !== org.id) {
    console.error("Cliente Riachão das Neves não encontrado – rode antes: npm run onboard -- riachao-das-neves --demo");
    process.exit(1);
  }
  if (await prisma.empreendimento.findFirst({ where: { nome: MARCADOR, municipio_id: municipio.id } })) {
    console.log(`Dados de demonstração de Riachão das Neves já existem (empreendimento "${MARCADOR}").`);
    await demandasUrbanas(prisma); // bloco acrescentado depois: idempotente por demanda (marcador = nome do local)
    await prisma.$disconnect();
    return;
  }

  const { sessaoPorEmail } = await import("../../../lib/sessao");
  const { criarPessoa } = await import("../../../lib/cadastros/pessoas");
  const { criarResponsavel } = await import("../../../lib/cadastros/responsaveis");
  const { criarEmpreendimento } = await import("../../../lib/cadastros/empreendimentos");
  const { salvarRascunho } = await import("../../../lib/processo/rascunho");
  const { anexarArquivo } = await import("../../../lib/processo/anexos");
  const { salvarChecklist } = await import("../../../lib/processo/checklist");
  const { transicionar } = await import("../../../lib/processo/transicionar");
  const fisc = await import("../../../lib/fiscalizacao/servico");
  const { FiscalizacaoSchema, AutoInfracaoSchema, NotificacaoSchema, DenunciaInternaSchema, DenunciaPublicaSchema } = await import("../../../lib/fiscalizacao/schemas");
  const { gerarAlertas } = await import("../../../lib/alertas/gerar");
  const log = (...a: unknown[]) => console.log(`[riachao ${((Date.now() - t0) / 1000).toFixed(0).padStart(3)}s]`, ...a);

  const [admin, tec, gestor, fiscal] = await Promise.all([sessaoPorEmail(EMAIL.admin), sessaoPorEmail(EMAIL.tec), sessaoPorEmail(EMAIL.gestor), sessaoPorEmail(EMAIL.fiscal)]);
  const tipologias = Object.fromEntries((await prisma.tipologia.findMany({ where: { organizacao_id: org.id } })).map((t) => [t.codigo, t]));
  const atos = Object.fromEntries((await prisma.tipoAto.findMany({ where: { organizacao_id: org.id } })).map((t) => [t.sigla, t]));
  const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

  // ── Pessoas e RTs ──
  const pessoa: Record<string, string> = {};
  for (const p of PESSOAS) {
    const reg = await criarPessoa(admin, {
      tipo: p.tipo, cpf_cnpj: p.doc, nome: p.nome, nome_fantasia: p.fantasia ?? null, email: p.email, telefone: p.telefone,
      endereco: { logradouro: p.logradouro, bairro: p.bairro, cidade: municipio.nome, uf: "BA", cep: "47970000" }, municipio_id: municipio.id,
    });
    pessoa[p.chave] = reg.id;
  }
  const rt: Record<string, string> = {};
  for (const r of RTS) rt[r.chave] = (await criarResponsavel(admin, { pessoa_id: pessoa[r.pessoa], formacao: r.formacao, conselho: r.conselho, registro_conselho: r.registro, uf_conselho: r.uf })).id;
  log(`${PESSOAS.length} pessoas e ${RTS.length} responsáveis técnicos (fictícios).`);

  // ── Empreendimentos ──
  const emp: Record<string, { id: string; req: string; tip: string; grandeza: number; nome: string }> = {};
  for (const [i, e] of EMPREENDIMENTOS.entries()) {
    const reg = await criarEmpreendimento(admin, {
      municipio_id: municipio.id, requerente_id: pessoa[e.req], nome: e.nome,
      endereco: { logradouro: e.logradouro, bairro: e.bairro ?? "Zona Rural", cidade: municipio.nome, uf: "BA", cep: "47970000" },
      latitude: round6(e.lat), longitude: round6(e.lng), tipologia_id: tipologias[e.tip].id, grandeza_porte: e.grandeza, area_m2: e.area,
      numero_car: e.car ? carFicticio(e.nome) : null, // CAR FICTÍCIO (formato oficial, sufixo hexadecimal aleatório)
      rt_id: e.rt ? rt[e.rt] : null,
    });
    emp[e.chave] = { id: reg.id, req: e.req, tip: e.tip, grandeza: e.grandeza, nome: e.nome };
    await prisma.empreendimento.update({ where: { id: reg.id }, data: { created_at: diasAtras(240 - i * 4, 9) } });
  }
  log(`${EMPREENDIMENTOS.length} empreendimentos (rurais e urbanos).`);

  // ── Processos (balcão: técnico protocola em nome do requerente sem login) ──
  const checklistOk = { c1: "SIM", c2: "SIM", c3: "SIM", c4: 450, c5: "SIM", c6: "Documentação conferida; localização confere com o CAR e com as imagens de satélite." };
  const criados: { id: string; spec: ProcDemo; numero: string | null }[] = [];
  for (const spec of [...PROCESSOS].sort((a, b) => b.dias - a.dias)) {
    const e = emp[spec.emp];
    const ato = atos[spec.ato];
    const rasc = await salvarRascunho({ requerente_id: pessoa[e.req], empreendimento_id: e.id, tipologia_id: tipologias[e.tip].id, grandeza: e.grandeza, tipo_ato_id: ato.id, descricao_atividade: DESCRICAO[e.tip] }, tec);
    const id = rasc.id;
    const t = (acao: string, payload: unknown, u: typeof tec) => transicionar(id, acao, payload, u);
    const exigidos = await prisma.documentoExigido.findMany({ where: { tipo_ato_id: ato.id, obrigatorio: true, OR: [{ tipologia_id: null }, { tipologia_id: tipologias[e.tip].id }] }, orderBy: { created_at: "asc" } });
    for (const d of spec.alvo === "RASCUNHO" ? exigidos.slice(0, 2) : exigidos) {
      const nome = `${d.nome.split(" (")[0].normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase().slice(0, 50)}.pdf`;
      await anexarArquivo(id, { nome, mime: "application/pdf", dados: PDF_EXEMPLO }, { tipo: "DOCUMENTO_EXIGIDO", documento_exigido_id: d.id }, tec);
    }
    const final = async () => {
      if (spec.alvo === "RASCUNHO") return;
      await t("protocolar", {}, tec);
      if (spec.alvo === "PROTOCOLADO") return;
      await t("distribuir", { tecnico_id: tec.id, despacho: "Encaminhado ao técnico ambiental para análise." }, gestor);
      if (spec.alvo === "EM_TRIAGEM") return;
      if (spec.pendDoc) {
        await t("pendencia", { itens: [{ descricao: "Apresentar o Plano de Recuperação de Área Degradada (PRAD) da cascalheira, com ART." }, { descricao: "Apresentar anuência do proprietário do imóvel e poligonal georreferenciada da área de lavra." }] }, tec);
        return;
      }
      await t("aceitar", {}, tec);
      if (spec.alvo === "EM_ANALISE") return;
      if (spec.alvo === "AGUARDANDO_VISTORIA") {
        await t("agendar_vistoria", { data_prevista: fimDoDia(5), despacho: "Vistoria ao pátio de descontaminação e ao depósito de agrotóxicos." }, tec);
        return;
      }
      await salvarChecklist(id, checklistOk, tec);
      const conclusao = spec.conclusao ?? "FAVORAVEL";
      const texto = `Analisada a documentação apresentada para o empreendimento ${e.nome}, constatou-se a regularidade das informações, a compatibilidade da atividade com o uso do solo e a adequação das medidas de controle ambiental propostas.\n\nOpina-se pelo DEFERIMENTO${conclusao === "FAVORAVEL_COM_CONDICIONANTES" ? ", condicionado ao cumprimento das condicionantes abaixo" : ""}.`;
      await t("parecer", { conclusao, texto, condicionantes: conclusao === "FAVORAVEL_COM_CONDICIONANTES" ? CONDICIONANTES : [] }, tec);
      if (spec.alvo === "AGUARDANDO_DECISAO") return;
      await t("deferir", { despacho: `Defiro o requerimento com base no parecer técnico. Emita-se a ${ato.nome}.` }, gestor); // emite a licença (PDF + QR)
    };
    await final();
    const p = await prisma.processo.findUniqueOrThrow({ where: { id } });
    criados.push({ id, spec, numero: p.numero });
    const protocolo = diasAtras(spec.dias, 8 + (spec.dias % 8), (spec.dias * 7) % 60);
    const conclusao = spec.dur !== undefined && p.status === "CONCLUIDO" ? new Date(Math.min(protocolo.getTime() + spec.dur * DIA, Date.now() - DIA)) : null;
    await prisma.processo.update({
      where: { id },
      data: {
        created_at: new Date(protocolo.getTime() - DIA),
        ...(p.data_protocolo ? { data_protocolo: protocolo } : {}),
        ...(conclusao ? { data_conclusao: conclusao, updated_at: conclusao } : {}),
        ...(spec.prazo !== undefined ? { prazo_etapa_ate: fimDoDia(spec.prazo), prazo_pausado: false } : {}),
      },
    });
    log(`${(p.numero ?? "(rascunho)").padEnd(16)} ${spec.ato.padEnd(4)} ${p.status.padEnd(22)} ${e.nome}${spec.rotulo ? `  [${spec.rotulo}]` : ""}`);
  }

  // ── Denúncias (4) ──
  const DENUNCIAS = [
    { chave: "d1", canal: "PORTAL" as const, descricao: "Desmatamento de Cerrado nativo com correntão e enleiramento em área extensa, aparentemente além da área pedida para supressão.", endereco: "Estrada de acesso norte, próximo à Fazenda Cabeceira do Riacho", lat: -11.4702, lng: -45.4768, dias: 21 },
    { chave: "d2", canal: "TELEFONE" as const, descricao: "Queimada de grande proporção em área de pastagem e vereda, com fumaça atingindo a estrada.", endereco: "Estrada da Baraúna, km 14", lat: -11.6240, lng: -45.0710, dias: 48 },
    { chave: "d3", canal: "PRESENCIAL" as const, descricao: "Som alto em estabelecimento comercial após as 22h, todos os fins de semana.", endereco: "Rua do Comércio, próximo à praça", lat: -11.7455, lng: -44.9096, dias: 12, nome: "Moradores da Rua do Comércio", contato: "(77) 99000-8888" },
    { chave: "d4", canal: "PORTAL" as const, descricao: "Descarte de embalagens vazias de agrotóxicos a céu aberto e queima de embalagens em terreno próximo a um riacho.", endereco: "Margem do riacho, estrada vicinal do Distrito Industrial", lat: -11.7350, lng: -44.9310, dias: 8 },
  ];
  const den: Record<string, { id: string; protocolo: string }> = {};
  for (const d of DENUNCIAS) {
    const pos = { latitude: d.lat, longitude: d.lng };
    const r =
      d.canal === "PORTAL"
        ? await fisc.criarDenunciaPublica(DenunciaPublicaSchema.parse({ municipio_id: municipio.id, descricao: d.descricao, endereco: d.endereco, ...pos, anonima: true, website: "" }))
        : await fisc.criarDenunciaInterna(fiscal, DenunciaInternaSchema.parse({ municipio_id: municipio.id, canal: d.canal, descricao: d.descricao, endereco: d.endereco, ...pos, anonima: !("nome" in d), denunciante_nome: "nome" in d ? d.nome : null, contato: "contato" in d ? d.contato : null }));
    den[d.chave] = r;
    await prisma.denuncia.update({ where: { id: r.id }, data: { created_at: diasAtras(d.dias, 9 + (d.dias % 7)) } });
  }
  log(`${DENUNCIAS.length} denúncias.`);

  // ── Vistorias (3) com fotos ──
  const VISTORIAS = [
    { chave: "v1", den: "d1", emp: "asv_cabeceira", dias: 18, lat: -11.4698, lng: -45.4772, constatacao: "IRREGULAR" as const, fotos: 2, relato: "Constatada supressão de aproximadamente 42 ha de Cerrado nativo sem Autorização de Supressão de Vegetação (processo de ASV ainda em análise), com leiras de material lenhoso no local." },
    { chave: "v2", den: "d4", emp: "revenda", dias: 6, lat: -11.7352, lng: -44.9305, constatacao: "IRREGULAR" as const, fotos: 1, relato: "Encontradas cerca de 120 embalagens vazias de agrotóxicos, parte queimada, com identificação de lote vendido pela revenda; ausência de tríplice lavagem." },
    { chave: "v3", emp: "silo_boqueirao", dias: 40, lat: -11.6408, lng: -45.1176, constatacao: "REGULAR" as const, fotos: 2, relato: "Vistoria de rotina: sistema de aspiração de pó em funcionamento, expurgo em local isolado e sinalizado; condicionantes em dia." },
  ];
  const vis: Record<string, string> = {};
  for (const v of VISTORIAS) {
    const entrada = FiscalizacaoSchema.parse({
      municipio_id: municipio.id, denuncia_id: v.den ? den[v.den].id : null, empreendimento_id: emp[v.emp].id,
      data_hora: diasAtras(v.dias, 9, 30), latitude: v.lat, longitude: v.lng, precisao_m: 8,
      equipe: [{ usuario_id: tec.id, nome: tec.nome }], relato: v.relato, constatacao: v.constatacao,
    });
    const fotos = FOTOS.slice(0, v.fotos).map((dados, i) => ({ nome: `vistoria-rdn-${v.chave}-${i + 1}.jpg`, dados, latitude: v.lat + i * 0.00008, longitude: v.lng - i * 0.00006 }));
    vis[v.chave] = (await fisc.criarFiscalizacao(fiscal, entrada, fotos)).id;
  }
  await fisc.alterarStatusDenuncia(fiscal, den.d1.id, "CONCLUIDA", "Vistoria realizada; área embargada e auto de infração lavrado.");
  await fisc.alterarStatusDenuncia(fiscal, den.d3.id, "ARQUIVADA", "Poluição sonora urbana: encaminhada à fiscalização de posturas do município.");
  // d4 fica EM_APURACAO (a vistoria já muda o status): aguardando o atendimento da notificação.
  log(`${VISTORIAS.length} vistorias com fotos.`);

  // ── Auto de infração (1) e notificação (1), com PDF ──
  const auto = await fisc.criarAutoInfracao(fiscal, AutoInfracaoSchema.parse({
    fiscalizacao_id: vis.v1, autuado: { pessoa_id: pessoa.otavio }, penalidade: "EMBARGO", valor_multa: null, prazo_defesa_dias: 20,
    enquadramento_legal: "Lei Federal nº 12.651/2012, art. 26; Decreto Federal nº 6.514/2008, arts. 51 e 52.",
    descricao_infracao: "Suprimir cerca de 42 ha de vegetação nativa de Cerrado sem autorização do órgão ambiental competente. Embargo da área suprimida.",
  }));
  if (auto.erro_pdf) throw new Error(`PDF do auto: ${auto.erro_pdf}`);
  const notif = await fisc.criarNotificacao(fiscal, NotificacaoSchema.parse({
    fiscalizacao_id: vis.v2, notificado: { pessoa_id: pessoa.agroinsumos }, prazo_dias: 15,
    exigencia: "Recolher as embalagens vazias descartadas, comprovar a destinação a unidade de recebimento credenciada e apresentar o programa de devolução de embalagens aos clientes.",
  }));
  if (notif.erro_pdf) throw new Error(`PDF da notificação: ${notif.erro_pdf}`);
  log(`Auto ${auto.auto.numero} e notificação ${notif.notificacao.numero} emitidos.`);

  // ── Alertas (só desta organização) ──
  const alertas = await gerarAlertas(new Date(), { organizacao_id: org.id });
  const alertasTec = await prisma.alerta.count({ where: { usuario_id: tec.id, lido: false } });

  // ── Demandas urbanas (depois dos alertas: não altera os alertas do técnico gerados acima) ──
  await demandasUrbanas(prisma);

  const porStatus = await prisma.processo.groupBy({ by: ["status"], where: { municipio_id: municipio.id }, _count: true, orderBy: { status: "asc" } });
  const docs = await prisma.documentoOficial.groupBy({ by: ["tipo"], where: { municipio_id: municipio.id }, _count: true, orderBy: { tipo: "asc" } });
  console.log("\n══════════ Demonstração de Riachão das Neves concluída ══════════");
  console.log(`Tempo: ${((Date.now() - t0) / 1000).toFixed(0)} s · Empreendimentos: ${EMPREENDIMENTOS.length} · Processos: ${criados.length}`);
  for (const s of porStatus) console.log(`  ${s.status.padEnd(22)} ${s._count}`);
  console.log(`Documentos: ${docs.map((d) => `${d.tipo}=${d._count}`).join(" ")}`);
  console.log(`Denúncias: ${DENUNCIAS.length} · Vistorias: ${VISTORIAS.length} · Alertas criados: ${alertas.alertas_criados} (tecnico.rdn: ${alertasTec} não lido(s))`);
  console.log("Logins (senha do onboarding --demo): admin.rdn@ · tecnico.rdn@ · gestor.rdn@ · fiscal.rdn@ (licenciagov.demo)");
  await prisma.$disconnect();
}

// ───────────────────────── Demandas urbanas (append-only) ─────────────────────────
// Poda na praça (concluída, com compensação) e evento com som (em análise). Pessoas, CPFs e locais FICTÍCIOS.
async function demandasUrbanas(prisma: PrismaClient) {
  const atos = await prisma.tipoAto.count({ where: { organizacao: { sigla: ORG_SIGLA }, sigla: { in: ["APC", "ASE"] } } });
  if (atos < 2) {
    console.log("[riachao] demandas urbanas puladas: catálogo sem APC/ASE – rode `npm run onboard -- riachao-das-neves --atualizar` antes.");
    return;
  }
  const n = await semearDemandas(prisma, {
    organizacaoSigla: ORG_SIGLA,
    municipioSigla: MUN,
    tecnicoEmail: EMAIL.tec,
    requerentes: [
      { chave: "paroquia", cpf: cpfDemanda("517924306"), nome: "Antônio Ferreira Lima", email: "zeladoria.praca@exemplo.com.br", telefone: "(77) 99000-4410", logradouro: "Praça da Matriz, 10", bairro: "Centro" },
      { chave: "festa", cpf: cpfDemanda("628035417"), nome: "Josefa Rodrigues Brito", email: "comissao.festa@exemplo.com.br", telefone: "(77) 99000-5521", logradouro: "Rua do Comércio, 77", bairro: "Centro" },
    ],
    demandas: [
      {
        local: "Praça da Matriz – poda das árvores", sigla: "APC", alvo: "CONCLUIDO", req: "paroquia", logradouro: "Praça da Matriz, s/n", bairro: "Centro", lat: -11.74638, lng: -44.91018, dias: 16,
        dados: { especie: "Oiti", quantidade: "3", intervencao: "Poda", motivo: "Risco à rede elétrica", local_arvore: "Praça ou área pública" },
        observacoes: "Copas encostando na rede elétrica e na iluminação da praça.",
        checklist: { v1: "Oiti (Moquilea tomentosa)", v2: 35, v3: 8, v4: "Bom", v5: "Médio", v6: "SIM", v7: "Poda", v8: 0, v9: "Poda de adequação da copa; árvores sadias, sem necessidade de supressão." },
      },
      {
        local: "Praça da Matriz – Festa do Padroeiro (som)", sigla: "ASE", alvo: "EM_ANALISE", req: "festa", logradouro: "Praça da Matriz, s/n", bairro: "Centro", lat: -11.74651, lng: -44.90995, dias: 3,
        dados: { evento: "Festa do Padroeiro", data_inicio: dataIso(20), data_fim: dataIso(22), horario_inicio: "19:00", horario_fim: "23:00", publico: "900", equipamento: "Palco com 6 caixas de 1.000 W e mesa de som", area_residencial: "Não" },
      },
    ],
    log: (...a) => console.log("[riachao demandas]", ...a),
  });
  if (n) console.log(`[riachao] ${n} demanda(s) urbana(s) criada(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[seed:riachao-demo] falhou:", e);
    process.exit(1);
  });
