// DEMANDAS URBANAS – serviços de alto volume da secretaria municipal de meio ambiente, com fluxo simplificado:
//   APC – Autorização de Poda/Corte de Árvore (urbana)          → vistoria + checklist; decisão pelo técnico
//   ASE – Autorização para Emissão Sonora / Evento               → sem vistoria; decisão pelo técnico
//   ACS – Autorização para Carro/Propaganda de Som               → sem vistoria; decisão pelo técnico
//
// Módulo PURO (sem banco/React): usado pelo catálogo (prisma/seed/catalogo.ts), pelo wizard (cliente), pela máquina de
// estados e pela emissão de documentos. Os parâmetros do tipo de ato (nome, validade, prazo, vistoria, parecer, documentos,
// checklist) ficam no banco e são editáveis por organização em /admin; aqui ficam só as regras e os textos-padrão.
//
// LIMITAÇÃO (sem mudança de schema): `processo` não tem coluna JSON para dados específicos do serviço. Os campos abaixo
// (espécie/quantidade de árvores, data/horário do evento, placa do veículo…) são gravados como TEXTO ESTRUTURADO no
// início de `processo.descricao_atividade` (bloco "[Dados do serviço – SIGLA] … [/Dados do serviço]") e relidos por
// lerDadosDemanda(). Recomenda-se, numa futura migração, `processo.dados_servico Json?`.
import { z } from "zod";

export const SIGLAS_DEMANDAS = ["APC", "ASE", "ACS"] as const;
export type SiglaDemanda = (typeof SIGLAS_DEMANDAS)[number];

export function ehDemandaUrbana(sigla: string | null | undefined): sigla is SiglaDemanda {
  return !!sigla && (SIGLAS_DEMANDAS as readonly string[]).includes(sigla);
}

/**
 * Decisão simplificada: nas demandas urbanas que dispensam parecer (`exige_parecer = false`), o próprio técnico
 * com escopo no município pode deferir/indeferir (além do gestor). Demais tipos de ato: regra geral (gestor/admin).
 */
export function decisaoPeloTecnico(tipoAto: { sigla: string; exige_parecer: boolean } | null | undefined): boolean {
  return !!tipoAto && ehDemandaUrbana(tipoAto.sigla) && !tipoAto.exige_parecer;
}

// ───────────── Campos específicos de cada serviço (wizard) ─────────────

export type CampoDemanda = {
  id: string;
  rotulo: string;
  tipo: "texto" | "numero" | "data" | "hora" | "opcao";
  obrigatorio: boolean;
  opcoes?: string[];
  dica?: string;
};

export const CAMPOS_DEMANDA: Record<SiglaDemanda, CampoDemanda[]> = {
  APC: [
    { id: "especie", rotulo: "Espécie da árvore (nome popular)", tipo: "texto", obrigatorio: true, dica: "Ex.: oiti, mangueira, ficus. Se não souber, escreva “não identificada”." },
    { id: "quantidade", rotulo: "Quantidade de árvores", tipo: "numero", obrigatorio: true },
    { id: "intervencao", rotulo: "Intervenção pretendida", tipo: "opcao", obrigatorio: true, opcoes: ["Poda", "Corte (supressão)", "Poda e corte"] },
    { id: "motivo", rotulo: "Motivo do pedido", tipo: "opcao", obrigatorio: true, opcoes: ["Risco à rede elétrica", "Risco à edificação", "Árvore doente ou morta", "Obra ou construção", "Outro"] },
    { id: "local_arvore", rotulo: "Onde está a árvore", tipo: "opcao", obrigatorio: true, opcoes: ["Calçada / passeio público", "Quintal ou terreno particular", "Praça ou área pública"] },
  ],
  ASE: [
    { id: "evento", rotulo: "Nome do evento", tipo: "texto", obrigatorio: true },
    { id: "data_inicio", rotulo: "Data de início", tipo: "data", obrigatorio: true },
    { id: "data_fim", rotulo: "Data de término", tipo: "data", obrigatorio: true },
    { id: "horario_inicio", rotulo: "Horário de início do som", tipo: "hora", obrigatorio: true },
    { id: "horario_fim", rotulo: "Horário de término do som", tipo: "hora", obrigatorio: true },
    { id: "publico", rotulo: "Estimativa de público (pessoas)", tipo: "numero", obrigatorio: true },
    { id: "equipamento", rotulo: "Equipamento de som (tipo, potência, nº de caixas)", tipo: "texto", obrigatorio: true },
    { id: "area_residencial", rotulo: "O local fica em área predominantemente residencial?", tipo: "opcao", obrigatorio: true, opcoes: ["Sim", "Não"], dica: "Em área residencial é exigida a anuência da vizinhança." },
  ],
  ACS: [
    { id: "placa", rotulo: "Placa do veículo", tipo: "texto", obrigatorio: true, dica: "Formato ABC1D23 ou ABC-1234." },
    { id: "veiculo", rotulo: "Veículo (marca/modelo/cor)", tipo: "texto", obrigatorio: true },
    { id: "periodo_dias", rotulo: "Período da autorização", tipo: "opcao", obrigatorio: true, opcoes: ["30 dias", "90 dias"] },
    { id: "equipamento", rotulo: "Equipamento de som (tipo e potência)", tipo: "texto", obrigatorio: true },
    { id: "finalidade", rotulo: "Finalidade da propaganda (o que será anunciado)", tipo: "texto", obrigatorio: true },
  ],
};

export type DadosDemanda = Record<string, string>;

const PLACA = /^[A-Z]{3}-?\d[A-Z0-9]\d{2}$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Público a partir do qual o evento é "de grande porte" (exige ART/laudo acústico). */
export const PUBLICO_EVENTO_GRANDE = 1000;
/** Duração máxima de uma autorização de evento (dias). */
export const MAX_DIAS_EVENTO = 30;

export type ResultadoValidacao = { ok: true; dados: DadosDemanda } | { ok: false; erros: Record<string, string> };

/** Valida e normaliza os campos do serviço (usado no wizard e no servidor). */
export function validarDadosDemanda(sigla: SiglaDemanda, bruto: Record<string, unknown> | null | undefined): ResultadoValidacao {
  const erros: Record<string, string> = {};
  const dados: DadosDemanda = {};
  for (const c of CAMPOS_DEMANDA[sigla]) {
    let v = String(bruto?.[c.id] ?? "").trim().slice(0, 300);
    if (!v) {
      if (c.obrigatorio) erros[c.id] = `Informe: ${c.rotulo.toLowerCase()}.`;
      continue;
    }
    if (c.tipo === "numero") {
      const n = Number(v.replace(",", "."));
      if (!Number.isFinite(n) || n < 1 || n > 1_000_000 || !Number.isInteger(n)) erros[c.id] = `${c.rotulo}: informe um número inteiro maior que zero.`;
      else v = String(n);
    } else if (c.tipo === "data" && !DATA.test(v)) erros[c.id] = `${c.rotulo}: data inválida.`;
    else if (c.tipo === "hora" && !HORA.test(v)) erros[c.id] = `${c.rotulo}: horário inválido (hh:mm).`;
    else if (c.tipo === "opcao" && !c.opcoes!.includes(v)) erros[c.id] = `${c.rotulo}: escolha uma das opções.`;
    if (c.id === "placa") {
      v = v.toUpperCase().replace(/\s/g, "");
      if (!PLACA.test(v)) erros[c.id] = "Placa inválida (use ABC1D23 ou ABC-1234).";
    }
    dados[c.id] = v.replace(/[\r\n]+/g, " ");
  }
  if (sigla === "ASE" && dados.data_inicio && dados.data_fim && !erros.data_inicio && !erros.data_fim) {
    const ini = Date.parse(`${dados.data_inicio}T00:00:00Z`);
    const fim = Date.parse(`${dados.data_fim}T00:00:00Z`);
    if (fim < ini) erros.data_fim = "A data de término não pode ser anterior à de início.";
    else if ((fim - ini) / 86400000 + 1 > MAX_DIAS_EVENTO) erros.data_fim = `A autorização de evento vale por no máximo ${MAX_DIAS_EVENTO} dias.`;
  }
  return Object.keys(erros).length ? { ok: false, erros } : { ok: true, dados };
}

// ───────────── Texto estruturado em processo.descricao_atividade ─────────────

const INICIO = (s: string) => `[Dados do serviço – ${s}]`;
const FIM = "[/Dados do serviço]";

/** Grava os campos como "Rótulo: valor" num bloco delimitado, seguido da descrição livre. */
export function serializarDadosDemanda(sigla: SiglaDemanda, dados: DadosDemanda, livre?: string | null): string {
  const linhas = CAMPOS_DEMANDA[sigla].filter((c) => dados[c.id]).map((c) => `${c.rotulo}: ${dados[c.id]}`);
  const resto = (livre ?? "").trim();
  return [INICIO(sigla), ...linhas, FIM, ...(resto ? ["", resto] : [])].join("\n");
}

/** Lê o bloco estruturado (null se não houver). `livre` = texto fora do bloco. */
export function lerDadosDemanda(texto: string | null | undefined): { sigla: SiglaDemanda; dados: DadosDemanda; livre: string } | null {
  if (!texto) return null;
  const m = texto.match(/\[Dados do serviço – (APC|ASE|ACS)\]\n([\s\S]*?)\n?\[\/Dados do serviço\]/);
  if (!m) return null;
  const sigla = m[1] as SiglaDemanda;
  const porRotulo = new Map(CAMPOS_DEMANDA[sigla].map((c) => [c.rotulo, c.id]));
  const dados: DadosDemanda = {};
  for (const linha of m[2].split("\n")) {
    const i = linha.indexOf(": ");
    if (i < 0) continue;
    const id = porRotulo.get(linha.slice(0, i).trim());
    if (id) dados[id] = linha.slice(i + 2).trim();
  }
  const livre = (texto.slice(0, m.index) + texto.slice(m.index! + m[0].length)).trim();
  return { sigla, dados, livre };
}

/** Pares [rótulo, valor] para exibição (tela e documento). */
export function paresDemanda(sigla: SiglaDemanda, dados: DadosDemanda): [string, string][] {
  return CAMPOS_DEMANDA[sigla].filter((c) => dados[c.id]).map((c) => [c.rotulo, formatarValor(c, dados[c.id])]);
}

function formatarValor(c: CampoDemanda, v: string): string {
  if (c.tipo === "data" && DATA.test(v)) return v.split("-").reverse().join("/");
  return v;
}

// ───────────── Catálogo (tipologias, documentos, checklists) ─────────────

/** Tipologia genérica de cada serviço (porte MICRO / potencial BAIXO para os casos usuais). */
export const TIPOLOGIA_DEMANDA: Record<SiglaDemanda, string> = { APC: "U1.1", ASE: "U1.2", ACS: "U1.3" };

/** Grandeza (unidade da tipologia) derivada dos campos do serviço. */
export function grandezaDaDemanda(sigla: SiglaDemanda, dados: DadosDemanda): number | null {
  if (sigla === "APC") return Number(dados.quantidade) || null;
  if (sigla === "ASE") return Number(dados.publico) || null;
  return 1; // ACS: um veículo por requerimento
}

/** Prazo de análise em dias úteis? (APC: corridos; ASE/ACS: úteis) */
export const PRAZO_DIAS_UTEIS: Record<SiglaDemanda, boolean> = { APC: false, ASE: true, ACS: true };

export const DOC_ANUENCIA = "Anuência da vizinhança";
export const DOC_LAUDO_ACUSTICO = "ART / laudo acústico";

/**
 * Documentos opcionais no catálogo que passam a ser OBRIGATÓRIOS conforme os dados do pedido
 * (prefixos dos nomes de documento_exigido). Conferido no protocolo.
 */
export function documentosCondicionais(sigla: SiglaDemanda, dados: DadosDemanda): { prefixo: string; motivo: string }[] {
  const r: { prefixo: string; motivo: string }[] = [];
  if (sigla === "ASE") {
    if (dados.area_residencial === "Sim") r.push({ prefixo: DOC_ANUENCIA, motivo: "evento em área residencial" });
    if (Number(dados.publico) >= PUBLICO_EVENTO_GRANDE) r.push({ prefixo: DOC_LAUDO_ACUSTICO, motivo: `público estimado a partir de ${PUBLICO_EVENTO_GRANDE} pessoas` });
  }
  return r;
}

// ───────────── Checklist de vistoria / análise ─────────────

export const RECOMENDACOES_PODA = ["Poda", "Corte (supressão)", "Indeferir"] as const;

export const CHECKLIST_PODA = {
  nome: "Vistoria de poda/corte de árvore",
  itens: [
    { id: "v1", texto: "Espécie identificada (nome popular/científico)", tipo: "TEXTO", obrigatorio: true },
    { id: "v2", texto: "DAP – diâmetro à altura do peito (cm)", tipo: "NUMERO", obrigatorio: true },
    { id: "v3", texto: "Altura estimada (m)", tipo: "NUMERO", obrigatorio: true },
    { id: "v4", texto: "Estado fitossanitário", tipo: "TEXTO", obrigatorio: true, opcoes: ["Bom", "Regular", "Ruim (doente/praga)", "Morta"] },
    { id: "v5", texto: "Risco de queda ou de dano (rede elétrica/edificação)", tipo: "TEXTO", obrigatorio: true, opcoes: ["Baixo", "Médio", "Alto"] },
    { id: "v6", texto: "Há conflito com rede elétrica, calçada ou edificação?", tipo: "SIM_NAO", obrigatorio: true },
    { id: "v7", texto: "Recomendação técnica", tipo: "TEXTO", obrigatorio: true, opcoes: [...RECOMENDACOES_PODA] },
    { id: "v8", texto: "Compensação ambiental – nº de mudas a plantar", tipo: "NUMERO", obrigatorio: true },
    { id: "v9", texto: "Observações da vistoria", tipo: "TEXTO", obrigatorio: false },
  ],
};

export const CHECKLIST_SOM = {
  nome: "Análise de emissão sonora",
  itens: [
    { id: "s1", texto: "Local/percurso compatível com o zoneamento e o uso do solo", tipo: "SIM_NAO", obrigatorio: true },
    { id: "s2", texto: "Respeita distância de hospitais, unidades de saúde e escolas", tipo: "SIM_NAO", obrigatorio: true },
    { id: "s3", texto: "Horário requerido dentro do permitido pela lei municipal", tipo: "SIM_NAO", obrigatorio: true },
    { id: "s4", texto: "Documentação do equipamento/veículo conferida", tipo: "SIM_NAO", obrigatorio: true },
    { id: "s5", texto: "Limite de pressão sonora aplicável – dB(A)", tipo: "NUMERO", obrigatorio: false },
    { id: "s6", texto: "Observações da análise", tipo: "TEXTO", obrigatorio: false },
  ],
};

/** Respostas do checklist de poda relevantes para a decisão/documento. */
export function resumoVistoriaPoda(respostas: Record<string, unknown> | null | undefined) {
  const r = respostas ?? {};
  const txt = (k: string) => (r[k] === null || r[k] === undefined || String(r[k]).trim() === "" ? null : String(r[k]).trim());
  const num = (k: string) => (txt(k) === null ? null : Number(String(r[k]).replace(",", ".")));
  return { especie: txt("v1"), dap_cm: num("v2"), altura_m: num("v3"), fitossanidade: txt("v4"), risco: txt("v5"), recomendacao: txt("v7"), mudas: num("v8"), observacoes: txt("v9") };
}

// ───────────── Regras da decisão simplificada ─────────────

/**
 * Pré-requisitos da decisão SEM parecer nas demandas urbanas (a máquina geral já exige parecer quando `exige_parecer`).
 * Retorna a mensagem de erro ou null. Parâmetros já carregados do banco (função pura, testada em tests/unit/demandas).
 */
export function erroDecisaoDemanda(p: {
  sigla: string;
  acao: "deferir" | "indeferir";
  exige_vistoria: boolean;
  exige_parecer: boolean;
  /** itens obrigatórios pendentes do checklist do tipo de ato (texto) */
  checklistPendente: string[];
  temChecklist: boolean;
  vistoriasRealizadas: number;
  respostas: Record<string, unknown> | null | undefined;
}): string | null {
  if (!ehDemandaUrbana(p.sigla) || p.exige_parecer || p.acao !== "deferir") return null;
  if (p.exige_vistoria && p.vistoriasRealizadas === 0) return "Registre a vistoria (checklist + “Concluir vistoria”) antes de deferir.";
  if (p.temChecklist && p.checklistPendente.length) return `Preencha o checklist antes de deferir. Itens obrigatórios pendentes: ${p.checklistPendente.join("; ")}.`;
  if (p.sigla === "APC") {
    const v = resumoVistoriaPoda(p.respostas);
    if (v.recomendacao === "Indeferir") return "A vistoria recomenda o indeferimento: use “Indeferir” ou revise o checklist.";
    if (v.mudas !== null && (!Number.isInteger(v.mudas) || v.mudas < 0)) return "Compensação: informe um número inteiro de mudas (0 ou mais).";
  }
  return null;
}

// ───────────── Condicionantes-padrão (texto editável na decisão) ─────────────

export type CondicionantePadrao = { descricao: string; periodicidade: string | null; prazo_dias: number | null };

/**
 * Condicionantes sugeridas na decisão (o técnico edita antes de deferir). Limites de ruído conforme ABNT NBR 10151:2019
 * (área mista predominantemente residencial: 55 dB(A) diurno / 50 dB(A) noturno) – AJUSTAR à lei municipal do órgão.
 */
export function condicionantesPadrao(sigla: SiglaDemanda, dados: DadosDemanda, respostas?: Record<string, unknown> | null): CondicionantePadrao[] {
  if (sigla === "APC") {
    const v = resumoVistoriaPoda(respostas);
    const mudas = v.mudas ?? 0;
    const corte = (v.recomendacao ?? dados.intervencao ?? "").startsWith("Corte") || dados.intervencao === "Poda e corte";
    const r: CondicionantePadrao[] = [
      { descricao: `Executar a ${corte ? "supressão" : "poda"} somente na(s) árvore(s) vistoriada(s) (${dados.especie || v.especie || "espécie indicada no pedido"}), por profissional habilitado, com EPI, isolamento e sinalização da área.`, periodicidade: null, prazo_dias: null },
      { descricao: "Havendo rede elétrica próxima, agendar a intervenção com a concessionária de energia; é vedado ao particular intervir na rede.", periodicidade: null, prazo_dias: null },
      { descricao: "Dar destinação adequada aos resíduos vegetais (galhos, folhas e tronco), sendo proibida a queima e o descarte em via pública.", periodicidade: null, prazo_dias: null },
    ];
    if (mudas > 0) r.push({ descricao: `Compensação ambiental: plantar ${mudas} muda(s) de espécie(s) nativa(s), com altura mínima de 1,5 m, no local ou em área indicada pelo órgão ambiental, e comprovar o plantio com relatório fotográfico.`, periodicidade: null, prazo_dias: 90 });
    return r;
  }
  if (sigla === "ASE") {
    const fim = dados.horario_fim || "22:00";
    return [
      { descricao: "Limites de pressão sonora (ABNT NBR 10151:2019 e lei municipal): até 55 dB(A) no período diurno (7h às 22h) e até 50 dB(A) no período noturno (22h às 7h), medidos no limite do imóvel receptor mais próximo.", periodicidade: null, prazo_dias: null },
      { descricao: `Horário limite: encerrar a emissão sonora às ${fim}${dados.data_inicio ? `, nos dias autorizados` : ""}.`, periodicidade: null, prazo_dias: null },
      { descricao: "Direcionar as caixas de som para o interior do evento e manter responsável no local, portando esta autorização, para atender a fiscalização.", periodicidade: null, prazo_dias: null },
      { descricao: "Ao término do evento, recolher os resíduos sólidos gerados e dar destinação adequada.", periodicidade: null, prazo_dias: null },
    ];
  }
  return [
    { descricao: "Horários permitidos: de segunda a sábado, das 8h às 12h e das 14h às 18h; proibida a emissão aos domingos e feriados.", periodicidade: null, prazo_dias: null },
    { descricao: "Zonas proibidas: raio de 200 m de hospitais, unidades de saúde, escolas e creches (em horário de funcionamento), templos durante celebrações e repartições públicas.", periodicidade: null, prazo_dias: null },
    { descricao: "Limite de 70 dB(A) medido a 7 m do veículo, reduzindo o volume em vias estritamente residenciais; proibido o estacionamento com o som ligado.", periodicidade: null, prazo_dias: null },
    { descricao: `Manter no veículo (placa ${dados.placa || "informada no pedido"}) esta autorização, o CRLV e a CNH do condutor, apresentando-os à fiscalização quando solicitado.`, periodicidade: null, prazo_dias: null },
  ];
}

// ───────────── Validade ─────────────

/** Validade específica: ASE = até o fim do último dia do evento; ACS = 30/90 dias. null → validade padrão do tipo de ato. */
export function validadeDemanda(sigla: SiglaDemanda, dados: DadosDemanda, emitidoEm: Date): Date | null {
  if (sigla === "ASE" && DATA.test(dados.data_fim ?? "")) return new Date(`${dados.data_fim}T23:59:59-03:00`);
  if (sigla === "ACS") {
    const dias = Number((dados.periodo_dias ?? "").replace(/\D/g, "")) || 30;
    const d = new Date(emitidoEm);
    d.setDate(d.getDate() + dias);
    return d;
  }
  return null;
}

/** Esquema zod do campo `dados_demanda` do rascunho (objeto simples chave → texto/número). */
export const DadosDemandaSchema = z.record(z.string().max(40), z.union([z.string().max(300), z.number()])).optional().nullable();
