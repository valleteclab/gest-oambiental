// Dados de ENSAIO da PoC – Pregão SRP 005/2026 – CDS Piemonte do Paraguaçu (SPEC 13 e 14).
// USO EXCLUSIVO DO AMBIENTE DA PoC (projeto/ambiente "licenciagov-poc"): NUNCA carregar na demonstração pública
// (que usa o consórcio fictício CID-DEMO) nem na produção do cliente após a implantação. Ver docs/poc-cds.md.
//
//   npm run onboard -- cds-piemonte --demo     (organização CDS-PIEMONTE, 8 municípios reais, usuários, catálogo)
//   npm run seed:cds-poc                       (este arquivo; idempotente pelo marcador "Posto Estrela – Ruy Barbosa")
//   ONBOARD_SENHA=… npm run seed:cds-poc -- --redefinir-senhas   (rotaciona a senha dos 5 requerentes de ensaio)
//
// Salvaguardas: aborta com DEMO_MODE=true ou se a organização fictícia CID-DEMO existir na base (ambiente da
// demonstração pública) – `--forcar` ignora as duas checagens (somente para testes locais conscientes).
//
// Municípios e códigos IBGE são REAIS (prisma/seed/clientes/cds-piemonte.json). Todo o resto é FICTÍCIO:
// empresas, pessoas, CPFs/CNPJs (gerados com dígitos verificadores válidos, sem relação com cadastros reais),
// responsáveis técnicos e registros em conselho, números de CAR (sufixo hexadecimal derivado do nome) e as
// coordenadas dos empreendimentos/denúncias/vistorias (pontos a poucos km da sede, conferidos dentro da malha
// municipal do IBGE). Não há telefones nem endereços reais de pessoas; e-mails só dos usuários de ensaio
// (@poc.licenciagov.app).
//
// Como prisma/seed/demo.ts, os dados são criados pelos SERVIÇOS REAIS (cadastros, rascunho, anexos, transicionar,
// emissão de documentos com PDF/QR, fiscalização, alertas) – numeração, tramitação, prazos, auditoria, e-mails e
// PDFs são genuínos. Depois, só campos de DATA são ajustados (histórico ao longo de 2026). NÃO cria registros de
// backup: o T10 usa uma execução REAL de backup (scripts/backup) no ambiente da PoC.
//
// Cenários dos testes de aceite (SPEC 13):
//   T1 – "Laticínio Boa Vista – Itaberaba" (requerente laticinio@…, com login): LP e LI concluídas, SEM LO aberta.
//   T2 – "Posto Estrela – Ruy Barbosa": LP, LI e LO concluídas, 3 licenças; RT com registro no CREA.
//   T3 – tecnico.itb tem exatamente 2 processos com prazo correndo: um vence em 3 dias e outro vencido.
//   T4 – denúncias de Itaberaba em apuração para o fiscal.itb.
//   T6/T9 – dados nos 8 municípios. T7 – processos em Itaberaba e em Iaçu (técnico de Iaçu não vê Itaberaba).
//   T11 – "Clínica Odontológica Sorriso Ltda" (sem login) com um único empreendimento em Itaberaba.
//
// Os módulos de lib/ importam "server-only": rodar com `tsx --conditions=react-server` (ver package.json).
import path from "node:path";
import { readFileSync } from "node:fs";
import type { StatusProcesso } from "@prisma/client";

try {
  process.loadEnvFile(path.resolve(__dirname, "../../../.env"));
} catch {
  /* variáveis já no ambiente */
}

const RAIZ = path.resolve(__dirname, "../../..");
const FIXTURES = path.join(RAIZ, "tests/fixtures");
export const ORG_SIGLA = "CDS-PIEMONTE";
export const MARCADOR = "Posto Estrela – Ruy Barbosa";
const DOMINIO = "poc.licenciagov.app";
const SENHA_ENSAIO_PADRAO = "Demo@2026licencia"; // mesma do onboarding --demo; ONBOARD_SENHA sobrescreve
const DIA = 86400000;

// ───────────────────────── Utilidades ─────────────────────────

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
/** CPF válido (FICTÍCIO) a partir de 9 dígitos-base. */
export function gerarCpf(base9: string): string {
  const d = base9.split("").map(Number);
  for (const n of [9, 10]) {
    let s = 0;
    for (let i = 0; i < n; i++) s += d[i] * (n + 1 - i);
    const r = (s * 10) % 11;
    d.push(r === 10 ? 0 : r);
  }
  return d.join("");
}
/** CNPJ válido (FICTÍCIO) a partir de 8 dígitos de raiz + filial 0001. */
export function gerarCnpj(raiz8: string, filial = "0001"): string {
  const d = (raiz8 + filial).split("").map(Number);
  for (const pesos of [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]]) {
    const s = pesos.reduce((acc, p, i) => acc + d[i] * p, 0);
    const r = s % 11;
    d.push(r < 2 ? 0 : 11 - r);
  }
  return d.join("");
}
/** Nº do CAR no formato oficial "BA-<IBGE>-<32 hex>" – FICTÍCIO (sufixo = hash do nome; não existe no SICAR). */
function carFicticio(ibge: string, semente: string): string {
  let h = 2166136261;
  let hex = "";
  for (let k = 0; hex.length < 32; k++) {
    for (const ch of `${semente}#${k}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    hex += h.toString(16).padStart(8, "0");
  }
  return `BA-${ibge}-${hex.slice(0, 32).toUpperCase()}`;
}

// ───────────────────────── Dados (fictícios) ─────────────────────────

/** Requerentes COM login (papel REQUERENTE) – usados pelos testes de aceite (T1 laticinio; T2 posto). */
export const REQUERENTES_LOGIN = [
  { chave: "laticinio", email: `laticinio@${DOMINIO}`, tipo: "PJ", doc: gerarCnpj("36184527"), nome: "Laticínio Boa Vista Ltda", mun: "ITB", logradouro: "Estrada do Boa Vista, km 3", bairro: "Zona Rural" },
  { chave: "posto", email: `posto@${DOMINIO}`, tipo: "PJ", doc: gerarCnpj("29573816"), nome: "Posto Estrela Comércio de Combustíveis Ltda", mun: "RUY", logradouro: "Rodovia de acesso, km 1", bairro: "Zona Urbana" },
  { chave: "joao", email: `joao@${DOMINIO}`, tipo: "PF", doc: gerarCpf("318274650"), nome: "João Pereira dos Santos", mun: "IAC", logradouro: "Sítio Olho d'Água, s/n", bairro: "Zona Rural" },
  { chave: "maria", email: `maria@${DOMINIO}`, tipo: "PF", doc: gerarCpf("427159386"), nome: "Maria de Lourdes Oliveira", mun: "ITB", logradouro: "Rua Projetada A, s/n", bairro: "Centro" },
  { chave: "ceramica", email: `ceramica@${DOMINIO}`, tipo: "PJ", doc: gerarCnpj("17496235"), nome: "Cerâmica Barro Forte Ltda", mun: "ITT", logradouro: "Estrada da Olaria, km 2", bairro: "Zona Rural" },
] as const;

type PessoaDemo = { chave: string; tipo: "PF" | "PJ"; doc: string; nome: string; fantasia?: string; mun: string; logradouro: string; bairro: string };
/** Requerentes SEM login e pessoas dos RTs (sem e-mail/telefone: nada de contatos inventados). */
const PESSOAS: PessoaDemo[] = [
  { chave: "primavera", tipo: "PJ", doc: gerarCnpj("48261735"), nome: "Primavera Empreendimentos Imobiliários Ltda", fantasia: "Primavera Urbanismo", mun: "ITB", logradouro: "Avenida Projetada, 800", bairro: "Centro" },
  { chave: "mineracao", tipo: "PJ", doc: gerarCnpj("53927184"), nome: "Areia Fina do Vale Mineração Ltda", fantasia: "Areal Vale Fino", mun: "IAC", logradouro: "Estrada do Porto, km 4", bairro: "Zona Rural" },
  { chave: "irmaos_silva", tipo: "PJ", doc: gerarCnpj("26815394"), nome: "Irmãos Silva Auto Center Ltda", fantasia: "Auto Center Irmãos Silva", mun: "IAC", logradouro: "Rua do Comércio, 145", bairro: "Centro" },
  { chave: "chapada", tipo: "PJ", doc: gerarCnpj("61742958"), nome: "Auto Posto Chapadinha Ltda", fantasia: "Posto Chapadinha", mun: "MNV", logradouro: "Avenida de Acesso, 1500", bairro: "Centro" },
  { chave: "serra_verde", tipo: "PJ", doc: gerarCnpj("72519643"), nome: "Laticínios Serra Verde Ltda", fantasia: "Serra Verde", mun: "MNV", logradouro: "Estrada vicinal, km 2", bairro: "Zona Rural" },
  { chave: "bela_vista", tipo: "PJ", doc: gerarCnpj("84637251"), nome: "Bela Vista Urbanismo SPE Ltda", mun: "RUY", logradouro: "Rua Projetada B, 60", bairro: "Centro" },
  { chave: "sorriso", tipo: "PJ", doc: gerarCnpj("95172846"), nome: "Clínica Odontológica Sorriso Ltda", fantasia: "Clínica Sorriso", mun: "ITB", logradouro: "Praça Central, 22", bairro: "Centro" },
  { chave: "comb_iac", tipo: "PJ", doc: gerarCnpj("37286159"), nome: "Comercial de Combustíveis Rota Sul Ltda", fantasia: "Posto Rota Sul Diesel", mun: "IAC", logradouro: "Avenida de Acesso, 900", bairro: "Rodoviária" },
  { chave: "antonio", tipo: "PF", doc: gerarCpf("539184627"), nome: "Antônio Carlos Ribeiro", mun: "RUY", logradouro: "Fazenda Santa Luzia, s/n", bairro: "Zona Rural" },
  { chave: "jose_roberto", tipo: "PF", doc: gerarCpf("642715398"), nome: "José Roberto Nascimento", mun: "RJB", logradouro: "Fazenda Boa Esperança, s/n", bairro: "Zona Rural" },
  { chave: "edvaldo", tipo: "PF", doc: gerarCpf("751836429"), nome: "Edvaldo Santos Lima", mun: "RUY", logradouro: "Rua do Comércio, 318", bairro: "Centro" },
  { chave: "rosangela", tipo: "PF", doc: gerarCpf("863914275"), nome: "Rosângela Souza Pires", mun: "IBQ", logradouro: "Rua Principal, 45", bairro: "Centro" },
  { chave: "gilberto", tipo: "PF", doc: gerarCpf("974125386"), nome: "Gilberto Araújo Costa", mun: "TPM", logradouro: "Avenida Principal, 77", bairro: "Centro" },
  // Pessoas dos responsáveis técnicos (fictícios)
  { chave: "rt_ricardo", tipo: "PF", doc: gerarCpf("185263947"), nome: "Ricardo Almeida Souza", mun: "ITB", logradouro: "Rua A, 210", bairro: "Centro" },
  { chave: "rt_fernanda", tipo: "PF", doc: gerarCpf("296374158"), nome: "Fernanda Lima Carvalho", mun: "RUY", logradouro: "Rua B, 58", bairro: "Centro" },
  { chave: "rt_paulo", tipo: "PF", doc: gerarCpf("317485269"), nome: "Paulo Henrique Mendes", mun: "IAC", logradouro: "Travessa C, 12", bairro: "Centro" },
  { chave: "rt_marcos", tipo: "PF", doc: gerarCpf("428596371"), nome: "Marcos Vinícius Tavares", mun: "ITT", logradouro: "Rua D, 101", bairro: "Centro" },
];

// Registros em conselho FICTÍCIOS (formato plausível).
const RTS = [
  { chave: "ricardo", pessoa: "rt_ricardo", formacao: "Engenheiro Ambiental e Sanitarista", conselho: "CREA", registro: "0512345678", uf: "BA" },
  { chave: "fernanda", pessoa: "rt_fernanda", formacao: "Bióloga", conselho: "CRBio", registro: "71234/08-D", uf: "BA" },
  { chave: "paulo", pessoa: "rt_paulo", formacao: "Engenheiro Agrônomo", conselho: "CREA", registro: "0512876543", uf: "BA" },
  { chave: "marcos", pessoa: "rt_marcos", formacao: "Geólogo", conselho: "CREA", registro: "0512987654", uf: "BA" },
] as const;

type EmpDemo = { chave: string; nome: string; mun: string; req: string; tip: string; grandeza: number; area: number; dLat: number; dLng: number; rt?: string; logradouro: string; bairro?: string; car?: boolean };

// 25 empreendimentos. Coordenadas: sede do município (cds-piemonte.json) + deslocamento de poucos km,
// conferidas dentro da malha municipal do IBGE.
export const EMPREENDIMENTOS: EmpDemo[] = [
  { chave: "posto_estrela", nome: MARCADOR, mun: "RUY", req: "posto", tip: "E1.1", grandeza: 90, area: 1800, dLat: 0.0071, dLng: -0.0093, rt: "ricardo", logradouro: "Rodovia de acesso, km 1, s/n", bairro: "Zona Urbana" },
  { chave: "lat_bv", nome: "Laticínio Boa Vista – Itaberaba", mun: "ITB", req: "laticinio", tip: "C1.1", grandeza: 15000, area: 5200, dLat: -0.0182, dLng: 0.0214, rt: "ricardo", logradouro: "Estrada do Boa Vista, km 3", bairro: "Zona Rural" },
  { chave: "ceramica", nome: "Cerâmica Barro Forte – Itatim", mun: "ITT", req: "ceramica", tip: "C2.1", grandeza: 400, area: 12000, dLat: 0.0125, dLng: -0.0187, rt: "marcos", logradouro: "Estrada da Olaria, km 2", bairro: "Zona Rural" },
  { chave: "olaria_bf", nome: "Olaria Barro Forte Tijolos – Itatim", mun: "ITT", req: "ceramica", tip: "C2.1", grandeza: 120, area: 6500, dLat: -0.0098, dLng: 0.0072, rt: "marcos", logradouro: "Estrada vicinal, s/n", bairro: "Zona Rural" },
  { chave: "olaria_sj", nome: "Olaria São José – Iaçu", mun: "IAC", req: "joao", tip: "C2.1", grandeza: 80, area: 4300, dLat: -0.0154, dLng: -0.0121, logradouro: "Sítio Olho d'Água, estrada vicinal, km 2", bairro: "Zona Rural" },
  { chave: "lavajato_brilho", nome: "Lava-Jato Brilho Total – Itaberaba", mun: "ITB", req: "maria", tip: "E1.2", grandeza: 150, area: 320, dLat: 0.0043, dLng: -0.0051, logradouro: "Rua Projetada A, s/n", bairro: "Centro" },
  { chave: "lavajato_estrela", nome: "Lava-Jato e Troca de Óleo Estrela – Ruy Barbosa", mun: "RUY", req: "posto", tip: "E1.2", grandeza: 300, area: 650, dLat: 0.0068, dLng: -0.0085, rt: "ricardo", logradouro: "Rodovia de acesso, km 1, anexo", bairro: "Zona Urbana" },
  { chave: "granja_sl", nome: "Granja Santa Luzia – Ruy Barbosa", mun: "RUY", req: "antonio", tip: "A1.1", grandeza: 80000, area: 38000, dLat: 0.0417, dLng: -0.0362, rt: "paulo", logradouro: "Fazenda Santa Luzia, estrada vicinal", bairro: "Zona Rural", car: true },
  { chave: "areal", nome: "Areal Vale Fino – Iaçu", mun: "IAC", req: "mineracao", tip: "F1.1", grandeza: 15000, area: 90000, dLat: -0.0213, dLng: 0.0288, rt: "marcos", logradouro: "Estrada do Porto, km 4", bairro: "Zona Rural" },
  { chave: "lagoa_funda", nome: "Extração de Areia Lagoa Funda – Rafael Jambeiro", mun: "RJB", req: "mineracao", tip: "F1.1", grandeza: 8000, area: 45000, dLat: -0.0264, dLng: -0.0197, rt: "marcos", logradouro: "Povoado de Lagoa Funda, s/n", bairro: "Zona Rural" },
  { chave: "posto_chapadinha", nome: "Posto Chapadinha – Mundo Novo", mun: "MNV", req: "chapada", tip: "E1.1", grandeza: 150, area: 2400, dLat: 0.0052, dLng: 0.0068, rt: "ricardo", logradouro: "Avenida de Acesso, 1500", bairro: "Centro" },
  { chave: "faz_bom_jesus", nome: "Fazenda Leiteira Bom Jesus – Tapiramutá", mun: "TPM", req: "jose_roberto", tip: "A1.2", grandeza: 400, area: 250000, dLat: -0.0286, dLng: 0.0171, rt: "paulo", logradouro: "Fazenda Bom Jesus, estrada vicinal", bairro: "Zona Rural", car: true },
  { chave: "of_irmaos", nome: "Oficina Mecânica Irmãos Silva – Iaçu", mun: "IAC", req: "irmaos_silva", tip: "E1.3", grandeza: 350, area: 480, dLat: 0.0031, dLng: 0.0044, logradouro: "Rua do Comércio, 145", bairro: "Centro" },
  { chave: "of_central", nome: "Oficina e Funilaria Central – Ruy Barbosa", mun: "RUY", req: "edvaldo", tip: "E1.3", grandeza: 250, area: 390, dLat: -0.0038, dLng: 0.0029, logradouro: "Rua do Comércio, 318", bairro: "Centro" },
  { chave: "mecanica_tpm", nome: "Auto Mecânica Serra Azul – Tapiramutá", mun: "TPM", req: "gilberto", tip: "E1.3", grandeza: 180, area: 260, dLat: 0.0027, dLng: -0.0035, logradouro: "Avenida Principal, 77", bairro: "Centro" },
  { chave: "lat_serra_verde", nome: "Laticínio Serra Verde – Mundo Novo", mun: "MNV", req: "serra_verde", tip: "C1.1", grandeza: 30000, area: 7800, dLat: 0.0195, dLng: 0.0241, rt: "fernanda", logradouro: "Estrada vicinal, km 2", bairro: "Zona Rural" },
  { chave: "queijaria", nome: "Queijaria Artesanal Sertão – Ibiquera", mun: "IBQ", req: "rosangela", tip: "C1.1", grandeza: 3000, area: 600, dLat: 0.0089, dLng: 0.0113, rt: "fernanda", logradouro: "Sítio Lagoa do Boi, s/n", bairro: "Zona Rural" },
  { chave: "lavajato_ibq", nome: "Lava-Jato Express – Ibiquera", mun: "IBQ", req: "rosangela", tip: "E1.2", grandeza: 120, area: 210, dLat: 0.0021, dLng: 0.0019, logradouro: "Rua Principal, 45", bairro: "Centro" },
  { chave: "granja_be", nome: "Granja Boa Esperança – Rafael Jambeiro", mun: "RJB", req: "jose_roberto", tip: "A1.1", grandeza: 150000, area: 52000, dLat: -0.0311, dLng: 0.0226, rt: "paulo", logradouro: "Fazenda Boa Esperança, s/n", bairro: "Zona Rural", car: true },
  { chave: "lot_bela_vista", nome: "Loteamento Residencial Bela Vista – Ruy Barbosa", mun: "RUY", req: "bela_vista", tip: "G1.1", grandeza: 25, area: 250000, dLat: 0.0148, dLng: 0.0117, rt: "ricardo", logradouro: "Estrada do Bela Vista, s/n", bairro: "Bela Vista" },
  { chave: "lot_primavera", nome: "Loteamento Jardim Primavera – Itaberaba", mun: "ITB", req: "primavera", tip: "G1.1", grandeza: 12, area: 120000, dLat: 0.0163, dLng: -0.0149, rt: "ricardo", logradouro: "Avenida Projetada, s/n (prolongamento)", bairro: "Primavera" },
  { chave: "lot_portal", nome: "Loteamento Portal do Sertão – Iaçu", mun: "IAC", req: "primavera", tip: "G1.1", grandeza: 8, area: 80000, dLat: -0.0122, dLng: -0.0164, rt: "fernanda", logradouro: "Saída para o Portal, s/n", bairro: "Portal" },
  { chave: "clinica", nome: "Clínica Odontológica Sorriso – Itaberaba", mun: "ITB", req: "sorriso", tip: "H1.1", grandeza: 180, area: 180, dLat: -0.0022, dLng: 0.0017, logradouro: "Praça Central, 22", bairro: "Centro" },
  { chave: "avicola_itb", nome: "Granja Avícola Riacho Seco – Itaberaba", mun: "ITB", req: "antonio", tip: "A1.1", grandeza: 45000, area: 26000, dLat: -0.0347, dLng: -0.0298, rt: "paulo", logradouro: "Fazenda Riacho Seco, estrada vicinal", bairro: "Zona Rural", car: true },
  { chave: "posto_rota_sul", nome: "Posto Rota Sul Diesel – Iaçu", mun: "IAC", req: "comb_iac", tip: "E1.1", grandeza: 60, area: 1500, dLat: 0.0061, dLng: 0.0083, rt: "ricardo", logradouro: "Avenida de Acesso, 900", bairro: "Rodoviária" },
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
  dias: number;
  dur?: number;
  tec?: string;
  pendDoc?: boolean;
  pendTec?: boolean;
  pendPrazo?: number;
  conclusao?: "FAVORAVEL" | "FAVORAVEL_COM_CONDICIONANTES" | "DESFAVORAVEL";
  prazo?: number;
  pendVencida?: boolean;
  validade?: number;
  rotulo?: string;
};

export const EMAILS = {
  admin: `admin.cds@${DOMINIO}`,
  itb: `tecnico.itb@${DOMINIO}`,
  ruy: `tecnico.ruy@${DOMINIO}`,
  iac: `tecnico.iac@${DOMINIO}`,
  c1: `tec.consorcio1@${DOMINIO}`,
  c2: `tec.consorcio2@${DOMINIO}`,
};
const T = EMAILS;

// 44 processos em todos os status. Ordenados pelo protocolo antes da execução (numeração crescente no tempo).
export const PROCESSOS: ProcDemo[] = [
  // ── CONCLUÍDOS com licença (15) – três "vencendo" (validade ajustada) ──
  { emp: "posto_estrela", ato: "LP", alvo: "CONCLUIDO", dias: 250, dur: 35, tec: T.ruy, conclusao: "FAVORAVEL_COM_CONDICIONANTES", rotulo: "T2 – LP" },
  { emp: "posto_estrela", ato: "LI", alvo: "CONCLUIDO", dias: 195, dur: 40, tec: T.ruy, pendTec: true, conclusao: "FAVORAVEL_COM_CONDICIONANTES", rotulo: "T2 – LI" },
  { emp: "posto_estrela", ato: "LO", alvo: "CONCLUIDO", dias: 120, dur: 45, tec: T.ruy, conclusao: "FAVORAVEL_COM_CONDICIONANTES", rotulo: "T2 – LO" },
  { emp: "lat_bv", ato: "LP", alvo: "CONCLUIDO", dias: 240, dur: 30, tec: T.c1, conclusao: "FAVORAVEL", rotulo: "T1 – LP anterior" },
  { emp: "lat_bv", ato: "LI", alvo: "CONCLUIDO", dias: 170, dur: 50, tec: T.itb, pendDoc: true, conclusao: "FAVORAVEL_COM_CONDICIONANTES", rotulo: "T1 – LI anterior" },
  { emp: "ceramica", ato: "LO", alvo: "CONCLUIDO", dias: 220, dur: 60, tec: T.c2, conclusao: "FAVORAVEL_COM_CONDICIONANTES" },
  { emp: "granja_sl", ato: "LO", alvo: "CONCLUIDO", dias: 205, dur: 55, tec: T.ruy, conclusao: "FAVORAVEL", validade: 25 },
  { emp: "areal", ato: "LO", alvo: "CONCLUIDO", dias: 185, dur: 50, tec: T.iac, conclusao: "FAVORAVEL_COM_CONDICIONANTES", validade: 55 },
  { emp: "posto_chapadinha", ato: "LO", alvo: "CONCLUIDO", dias: 160, dur: 45, tec: T.c1, conclusao: "FAVORAVEL", validade: 110 },
  { emp: "of_irmaos", ato: "LS", alvo: "CONCLUIDO", dias: 150, dur: 25, tec: T.iac, conclusao: "FAVORAVEL" },
  { emp: "of_central", ato: "LS", alvo: "CONCLUIDO", dias: 140, dur: 20, tec: T.ruy, conclusao: "FAVORAVEL" },
  { emp: "lat_serra_verde", ato: "LI", alvo: "CONCLUIDO", dias: 130, dur: 40, tec: T.c2, conclusao: "FAVORAVEL_COM_CONDICIONANTES" },
  { emp: "granja_be", ato: "LU", alvo: "CONCLUIDO", dias: 110, dur: 35, tec: T.c1, pendTec: true, conclusao: "FAVORAVEL" },
  { emp: "olaria_sj", ato: "LAC", alvo: "CONCLUIDO", dias: 95, dur: 20, tec: T.iac, conclusao: "FAVORAVEL" },
  { emp: "lot_bela_vista", ato: "LP", alvo: "CONCLUIDO", dias: 80, dur: 30, tec: T.ruy, pendDoc: true, conclusao: "FAVORAVEL_COM_CONDICIONANTES" },
  // ── Outros concluídos: certidão e indeferimento com ofício ──
  { emp: "clinica", ato: "CERT_DISP", alvo: "CONCLUIDO", dias: 100, dur: 15, tec: T.itb, conclusao: "FAVORAVEL" },
  { emp: "queijaria", ato: "LO", alvo: "INDEFERIDO", dias: 88, dur: 40, tec: T.c1, conclusao: "DESFAVORAVEL", rotulo: "indeferido → concluído (ofício)" },
  // ── Aguardando decisão (3) ──
  { emp: "posto_rota_sul", ato: "LO", alvo: "AGUARDANDO_DECISAO", dias: 70, tec: T.iac, conclusao: "FAVORAVEL_COM_CONDICIONANTES", prazo: 1 },
  { emp: "avicola_itb", ato: "LP", alvo: "AGUARDANDO_DECISAO", dias: 60, tec: T.c2, conclusao: "FAVORAVEL" },
  { emp: "olaria_bf", ato: "LO", alvo: "AGUARDANDO_DECISAO", dias: 55, tec: T.c1, conclusao: "FAVORAVEL_COM_CONDICIONANTES" },
  // ── Deferido / indeferido aguardando emissão do documento ──
  { emp: "faz_bom_jesus", ato: "LO", alvo: "DEFERIDO", dias: 50, tec: T.c2, conclusao: "FAVORAVEL" },
  { emp: "lavajato_ibq", ato: "LS", alvo: "INDEFERIDO", dias: 45, tec: T.c1, conclusao: "DESFAVORAVEL" },
  // ── Aguardando vistoria (2) ──
  { emp: "lagoa_funda", ato: "LO", alvo: "AGUARDANDO_VISTORIA", dias: 40, tec: T.c1 },
  { emp: "mecanica_tpm", ato: "LO", alvo: "AGUARDANDO_VISTORIA", dias: 35, tec: T.c2 },
  // ── Em análise (5) – os dois de tecnico.itb são o cenário T3 ──
  { emp: "lot_primavera", ato: "LI", alvo: "EM_ANALISE", dias: 58, tec: T.itb, prazo: 3, rotulo: "T3 – vence em 3 dias" },
  { emp: "lavajato_brilho", ato: "LO", alvo: "EM_ANALISE", dias: 66, tec: T.itb, prazo: -4, rotulo: "T3 – vencido" },
  { emp: "lot_portal", ato: "LP", alvo: "EM_ANALISE", dias: 30, tec: T.iac, pendTec: true },
  { emp: "lavajato_estrela", ato: "LS", alvo: "EM_ANALISE", dias: 28, tec: T.ruy },
  { emp: "lat_serra_verde", ato: "LO", alvo: "EM_ANALISE", dias: 25, tec: T.c2, prazo: -2 },
  // ── Aguardando requerente (4) ──
  { emp: "areal", ato: "ASV", alvo: "AGUARDANDO_REQUERENTE", dias: 22, tec: T.iac, pendTec: true },
  { emp: "ceramica", ato: "AA", alvo: "AGUARDANDO_REQUERENTE", dias: 20, tec: T.c2, pendDoc: true, pendPrazo: 3 },
  { emp: "granja_be", ato: "AA", alvo: "AGUARDANDO_REQUERENTE", dias: 38, tec: T.c1, pendTec: true, pendVencida: true },
  { emp: "olaria_sj", ato: "LO", alvo: "AGUARDANDO_REQUERENTE", dias: 33, tec: T.iac, pendTec: true },
  // ── Em triagem (3) ──
  { emp: "granja_sl", ato: "RLO", alvo: "EM_TRIAGEM", dias: 10, tec: T.ruy, prazo: -2 },
  { emp: "queijaria", ato: "LS", alvo: "EM_TRIAGEM", dias: 9, tec: T.c1 },
  { emp: "of_irmaos", ato: "AA", alvo: "EM_TRIAGEM", dias: 12, tec: T.iac },
  // ── Protocolados (3) ──
  { emp: "posto_chapadinha", ato: "RLO", alvo: "PROTOCOLADO", dias: 5 },
  { emp: "lagoa_funda", ato: "AA", alvo: "PROTOCOLADO", dias: 4 },
  { emp: "lot_bela_vista", ato: "LI", alvo: "PROTOCOLADO", dias: 3 },
  // ── Rascunhos (3) ──
  { emp: "olaria_sj", ato: "AA", alvo: "RASCUNHO", dias: 2 },
  { emp: "olaria_bf", ato: "AA", alvo: "RASCUNHO", dias: 6 },
  { emp: "faz_bom_jesus", ato: "ASV", alvo: "RASCUNHO", dias: 1 },
  // ── Arquivados (2) ──
  { emp: "posto_rota_sul", ato: "AA", alvo: "ARQUIVADO_PENDENCIA", dias: 150, dur: 50, tec: T.iac },
  { emp: "avicola_itb", ato: "LO", alvo: "ARQUIVADO_TRIAGEM", dias: 190, dur: 10, tec: T.c2 },
];

const CONDICIONANTES = [
  { descricao: "Apresentar relatório semestral de monitoramento de efluentes líquidos, com laudos de laboratório acreditado.", periodicidade: "Semestral", prazo_dias: 180 },
  { descricao: "Manter o Plano de Gerenciamento de Resíduos Sólidos atualizado e comprovar a destinação final por meio de MTR.", periodicidade: "Anual", prazo_dias: 365 },
  { descricao: "Executar e manter o plantio compensatório de 150 mudas nativas da caatinga, com relatório fotográfico.", periodicidade: "Anual", prazo_dias: 300 },
];

type DenDemo = { chave: string; sig: string; canal: "PORTAL" | "PRESENCIAL" | "TELEFONE" | "OUTRO"; descricao: string; endereco: string; dLat: number; dLng: number; nome?: string; dias: number };
// 10 denúncias (denunciantes identificados sem contato: nada de telefones inventados)
export const DENUNCIAS: DenDemo[] = [
  { chave: "d1", sig: "ITB", canal: "PRESENCIAL", descricao: "Lançamento de água com sabão e óleo de lava-jato diretamente na sarjeta, escorrendo até o córrego do bairro.", endereco: "Rua Projetada A, próximo ao lava-jato", dLat: 0.0045, dLng: -0.0049, nome: "Morador(a) do bairro (identificado no atendimento)", dias: 14 },
  { chave: "d2", sig: "ITB", canal: "TELEFONE", descricao: "Queima de lixo a céu aberto em terreno baldio, com fumaça intensa no fim da tarde.", endereco: "Terreno baldio na Rua Nova", dLat: -0.0071, dLng: 0.0088, dias: 40 },
  { chave: "d3", sig: "RUY", canal: "PORTAL", descricao: "Desmatamento de vegetação nativa às margens do riacho, com uso de trator e queima das leiras, dentro de área de preservação permanente.", endereco: "Estrada vicinal, após a Fazenda Santa Luzia", dLat: 0.0432, dLng: -0.0389, dias: 12 },
  { chave: "d4", sig: "RUY", canal: "TELEFONE", descricao: "Fumaça preta e odor forte vindos de forno de olaria durante a madrugada.", endereco: "Saída da cidade, km 3", dLat: 0.0211, dLng: -0.0166, dias: 150 },
  { chave: "d5", sig: "IAC", canal: "PRESENCIAL", descricao: "Extração de areia com draga no leito do rio fora da poligonal autorizada, com assoreamento visível.", endereco: "Porto de areia, margem do rio", dLat: -0.0228, dLng: 0.0301, nome: "Associação de pescadores da comunidade", dias: 9 },
  { chave: "d6", sig: "ITT", canal: "OUTRO", descricao: "Descarte de cacos de telha e tijolos (resíduos cerâmicos) em área de caatinga ao lado da estrada.", endereco: "Estrada da Olaria, acostamento", dLat: 0.0141, dLng: -0.0203, dias: 7 },
  { chave: "d7", sig: "MNV", canal: "PORTAL", descricao: "Cheiro forte de combustível no quintal das casas vizinhas ao posto; suspeita de vazamento em tanque subterrâneo.", endereco: "Avenida de Acesso, imediações do posto", dLat: 0.0058, dLng: 0.0072, dias: 3 },
  { chave: "d8", sig: "TPM", canal: "TELEFONE", descricao: "Barulho de compressor e marteletes de oficina após as 22h.", endereco: "Avenida Principal, próximo à praça", dLat: 0.0025, dLng: -0.0031, dias: 95 },
  { chave: "d9", sig: "RJB", canal: "PRESENCIAL", descricao: "Criação de porcos a menos de 30 metros de nascente usada para abastecimento da comunidade.", endereco: "Comunidade rural, próximo à nascente", dLat: 0.0132, dLng: -0.0144, nome: "Associação comunitária local", dias: 20 },
  { chave: "d10", sig: "IBQ", canal: "PORTAL", descricao: "Resíduos de serviços de saúde (seringas e frascos) descartados em terreno às margens da estrada vicinal.", endereco: "Estrada vicinal, saída da cidade", dLat: 0.0147, dLng: 0.0181, dias: 1 },
];

type VisDemo = { chave: string; sig: string; den?: string; emp?: string; dias: number; dLat: number; dLng: number; constatacao: "IRREGULAR" | "REGULAR" | "INCONCLUSIVA"; relato: string; fotos: number };
// 8 vistorias com fotos e coordenadas dentro dos municípios
export const VISTORIAS: VisDemo[] = [
  { chave: "v1", sig: "ITB", den: "d1", emp: "lavajato_brilho", dias: 12, dLat: 0.0044, dLng: -0.0050, constatacao: "IRREGULAR", fotos: 2, relato: "Constatado lançamento de efluente de lavagem de veículos na via pública, sem passagem pela caixa separadora de água e óleo, que se encontrava obstruída." },
  { chave: "v2", sig: "ITB", den: "d2", dias: 37, dLat: -0.0070, dLng: 0.0089, constatacao: "INCONCLUSIVA", fotos: 1, relato: "No momento da vistoria não havia queima em andamento; foram observados vestígios de cinzas e resíduos domésticos. Responsável pelo terreno não identificado." },
  { chave: "v3", sig: "RUY", den: "d3", emp: "granja_sl", dias: 10, dLat: 0.0430, dLng: -0.0385, constatacao: "IRREGULAR", fotos: 2, relato: "Constatada supressão de aproximadamente 1,8 ha de vegetação nativa em APP do riacho, sem autorização de supressão, com leiras queimadas no local." },
  { chave: "v4", sig: "RUY", den: "d4", dias: 145, dLat: 0.0209, dLng: -0.0168, constatacao: "REGULAR", fotos: 1, relato: "Forno com chaminé e lenha de manejo com DOF; emissão dentro do esperado para a atividade. Orientado o proprietário quanto ao horário de queima." },
  { chave: "v5", sig: "IAC", den: "d5", emp: "areal", dias: 7, dLat: -0.0225, dLng: 0.0296, constatacao: "IRREGULAR", fotos: 2, relato: "Draga em operação cerca de 400 m a jusante da poligonal licenciada, com pilhas de areia depositadas na margem e supressão da mata ciliar." },
  { chave: "v6", sig: "ITT", den: "d6", emp: "ceramica", dias: 5, dLat: 0.0139, dLng: -0.0200, constatacao: "IRREGULAR", fotos: 1, relato: "Resíduos cerâmicos com identificação da Cerâmica Barro Forte dispostos em área de caatinga, cerca de 30 m³, fora da área licenciada." },
  { chave: "v7", sig: "ITB", emp: "avicola_itb", dias: 75, dLat: -0.0345, dLng: -0.0296, constatacao: "REGULAR", fotos: 2, relato: "Vistoria de rotina: galpões com cortinas e composteira em funcionamento; cama de frango armazenada em local coberto." },
  { chave: "v8", sig: "IAC", emp: "of_irmaos", dias: 20, dLat: 0.0032, dLng: 0.0045, constatacao: "IRREGULAR", fotos: 1, relato: "Vistoria de rotina: tambores de óleo usado armazenados sobre solo sem impermeabilização e sem bacia de contenção." },
];

// ───────────────────────── Execução ─────────────────────────

async function main() {
  const t0 = Date.now();
  const forcar = process.argv.includes("--forcar");
  const { prisma } = await import("../../../lib/db");
  const log = (...a: unknown[]) => console.log(`[cds-poc ${((Date.now() - t0) / 1000).toFixed(0).padStart(3)}s]`, ...a);
  const abortar = async (msg: string) => {
    console.error(`[seed:cds-poc] ${msg}`);
    await prisma.$disconnect();
    process.exit(1);
  };

  // ── Salvaguardas: nunca no ambiente da demonstração pública ──
  if (!forcar && process.env.DEMO_MODE === "true") return abortar("DEMO_MODE=true – este seed é exclusivo do ambiente da PoC (DEMO_MODE=false). Abortado; use --forcar só em teste local.");
  if (!forcar && (await prisma.organizacao.findFirst({ where: { sigla: "CID-DEMO" } }))) return abortar("A organização fictícia CID-DEMO existe nesta base (demonstração pública) – o ensaio da PoC não é carregado aqui. Abortado.");

  const org = await prisma.organizacao.findFirst({ where: { sigla: ORG_SIGLA } });
  if (!org) return abortar(`Organização ${ORG_SIGLA} não encontrada – rode antes: npm run onboard -- cds-piemonte --demo`);
  const municipios = await prisma.municipio.findMany({ where: { organizacao_id: org.id } });
  const mun = Object.fromEntries(municipios.map((m) => [m.sigla, m]));
  const faltando = ["IAC", "IBQ", "ITB", "ITT", "MNV", "RJB", "RUY", "TPM"].filter((s) => !mun[s]);
  if (faltando.length) return abortar(`Municípios ausentes em ${ORG_SIGLA}: ${faltando.join(", ")} – rode o onboarding.`);
  // --redefinir-senhas: rotação da senha dos 5 requerentes de ensaio (ONBOARD_SENHA) – os usuários internos são
  // rotacionados por `npm run onboard -- cds-piemonte --demo --redefinir-senhas`.
  if (process.argv.includes("--redefinir-senhas")) {
    if (!process.env.ONBOARD_SENHA) return abortar("--redefinir-senhas exige ONBOARD_SENHA (a nova senha).");
    const { hash } = await import("@node-rs/argon2");
    const { auditar } = await import("../../../lib/audit");
    const novo = await hash(process.env.ONBOARD_SENHA, { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    for (const r of REQUERENTES_LOGIN) {
      const u = await prisma.usuario.findUnique({ where: { email: r.email } });
      if (!u) continue;
      await prisma.usuario.update({ where: { id: u.id }, data: { senha_hash: novo, trocar_senha: false, falhas_login: 0, bloqueado_ate: null } });
      await auditar({ usuario_id: null, acao: "REDEFINIR_SENHA", entidade: "usuario", entidade_id: u.id, depois: { email: r.email, origem: "seed:cds-poc --redefinir-senhas" } });
      log(`senha redefinida: ${r.email}`);
    }
  }
  if (await prisma.empreendimento.findFirst({ where: { nome: MARCADOR, municipio: { organizacao_id: org.id } } })) {
    console.log(`Dados de ensaio da PoC já existem (empreendimento "${MARCADOR}"). Nada a fazer.`);
    console.log("Para recriar: apague o banco, rode `npx prisma migrate deploy`, o onboarding e `npm run seed:cds-poc`.");
    await prisma.$disconnect();
    return;
  }

  const { hash } = await import("@node-rs/argon2");
  const { auditar } = await import("../../../lib/audit");
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
  type UsuarioSessao = import("../../../lib/rbac").UsuarioSessao;

  const PDF_EXEMPLO = readFileSync(path.join(FIXTURES, "documento-exemplo.pdf"));
  const FOTOS = [readFileSync(path.join(FIXTURES, "vistoria-1.jpg")), readFileSync(path.join(FIXTURES, "vistoria-2.jpg"))];

  const cacheSessao = new Map<string, UsuarioSessao>();
  async function sessao(email: string): Promise<UsuarioSessao> {
    if (cacheSessao.has(email)) return cacheSessao.get(email)!;
    const s = await sessaoPorEmail(email).catch(() => {
      throw new Error(`Usuário ${email} não encontrado – rode antes: npm run onboard -- cds-piemonte --demo`);
    });
    cacheSessao.set(email, s);
    return s;
  }
  const tipologias = Object.fromEntries((await prisma.tipologia.findMany({ where: { organizacao_id: org.id } })).map((t) => [t.codigo, t]));
  const atos = Object.fromEntries((await prisma.tipoAto.findMany({ where: { organizacao_id: org.id } })).map((t) => [t.sigla, t]));
  const admin = await sessao(EMAILS.admin);
  const COM_EQUIPE = new Set(["ITB", "RUY", "IAC"]); // municípios com técnico/gestor/fiscal próprios (SPEC 14)
  const gestorDe = (sigla: string) => (COM_EQUIPE.has(sigla) ? sessao(`gestor.${sigla.toLowerCase()}@${DOMINIO}`) : Promise.resolve(admin));
  const fiscalDe = (sigla: string) => sessao(COM_EQUIPE.has(sigla) ? `fiscal.${sigla.toLowerCase()}@${DOMINIO}` : T.c2);
  const balcaoDe = (sigla: string) => sessao(COM_EQUIPE.has(sigla) ? `tecnico.${sigla.toLowerCase()}@${DOMINIO}` : T.c1);
  const endereco = (sig: string, logradouro: string, bairro: string) => ({ logradouro, bairro, cidade: mun[sig].nome, uf: "BA", cep: null });

  // ── Requerentes com login (cadastro da pessoa pelo serviço real + usuário REQUERENTE) ──
  const senhaEnsaio = process.env.ONBOARD_SENHA || SENHA_ENSAIO_PADRAO;
  const senha_hash = await hash(senhaEnsaio, { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const pessoa: Record<string, string> = {};
  const REQ_EMAIL: Record<string, string> = {};
  for (const r of REQUERENTES_LOGIN) {
    let u = await prisma.usuario.findUnique({ where: { email: r.email } });
    if (u?.pessoa_id) {
      pessoa[r.chave] = u.pessoa_id;
    } else {
      const p = await criarPessoa(admin, { tipo: r.tipo, cpf_cnpj: r.doc, nome: r.nome, email: r.email, telefone: null, endereco: endereco(r.mun, r.logradouro, r.bairro), municipio_id: mun[r.mun].id });
      pessoa[r.chave] = p.id;
      u = u
        ? await prisma.usuario.update({ where: { id: u.id }, data: { pessoa_id: p.id } })
        : await prisma.usuario.create({ data: { email: r.email, nome: r.nome, senha_hash, trocar_senha: false, pessoa_id: p.id } });
      if (!(await prisma.usuarioPapel.findFirst({ where: { usuario_id: u.id, papel: "REQUERENTE" } }))) await prisma.usuarioPapel.create({ data: { usuario_id: u.id, papel: "REQUERENTE" } });
      await auditar({ usuario_id: admin.id, acao: "CADASTRO_REQUERENTE", entidade: "usuario", entidade_id: u.id, depois: { email: r.email, pessoa_id: p.id, papel: "REQUERENTE", origem: "seed:cds-poc" } });
    }
    REQ_EMAIL[r.chave] = r.email;
  }

  // ── Pessoas (requerentes sem login e RTs) ──
  for (const p of PESSOAS) {
    const reg = await criarPessoa(admin, {
      tipo: p.tipo, cpf_cnpj: p.doc, nome: p.nome, nome_fantasia: p.fantasia ?? null, email: null, telefone: null,
      endereco: endereco(p.mun, p.logradouro, p.bairro), municipio_id: mun[p.mun].id,
    });
    pessoa[p.chave] = reg.id;
  }
  const rt: Record<string, string> = {};
  for (const r of RTS) rt[r.chave] = (await criarResponsavel(admin, { pessoa_id: pessoa[r.pessoa], formacao: r.formacao, conselho: r.conselho, registro_conselho: r.registro, uf_conselho: r.uf })).id;
  log(`${REQUERENTES_LOGIN.length} requerentes com login, ${PESSOAS.length} pessoas e ${RTS.length} responsáveis técnicos (fictícios).`);

  // ── Empreendimentos ──
  const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
  const emp: Record<string, { id: string; mun: string; req: string; tip: string; grandeza: number; nome: string }> = {};
  for (const [i, e] of EMPREENDIMENTOS.entries()) {
    const m = mun[e.mun];
    const reg = await criarEmpreendimento(admin, {
      municipio_id: m.id, requerente_id: pessoa[e.req], nome: e.nome,
      endereco: endereco(e.mun, e.logradouro, e.bairro ?? "Centro"),
      latitude: round6(Number(m.latitude) + e.dLat), longitude: round6(Number(m.longitude) + e.dLng),
      tipologia_id: tipologias[e.tip].id, grandeza_porte: e.grandeza, area_m2: e.area,
      numero_car: e.car ? carFicticio(m.codigo_ibge, e.nome) : null, rt_id: e.rt ? rt[e.rt] : null,
    });
    emp[e.chave] = { id: reg.id, mun: e.mun, req: e.req, tip: e.tip, grandeza: e.grandeza, nome: e.nome };
    await prisma.empreendimento.update({ where: { id: reg.id }, data: { created_at: diasAtras(265 - i * 3, 9) } });
  }
  log(`${EMPREENDIMENTOS.length} empreendimentos cadastrados.`);

  // ── Processos ──
  const checklistOk = { c1: "SIM", c2: "SIM", c3: "SIM", c4: 350, c5: "SIM", c6: "Documentação conferida; situação compatível com o porte e o potencial poluidor declarados." };
  const silenciar = async <R,>(fn: () => Promise<R>): Promise<R> => {
    const orig = console.error;
    console.error = () => {};
    try {
      return await fn();
    } finally {
      console.error = orig;
    }
  };
  /** Decisão com o storage indisponível: documento não emitido → DEFERIDO/INDEFERIDO "aguardando emissão" (estado real). */
  const semStorage = async <R,>(fn: () => Promise<R>): Promise<R> => {
    const dir = process.env.STORAGE_LOCAL_DIR;
    const drv = process.env.STORAGE_DRIVER;
    process.env.STORAGE_DRIVER = "local";
    process.env.STORAGE_LOCAL_DIR = "/dev/null/indisponivel";
    try {
      return await silenciar(fn);
    } finally {
      if (dir === undefined) delete process.env.STORAGE_LOCAL_DIR;
      else process.env.STORAGE_LOCAL_DIR = dir;
      if (drv === undefined) delete process.env.STORAGE_DRIVER;
      else process.env.STORAGE_DRIVER = drv;
    }
  };

  const criados: { id: string; spec: ProcDemo; numero: string | null }[] = [];
  for (const spec of [...PROCESSOS].sort((a, b) => b.dias - a.dias)) {
    const e = emp[spec.emp];
    const sig = e.mun;
    const ato = atos[spec.ato];
    const reqEmail = REQ_EMAIL[e.req];
    const req = reqEmail ? await sessao(reqEmail) : await balcaoDe(sig); // sem login → atendimento no balcão
    const tec = spec.tec ? await sessao(spec.tec) : null;
    const gestor = await gestorDe(sig);

    const rasc = await salvarRascunho(
      { ...(reqEmail ? {} : { requerente_id: pessoa[e.req] }), empreendimento_id: e.id, tipologia_id: tipologias[e.tip].id, grandeza: e.grandeza, tipo_ato_id: ato.id, descricao_atividade: DESCRICAO_ATIVIDADE[e.tip] },
      req,
    );
    const id = rasc.id;
    const t = (acao: string, payload: unknown, u: UsuarioSessao) => transicionar(id, acao, payload, u);

    const exigidos = await prisma.documentoExigido.findMany({ where: { tipo_ato_id: ato.id, obrigatorio: true, OR: [{ tipologia_id: null }, { tipologia_id: tipologias[e.tip].id }] }, orderBy: { created_at: "asc" } });
    for (const d of spec.alvo === "RASCUNHO" ? exigidos.slice(0, 2) : exigidos) {
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
      const decidir = () =>
        conclusao === "DESFAVORAVEL"
          ? t("indeferir", { motivo: "Indefiro o requerimento com base no parecer técnico desfavorável: atividade incompatível com a localização proposta (APP)." }, gestor)
          : t("deferir", { despacho: `Defiro o requerimento com base no parecer técnico. Emita-se a ${ato.nome}.` }, gestor);
      if ((spec.alvo === "DEFERIDO" || spec.alvo === "INDEFERIDO") && spec.dur === undefined) await semStorage(decidir);
      else await decidir();
    };
    await final();

    const p = await prisma.processo.findUniqueOrThrow({ where: { id } });
    criados.push({ id, spec, numero: p.numero });
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
    // Licenças "vencendo": validade ajustada só nos dados de ensaio (o PDF emitido mantém a validade original).
    if (spec.validade !== undefined) {
      await prisma.documentoOficial.updateMany({ where: { processo_id: id, tipo: { in: ["LICENCA", "AUTORIZACAO"] }, status: "VALIDO" }, data: { validade_ate: fimDoDia(spec.validade) } });
    }
    log(`${(p.numero ?? "(rascunho)").padEnd(16)} ${spec.ato.padEnd(9)} ${p.status.padEnd(22)} ${e.nome}${spec.rotulo ? `  [${spec.rotulo}]` : ""}`);
  }

  // ── Denúncias ──
  const posicao = (sig: string, dLat: number, dLng: number) => ({ latitude: round6(Number(mun[sig].latitude) + dLat), longitude: round6(Number(mun[sig].longitude) + dLng) });
  const den: Record<string, { id: string; protocolo: string }> = {};
  for (const d of DENUNCIAS) {
    const pos = posicao(d.sig, d.dLat, d.dLng);
    const r =
      d.canal === "PORTAL"
        ? await fisc.criarDenunciaPublica(DenunciaPublicaSchema.parse({ municipio_id: mun[d.sig].id, descricao: d.descricao, endereco: d.endereco, ...pos, anonima: true, website: "" }))
        : await fisc.criarDenunciaInterna(await fiscalDe(d.sig), DenunciaInternaSchema.parse({ municipio_id: mun[d.sig].id, canal: d.canal, descricao: d.descricao, endereco: d.endereco, ...pos, anonima: !d.nome, denunciante_nome: d.nome ?? null, contato: null }));
    den[d.chave] = r;
    await prisma.denuncia.update({ where: { id: r.id }, data: { created_at: diasAtras(d.dias, 8 + (d.dias % 9)) } });
  }
  log(`${DENUNCIAS.length} denúncias registradas.`);

  // ── Vistorias (8) com fotos ──
  const vis: Record<string, string> = {};
  let fotosTotal = 0;
  for (const v of VISTORIAS) {
    const u = await fiscalDe(v.sig);
    const pos = posicao(v.sig, v.dLat, v.dLng);
    const colega = COM_EQUIPE.has(v.sig) ? await sessao(`tecnico.${v.sig.toLowerCase()}@${DOMINIO}`) : null;
    const entrada = FiscalizacaoSchema.parse({
      municipio_id: mun[v.sig].id, denuncia_id: v.den ? den[v.den].id : null, empreendimento_id: v.emp ? emp[v.emp].id : null,
      data_hora: diasAtras(v.dias, 9 + (v.dias % 6), 20), ...pos, precisao_m: 6 + (v.dias % 9),
      equipe: colega ? [{ usuario_id: colega.id, nome: colega.nome }] : [], relato: v.relato, constatacao: v.constatacao,
    });
    const fotos = FOTOS.slice(0, v.fotos).map((dados, i) => ({ nome: `vistoria-${v.chave}-${i + 1}.jpg`, dados, latitude: pos.latitude + i * 0.00008, longitude: pos.longitude - i * 0.00006 }));
    vis[v.chave] = (await fisc.criarFiscalizacao(u, entrada, fotos)).id;
    fotosTotal += fotos.length;
  }
  const statusDen: [string, "CONCLUIDA" | "ARQUIVADA" | "EM_APURACAO", string][] = [
    ["d1", "CONCLUIDA", "Vistoria realizada, auto de infração e notificação lavrados."],
    ["d4", "CONCLUIDA", "Vistoria não constatou irregularidade. Denunciante informado."],
    ["d5", "CONCLUIDA", "Auto de infração lavrado e notificação emitida ao empreendedor."],
    ["d8", "ARQUIVADA", "Poluição sonora urbana: encaminhada à fiscalização de posturas do município."],
    ["d9", "EM_APURACAO", "Vistoria a ser agendada com apoio da vigilância sanitária."],
  ];
  for (const [chave, status, despacho] of statusDen) {
    const d = DENUNCIAS.find((x) => x.chave === chave)!;
    await fisc.alterarStatusDenuncia(await fiscalDe(d.sig), den[chave].id, status, despacho);
  }
  log(`${VISTORIAS.length} vistorias (${fotosTotal} fotos) registradas.`);

  // ── Autos de infração (4) e notificações (5) com PDF ──
  const autos = [
    { v: "v1", sig: "ITB", autuado: { pessoa_id: pessoa.maria }, penalidade: "MULTA", valor_multa: 3500, enquadramento_legal: "Lei Federal nº 9.605/1998, art. 54, §2º, V; Decreto Federal nº 6.514/2008, art. 62, V.", descricao_infracao: "Lançar efluentes líquidos (água de lavagem com óleo e detergente) em via pública e galeria pluvial, em desacordo com as exigências estabelecidas." },
    { v: "v3", sig: "RUY", autuado: { pessoa_id: pessoa.antonio }, penalidade: "EMBARGO", valor_multa: null, enquadramento_legal: "Lei Federal nº 12.651/2012, art. 4º; Decreto Federal nº 6.514/2008, arts. 43 e 51.", descricao_infracao: "Destruir vegetação nativa em área de preservação permanente (1,8 ha) sem autorização do órgão ambiental. Embargo da área suprimida." },
    { v: "v5", sig: "IAC", autuado: { pessoa_id: pessoa.mineracao }, penalidade: "MULTA", valor_multa: 25000, enquadramento_legal: "Lei Federal nº 9.605/1998, art. 55; Decreto Federal nº 6.514/2008, art. 63.", descricao_infracao: "Executar extração de recursos minerais (areia) fora da poligonal autorizada e em desacordo com a licença ambiental vigente." },
    { v: "v6", sig: "ITT", autuado: { pessoa_id: pessoa.ceramica }, penalidade: "ADVERTENCIA", valor_multa: null, enquadramento_legal: "Lei Federal nº 12.305/2010, art. 47, II; Decreto Federal nº 6.514/2008, art. 62, IX.", descricao_infracao: "Dispor resíduos sólidos industriais (cacos cerâmicos) a céu aberto, em área não licenciada." },
  ] as const;
  for (const a of autos) {
    const r = await fisc.criarAutoInfracao(await fiscalDe(a.sig), AutoInfracaoSchema.parse({ fiscalizacao_id: vis[a.v], autuado: a.autuado, enquadramento_legal: a.enquadramento_legal, descricao_infracao: a.descricao_infracao, penalidade: a.penalidade, valor_multa: a.valor_multa, prazo_defesa_dias: 20 }));
    if (r.erro_pdf) throw new Error(`PDF do auto ${r.auto.numero}: ${r.erro_pdf}`);
  }
  const lavajatoEstrela = criados.find((c) => c.spec.emp === "lavajato_estrela")!;
  const notificacoes = [
    { sig: "ITB", fiscalizacao_id: vis.v1, notificado: { pessoa_id: pessoa.maria }, exigencia: "Desobstruir e adequar a caixa separadora de água e óleo e apresentar comprovante de limpeza por empresa licenciada.", prazo_dias: 15 },
    { sig: "RUY", fiscalizacao_id: vis.v3, notificado: { pessoa_id: pessoa.antonio }, exigencia: "Apresentar Projeto de Recuperação de Área Degradada (PRAD) para a APP suprimida, elaborado por profissional habilitado com ART.", prazo_dias: 30 },
    { sig: "IAC", fiscalizacao_id: vis.v5, notificado: { pessoa_id: pessoa.mineracao }, exigencia: "Paralisar a dragagem fora da poligonal e apresentar levantamento planialtimétrico georreferenciado da área explorada.", prazo_dias: 10 },
    { sig: "IAC", fiscalizacao_id: vis.v8, notificado: { pessoa_id: pessoa.irmaos_silva }, exigencia: "Instalar bacia de contenção impermeabilizada para os tambores de óleo usado e comprovar a destinação a coletor autorizado pela ANP.", prazo_dias: 20 },
    { sig: "RUY", processo_id: lavajatoEstrela.id, notificado: { pessoa_id: pessoa.posto }, exigencia: "Apresentar outorga (ou dispensa) de uso de recursos hídricos do poço tubular que abastece a lavagem de veículos.", prazo_dias: 30 },
  ];
  for (const n of notificacoes) {
    const u = n.processo_id ? await sessao(T.ruy) : await fiscalDe(n.sig);
    const r = await fisc.criarNotificacao(u, NotificacaoSchema.parse({ ...n, sig: undefined }));
    if (r.erro_pdf) throw new Error(`PDF da notificação ${r.notificacao.numero}: ${r.erro_pdf}`);
  }
  log(`${autos.length} autos de infração e ${notificacoes.length} notificações emitidos (PDF).`);

  // ── Alertas (T3) – só desta organização ──
  const alertas = await gerarAlertas(new Date(), { organizacao_id: org.id });
  log(`Alertas: ${alertas.alertas_criados} criados, ${alertas.emails_enviados} e-mails.${alertas.erros.length ? " Erros: " + alertas.erros.join("; ") : ""}`);

  // ── Resumo ──
  const doOrg = { municipio_id: { in: municipios.map((m) => m.id) } };
  const porStatus = await prisma.processo.groupBy({ by: ["status"], where: doOrg, _count: true, orderBy: { status: "asc" } });
  const porMun = await prisma.processo.groupBy({ by: ["municipio_id"], where: doOrg, _count: true });
  const docs = await prisma.documentoOficial.groupBy({ by: ["tipo"], where: doOrg, _count: true, orderBy: { tipo: "asc" } });
  const tecItb = await sessao(T.itb);
  const alertasItb = await prisma.alerta.count({ where: { usuario_id: tecItb.id, lido: false } });
  const vencendo = await prisma.documentoOficial.count({ where: { ...doOrg, tipo: "LICENCA", status: "VALIDO", validade_ate: { lte: new Date(Date.now() + 120 * DIA) } } });
  const [nDen, nFis, nAutos, nNot] = await Promise.all([
    prisma.denuncia.count({ where: doOrg }), prisma.fiscalizacao.count({ where: { ...doOrg, status: "REALIZADA" } }), prisma.autoInfracao.count({ where: doOrg }), prisma.notificacao.count({ where: doOrg }),
  ]);
  const t2 = await prisma.processo.findMany({ where: { empreendimento: { nome: MARCADOR } }, include: { tipo_ato: true, documentos: { where: { tipo: "LICENCA" } } }, orderBy: { data_protocolo: "asc" } });

  console.log("\n══════════ Ensaio da PoC (CDS Piemonte do Paraguaçu) carregado ══════════");
  console.log(`Tempo: ${((Date.now() - t0) / 1000).toFixed(0)} s · Empreendimentos: ${EMPREENDIMENTOS.length} · Processos: ${criados.length}`);
  for (const s of porStatus) console.log(`  ${s.status.padEnd(22)} ${s._count}`);
  console.log(`Por município: ${porMun.map((m) => `${municipios.find((x) => x.id === m.municipio_id)!.sigla}=${m._count}`).join(" ")}`);
  console.log(`Documentos oficiais: ${docs.map((d) => `${d.tipo}=${d._count}`).join(" ")} (licenças vencendo em ≤120 dias: ${vencendo})`);
  console.log(`Denúncias: ${nDen} · Vistorias realizadas: ${nFis} · Autos: ${nAutos} · Notificações: ${nNot}`);
  console.log(`T3 – ${T.itb}: ${alertasItb} alerta(s) não lido(s)`);
  console.log(`T2 – ${MARCADOR}: ${t2.map((p) => `${p.tipo_ato.sigla} ${p.numero} ${p.status} [${p.documentos.map((d) => d.numero).join(",")}]`).join(" · ")}`);
  console.log(`\nLogins de ENSAIO (senha: a do onboarding --demo/ONBOARD_SENHA – TROCAR antes da sessão oficial):`);
  console.log(`  ${EMAILS.admin} · sema@${DOMINIO} · tec.consorcio1@… · tec.consorcio2@…`);
  console.log(`  tecnico.itb@ · gestor.itb@ · fiscal.itb@ (também .ruy e .iac) – domínio @${DOMINIO}`);
  console.log(`  Requerentes: ${REQUERENTES_LOGIN.map((r) => r.email.split("@")[0] + "@").join(" · ")} (${DOMINIO})`);
  await prisma.$disconnect();
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("[seed:cds-poc] falhou:", e);
      process.exit(1);
    });
}
