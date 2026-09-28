// Catálogo-base de configuração de uma organização (cliente): tipos de ato, documentos exigidos, tipologias,
// checklist padrão, prazos por etapa e feriados nacionais. Usado pelo seed base (organização de demonstração)
// e pelo onboarding de clientes (prisma/seed/onboarding.ts). Idempotente: só cria o que falta.
import type { PrismaClient, PotencialPoluidor, CategoriaAto } from "@prisma/client";

export const TIPOS_ATO: { sigla: string; nome: string; categoria: CategoriaAto; validade: number | null; vistoria: boolean; prazo: number }[] = [
  { sigla: "LP", nome: "Licença Prévia", categoria: "LICENCA", validade: 36, vistoria: true, prazo: 60 },
  { sigla: "LI", nome: "Licença de Instalação", categoria: "LICENCA", validade: 48, vistoria: true, prazo: 60 },
  { sigla: "LO", nome: "Licença de Operação", categoria: "LICENCA", validade: 48, vistoria: true, prazo: 60 },
  { sigla: "LS", nome: "Licença Simplificada", categoria: "LICENCA", validade: 48, vistoria: false, prazo: 30 },
  { sigla: "LU", nome: "Licença Unificada", categoria: "LICENCA", validade: 48, vistoria: true, prazo: 60 },
  { sigla: "LAC", nome: "Licença por Adesão e Compromisso", categoria: "LICENCA", validade: 36, vistoria: false, prazo: 30 },
  { sigla: "RLO", nome: "Renovação de Licença de Operação", categoria: "LICENCA", validade: 48, vistoria: true, prazo: 60 },
  { sigla: "AA", nome: "Autorização Ambiental", categoria: "AUTORIZACAO", validade: 12, vistoria: false, prazo: 30 },
  { sigla: "ASV", nome: "Autorização de Supressão de Vegetação", categoria: "AUTORIZACAO", validade: 12, vistoria: true, prazo: 60 },
  { sigla: "CERT_DISP", nome: "Certidão de Dispensa / Não Exigibilidade", categoria: "CERTIDAO", validade: 24, vistoria: false, prazo: 30 },
  { sigla: "DECL", nome: "Declaração Ambiental", categoria: "DECLARACAO", validade: null, vistoria: false, prazo: 30 },
];

export type TipologiaCatalogo = {
  codigo: string;
  divisao: string;
  descricao: string;
  unidade: string;
  pp: PotencialPoluidor;
  /** Limites superiores de MICRO, PEQUENO, MÉDIO e GRANDE (acima = EXCEPCIONAL). */
  faixas: number[];
};

// Exemplos baseados na lógica da Resolução CEPRAM nº 4.327/2013 – validar com SEMA/INEMA.
export const TIPOLOGIAS: TipologiaCatalogo[] = [
  { codigo: "A1.1", divisao: "Agropecuária", descricao: "Avicultura (criação de aves)", unidade: "nº de cabeças", pp: "MEDIO", faixas: [50000, 200000, 500000, 1000000] },
  { codigo: "A1.2", divisao: "Agropecuária", descricao: "Bovinocultura de leite/corte confinada", unidade: "nº de cabeças", pp: "MEDIO", faixas: [200, 1000, 3000, 6000] },
  { codigo: "C1.1", divisao: "Indústria de alimentos", descricao: "Laticínio (beneficiamento de leite e derivados)", unidade: "litros/dia", pp: "ALTO", faixas: [5000, 20000, 60000, 150000] },
  { codigo: "C2.1", divisao: "Indústria de minerais não metálicos", descricao: "Olaria / cerâmica vermelha", unidade: "milheiros/mês", pp: "MEDIO", faixas: [100, 500, 1500, 3000] },
  { codigo: "E1.1", divisao: "Comércio e serviços", descricao: "Posto revendedor de combustíveis", unidade: "capacidade de armazenamento (m³)", pp: "ALTO", faixas: [60, 120, 250, 500] },
  { codigo: "E1.2", divisao: "Comércio e serviços", descricao: "Lava-jato / lavagem de veículos", unidade: "área construída (m²)", pp: "BAIXO", faixas: [200, 500, 1000, 2000] },
  { codigo: "E1.3", divisao: "Comércio e serviços", descricao: "Oficina mecânica / funilaria", unidade: "área construída (m²)", pp: "MEDIO", faixas: [200, 500, 1000, 2000] },
  { codigo: "F1.1", divisao: "Mineração", descricao: "Extração de areia / cascalho", unidade: "volume (m³/ano)", pp: "MEDIO", faixas: [5000, 20000, 60000, 120000] },
  { codigo: "G1.1", divisao: "Parcelamento do solo", descricao: "Loteamento urbano", unidade: "área total (ha)", pp: "MEDIO", faixas: [5, 20, 50, 100] },
  { codigo: "H1.1", divisao: "Serviços de saúde", descricao: "Clínicas e consultórios com geração de RSS", unidade: "área construída (m²)", pp: "BAIXO", faixas: [200, 500, 1500, 3000] },
];

export const PORTES = ["MICRO", "PEQUENO", "MEDIO", "GRANDE", "EXCEPCIONAL"] as const;

export const faixasPorte = (faixas: number[]) => [...faixas.map((ate, i) => ({ porte: PORTES[i], ate })), { porte: "EXCEPCIONAL", ate: null }];

export const CHECKLIST_PADRAO = {
  nome: "Checklist padrão de análise",
  itens: [
    { id: "c1", texto: "Documentação obrigatória completa e legível", tipo: "SIM_NAO", obrigatorio: true },
    { id: "c2", texto: "Localização confere com coordenadas informadas", tipo: "SIM_NAO", obrigatorio: true },
    { id: "c3", texto: "Atividade compatível com o zoneamento municipal", tipo: "SIM_NAO", obrigatorio: true },
    { id: "c4", texto: "Distância de corpos hídricos (m)", tipo: "NUMERO", obrigatorio: false },
    { id: "c5", texto: "ART/RRT do responsável técnico apresentada", tipo: "SIM_NAO", obrigatorio: true },
    { id: "c6", texto: "Observações do técnico", tipo: "TEXTO", obrigatorio: false },
  ],
};

/** Documentos exigidos padrão de todo tipo de ato: [nome, obrigatório?]. */
export function documentosPadrao(categoria: CategoriaAto): [string, boolean][] {
  return [
    ["Requerimento assinado", true],
    ["Documento de identificação do requerente (RG/CPF ou contrato social/CNPJ)", true],
    ["Comprovante de posse ou propriedade do imóvel", true],
    ["Certidão de uso e ocupação do solo (Prefeitura)", true],
    ["ART/RRT do responsável técnico", categoria === "LICENCA"],
    ["Memorial descritivo da atividade", categoria === "LICENCA"],
    ["Planta de localização / croqui (PDF, KML ou DWG)", false],
  ];
}

// Prazos iniciais (SPEC 6.1) – editáveis em /admin/prazos
export const PRAZOS_PADRAO = [
  { etapa: "TRIAGEM", dias: 5, dias_alerta: 2, conta_dias_uteis: true },
  { etapa: "ANALISE_CURTA", dias: 30, dias_alerta: 5, conta_dias_uteis: false },
  { etapa: "ANALISE_LONGA", dias: 60, dias_alerta: 5, conta_dias_uteis: false },
  { etapa: "PENDENCIA", dias: 30, dias_alerta: 5, conta_dias_uteis: false },
  { etapa: "VISTORIA", dias: 15, dias_alerta: 3, conta_dias_uteis: true },
  { etapa: "DECISAO", dias: 10, dias_alerta: 3, conta_dias_uteis: true },
];

// Somente feriados nacionais (e pontos facultativos federais) – valem para todos os órgãos (municipio_id NULL);
// feriados estaduais/municipais são cadastrados por órgão em /admin/feriados.
export const FERIADOS_NACIONAIS_2026: [string, string][] = [
  ["2026-01-01", "Confraternização Universal"], ["2026-02-16", "Carnaval"], ["2026-02-17", "Carnaval"], ["2026-04-03", "Sexta-feira Santa"],
  ["2026-04-21", "Tiradentes"], ["2026-05-01", "Dia do Trabalho"], ["2026-06-04", "Corpus Christi"], ["2026-09-07", "Independência do Brasil"],
  ["2026-10-12", "Nossa Senhora Aparecida"], ["2026-11-02", "Finados"], ["2026-11-15", "Proclamação da República"], ["2026-11-20", "Consciência Negra"],
  ["2026-12-25", "Natal"],
];

export type DocumentoExtra = { tipo_ato: string; tipologia?: string | null; nome: string; obrigatorio?: boolean; formatos?: string };

export type ResumoCatalogo = { tipos_ato: number; documentos: number; tipologias: number; checklist: boolean; prazos: number; feriados: number };

/**
 * Aplica o catálogo-base (e tipologias/documentos extras do cliente) à organização. Idempotente:
 * cria apenas o que ainda não existe (por sigla/código/nome) – nunca sobrescreve o que o órgão já editou.
 */
export async function aplicarCatalogo(
  prisma: PrismaClient,
  organizacaoId: string,
  extras: { tipologias?: TipologiaCatalogo[]; documentos?: DocumentoExtra[] } = {},
): Promise<ResumoCatalogo> {
  const r: ResumoCatalogo = { tipos_ato: 0, documentos: 0, tipologias: 0, checklist: false, prazos: 0, feriados: 0 };

  let checklist = await prisma.checklistModelo.findFirst({ where: { nome: CHECKLIST_PADRAO.nome, organizacao_id: organizacaoId } });
  if (!checklist) {
    checklist = await prisma.checklistModelo.create({ data: { organizacao_id: organizacaoId, nome: CHECKLIST_PADRAO.nome, itens: CHECKLIST_PADRAO.itens } });
    r.checklist = true;
  }

  for (const t of TIPOS_ATO) {
    let ato = await prisma.tipoAto.findUnique({ where: { organizacao_id_sigla: { organizacao_id: organizacaoId, sigla: t.sigla } } });
    if (!ato) {
      ato = await prisma.tipoAto.create({
        data: {
          organizacao_id: organizacaoId, sigla: t.sigla, nome: t.nome, categoria: t.categoria, validade_meses_padrao: t.validade,
          exige_vistoria: t.vistoria, exige_parecer: t.sigla !== "DECL", prazo_analise_dias: t.prazo,
          modelo_documento: t.categoria === "CERTIDAO" || t.categoria === "DECLARACAO" ? "CERTIDAO" : t.categoria === "AUTORIZACAO" ? "AUTORIZACAO" : "LICENCA",
          checklist_modelo_id: checklist.id,
        },
      });
      r.tipos_ato++;
    }
    if ((await prisma.documentoExigido.count({ where: { tipo_ato_id: ato.id, tipologia_id: null } })) === 0) {
      const docs = documentosPadrao(t.categoria);
      await prisma.documentoExigido.createMany({ data: docs.map(([nome, obrigatorio]) => ({ tipo_ato_id: ato.id, nome, obrigatorio, formatos: nome.includes("KML") ? "pdf,kml,kmz,dwg" : "pdf,jpg,png" })) });
      r.documentos += docs.length;
    }
  }

  for (const t of [...TIPOLOGIAS, ...(extras.tipologias ?? [])]) {
    const existe = await prisma.tipologia.findUnique({ where: { organizacao_id_codigo: { organizacao_id: organizacaoId, codigo: t.codigo } } });
    if (existe) continue;
    await prisma.tipologia.create({
      data: { organizacao_id: organizacaoId, codigo: t.codigo, divisao: t.divisao, descricao: t.descricao, unidade_porte: t.unidade, potencial_poluidor: t.pp, faixas_porte: faixasPorte(t.faixas) },
    });
    r.tipologias++;
  }

  // Documentos específicos de tipologia (ex.: inventário florestal para supressão de vegetação)
  for (const d of extras.documentos ?? []) {
    const ato = await prisma.tipoAto.findUnique({ where: { organizacao_id_sigla: { organizacao_id: organizacaoId, sigla: d.tipo_ato } } });
    if (!ato) throw new Error(`Documento extra: tipo de ato ${d.tipo_ato} inexistente.`);
    const tip = d.tipologia ? await prisma.tipologia.findUnique({ where: { organizacao_id_codigo: { organizacao_id: organizacaoId, codigo: d.tipologia } } }) : null;
    if (d.tipologia && !tip) throw new Error(`Documento extra: tipologia ${d.tipologia} inexistente.`);
    if (await prisma.documentoExigido.findFirst({ where: { tipo_ato_id: ato.id, tipologia_id: tip?.id ?? null, nome: d.nome } })) continue;
    await prisma.documentoExigido.create({ data: { tipo_ato_id: ato.id, tipologia_id: tip?.id ?? null, nome: d.nome, obrigatorio: d.obrigatorio ?? true, formatos: d.formatos ?? "pdf" } });
    r.documentos++;
  }

  for (const p of PRAZOS_PADRAO) {
    if (await prisma.prazoConfig.findFirst({ where: { organizacao_id: organizacaoId, municipio_id: null, etapa: p.etapa } })) continue;
    await prisma.prazoConfig.create({ data: { organizacao_id: organizacaoId, ...p } });
    r.prazos++;
  }

  for (const [d, descricao] of FERIADOS_NACIONAIS_2026) {
    const data = new Date(`${d}T00:00:00Z`);
    if (await prisma.feriado.findFirst({ where: { municipio_id: null, data } })) continue;
    await prisma.feriado.create({ data: { data, descricao } });
    r.feriados++;
  }
  return r;
}
