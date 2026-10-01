// Seed OPCIONAL de demonstração das DEMANDAS URBANAS (APC poda/corte, ASE som em evento, ACS carro de som).
//
//   npm run seed:demandas-demo      (depois de `npm run seed:demo`; no deploy: SEED_DEMANDAS_DEMO=true – scripts/predeploy.sh)
//
// Separado de prisma/seed/demo.ts para NÃO alterar as contagens esperadas pelos E2E (tests/e2e/dados.ts – 44 processos,
// T3: técnico do município principal com exatamente 2 prazos correndo). Por isso os processos daqui ficam com o técnico
// do consórcio (tec.consorcio1), nunca com tecnico.lor. Idempotente POR DEMANDA: o marcador é o nome do local
// (empreendimento) no município – o que já existe é pulado. Também usado por clientes/riachao-demo.ts (semearDemandas).
//
// Tudo FICTÍCIO (pessoas, CPFs com dígitos válidos gerados, placas com prefixo "DEM", endereços). Criado pelos SERVIÇOS
// reais (cadastro, rascunho, anexos, transicionar, checklist, emissão do documento com PDF/QR).
// Os módulos de lib/ importam "server-only": rodar com `tsx --conditions=react-server` (ver package.json).
import path from "node:path";
import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { condicionantesPadrao, grandezaDaDemanda, TIPOLOGIA_DEMANDA, type DadosDemanda, type SiglaDemanda } from "../../lib/demandas/catalogo";

try {
  process.loadEnvFile(path.resolve(__dirname, "../../.env"));
} catch {
  /* variáveis já no ambiente */
}

const FIXTURES = path.resolve(__dirname, "../../tests/fixtures");
const PDF = () => readFileSync(path.join(FIXTURES, "documento-exemplo.pdf"));
const FOTO = () => readFileSync(path.join(FIXTURES, "vistoria-1.jpg"));
const DIA = 86400000;

/** CPF válido (fictício) a partir de 9 dígitos-base. */
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

/** Data ISO (aaaa-mm-dd) daqui a `n` dias. */
export function dataIso(n: number): string {
  return new Date(Date.now() + n * DIA).toISOString().slice(0, 10);
}

export type RequerenteSeed = { chave: string; cpf: string; nome: string; email: string; telefone: string; logradouro: string; bairro: string };

export type DemandaSeed = {
  /** Nome do local (empreendimento) – marcador de idempotência no município. */
  local: string;
  sigla: SiglaDemanda;
  alvo: "PROTOCOLADO" | "EM_TRIAGEM" | "EM_ANALISE" | "CONCLUIDO" | "INDEFERIDO";
  req: string;
  logradouro: string;
  bairro: string;
  lat: number;
  lng: number;
  dados: DadosDemanda;
  observacoes?: string;
  /** Respostas do checklist (vistoria APC / análise de som) antes da decisão. */
  checklist?: Record<string, string | number>;
  /** Motivo, quando alvo = INDEFERIDO. */
  motivo?: string;
  /** Protocolo há `dias` dias (ajuste de datas depois das transições). */
  dias: number;
};

export type OpcoesSeed = {
  organizacaoSigla: string;
  municipioSigla: string;
  /** Técnico que protocola no balcão, analisa e decide (decisão simplificada). */
  tecnicoEmail: string;
  requerentes: RequerenteSeed[];
  demandas: DemandaSeed[];
  log?: (...a: unknown[]) => void;
};

/** Cria as demandas que ainda não existem (por local). Retorna quantas foram criadas. */
export async function semearDemandas(prisma: PrismaClient, o: OpcoesSeed): Promise<number> {
  const log = o.log ?? ((...a: unknown[]) => console.log("[demandas]", ...a));
  const { sessaoPorEmail } = await import("../../lib/sessao");
  const { criarPessoa } = await import("../../lib/cadastros/pessoas");
  const { criarEmpreendimento } = await import("../../lib/cadastros/empreendimentos");
  const { salvarRascunho } = await import("../../lib/processo/rascunho");
  const { anexarArquivo } = await import("../../lib/processo/anexos");
  const { salvarChecklist } = await import("../../lib/processo/checklist");
  const { transicionar } = await import("../../lib/processo/transicionar");

  const org = await prisma.organizacao.findFirst({ where: { sigla: o.organizacaoSigla } });
  const mun = await prisma.municipio.findUnique({ where: { sigla: o.municipioSigla } });
  if (!org || !mun || mun.organizacao_id !== org.id) throw new Error(`Organização ${o.organizacaoSigla}/município ${o.municipioSigla} não encontrados.`);
  const atos = Object.fromEntries((await prisma.tipoAto.findMany({ where: { organizacao_id: org.id, sigla: { in: ["APC", "ASE", "ACS"] } } })).map((t) => [t.sigla, t]));
  const tipologias = Object.fromEntries((await prisma.tipologia.findMany({ where: { organizacao_id: org.id, codigo: { in: Object.values(TIPOLOGIA_DEMANDA) } } })).map((t) => [t.codigo, t]));
  if (Object.keys(atos).length < 3 || Object.keys(tipologias).length < 3) {
    throw new Error(`Catálogo sem os serviços urbanos (APC/ASE/ACS e tipologias U1.x) em ${o.organizacaoSigla} – rode o seed base/onboarding (--atualizar) antes.`);
  }
  const tec = await sessaoPorEmail(o.tecnicoEmail);
  const pessoa: Record<string, string> = {};
  let criadas = 0;

  for (const d of o.demandas) {
    if (await prisma.empreendimento.findFirst({ where: { nome: d.local, municipio_id: mun.id } })) continue;
    // Requerente (PF fictícia) – reaproveita se já cadastrada
    if (!pessoa[d.req]) {
      const r = o.requerentes.find((x) => x.chave === d.req)!;
      try {
        pessoa[d.req] = (await criarPessoa(tec, { tipo: "PF", cpf_cnpj: r.cpf, nome: r.nome, email: r.email, telefone: r.telefone, endereco: { logradouro: r.logradouro, bairro: r.bairro, cidade: mun.nome, uf: "BA" }, municipio_id: mun.id })).id;
      } catch (e) {
        const id = (e as { details?: { pessoa_id?: string | null } }).details?.pessoa_id;
        if (!id) throw e;
        pessoa[d.req] = id;
      }
    }
    const ato = atos[d.sigla];
    const tip = tipologias[TIPOLOGIA_DEMANDA[d.sigla]];
    const grandeza = grandezaDaDemanda(d.sigla, d.dados) ?? 1;
    const emp = await criarEmpreendimento(tec, {
      municipio_id: mun.id, requerente_id: pessoa[d.req], nome: d.local,
      endereco: { logradouro: d.logradouro, bairro: d.bairro, cidade: mun.nome, uf: "BA" },
      latitude: d.lat, longitude: d.lng, tipologia_id: tip.id, grandeza_porte: grandeza,
    });
    const rasc = await salvarRascunho({ requerente_id: pessoa[d.req], empreendimento_id: emp.id, tipologia_id: tip.id, grandeza, tipo_ato_id: ato.id, dados_demanda: d.dados, descricao_atividade: d.observacoes ?? null }, tec);
    const id = rasc.id;
    const t = (acao: string, payload: unknown) => transicionar(id, acao, payload, tec);

    // Documentos: obrigatórios + os que se tornam obrigatórios pelos dados (anuência, laudo acústico)
    const exigidos = await prisma.documentoExigido.findMany({ where: { tipo_ato_id: ato.id, tipologia_id: null }, orderBy: { created_at: "asc" } });
    const condicionais = d.sigla === "ASE" ? [d.dados.area_residencial === "Sim" ? "Anuência" : null, Number(d.dados.publico) >= 1000 ? "ART" : null].filter(Boolean) as string[] : [];
    for (const doc of exigidos.filter((x) => x.obrigatorio || condicionais.some((c) => x.nome.startsWith(c)))) {
      const foto = /^Foto/.test(doc.nome);
      const nome = `${doc.nome.split(" (")[0].normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase().slice(0, 50)}.${foto ? "jpg" : "pdf"}`;
      await anexarArquivo(id, { nome, mime: foto ? "image/jpeg" : "application/pdf", dados: foto ? FOTO() : PDF() }, { tipo: "DOCUMENTO_EXIGIDO", documento_exigido_id: doc.id }, tec);
    }

    await t("protocolar", {}); // distribuição automática (rodízio) – fluxo simplificado
    if (d.alvo !== "PROTOCOLADO") {
      const p0 = await prisma.processo.findUniqueOrThrow({ where: { id } });
      if (p0.tecnico_id !== tec.id) await t("distribuir", { tecnico_id: tec.id, despacho: "Redistribuído ao técnico responsável pelas demandas urbanas." });
      if (d.alvo !== "EM_TRIAGEM") {
        await t("aceitar", { despacho: "Documentação conferida (triagem simplificada)." });
        if (d.alvo !== "EM_ANALISE") {
          if (d.checklist) await salvarChecklist(id, d.checklist, tec);
          if (ato.exige_vistoria) {
            await t("agendar_vistoria", { data_prevista: new Date(), despacho: "Vistoria de campo da demanda urbana." });
            await t("concluir_vistoria", { despacho: `Vistoria realizada: ${Object.values(d.checklist ?? {}).join("; ")}`.slice(0, 2000) });
          }
          if (d.alvo === "INDEFERIDO") await t("indeferir", { motivo: d.motivo ?? "Pedido em desacordo com a legislação municipal." });
          else await t("deferir", { despacho: "Deferido (decisão simplificada – demanda urbana).", condicionantes: condicionantesPadrao(d.sigla, d.dados, d.checklist) });
        }
      }
    }
    // Datas: espalha o histórico (somente campos de data do processo – tramitação/auditoria são imutáveis)
    const p = await prisma.processo.findUniqueOrThrow({ where: { id } });
    const protocolo = new Date(Date.now() - d.dias * DIA);
    await prisma.processo.update({
      where: { id },
      data: {
        created_at: new Date(protocolo.getTime() - DIA / 4),
        ...(p.data_protocolo ? { data_protocolo: protocolo } : {}),
        ...(p.status === "CONCLUIDO" ? { data_conclusao: new Date(Math.min(protocolo.getTime() + 4 * DIA, Date.now())) } : {}),
      },
    });
    criadas++;
    log(`${(p.numero ?? "(rascunho)").padEnd(16)} ${d.sigla}  ${p.status.padEnd(12)} ${d.local}`);
  }
  return criadas;
}

// ───────────────────────── Demonstração CID-DEMO (Lagoa do Orvalho) ─────────────────────────

const REQUERENTES_LOR: RequerenteSeed[] = [
  { chave: "helena", cpf: gerarCpf("615203847"), nome: "Helena Martins Barreto", email: "helena.barreto@exemplo.com.br", telefone: "(75) 99000-5510", logradouro: "Rua das Acácias, 45", bairro: "Jardim Primavera" },
  { chave: "associacao", cpf: gerarCpf("730418562"), nome: "Carlos Eduardo Pinheiro", email: "associacao.bairroalto@exemplo.com.br", telefone: "(75) 99000-6620", logradouro: "Rua São Pedro, 12", bairro: "Bairro Alto" },
  { chave: "som", cpf: gerarCpf("842305916"), nome: "Rogério Alves Nunes", email: "rogerio.somvolante@exemplo.com.br", telefone: "(75) 99000-7730", logradouro: "Travessa do Mercado, 8", bairro: "Centro" },
  { chave: "sindico", cpf: gerarCpf("953107284"), nome: "Marlene Souza Teixeira", email: "sindica.jardimflores@exemplo.com.br", telefone: "(75) 99000-8840", logradouro: "Rua das Flores, 300", bairro: "São João" },
];

/** Coordenadas: sede do município de demonstração (Lagoa do Orvalho) + poucos metros. */
function demandasLor(lat0: number, lng0: number): DemandaSeed[] {
  const p = (dl: number, dg: number) => ({ lat: Math.round((lat0 + dl) * 1e6) / 1e6, lng: Math.round((lng0 + dg) * 1e6) / 1e6 });
  return [
    {
      local: "Residência – Rua das Acácias, 45", sigla: "APC", alvo: "CONCLUIDO", req: "helena", logradouro: "Rua das Acácias, 45", bairro: "Jardim Primavera", ...p(0.0031, -0.0022), dias: 18,
      dados: { especie: "Ficus (Ficus benjamina)", quantidade: "1", intervencao: "Corte (supressão)", motivo: "Risco à edificação", local_arvore: "Quintal ou terreno particular" },
      observacoes: "Raízes rachando o muro e a calçada; galhos sobre o telhado.",
      checklist: { v1: "Ficus benjamina", v2: 48, v3: 9, v4: "Regular", v5: "Alto", v6: "SIM", v7: "Corte (supressão)", v8: 3, v9: "Raízes comprometendo a fundação do muro; sem alternativa de manejo." },
    },
    {
      local: "Condomínio Jardim das Flores – Rua das Flores, 300", sigla: "APC", alvo: "EM_ANALISE", req: "sindico", logradouro: "Rua das Flores, 300", bairro: "São João", ...p(-0.0027, 0.0035), dias: 5,
      dados: { especie: "Mangueira", quantidade: "2", intervencao: "Poda", motivo: "Risco à rede elétrica", local_arvore: "Calçada / passeio público" },
      observacoes: "Galhos encostando na rede de baixa tensão em frente ao condomínio.",
    },
    {
      local: "Praça Dr. Joaquim Dias – ficus central", sigla: "APC", alvo: "EM_TRIAGEM", req: "associacao", logradouro: "Praça Dr. Joaquim Dias, s/n", bairro: "Centro", ...p(-0.0019, 0.0012), dias: 2,
      dados: { especie: "Ficus", quantidade: "1", intervencao: "Poda", motivo: "Árvore doente ou morta", local_arvore: "Praça ou área pública" },
    },
    {
      local: "Quadra Poliesportiva do Bairro Alto – Festa Junina", sigla: "ASE", alvo: "CONCLUIDO", req: "associacao", logradouro: "Rua São Pedro, s/n", bairro: "Bairro Alto", ...p(0.0045, 0.0041), dias: 12,
      dados: { evento: "Arraiá do Bairro Alto", data_inicio: dataIso(15), data_fim: dataIso(16), horario_inicio: "18:00", horario_fim: "23:00", publico: "600", equipamento: "Paredão com 4 caixas de 800 W RMS e mesa de som", area_residencial: "Não" },
      checklist: { s1: "SIM", s2: "SIM", s3: "SIM", s4: "SIM", s5: 55, s6: "Quadra afastada das residências; horário limite 23h conforme lei municipal." },
    },
    {
      local: "Largo da Matriz – Aniversário da Cidade", sigla: "ASE", alvo: "EM_ANALISE", req: "associacao", logradouro: "Largo da Matriz, s/n", bairro: "Centro", ...p(-0.0008, -0.0014), dias: 2,
      dados: { evento: "Show de aniversário da cidade", data_inicio: dataIso(25), data_fim: dataIso(25), horario_inicio: "20:00", horario_fim: "23:59", publico: "3000", equipamento: "Palco com sistema line array 20 kW", area_residencial: "Sim" },
    },
    {
      local: "Carro de som – placa DEM0A01", sigla: "ACS", alvo: "CONCLUIDO", req: "som", logradouro: "Travessa do Mercado, 8", bairro: "Centro", ...p(0.0011, 0.0009), dias: 9,
      dados: { placa: "DEM0A01", veiculo: "Fiat Strada branca", periodo_dias: "90 dias", equipamento: "2 cornetas de 100 W e amplificador 12 V", finalidade: "Anúncios do comércio local" },
      checklist: { s1: "SIM", s2: "SIM", s3: "SIM", s4: "SIM", s5: 70, s6: "CRLV e CNH conferidos." },
    },
    {
      local: "Moto de som – placa DEM1B22", sigla: "ACS", alvo: "INDEFERIDO", req: "som", logradouro: "Travessa do Mercado, 8", bairro: "Centro", ...p(0.0013, 0.0007), dias: 14,
      dados: { placa: "DEM1B22", veiculo: "Moto Honda CG vermelha", periodo_dias: "30 dias", equipamento: "Caixa de som 400 W", finalidade: "Propaganda de loja de calçados" },
      checklist: { s1: "SIM", s2: "NAO", s3: "SIM", s4: "NAO", s6: "CRLV vencido; roteiro passa em frente ao hospital municipal." },
      motivo: "CRLV do veículo vencido e roteiro proposto em frente ao hospital municipal (zona de silêncio). O requerente pode apresentar novo pedido com documentação regular e roteiro alternativo.",
    },
  ];
}

async function main() {
  const t0 = Date.now();
  const { prisma } = await import("../../lib/db");
  const mun = await prisma.municipio.findUnique({ where: { sigla: "LOR" } });
  if (!mun?.latitude || !mun.longitude) throw new Error("Município LOR não encontrado – rode `npm run seed:demo` antes.");
  const n = await semearDemandas(prisma, {
    organizacaoSigla: "CID-DEMO",
    municipioSigla: "LOR",
    tecnicoEmail: "tec.consorcio1@licenciagov.demo", // nunca tecnico.lor (T3 conta os prazos dele)
    requerentes: REQUERENTES_LOR,
    demandas: demandasLor(Number(mun.latitude), Number(mun.longitude)),
    log: (...a) => console.log(`[demandas ${((Date.now() - t0) / 1000).toFixed(0).padStart(3)}s]`, ...a),
  });
  console.log(n ? `Demandas urbanas de demonstração: ${n} processo(s) criado(s) em Lagoa do Orvalho.` : "Demandas urbanas de demonstração já existem. Nada a fazer.");
  await prisma.$disconnect();
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("[seed:demandas-demo] falhou:", e);
      process.exit(1);
    });
}
