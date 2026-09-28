// Seed de DEMONSTRAÇÃO (SPEC 14) – executar com `npm run seed:demo` (roda o seed base antes).
// NUNCA rodar em produção de cliente após a implantação.
//
// Os dados são criados pelos serviços reais da aplicação (cadastros, rascunho, anexos, transicionar,
// emissão de documentos, fiscalização, alertas), então numeração, tramitação, prazos, auditoria,
// e-mails e PDFs (com QR Code) são genuínos. Depois das transições, apenas campos de DATA são ajustados
// para espalhar os dados ao longo de 2026 (created_at / data_protocolo / data_conclusao de processo e
// created_at de denúncia) – tramitacao e log_auditoria (imutáveis) não são tocados.
//
// Cenários dos testes de aceite (SPEC 13):
//   T1 – "Laticínio Boa Vista – Lagoa do Orvalho" (Laticínio Boa Vista Ltda, LOR) só com LP e LI concluídas (sem LO aberta).
//   T2 – "Posto Estrela – Serra Serena" com LP, LI e LO concluídas e licenças emitidas; RT com registro no CREA.
//   T3 – tecnico.lor tem exatamente 2 processos com prazo correndo: um vence em 3 dias e outro vencido.
//   T6/T7 – dados em todos os municípios (Lagoa do Orvalho, Campo das Seriemas, Serra Serena…).
//   T10 – sem registros de backup fabricados: o backup e o teste de restauração são executados de verdade
//         (worker ou botões em /admin/backup; o spec T10 os dispara).
//
// Os módulos de lib/ importam "server-only": rodar com `tsx --conditions=react-server` (ver package.json).
import path from "node:path";
import { readFileSync } from "node:fs";
import type { StatusProcesso } from "@prisma/client";

try {
  process.loadEnvFile(path.resolve(__dirname, "../../.env"));
} catch {
  /* variáveis já no ambiente */
}

const RAIZ = path.resolve(__dirname, "../..");
const FIXTURES = path.join(RAIZ, "tests/fixtures");
const MARCADOR = "Posto Estrela – Serra Serena";
const SENHA_DEMO = "Demo@2026licencia";
const DIA = 86400000;

// ───────────────────────── Utilidades ─────────────────────────

/** Data `n` dias atrás, às `hora`h (horário local). */
function diasAtras(n: number, hora = 10, minuto = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hora, minuto, 0, 0);
  return d;
}

/** Fim do dia daqui a `n` dias (negativo = passado). */
function fimDoDia(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(23, 59, 59, 0);
  return d;
}

/** CPF válido a partir de 9 dígitos-base (calcula os dígitos verificadores). */
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

/** CNPJ válido a partir de 8 dígitos de raiz + filial 0001. */
function gerarCnpj(raiz8: string, filial = "0001"): string {
  const d = (raiz8 + filial).split("").map(Number);
  for (const pesos of [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]]) {
    const s = pesos.reduce((acc, p, i) => acc + d[i] * p, 0);
    const r = s % 11;
    d.push(r < 2 ? 0 : 11 - r);
  }
  return d.join("");
}

const PDF_EXEMPLO = readFileSync(path.join(FIXTURES, "documento-exemplo.pdf"));
const FOTOS = [readFileSync(path.join(FIXTURES, "vistoria-1.jpg")), readFileSync(path.join(FIXTURES, "vistoria-2.jpg"))];

// ───────────────────────── Dados ─────────────────────────

type PessoaDemo = { chave: string; tipo: "PF" | "PJ"; doc: string; nome: string; fantasia?: string; mun: string; email: string; telefone: string; logradouro: string; bairro: string };

const PESSOAS: PessoaDemo[] = [
  { chave: "primavera", tipo: "PJ", doc: gerarCnpj("27415836"), nome: "Primavera Empreendimentos Imobiliários Ltda", fantasia: "Primavera Urbanismo", mun: "LOR", email: "contato@primaveraurbanismo.com.br", telefone: "(75) 3555-4410", logradouro: "Av. Rio Branco, 812", bairro: "Centro" },
  { chave: "mineracao", tipo: "PJ", doc: gerarCnpj("31872904"), nome: "Mineração Seriemas Areia e Cascalho Ltda", fantasia: "Areal Seriemas", mun: "CSE", email: "comercial@arealseriemas.com.br", telefone: "(75) 3555-1180", logradouro: "Rodovia BA-245, km 4", bairro: "Zona Rural" },
  { chave: "irmaos_silva", tipo: "PJ", doc: gerarCnpj("19634527"), nome: "Irmãos Silva Auto Center Ltda", fantasia: "Auto Center Irmãos Silva", mun: "CSE", email: "oficina@irmaossilva.com.br", telefone: "(75) 3555-2217", logradouro: "Rua Sete de Setembro, 145", bairro: "Centro" },
  { chave: "chapada", tipo: "PJ", doc: gerarCnpj("08451963"), nome: "Auto Posto Chapada Ltda", fantasia: "Posto Chapada", mun: "AUM", email: "gerencia@postochapada.com.br", telefone: "(74) 3555-1090", logradouro: "Av. Getúlio Vargas, 1500", bairro: "São Francisco" },
  { chave: "serra_verde", tipo: "PJ", doc: gerarCnpj("14789320"), nome: "Laticínios Serra Verde Ltda", fantasia: "Serra Verde", mun: "AUM", email: "industria@laticiniosserraverde.com.br", telefone: "(74) 3555-3321", logradouro: "Estrada do Umbuzeiro, km 2", bairro: "Zona Rural" },
  { chave: "bela_vista", tipo: "PJ", doc: gerarCnpj("35120478"), nome: "Bela Vista Urbanismo SPE Ltda", mun: "SSR", email: "projetos@belavistaurbanismo.com.br", telefone: "(75) 3555-7788", logradouro: "Rua Barão do Rio Branco, 60", bairro: "Centro" },
  { chave: "sorriso", tipo: "PJ", doc: gerarCnpj("22908163"), nome: "Clínica Odontológica Sorriso Ltda", fantasia: "Clínica Sorriso", mun: "LOR", email: "atendimento@clinicasorriso.com.br", telefone: "(75) 3555-9020", logradouro: "Praça Dr. Joaquim Dias, 22", bairro: "Centro" },
  { chave: "comb_cse", tipo: "PJ", doc: gerarCnpj("40317852"), nome: "Comercial de Combustíveis Seriemas Ltda", fantasia: "Posto Seriemas Diesel", mun: "CSE", email: "financeiro@postoseriemas.com.br", telefone: "(75) 3555-3350", logradouro: "Av. ACM, 900", bairro: "Rodoviária" },
  { chave: "antonio", tipo: "PF", doc: gerarCpf("284617395"), nome: "Antônio Carlos Ribeiro", mun: "SSR", email: "antonio.ribeiro@exemplo.com.br", telefone: "(75) 99000-2233", logradouro: "Fazenda Santa Luzia, s/n", bairro: "Zona Rural" },
  { chave: "jose_roberto", tipo: "PF", doc: gerarCpf("517308462"), nome: "José Roberto Nascimento", mun: "VMA", email: "jr.nascimento@exemplo.com.br", telefone: "(75) 99000-7741", logradouro: "Fazenda Boa Esperança, s/n", bairro: "Zona Rural" },
  { chave: "edvaldo", tipo: "PF", doc: gerarCpf("631825079"), nome: "Edvaldo Santos Lima", mun: "SSR", email: "edvaldo.funilaria@exemplo.com.br", telefone: "(75) 99000-0412", logradouro: "Rua do Comércio, 318", bairro: "Centro" },
  { chave: "rosangela", tipo: "PF", doc: gerarCpf("749261538"), nome: "Rosângela Souza Pires", mun: "VMA", email: "rosangela.pires@exemplo.com.br", telefone: "(75) 99000-3390", logradouro: "Rua Principal, 45", bairro: "Centro" },
  { chave: "gilberto", tipo: "PF", doc: gerarCpf("852094176"), nome: "Gilberto Araújo Costa", mun: "AUM", email: "gilberto.mecanica@exemplo.com.br", telefone: "(74) 99000-1508", logradouro: "Av. Luiz Viana, 77", bairro: "Centro" },
  // Pessoas dos responsáveis técnicos
  { chave: "rt_ricardo", tipo: "PF", doc: gerarCpf("193745286"), nome: "Ricardo Almeida Souza", mun: "LOR", email: "ricardo.almeida.eng@exemplo.com.br", telefone: "(75) 99000-6070", logradouro: "Rua J. J. Seabra, 210", bairro: "Centro" },
  { chave: "rt_fernanda", tipo: "PF", doc: gerarCpf("402918573"), nome: "Fernanda Lima Carvalho", mun: "SSR", email: "fernanda.bio@exemplo.com.br", telefone: "(75) 99000-1122", logradouro: "Rua Otaviano Alves, 58", bairro: "Centro" },
  { chave: "rt_paulo", tipo: "PF", doc: gerarCpf("275836104"), nome: "Paulo Henrique Mendes", mun: "CSE", email: "paulo.agronomo@exemplo.com.br", telefone: "(75) 99000-4410", logradouro: "Travessa São João, 12", bairro: "Centro" },
  { chave: "rt_marcos", tipo: "PF", doc: gerarCpf("368190257"), nome: "Marcos Vinícius Tavares", mun: "PCA", email: "marcos.geologia@exemplo.com.br", telefone: "(75) 99000-9031", logradouro: "Rua da Matriz, 101", bairro: "Centro" },
];

const RTS = [
  { chave: "ricardo", pessoa: "rt_ricardo", formacao: "Engenheiro Ambiental e Sanitarista", conselho: "CREA", registro: "3000123456", uf: "BA" },
  { chave: "fernanda", pessoa: "rt_fernanda", formacao: "Bióloga", conselho: "CRBio", registro: "45678/08-D", uf: "BA" },
  { chave: "paulo", pessoa: "rt_paulo", formacao: "Engenheiro Agrônomo", conselho: "CREA", registro: "3000654321", uf: "BA" },
  { chave: "marcos", pessoa: "rt_marcos", formacao: "Geólogo", conselho: "CREA", registro: "3000987654", uf: "BA" },
] as const;

// Requerentes do seed base (com login) por chave → e-mail
const REQ_BASE: Record<string, string> = {
  laticinio: "laticinio@licenciagov.demo",
  posto: "posto@licenciagov.demo",
  joao: "joao@licenciagov.demo",
  maria: "maria@licenciagov.demo",
  ceramica: "ceramica@licenciagov.demo",
};

type EmpDemo = { chave: string; nome: string; mun: string; req: string; tip: string; grandeza: number; area: number; dLat: number; dLng: number; rt?: string; logradouro: string; bairro?: string; car?: string };

// Coordenadas: sede do município (seed base) + deslocamento de poucos km.
const EMPREENDIMENTOS: EmpDemo[] = [
  { chave: "posto_estrela", nome: MARCADOR, mun: "SSR", req: "posto", tip: "E1.1", grandeza: 90, area: 1800, dLat: 0.0071, dLng: -0.0093, rt: "ricardo", logradouro: "Rodovia BA-046, km 1, s/n", bairro: "Alto da Boa Vista" },
  { chave: "lat_bv", nome: "Laticínio Boa Vista – Lagoa do Orvalho", mun: "LOR", req: "laticinio", tip: "C1.1", grandeza: 15000, area: 5200, dLat: -0.0182, dLng: 0.0214, rt: "ricardo", logradouro: "Estrada do Boa Vista, km 3", bairro: "Zona Rural" },
  { chave: "ceramica_ptg", nome: "Cerâmica Candeeiro – Pedra do Candeeiro", mun: "PCA", req: "ceramica", tip: "C2.1", grandeza: 400, area: 12000, dLat: 0.0125, dLng: 0.0187, rt: "marcos", logradouro: "Rodovia BR-116, km 519", bairro: "Zona Rural" },
  { chave: "olaria_candeeiro", nome: "Olaria Candeeiro Tijolos – Pedra do Candeeiro", mun: "PCA", req: "ceramica", tip: "C2.1", grandeza: 120, area: 6500, dLat: -0.0098, dLng: 0.0072, rt: "marcos", logradouro: "Povoado de Tanquinho, s/n", bairro: "Zona Rural" },
  { chave: "olaria_sj", nome: "Olaria São José – Campo das Seriemas", mun: "CSE", req: "joao", tip: "C2.1", grandeza: 80, area: 4300, dLat: 0.0154, dLng: -0.0121, logradouro: "Estrada de Lajedo Alto, km 2", bairro: "Zona Rural" },
  { chave: "lavajato_brilho", nome: "Lava-Jato Brilho Total – Lagoa do Orvalho", mun: "LOR", req: "maria", tip: "E1.2", grandeza: 150, area: 320, dLat: 0.0043, dLng: -0.0051, logradouro: "Rua Tenente Joaquim Nascimento, 480", bairro: "São João" },
  { chave: "lavajato_estrela", nome: "Lava-Jato e Troca de Óleo Estrela – Serra Serena", mun: "SSR", req: "posto", tip: "E1.2", grandeza: 300, area: 650, dLat: 0.0068, dLng: -0.0085, rt: "ricardo", logradouro: "Rodovia BA-046, km 1, anexo", bairro: "Alto da Boa Vista" },
  { chave: "granja_sl", nome: "Granja Santa Luzia – Serra Serena", mun: "SSR", req: "antonio", tip: "A1.1", grandeza: 80000, area: 38000, dLat: -0.0417, dLng: 0.0362, rt: "paulo", logradouro: "Fazenda Santa Luzia, Estrada do Morro Branco", bairro: "Zona Rural", car: "BA-9900202-5F1A2B3C4D5E6F7A8B9C0D1E2F3A4B5C" },
  { chave: "areal", nome: "Areal Rio das Seriemas – Campo das Seriemas", mun: "CSE", req: "mineracao", tip: "F1.1", grandeza: 15000, area: 90000, dLat: -0.0213, dLng: 0.0288, rt: "marcos", logradouro: "Margem direita do Rio das Seriemas, Porto das Seriemas", bairro: "Zona Rural" },
  { chave: "lagoa_funda", nome: "Extração de Areia Lagoa Funda – Várzea do Mandacaru", mun: "VMA", req: "mineracao", tip: "F1.1", grandeza: 8000, area: 45000, dLat: 0.0264, dLng: -0.0197, rt: "marcos", logradouro: "Povoado de Lagoa Funda, s/n", bairro: "Zona Rural" },
  { chave: "posto_chapada", nome: "Posto Chapada – Alto do Umbuzeiro", mun: "AUM", req: "chapada", tip: "E1.1", grandeza: 150, area: 2400, dLat: 0.0052, dLng: 0.0068, rt: "ricardo", logradouro: "Av. Getúlio Vargas, 1500", bairro: "São Francisco" },
  { chave: "faz_bom_jesus", nome: "Fazenda Leiteira Bom Jesus – Alto do Umbuzeiro", mun: "AUM", req: "jose_roberto", tip: "A1.2", grandeza: 400, area: 250000, dLat: -0.0386, dLng: -0.0271, rt: "paulo", logradouro: "Fazenda Bom Jesus, Estrada de Alto Bonito", bairro: "Zona Rural", car: "BA-9900505-9A8B7C6D5E4F3A2B1C0D9E8F7A6B5C4D" },
  { chave: "of_irmaos", nome: "Oficina Mecânica Irmãos Silva – Campo das Seriemas", mun: "CSE", req: "irmaos_silva", tip: "E1.3", grandeza: 350, area: 480, dLat: 0.0031, dLng: 0.0044, logradouro: "Rua Sete de Setembro, 145", bairro: "Centro" },
  { chave: "of_central", nome: "Oficina e Funilaria Central – Serra Serena", mun: "SSR", req: "edvaldo", tip: "E1.3", grandeza: 250, area: 390, dLat: -0.0038, dLng: 0.0029, logradouro: "Rua do Comércio, 318", bairro: "Centro" },
  { chave: "mecanica_aum", nome: "Auto Mecânica Umbuzeiro", mun: "AUM", req: "gilberto", tip: "E1.3", grandeza: 180, area: 260, dLat: 0.0027, dLng: -0.0035, logradouro: "Av. Luiz Viana, 77", bairro: "Centro" },
  { chave: "lat_serra_verde", nome: "Laticínio Serra Verde – Alto do Umbuzeiro", mun: "AUM", req: "serra_verde", tip: "C1.1", grandeza: 30000, area: 7800, dLat: 0.0195, dLng: 0.0241, rt: "fernanda", logradouro: "Estrada do Umbuzeiro, km 2", bairro: "Zona Rural" },
  { chave: "queijaria", nome: "Queijaria Artesanal Sertão – Várzea do Mandacaru", mun: "VMA", req: "rosangela", tip: "C1.1", grandeza: 3000, area: 600, dLat: 0.0089, dLng: -0.0113, rt: "fernanda", logradouro: "Sítio Lagoa do Boi, s/n", bairro: "Zona Rural" },
  { chave: "lavajato_vma", nome: "Lava-Jato Mandacaru Express", mun: "VMA", req: "rosangela", tip: "E1.2", grandeza: 120, area: 210, dLat: 0.0021, dLng: 0.0019, logradouro: "Rua Principal, 45", bairro: "Centro" },
  { chave: "granja_be", nome: "Granja Boa Esperança – Várzea do Mandacaru", mun: "VMA", req: "jose_roberto", tip: "A1.1", grandeza: 150000, area: 52000, dLat: -0.0311, dLng: 0.0226, rt: "paulo", logradouro: "Fazenda Boa Esperança, s/n", bairro: "Zona Rural", car: "BA-9900606-1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E" },
  { chave: "lot_bela_vista", nome: "Loteamento Residencial Bela Vista – Serra Serena", mun: "SSR", req: "bela_vista", tip: "G1.1", grandeza: 25, area: 250000, dLat: 0.0148, dLng: 0.0117, rt: "ricardo", logradouro: "Estrada do Bela Vista, s/n", bairro: "Bela Vista" },
  { chave: "lot_primavera", nome: "Loteamento Jardim Primavera – Lagoa do Orvalho", mun: "LOR", req: "primavera", tip: "G1.1", grandeza: 12, area: 120000, dLat: 0.0163, dLng: -0.0149, rt: "ricardo", logradouro: "Av. Primavera, s/n (prolongamento)", bairro: "Primavera" },
  { chave: "lot_portal", nome: "Loteamento Portal do Sertão – Campo das Seriemas", mun: "CSE", req: "primavera", tip: "G1.1", grandeza: 8, area: 80000, dLat: -0.0122, dLng: -0.0164, rt: "fernanda", logradouro: "Saída para o Portal, s/n", bairro: "Portal" },
  { chave: "clinica", nome: "Clínica Odontológica Sorriso – Lagoa do Orvalho", mun: "LOR", req: "sorriso", tip: "H1.1", grandeza: 180, area: 180, dLat: -0.0022, dLng: 0.0017, logradouro: "Praça Dr. Joaquim Dias, 22", bairro: "Centro" },
  { chave: "avicola_lor", nome: "Avícola Orvalho", mun: "LOR", req: "antonio", tip: "A1.1", grandeza: 45000, area: 26000, dLat: -0.0347, dLng: -0.0298, rt: "paulo", logradouro: "Fazenda Riachão, Estrada do Riachão", bairro: "Zona Rural" },
  { chave: "posto_cse", nome: "Posto Seriemas Diesel", mun: "CSE", req: "comb_cse", tip: "E1.1", grandeza: 60, area: 1500, dLat: 0.0061, dLng: 0.0083, rt: "ricardo", logradouro: "Av. ACM, 900", bairro: "Rodoviária" },
];

const DESCRICAO_ATIVIDADE: Record<string, string> = {
  "E1.1": "Posto revendedor de combustíveis líquidos (gasolina, etanol e diesel S10) com tanques subterrâneos jaquetados, pista de abastecimento e caixa separadora de água e óleo.",
  "C1.1": "Recepção, pasteurização e beneficiamento de leite para produção de queijos, iogurte e bebida láctea, com estação de tratamento de efluentes.",
  "C2.1": "Fabricação de blocos e telhas cerâmicas com forno intermitente a lenha de manejo sustentável e jazida própria de argila.",
  "E1.2": "Lavagem de veículos leves com rampa, caixa de areia e separador de água e óleo; reúso parcial da água de lavagem.",
  "E1.3": "Serviços de mecânica geral, funilaria e pintura de veículos, com cabine de pintura e armazenamento temporário de resíduos oleosos.",
  "F1.1": "Extração de areia em leito de rio por dragagem com beneficiamento por peneiramento e pátio de estocagem.",
  "G1.1": "Parcelamento do solo urbano para fins residenciais com implantação de sistema viário, drenagem, rede de água e esgotamento sanitário.",
  "A1.1": "Criação de frangos de corte em galpões climatizados, com composteira para aves mortas e armazenamento de cama de frango.",
  "A1.2": "Bovinocultura leiteira em sistema semiconfinado com sala de ordenha, esterqueira e lagoa de estabilização.",
  "H1.1": "Clínica odontológica com geração de resíduos de serviços de saúde (grupos A, B e E) e plano de gerenciamento de RSS.",
};

type Alvo = StatusProcesso | "ARQUIVADO_PENDENCIA" | "ARQUIVADO_TRIAGEM";

type ProcDemo = {
  emp: string;
  ato: string;
  alvo: Alvo;
  /** dias atrás do protocolo (ou da criação, se rascunho) */
  dias: number;
  /** duração até a conclusão/arquivamento (dias) */
  dur?: number;
  tec?: string;
  pendDoc?: boolean;
  pendTec?: boolean;
  pendPrazo?: number;
  conclusao?: "FAVORAVEL" | "FAVORAVEL_COM_CONDICIONANTES" | "DESFAVORAVEL";
  /** Ajusta prazo_etapa_ate para hoje + n dias (T3 e variedade do painel de prazos) */
  prazo?: number;
  /** Pendência aberta com prazo já vencido (ajuste de data) */
  pendVencida?: boolean;
  /** Ajusta validade_ate da licença para hoje + n dias (licenças "vencendo") */
  validade?: number;
  rotulo?: string;
};

const T = {
  lor: "tecnico.lor@licenciagov.demo",
  ssr: "tecnico.ssr@licenciagov.demo",
  cse: "tecnico.cse@licenciagov.demo",
  c1: "tec.consorcio1@licenciagov.demo",
  c2: "tec.consorcio2@licenciagov.demo",
};

// ~44 processos em todos os status. Ordenados pelo protocolo antes da execução (numeração crescente no tempo).
const PROCESSOS: ProcDemo[] = [
  // ── CONCLUÍDOS com licença (15) ──
  { emp: "posto_estrela", ato: "LP", alvo: "CONCLUIDO", dias: 250, dur: 35, tec: T.ssr, conclusao: "FAVORAVEL_COM_CONDICIONANTES", rotulo: "T2 – LP" },
  { emp: "posto_estrela", ato: "LI", alvo: "CONCLUIDO", dias: 195, dur: 40, tec: T.ssr, pendTec: true, conclusao: "FAVORAVEL_COM_CONDICIONANTES", rotulo: "T2 – LI" },
  { emp: "posto_estrela", ato: "LO", alvo: "CONCLUIDO", dias: 120, dur: 45, tec: T.ssr, conclusao: "FAVORAVEL_COM_CONDICIONANTES", rotulo: "T2 – LO" },
  { emp: "lat_bv", ato: "LP", alvo: "CONCLUIDO", dias: 240, dur: 30, tec: T.c1, conclusao: "FAVORAVEL", rotulo: "T1 – LP anterior" },
  { emp: "lat_bv", ato: "LI", alvo: "CONCLUIDO", dias: 170, dur: 50, tec: T.lor, pendDoc: true, conclusao: "FAVORAVEL_COM_CONDICIONANTES", rotulo: "T1 – LI anterior" },
  { emp: "ceramica_ptg", ato: "LO", alvo: "CONCLUIDO", dias: 220, dur: 60, tec: T.c2, conclusao: "FAVORAVEL_COM_CONDICIONANTES" },
  { emp: "granja_sl", ato: "LO", alvo: "CONCLUIDO", dias: 205, dur: 55, tec: T.ssr, conclusao: "FAVORAVEL", validade: 25 },
  { emp: "areal", ato: "LO", alvo: "CONCLUIDO", dias: 185, dur: 50, tec: T.cse, conclusao: "FAVORAVEL_COM_CONDICIONANTES", validade: 55 },
  { emp: "posto_chapada", ato: "LO", alvo: "CONCLUIDO", dias: 160, dur: 45, tec: T.c1, conclusao: "FAVORAVEL", validade: 110 },
  { emp: "of_irmaos", ato: "LS", alvo: "CONCLUIDO", dias: 150, dur: 25, tec: T.cse, conclusao: "FAVORAVEL" },
  { emp: "of_central", ato: "LS", alvo: "CONCLUIDO", dias: 140, dur: 20, tec: T.ssr, conclusao: "FAVORAVEL" },
  { emp: "lat_serra_verde", ato: "LI", alvo: "CONCLUIDO", dias: 130, dur: 40, tec: T.c2, conclusao: "FAVORAVEL_COM_CONDICIONANTES" },
  { emp: "granja_be", ato: "LU", alvo: "CONCLUIDO", dias: 110, dur: 35, tec: T.c1, pendTec: true, conclusao: "FAVORAVEL" },
  { emp: "olaria_sj", ato: "LAC", alvo: "CONCLUIDO", dias: 95, dur: 20, tec: T.cse, conclusao: "FAVORAVEL" },
  { emp: "lot_bela_vista", ato: "LP", alvo: "CONCLUIDO", dias: 80, dur: 30, tec: T.ssr, pendDoc: true, conclusao: "FAVORAVEL_COM_CONDICIONANTES" },
  // ── Outros concluídos: certidão e indeferimento com ofício ──
  { emp: "clinica", ato: "CERT_DISP", alvo: "CONCLUIDO", dias: 100, dur: 15, tec: T.lor, conclusao: "FAVORAVEL" },
  { emp: "queijaria", ato: "LO", alvo: "INDEFERIDO", dias: 88, dur: 40, tec: T.c1, conclusao: "DESFAVORAVEL", rotulo: "indeferido → concluído (ofício)" },
  // ── Aguardando decisão (3) ──
  { emp: "posto_cse", ato: "LO", alvo: "AGUARDANDO_DECISAO", dias: 70, tec: T.cse, conclusao: "FAVORAVEL_COM_CONDICIONANTES", prazo: 1 },
  { emp: "avicola_lor", ato: "LP", alvo: "AGUARDANDO_DECISAO", dias: 60, tec: T.c2, conclusao: "FAVORAVEL" },
  { emp: "olaria_candeeiro", ato: "LO", alvo: "AGUARDANDO_DECISAO", dias: 55, tec: T.c1, conclusao: "FAVORAVEL_COM_CONDICIONANTES" },
  // ── Deferido / indeferido aguardando emissão do documento ──
  { emp: "faz_bom_jesus", ato: "LO", alvo: "DEFERIDO", dias: 50, tec: T.c2, conclusao: "FAVORAVEL" },
  { emp: "lavajato_vma", ato: "LS", alvo: "INDEFERIDO", dias: 45, tec: T.c1, conclusao: "DESFAVORAVEL" },
  // ── Aguardando vistoria (2) ──
  { emp: "lagoa_funda", ato: "LO", alvo: "AGUARDANDO_VISTORIA", dias: 40, tec: T.c1 },
  { emp: "mecanica_aum", ato: "LO", alvo: "AGUARDANDO_VISTORIA", dias: 35, tec: T.c2 },
  // ── Em análise (5) – os dois de tecnico.lor são o cenário T3 ──
  { emp: "lot_primavera", ato: "LI", alvo: "EM_ANALISE", dias: 58, tec: T.lor, prazo: 3, rotulo: "T3 – vence em 3 dias" },
  { emp: "lavajato_brilho", ato: "LO", alvo: "EM_ANALISE", dias: 66, tec: T.lor, prazo: -4, rotulo: "T3 – vencido" },
  { emp: "lot_portal", ato: "LP", alvo: "EM_ANALISE", dias: 30, tec: T.cse, pendTec: true },
  { emp: "lavajato_estrela", ato: "LS", alvo: "EM_ANALISE", dias: 28, tec: T.ssr },
  { emp: "lat_serra_verde", ato: "LO", alvo: "EM_ANALISE", dias: 25, tec: T.c2, prazo: -2 },
  // ── Aguardando requerente (4) ──
  { emp: "areal", ato: "ASV", alvo: "AGUARDANDO_REQUERENTE", dias: 22, tec: T.cse, pendTec: true },
  { emp: "ceramica_ptg", ato: "AA", alvo: "AGUARDANDO_REQUERENTE", dias: 20, tec: T.c2, pendDoc: true, pendPrazo: 3 },
  { emp: "granja_be", ato: "AA", alvo: "AGUARDANDO_REQUERENTE", dias: 38, tec: T.c1, pendTec: true, pendVencida: true },
  { emp: "olaria_sj", ato: "LO", alvo: "AGUARDANDO_REQUERENTE", dias: 33, tec: T.cse, pendTec: true },
  // ── Em triagem (3) ──
  { emp: "granja_sl", ato: "RLO", alvo: "EM_TRIAGEM", dias: 10, tec: T.ssr, prazo: -2 },
  { emp: "queijaria", ato: "LS", alvo: "EM_TRIAGEM", dias: 9, tec: T.c1 },
  { emp: "of_irmaos", ato: "AA", alvo: "EM_TRIAGEM", dias: 12, tec: T.cse },
  // ── Protocolados (3) ──
  { emp: "posto_chapada", ato: "RLO", alvo: "PROTOCOLADO", dias: 5 },
  { emp: "lagoa_funda", ato: "AA", alvo: "PROTOCOLADO", dias: 4 },
  { emp: "lot_bela_vista", ato: "LI", alvo: "PROTOCOLADO", dias: 3 },
  // ── Rascunhos (3) ──
  { emp: "olaria_sj", ato: "AA", alvo: "RASCUNHO", dias: 2 },
  { emp: "olaria_candeeiro", ato: "AA", alvo: "RASCUNHO", dias: 6 },
  { emp: "faz_bom_jesus", ato: "ASV", alvo: "RASCUNHO", dias: 1 },
  // ── Arquivados (2) ──
  { emp: "posto_cse", ato: "AA", alvo: "ARQUIVADO_PENDENCIA", dias: 150, dur: 50, tec: T.cse },
  { emp: "avicola_lor", ato: "LO", alvo: "ARQUIVADO_TRIAGEM", dias: 190, dur: 10, tec: T.c2 },
];

const CONDICIONANTES = [
  { descricao: "Apresentar relatório semestral de monitoramento de efluentes líquidos, com laudos de laboratório acreditado.", periodicidade: "Semestral", prazo_dias: 180 },
  { descricao: "Manter o Plano de Gerenciamento de Resíduos Sólidos atualizado e comprovar a destinação final por meio de MTR.", periodicidade: "Anual", prazo_dias: 365 },
  { descricao: "Executar e manter o plantio compensatório de 150 mudas nativas da caatinga, com relatório fotográfico.", periodicidade: "Anual", prazo_dias: 300 },
];

// ───────────────────────── Execução ─────────────────────────

async function main() {
  const t0 = Date.now();
  const { prisma } = await import("../../lib/db");
  const existente = await prisma.empreendimento.findFirst({ where: { nome: MARCADOR } });
  if (existente) {
    console.log(`Dados de demonstração já existem (empreendimento "${MARCADOR}"). Nada a fazer.`);
    console.log("Para recriar: apague o banco, rode `npx prisma migrate deploy` e `npm run seed:demo`.");
    await prisma.$disconnect();
    return;
  }

  const { criarPessoa } = await import("../../lib/cadastros/pessoas");
  const { criarResponsavel } = await import("../../lib/cadastros/responsaveis");
  const { criarEmpreendimento } = await import("../../lib/cadastros/empreendimentos");
  const { salvarRascunho } = await import("../../lib/processo/rascunho");
  const { anexarArquivo } = await import("../../lib/processo/anexos");
  const { salvarChecklist } = await import("../../lib/processo/checklist");
  const { transicionar } = await import("../../lib/processo/transicionar");
  const fisc = await import("../../lib/fiscalizacao/servico");
  const { FiscalizacaoSchema, AutoInfracaoSchema, NotificacaoSchema, DenunciaInternaSchema, DenunciaPublicaSchema } = await import("../../lib/fiscalizacao/schemas");
  const { gerarAlertas } = await import("../../lib/alertas/gerar");
  const { sessaoPorEmail } = await import("../../lib/sessao");
  type UsuarioSessao = import("../../lib/rbac").UsuarioSessao;

  const log = (...a: unknown[]) => console.log(`[demo ${((Date.now() - t0) / 1000).toFixed(0).padStart(3)}s]`, ...a);

  // ── Sessões dos usuários demo ──
  const cacheSessao = new Map<string, UsuarioSessao>();
  async function sessao(email: string): Promise<UsuarioSessao> {
    if (cacheSessao.has(email)) return cacheSessao.get(email)!;
    const s: UsuarioSessao = await sessaoPorEmail(email).catch(() => {
      throw new Error(`Usuário ${email} não encontrado – rode o seed base (npm run seed:base).`);
    });
    cacheSessao.set(email, s);
    return s;
  }

  // Somente a organização de demonstração (outras organizações/clientes podem existir na mesma base).
  const orgDemo = await prisma.organizacao.findFirstOrThrow({ where: { sigla: "CID-DEMO" } });
  const municipios = await prisma.municipio.findMany({ where: { organizacao_id: orgDemo.id } });
  const mun = Object.fromEntries(municipios.map((m) => [m.sigla, m]));
  const tipologias = Object.fromEntries((await prisma.tipologia.findMany({ where: { organizacao_id: orgDemo.id } })).map((t) => [t.codigo, t]));
  const atos = Object.fromEntries((await prisma.tipoAto.findMany({ where: { organizacao_id: orgDemo.id } })).map((t) => [t.sigla, t]));
  const admin = await sessao("admin@licenciagov.demo");
  const COM_EQUIPE = new Set(["LOR", "SSR", "CSE"]); // municípios com técnico/gestor/fiscal próprios no seed base
  const gestorDe = (sigla: string) => (COM_EQUIPE.has(sigla) ? sessao(`gestor.${sigla.toLowerCase()}@licenciagov.demo`) : Promise.resolve(admin));
  const fiscalDe = (sigla: string) => sessao(COM_EQUIPE.has(sigla) ? `fiscal.${sigla.toLowerCase()}@licenciagov.demo` : T.c2);
  const balcaoDe = (sigla: string) => sessao(COM_EQUIPE.has(sigla) ? `tecnico.${sigla.toLowerCase()}@licenciagov.demo` : T.c1);

  // ── Pessoas (requerentes e RTs) ──
  const pessoa: Record<string, string> = {};
  for (const [chave, email] of Object.entries(REQ_BASE)) {
    const u = await prisma.usuario.findUniqueOrThrow({ where: { email } });
    pessoa[chave] = u.pessoa_id!;
  }
  for (const p of PESSOAS) {
    const cidade = mun[p.mun].nome;
    const reg = await criarPessoa(admin, {
      tipo: p.tipo, cpf_cnpj: p.doc, nome: p.nome, nome_fantasia: p.fantasia ?? null, email: p.email, telefone: p.telefone,
      endereco: { logradouro: p.logradouro, bairro: p.bairro, cidade, uf: "BA", cep: "46880000" }, municipio_id: mun[p.mun].id,
    });
    pessoa[p.chave] = reg.id;
  }
  const rt: Record<string, string> = {};
  for (const r of RTS) {
    const reg = await criarResponsavel(admin, { pessoa_id: pessoa[r.pessoa], formacao: r.formacao, conselho: r.conselho, registro_conselho: r.registro, uf_conselho: r.uf });
    rt[r.chave] = reg.id;
  }
  log(`${PESSOAS.length} pessoas e ${RTS.length} responsáveis técnicos cadastrados.`);

  // ── Empreendimentos ──
  const emp: Record<string, { id: string; mun: string; req: string; tip: string; grandeza: number; lat: number; lng: number; nome: string }> = {};
  const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
  for (const e of EMPREENDIMENTOS) {
    const m = mun[e.mun];
    const lat = round6(Number(m.latitude) + e.dLat);
    const lng = round6(Number(m.longitude) + e.dLng);
    const reg = await criarEmpreendimento(admin, {
      municipio_id: m.id, requerente_id: pessoa[e.req], nome: e.nome,
      endereco: { logradouro: e.logradouro, bairro: e.bairro ?? "Centro", cidade: m.nome, uf: "BA", cep: "46880000" },
      latitude: lat, longitude: lng, tipologia_id: tipologias[e.tip].id, grandeza_porte: e.grandeza, area_m2: e.area, numero_car: e.car ?? null, rt_id: e.rt ? rt[e.rt] : null,
    });
    emp[e.chave] = { id: reg.id, mun: e.mun, req: e.req, tip: e.tip, grandeza: e.grandeza, lat, lng, nome: e.nome };
  }
  // Empreendimentos "antigos": cadastrados no início do ano
  for (const [i, e] of EMPREENDIMENTOS.entries()) await prisma.empreendimento.update({ where: { id: emp[e.chave].id }, data: { created_at: diasAtras(265 - i * 3, 9) } });
  log(`${EMPREENDIMENTOS.length} empreendimentos cadastrados.`);

  // ── Processos ──
  const checklistOk = { c1: "SIM", c2: "SIM", c3: "SIM", c4: 350, c5: "SIM", c6: "Documentação conferida; situação compatível com o porte e o potencial poluidor declarados." };
  const silenciar = async <T,>(fn: () => Promise<T>): Promise<T> => {
    const orig = console.error;
    console.error = () => {};
    try {
      return await fn();
    } finally {
      console.error = orig;
    }
  };
  /** Executa a decisão com o storage indisponível: o documento não é emitido e o processo fica DEFERIDO/INDEFERIDO (estado real "aguardando emissão"). */
  const semStorage = async <T,>(fn: () => Promise<T>): Promise<T> => {
    const dir = process.env.STORAGE_LOCAL_DIR;
    const drv = process.env.STORAGE_DRIVER;
    process.env.STORAGE_DRIVER = "local";
    process.env.STORAGE_LOCAL_DIR = "/dev/null/indisponivel";
    try {
      return await silenciar(fn);
    } finally {
      process.env.STORAGE_LOCAL_DIR = dir;
      if (drv === undefined) delete process.env.STORAGE_DRIVER;
      else process.env.STORAGE_DRIVER = drv;
    }
  };

  const criados: { id: string; spec: ProcDemo; numero: string | null }[] = [];
  const ordenados = [...PROCESSOS].sort((a, b) => b.dias - a.dias);
  for (const spec of ordenados) {
    const e = emp[spec.emp];
    const sig = e.mun;
    const ato = atos[spec.ato];
    const reqEmail = REQ_BASE[e.req];
    const req = reqEmail ? await sessao(reqEmail) : await balcaoDe(sig); // sem login → atendimento no balcão
    const tec = spec.tec ? await sessao(spec.tec) : null;
    const gestor = await gestorDe(sig);

    const rasc = await salvarRascunho(
      {
        ...(reqEmail ? {} : { requerente_id: pessoa[e.req] }),
        empreendimento_id: e.id, tipologia_id: tipologias[e.tip].id, grandeza: e.grandeza, tipo_ato_id: ato.id,
        descricao_atividade: DESCRICAO_ATIVIDADE[e.tip],
      },
      req,
    );
    const id = rasc.id;
    const t = (acao: string, payload: unknown, u: UsuarioSessao) => transicionar(id, acao, payload, u);

    // Documentos exigidos (PDF de exemplo). Rascunhos ficam com parte dos documentos.
    const exigidos = await prisma.documentoExigido.findMany({ where: { tipo_ato_id: ato.id, obrigatorio: true }, orderBy: { created_at: "asc" } });
    const anexar = spec.alvo === "RASCUNHO" ? exigidos.slice(0, 2) : exigidos;
    for (const d of anexar) {
      const nome = `${d.nome.split(" (")[0].normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase().slice(0, 50)}.pdf`;
      await anexarArquivo(id, { nome, mime: "application/pdf", dados: PDF_EXEMPLO }, { tipo: "DOCUMENTO_EXIGIDO", documento_exigido_id: d.id }, req);
    }

    const final = async () => {
      if (spec.alvo === "RASCUNHO") return;
      await t("protocolar", {}, req);
      if (spec.alvo === "PROTOCOLADO") return;
      await t("distribuir", { tecnico_id: tec!.id, despacho: "Encaminhado para análise conforme escala da equipe técnica." }, gestor);
      if (spec.alvo === "ARQUIVADO_TRIAGEM") {
        await t("arquivar", { justificativa: "Requerimento em duplicidade com outro processo do mesmo empreendimento; arquivado a pedido do requerente." }, gestor);
        return;
      }
      if (spec.pendDoc) {
        await t("pendencia", { itens: [{ descricao: "Apresentar certidão de uso e ocupação do solo atualizada (emitida há menos de 90 dias)." }, { descricao: "Reapresentar a ART do responsável técnico com a assinatura do contratante." }], prazo_dias: spec.pendPrazo ?? null }, tec!);
        if (spec.alvo === "AGUARDANDO_REQUERENTE") return;
        const pend = await prisma.pendencia.findFirst({ where: { processo_id: id, status: "ABERTA" } });
        if (pend) await anexarArquivo(id, { nome: "certidao-uso-solo-atualizada.pdf", mime: "application/pdf", dados: PDF_EXEMPLO }, { tipo: "RESPOSTA_PENDENCIA", pendencia_id: pend.id }, req);
        await t("responder", { resposta: "Documentos atualizados anexados conforme solicitado." }, req);
      }
      if (spec.alvo === "EM_TRIAGEM") return;
      await t("aceitar", {}, tec!);
      if (spec.alvo === "ARQUIVADO_PENDENCIA") {
        await t("pendencia", { itens: [{ descricao: "Apresentar laudo de estanqueidade dos tanques de armazenamento de combustível." }] }, tec!);
        await t("arquivar", { justificativa: "Pendência técnica não atendida no prazo concedido. Processo arquivado; o requerente poderá protocolar novo pedido." }, gestor);
        return;
      }
      if (spec.pendTec) {
        await t("pendencia", { itens: [{ descricao: "Complementar o memorial descritivo com o balanço hídrico e o dimensionamento do sistema de tratamento de efluentes." }], prazo_dias: spec.pendPrazo ?? null }, tec!);
        if (spec.alvo === "AGUARDANDO_REQUERENTE") return;
        await t("responder", { resposta: "Memorial complementar com balanço hídrico e memória de cálculo do sistema de tratamento anexado." }, req);
      }
      if (spec.alvo === "EM_ANALISE") return;
      if (spec.alvo === "AGUARDANDO_VISTORIA") {
        await t("agendar_vistoria", { data_prevista: fimDoDia(6), despacho: "Vistoria técnica para verificação das informações do requerimento." }, tec!);
        return;
      }
      await salvarChecklist(id, checklistOk, tec!);
      const conclusao = spec.conclusao ?? "FAVORAVEL";
      const textoParecer =
        conclusao === "DESFAVORAVEL"
          ? `Após análise da documentação e das informações prestadas, verificou-se que o empreendimento ${e.nome} não atende aos requisitos ambientais: a área proposta está inserida em faixa de preservação permanente e não foi apresentada alternativa locacional.\n\nOpina-se pelo INDEFERIMENTO do requerimento.`
          : `Analisada a documentação apresentada para o empreendimento ${e.nome}, constatou-se a regularidade das informações, a compatibilidade da atividade com o zoneamento municipal e a adequação das medidas de controle ambiental propostas.\n\nOpina-se pelo DEFERIMENTO${conclusao === "FAVORAVEL_COM_CONDICIONANTES" ? ", condicionado ao cumprimento das condicionantes abaixo" : ""}.`;
      await t("parecer", { conclusao, texto: textoParecer, condicionantes: conclusao === "FAVORAVEL_COM_CONDICIONANTES" ? CONDICIONANTES.slice(0, spec.ato === "LP" ? 1 : 2) : [] }, tec!);
      if (spec.alvo === "AGUARDANDO_DECISAO") return;
      const indeferir = conclusao === "DESFAVORAVEL";
      const decidir = () =>
        indeferir
          ? t("indeferir", { motivo: "Indefiro o requerimento com base no parecer técnico desfavorável: atividade incompatível com a localização proposta (APP)." }, gestor)
          : t("deferir", { despacho: `Defiro o requerimento com base no parecer técnico. Emita-se a ${ato.nome}.` }, gestor);
      // DEFERIDO / INDEFERIDO "puros": decisão registrada, documento ainda não emitido
      if ((spec.alvo === "DEFERIDO" || spec.alvo === "INDEFERIDO") && spec.dur === undefined) await semStorage(decidir);
      else await decidir();
    };
    await final();

    const p = await prisma.processo.findUniqueOrThrow({ where: { id } });
    criados.push({ id, spec, numero: p.numero });

    // ── Ajustes de data (dashboard ao longo de 2026) ──
    const protocolo = diasAtras(spec.dias, 9 + (spec.dias % 7), (spec.dias * 7) % 60);
    const conclusao = spec.dur !== undefined && ["CONCLUIDO", "ARQUIVADO"].includes(p.status) ? new Date(Math.min(protocolo.getTime() + spec.dur * DIA, Date.now() - DIA)) : null;
    await prisma.processo.update({
      where: { id },
      data: {
        created_at: new Date(protocolo.getTime() - DIA),
        ...(p.data_protocolo ? { data_protocolo: protocolo } : {}),
        ...(conclusao ? { data_conclusao: conclusao, updated_at: conclusao } : {}),
        ...(spec.prazo !== undefined ? { prazo_etapa_ate: fimDoDia(spec.prazo), prazo_pausado: false } : {}),
      },
    });
    if (spec.pendVencida) {
      const venc = fimDoDia(-3);
      await prisma.pendencia.updateMany({ where: { processo_id: id, status: "ABERTA" }, data: { prazo_ate: venc } });
      await prisma.processo.update({ where: { id }, data: { prazo_etapa_ate: venc } });
    }
    // Licenças "vencendo" (30/60/120 dias): a validade é ajustada só nos dados de demonstração –
    // o PDF emitido mantém a validade original (documento_oficial é imutável fora do seed).
    if (spec.validade !== undefined) {
      await prisma.documentoOficial.updateMany({ where: { processo_id: id, tipo: { in: ["LICENCA", "AUTORIZACAO"] }, status: "VALIDO" }, data: { validade_ate: fimDoDia(spec.validade) } });
    }
    log(`${(p.numero ?? "(rascunho)").padEnd(16)} ${spec.ato.padEnd(9)} ${p.status.padEnd(22)} ${e.nome}${spec.rotulo ? `  [${spec.rotulo}]` : ""}`);
  }

  // ── Denúncias ──
  const lojaPos = (sig: string, dLat: number, dLng: number) => ({ latitude: round6(Number(mun[sig].latitude) + dLat), longitude: round6(Number(mun[sig].longitude) + dLng) });
  type DenDemo = { chave: string; sig: string; canal: "PORTAL" | "PRESENCIAL" | "TELEFONE" | "OUTRO"; descricao: string; endereco: string; dLat: number; dLng: number; nome?: string; contato?: string; dias: number };
  const DENUNCIAS: DenDemo[] = [
    { chave: "d1", sig: "LOR", canal: "PRESENCIAL", descricao: "Lançamento de água com sabão e óleo de lava-jato diretamente na sarjeta, escorrendo até o córrego do bairro.", endereco: "Rua Tenente Joaquim Nascimento, próximo ao nº 480 – São João", dLat: 0.0045, dLng: -0.0049, nome: "Marcos Antônio Reis", contato: "(75) 99000-2020", dias: 14 },
    { chave: "d2", sig: "LOR", canal: "TELEFONE", descricao: "Queima de lixo a céu aberto em terreno baldio, com fumaça intensa no fim da tarde.", endereco: "Terreno baldio na Rua Nova, bairro São José", dLat: -0.0071, dLng: 0.0088, dias: 40 },
    { chave: "d3", sig: "SSR", canal: "PORTAL", descricao: "Desmatamento de vegetação nativa às margens do riacho, com uso de trator e queima das leiras, dentro de área de preservação permanente.", endereco: "Estrada do Morro Branco, após a Fazenda Santa Luzia", dLat: -0.0432, dLng: 0.0389, dias: 12 },
    { chave: "d4", sig: "SSR", canal: "TELEFONE", descricao: "Fumaça preta e odor forte vindos de forno de olaria durante a madrugada.", endereco: "Saída para a Serra, km 3", dLat: 0.0211, dLng: -0.0166, dias: 150 },
    { chave: "d5", sig: "CSE", canal: "PRESENCIAL", descricao: "Extração de areia com draga no leito do Rio das Seriemas fora da poligonal autorizada, com assoreamento visível.", endereco: "Porto das Seriemas, margem direita do Rio das Seriemas", dLat: -0.0228, dLng: 0.0301, nome: "Colônia de Pescadores Z-18", contato: "(75) 99000-8181", dias: 9 },
    { chave: "d6", sig: "PCA", canal: "OUTRO", descricao: "Descarte de cacos de telha e tijolos (resíduos cerâmicos) em área de caatinga ao lado da rodovia.", endereco: "BR-116, km 520, acostamento sentido capital", dLat: 0.0141, dLng: 0.0203, dias: 7 },
    { chave: "d7", sig: "AUM", canal: "PORTAL", descricao: "Cheiro forte de combustível no quintal das casas vizinhas ao posto; suspeita de vazamento em tanque subterrâneo.", endereco: "Av. Getúlio Vargas, imediações do nº 1500", dLat: 0.0058, dLng: 0.0072, dias: 3 },
    { chave: "d8", sig: "AUM", canal: "TELEFONE", descricao: "Barulho de compressor e marteletes de oficina após as 22h.", endereco: "Av. Luiz Viana, próximo à praça", dLat: 0.0025, dLng: -0.0031, dias: 95 },
    { chave: "d9", sig: "VMA", canal: "PRESENCIAL", descricao: "Criação de porcos a menos de 30 metros de nascente usada para abastecimento da comunidade.", endereco: "Comunidade de Lagoa do Boi", dLat: 0.0132, dLng: -0.0144, nome: "Associação Comunitária de Lagoa do Boi", contato: "(75) 99000-1234", dias: 20 },
    { chave: "d10", sig: "VMA", canal: "PORTAL", descricao: "Resíduos de serviços de saúde (seringas e frascos) descartados em terreno às margens da estrada vicinal.", endereco: "Estrada vicinal para o povoado de Lagoa Funda", dLat: 0.0247, dLng: -0.0181, dias: 1 },
  ];
  const den: Record<string, { id: string; protocolo: string }> = {};
  for (const d of DENUNCIAS) {
    const pos = lojaPos(d.sig, d.dLat, d.dLng);
    const r =
      d.canal === "PORTAL"
        ? await fisc.criarDenunciaPublica(DenunciaPublicaSchema.parse({ municipio_id: mun[d.sig].id, descricao: d.descricao, endereco: d.endereco, ...pos, anonima: true, website: "" }))
        : await fisc.criarDenunciaInterna(await fiscalDe(d.sig), DenunciaInternaSchema.parse({ municipio_id: mun[d.sig].id, canal: d.canal, descricao: d.descricao, endereco: d.endereco, ...pos, anonima: !d.nome, denunciante_nome: d.nome ?? null, contato: d.contato ?? null }));
    den[d.chave] = r;
    await prisma.denuncia.update({ where: { id: r.id }, data: { created_at: diasAtras(d.dias, 8 + (d.dias % 9)) } });
  }
  log(`${DENUNCIAS.length} denúncias registradas.`);

  // ── Vistorias (8) com fotos e coordenadas ──
  type VisDemo = { chave: string; sig: string; den?: string; emp?: string; dias: number; dLat: number; dLng: number; constatacao: "IRREGULAR" | "REGULAR" | "INCONCLUSIVA"; relato: string; fotos: number };
  const VISTORIAS: VisDemo[] = [
    { chave: "v1", sig: "LOR", den: "d1", emp: "lavajato_brilho", dias: 12, dLat: 0.0044, dLng: -0.0050, constatacao: "IRREGULAR", fotos: 2, relato: "Constatado lançamento de efluente de lavagem de veículos na via pública, sem passagem pela caixa separadora de água e óleo, que se encontrava obstruída." },
    { chave: "v2", sig: "LOR", den: "d2", dias: 37, dLat: -0.0070, dLng: 0.0089, constatacao: "INCONCLUSIVA", fotos: 1, relato: "No momento da vistoria não havia queima em andamento; foram observados vestígios de cinzas e resíduos domésticos. Responsável pelo terreno não identificado." },
    { chave: "v3", sig: "SSR", den: "d3", emp: "granja_sl", dias: 10, dLat: -0.0430, dLng: 0.0385, constatacao: "IRREGULAR", fotos: 2, relato: "Constatada supressão de aproximadamente 1,8 ha de vegetação nativa em APP do riacho, sem autorização de supressão, com leiras queimadas no local." },
    { chave: "v4", sig: "SSR", den: "d4", dias: 145, dLat: 0.0209, dLng: -0.0168, constatacao: "REGULAR", fotos: 1, relato: "Forno com chaminé e lenha de manejo com DOF; emissão dentro do esperado para a atividade. Orientado o proprietário quanto ao horário de queima." },
    { chave: "v5", sig: "CSE", den: "d5", emp: "areal", dias: 7, dLat: -0.0225, dLng: 0.0296, constatacao: "IRREGULAR", fotos: 2, relato: "Draga em operação cerca de 400 m a jusante da poligonal licenciada, com pilhas de areia depositadas na margem e supressão da mata ciliar." },
    { chave: "v6", sig: "PCA", den: "d6", emp: "ceramica_ptg", dias: 5, dLat: 0.0139, dLng: 0.0200, constatacao: "IRREGULAR", fotos: 1, relato: "Resíduos cerâmicos com identificação da Cerâmica Candeeiro dispostos em área de caatinga, cerca de 30 m³, fora da área licenciada." },
    { chave: "v7", sig: "LOR", emp: "avicola_lor", dias: 75, dLat: -0.0345, dLng: -0.0296, constatacao: "REGULAR", fotos: 2, relato: "Vistoria de rotina: galpões com cortinas e composteira em funcionamento; cama de frango armazenada em local coberto." },
    { chave: "v8", sig: "CSE", emp: "of_irmaos", dias: 20, dLat: 0.0032, dLng: 0.0045, constatacao: "IRREGULAR", fotos: 1, relato: "Vistoria de rotina: tambores de óleo usado armazenados sobre solo sem impermeabilização e sem bacia de contenção." },
  ];
  const vis: Record<string, string> = {};
  let fotosTotal = 0;
  for (const v of VISTORIAS) {
    const u = await fiscalDe(v.sig);
    const pos = lojaPos(v.sig, v.dLat, v.dLng);
    const colega = COM_EQUIPE.has(v.sig) ? await sessao(`tecnico.${v.sig.toLowerCase()}@licenciagov.demo`) : null;
    const entrada = FiscalizacaoSchema.parse({
      municipio_id: mun[v.sig].id, denuncia_id: v.den ? den[v.den].id : null, empreendimento_id: v.emp ? emp[v.emp].id : null,
      data_hora: diasAtras(v.dias, 9 + (v.dias % 6), 20), ...pos, precisao_m: 6 + (v.dias % 9),
      equipe: colega ? [{ usuario_id: colega.id, nome: colega.nome }] : [], relato: v.relato, constatacao: v.constatacao,
    });
    const fotos = FOTOS.slice(0, v.fotos).map((dados, i) => ({ nome: `vistoria-${v.chave}-${i + 1}.jpg`, dados, latitude: pos.latitude + i * 0.00008, longitude: pos.longitude - i * 0.00006 }));
    const f = await fisc.criarFiscalizacao(u, entrada, fotos);
    vis[v.chave] = f.id;
    fotosTotal += fotos.length;
  }
  // Situação final das denúncias
  const statusDen: [string, "CONCLUIDA" | "ARQUIVADA" | "EM_APURACAO", string][] = [
    ["d1", "CONCLUIDA", "Vistoria realizada, auto de infração e notificação lavrados."],
    ["d4", "CONCLUIDA", "Vistoria não constatou irregularidade. Denunciante informado."],
    ["d5", "CONCLUIDA", "Auto de infração lavrado e notificação emitida ao empreendedor."],
    ["d8", "ARQUIVADA", "Competência da Secretaria de Ordem Pública (poluição sonora urbana). Encaminhado ao órgão competente."],
    ["d9", "EM_APURACAO", "Vistoria a ser agendada com apoio da vigilância sanitária."],
  ];
  for (const [chave, status, despacho] of statusDen) {
    const d = DENUNCIAS.find((x) => x.chave === chave)!;
    await fisc.alterarStatusDenuncia(await fiscalDe(d.sig), den[chave].id, status, despacho);
  }
  log(`${VISTORIAS.length} vistorias (${fotosTotal} fotos) registradas.`);

  // ── Autos de infração (4) e notificações (5) com PDF ──
  const autos = [
    { v: "v1", sig: "LOR", autuado: { pessoa_id: pessoa.maria }, penalidade: "MULTA", valor_multa: 3500, enquadramento_legal: "Lei Federal nº 9.605/1998, art. 54, §2º, V; Decreto Federal nº 6.514/2008, art. 62, V.", descricao_infracao: "Lançar efluentes líquidos (água de lavagem com óleo e detergente) em via pública e galeria pluvial, em desacordo com as exigências estabelecidas." },
    { v: "v3", sig: "SSR", autuado: { pessoa_id: pessoa.antonio }, penalidade: "EMBARGO", valor_multa: null, enquadramento_legal: "Lei Federal nº 12.651/2012, art. 4º; Decreto Federal nº 6.514/2008, arts. 43 e 51.", descricao_infracao: "Destruir vegetação nativa em área de preservação permanente (1,8 ha) sem autorização do órgão ambiental. Embargo da área suprimida." },
    { v: "v5", sig: "CSE", autuado: { pessoa_id: pessoa.mineracao }, penalidade: "MULTA", valor_multa: 25000, enquadramento_legal: "Lei Federal nº 9.605/1998, art. 55; Decreto Federal nº 6.514/2008, art. 63.", descricao_infracao: "Executar extração de recursos minerais (areia) fora da poligonal autorizada e em desacordo com a licença ambiental vigente." },
    { v: "v6", sig: "PCA", autuado: { pessoa_id: pessoa.ceramica }, penalidade: "ADVERTENCIA", valor_multa: null, enquadramento_legal: "Lei Federal nº 12.305/2010, art. 47, II; Decreto Federal nº 6.514/2008, art. 62, IX.", descricao_infracao: "Dispor resíduos sólidos industriais (cacos cerâmicos) a céu aberto, em área não licenciada." },
  ] as const;
  let pdfsFiscalizacao = 0;
  for (const a of autos) {
    const u = await fiscalDe(a.sig);
    const r = await fisc.criarAutoInfracao(u, AutoInfracaoSchema.parse({ fiscalizacao_id: vis[a.v], autuado: a.autuado, enquadramento_legal: a.enquadramento_legal, descricao_infracao: a.descricao_infracao, penalidade: a.penalidade, valor_multa: a.valor_multa, prazo_defesa_dias: 20 }));
    if (r.erro_pdf) throw new Error(`PDF do auto ${r.auto.numero}: ${r.erro_pdf}`);
    pdfsFiscalizacao++;
  }
  const lavajatoEstrela = criados.find((c) => c.spec.emp === "lavajato_estrela")!;
  const notificacoes = [
    { sig: "LOR", fiscalizacao_id: vis.v1, notificado: { pessoa_id: pessoa.maria }, exigencia: "Desobstruir e adequar a caixa separadora de água e óleo e apresentar comprovante de limpeza por empresa licenciada.", prazo_dias: 15 },
    { sig: "SSR", fiscalizacao_id: vis.v3, notificado: { pessoa_id: pessoa.antonio }, exigencia: "Apresentar Projeto de Recuperação de Área Degradada (PRAD) para a APP suprimida, elaborado por profissional habilitado com ART.", prazo_dias: 30 },
    { sig: "CSE", fiscalizacao_id: vis.v5, notificado: { pessoa_id: pessoa.mineracao }, exigencia: "Paralisar a dragagem fora da poligonal e apresentar levantamento planialtimétrico georreferenciado da área explorada.", prazo_dias: 10 },
    { sig: "CSE", fiscalizacao_id: vis.v8, notificado: { nova_pessoa: { tipo: "PJ", cpf_cnpj: gerarCnpj("19634527"), nome: "Irmãos Silva Auto Center Ltda" } }, exigencia: "Instalar bacia de contenção impermeabilizada para os tambores de óleo usado e comprovar a destinação a coletor autorizado pela ANP.", prazo_dias: 20 },
    { sig: "SSR", processo_id: lavajatoEstrela.id, notificado: { pessoa_id: pessoa.posto }, exigencia: "Apresentar outorga (ou dispensa) de uso de recursos hídricos do poço tubular que abastece a lavagem de veículos.", prazo_dias: 30 },
  ];
  for (const n of notificacoes) {
    const u = n.processo_id ? await sessao(T.ssr) : await fiscalDe(n.sig);
    const r = await fisc.criarNotificacao(u, NotificacaoSchema.parse({ ...n, sig: undefined }));
    if (r.erro_pdf) throw new Error(`PDF da notificação ${r.notificacao.numero}: ${r.erro_pdf}`);
    pdfsFiscalizacao++;
  }
  log(`${autos.length} autos de infração e ${notificacoes.length} notificações emitidos (PDF).`);

  // Backup (T10): NENHUM registro é fabricado aqui. /admin/backup mostra apenas execuções reais do job
  // `backup` do worker (lib/backup/executar.ts) ou do botão "Executar backup agora".

  // ── Alertas (T3) ──
  const alertas = await gerarAlertas(new Date(), { organizacao_id: orgDemo.id });
  log(`Alertas: ${alertas.alertas_criados} criados, ${alertas.emails_enviados} e-mails na caixa de teste.${alertas.erros.length ? " Erros: " + alertas.erros.join("; ") : ""}`);

  // ── Resumo ──
  const porStatus = await prisma.processo.groupBy({ by: ["status"], _count: true, orderBy: { status: "asc" } });
  const porMun = await prisma.processo.groupBy({ by: ["municipio_id"], _count: true });
  const docs = await prisma.documentoOficial.groupBy({ by: ["tipo"], _count: true, orderBy: { tipo: "asc" } });
  const tecLor = await sessao(T.lor);
  const alertasLor = await prisma.alerta.count({ where: { usuario_id: tecLor.id, lido: false } });
  const vencendo = await prisma.documentoOficial.count({ where: { tipo: "LICENCA", status: "VALIDO", validade_ate: { lte: new Date(Date.now() + 120 * DIA) } } });
  const [nDen, nFis, nAutos, nNot, nEmails, nEmp, nPessoas] = await Promise.all([
    prisma.denuncia.count(), prisma.fiscalizacao.count({ where: { status: "REALIZADA" } }), prisma.autoInfracao.count(), prisma.notificacao.count(), prisma.emailEnviado.count(), prisma.empreendimento.count(), prisma.pessoa.count(),
  ]);
  const tecLorProc = await prisma.processo.findMany({ where: { tecnico_id: tecLor.id }, select: { numero: true, status: true, prazo_etapa_ate: true } });

  console.log("\n══════════ Seed de demonstração concluído ══════════");
  console.log(`Tempo: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  console.log(`Pessoas: ${nPessoas} · Responsáveis técnicos: ${RTS.length} · Empreendimentos: ${nEmp}`);
  console.log(`Processos: ${criados.length}`);
  for (const s of porStatus) console.log(`  ${s.status.padEnd(22)} ${s._count}`);
  console.log(`Por município: ${porMun.map((m) => `${municipios.find((x) => x.id === m.municipio_id)!.sigla}=${m._count}`).join(" ")}`);
  console.log(`Documentos oficiais: ${docs.map((d) => `${d.tipo}=${d._count}`).join(" ")} (licenças vencendo em ≤120 dias: ${vencendo})`);
  console.log(`Denúncias: ${nDen} · Vistorias realizadas: ${nFis} · Autos: ${nAutos} · Notificações: ${nNot} · PDFs de fiscalização: ${pdfsFiscalizacao}`);
  console.log(`E-mails na caixa de teste (email_enviado): ${nEmails}`);
  console.log(`T3 – tecnico.lor: ${alertasLor} alerta(s) não lido(s); processos: ${tecLorProc.map((p) => `${p.numero} ${p.status}`).join(", ")}`);
  const t2 = await prisma.processo.findMany({ where: { empreendimento: { nome: MARCADOR } }, include: { tipo_ato: true, documentos: { where: { tipo: "LICENCA" } } }, orderBy: { data_protocolo: "asc" } });
  console.log(`T2 – ${MARCADOR}: ${t2.map((p) => `${p.tipo_ato.sigla} ${p.numero} ${p.status} [${p.documentos.map((d) => d.numero).join(",")}]`).join(" · ")}`);
  console.log(`\nLogins (senha de todos: ${SENHA_DEMO}):`);
  console.log("  admin@licenciagov.demo · sema@licenciagov.demo · tec.consorcio1@… · tec.consorcio2@…");
  console.log("  tecnico.lor@ · gestor.lor@ · fiscal.lor@ (também .ssr e .cse) – domínio @licenciagov.demo");
  console.log("  Requerentes: laticinio@ · posto@ · joao@ · maria@ · ceramica@ (licenciagov.demo)");

  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[seed:demo] falhou:", e);
    process.exit(1);
  });
