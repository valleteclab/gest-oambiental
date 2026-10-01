import { describe, expect, it } from "vitest";
import type { StatusProcesso } from "@prisma/client";
import type { PapelVinculo, UsuarioSessao } from "@/lib/rbac";
import {
  CAMPOS_DEMANDA,
  CHECKLIST_PODA,
  CHECKLIST_SOM,
  PRAZO_DIAS_UTEIS,
  SIGLAS_DEMANDAS,
  TIPOLOGIA_DEMANDA,
  condicionantesPadrao,
  decisaoPeloTecnico,
  documentosCondicionais,
  ehDemandaUrbana,
  erroDecisaoDemanda,
  grandezaDaDemanda,
  lerDadosDemanda,
  paresDemanda,
  serializarDadosDemanda,
  validadeDemanda,
  validarDadosDemanda,
} from "@/lib/demandas/catalogo";
import { TIPOS_ATO, TIPOLOGIAS, faixasPorte } from "@/prisma/seed/catalogo";
import { acoesDisponiveis, itensChecklistPendentes, lerItensChecklist, permitido, type ContextoAcao } from "@/lib/processo/maquina";
import { calcularPorte } from "@/lib/processo/porte";
import { chaveModeloEspecifico, MODELOS_ESPECIFICOS, type ContextoDocumento } from "@/templates";
import { renderizarDocumento } from "@/lib/documentos/modelo";

// Demandas urbanas (APC/ASE/ACS): catálogo-base completo e regras do fluxo simplificado.

describe("catálogo-base – demandas urbanas", () => {
  const ato = (s: string) => TIPOS_ATO.find((t) => t.sigla === s)!;

  it("APC, ASE e ACS existem como AUTORIZACAO, sem parecer e com modelo/checklist próprios", () => {
    for (const s of SIGLAS_DEMANDAS) {
      const t = ato(s);
      expect(t, s).toBeTruthy();
      expect(t.categoria).toBe("AUTORIZACAO");
      expect(t.parecer).toBe(false);
      expect(t.modelo && t.modelo in MODELOS_ESPECIFICOS, `${s}: modelo ${t.modelo}`).toBe(true);
      expect(t.checklist).toBeTruthy();
      expect(t.documentos?.filter(([, obrigatorio]) => obrigatorio).length).toBeGreaterThanOrEqual(3);
    }
  });

  it("parâmetros de cada serviço (validade, vistoria, prazo)", () => {
    expect(ato("APC")).toMatchObject({ validade: 6, vistoria: true, prazo: 15, modelo: "AUTORIZACAO_PODA", checklist: "PODA" });
    expect(ato("ASE")).toMatchObject({ validade: null, vistoria: false, prazo: 5, modelo: "AUTORIZACAO_SOM" });
    expect(ato("ACS")).toMatchObject({ validade: 3, vistoria: false, prazo: 3, modelo: "AUTORIZACAO_SOM" });
    expect(PRAZO_DIAS_UTEIS).toEqual({ APC: false, ASE: true, ACS: true });
  });

  it("documentos exigidos cobrem o pedido de cada serviço", () => {
    const nomes = (s: string) => ato(s).documentos!.map(([n]) => n.toLowerCase()).join(" | ");
    for (const k of ["foto", "localização", "justificativa", "propriedade"]) expect(nomes("APC")).toContain(k);
    for (const k of ["local do evento", "data e horário", "público", "equipamento", "anuência", "laudo acústico"]) expect(nomes("ASE")).toContain(k);
    for (const k of ["crlv", "cnh", "equipamento"]) expect(nomes("ACS")).toContain(k);
    // documentos condicionais apontam para itens OPCIONAIS existentes no catálogo
    const opcionais = ato("ASE").documentos!.filter(([, o]) => !o).map(([n]) => n);
    for (const c of documentosCondicionais("ASE", { area_residencial: "Sim", publico: "5000" })) expect(opcionais.some((n) => n.startsWith(c.prefixo)), c.prefixo).toBe(true);
  });

  it("tipologias genéricas (imóvel urbano etc.): potencial BAIXO e porte MICRO nos casos usuais", () => {
    for (const s of SIGLAS_DEMANDAS) {
      const tip = TIPOLOGIAS.find((t) => t.codigo === TIPOLOGIA_DEMANDA[s])!;
      expect(tip, s).toBeTruthy();
      expect(tip.pp).toBe("BAIXO");
    }
    const porte = (codigo: string, g: number) => calcularPorte(faixasPorte(TIPOLOGIAS.find((t) => t.codigo === codigo)!.faixas), g);
    expect(TIPOLOGIAS.find((t) => t.codigo === "U1.1")!.descricao).toMatch(/Imóvel urbano \(poda\/corte/);
    expect(porte("U1.1", 2)).toBe("MICRO");
    expect(porte("U1.2", 600)).toBe("MICRO");
    expect(porte("U1.3", 1)).toBe("MICRO");
  });

  it("checklist de vistoria de poda: espécie, DAP/altura, fitossanidade, risco, recomendação e compensação", () => {
    const itens = lerItensChecklist(CHECKLIST_PODA.itens);
    expect(itens.map((i) => i.id)).toEqual(["v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8", "v9"]);
    expect(itens.find((i) => i.id === "v7")!.opcoes).toEqual(["Poda", "Corte (supressão)", "Indeferir"]);
    expect(itens.find((i) => i.id === "v8")).toMatchObject({ tipo: "NUMERO", obrigatorio: true });
    expect(lerItensChecklist(CHECKLIST_SOM.itens).length).toBeGreaterThanOrEqual(4);
  });
});

describe("checklist com opções", () => {
  const itens = lerItensChecklist([{ id: "r", texto: "Recomendação", tipo: "TEXTO", obrigatorio: true, opcoes: ["Poda", "Corte"] }, { id: "x", texto: "Livre", tipo: "NUMERO", opcoes: ["ignorado"] }]);
  it("preserva opções só em itens de texto", () => {
    expect(itens[0].opcoes).toEqual(["Poda", "Corte"]);
    expect(itens[1].opcoes).toBeUndefined();
  });
  it("resposta fora das opções fica pendente", () => {
    expect(itensChecklistPendentes(itens, { r: "Talvez" }).map((i) => i.id)).toEqual(["r"]);
    expect(itensChecklistPendentes(itens, { r: "Corte" })).toEqual([]);
  });
});

describe("campos do serviço (texto estruturado em descricao_atividade)", () => {
  it("valida e normaliza (placa, números, datas do evento)", () => {
    const acs = validarDadosDemanda("ACS", { placa: "dem 0a01", veiculo: "Fiat", periodo_dias: "90 dias", equipamento: "Corneta", finalidade: "Anúncios" });
    expect(acs.ok && acs.dados.placa).toBe("DEM0A01");
    const ruim = validarDadosDemanda("ACS", { placa: "12345", veiculo: "", periodo_dias: "7 dias" });
    expect(ruim.ok).toBe(false);
    if (!ruim.ok) expect(Object.keys(ruim.erros)).toEqual(expect.arrayContaining(["placa", "veiculo", "periodo_dias", "equipamento"]));
    const base = { evento: "Festa", horario_inicio: "18:00", horario_fim: "23:00", publico: "300", equipamento: "Som", area_residencial: "Não" };
    expect(validarDadosDemanda("ASE", { ...base, data_inicio: "2026-10-10", data_fim: "2026-10-09" }).ok).toBe(false);
    expect(validarDadosDemanda("ASE", { ...base, data_inicio: "2026-10-01", data_fim: "2026-11-15" }).ok).toBe(false);
    expect(validarDadosDemanda("ASE", { ...base, data_inicio: "2026-10-10", data_fim: "2026-10-11" }).ok).toBe(true);
    expect(validarDadosDemanda("APC", { especie: "Oiti", quantidade: "0", intervencao: "Poda", motivo: "Outro", local_arvore: "Praça ou área pública" }).ok).toBe(false);
  });

  it("serializa e relê o bloco estruturado preservando o texto livre", () => {
    const dados = { especie: "Oiti", quantidade: "2", intervencao: "Poda", motivo: "Risco à rede elétrica", local_arvore: "Calçada / passeio público" };
    const txt = serializarDadosDemanda("APC", dados, "Galhos na rede.");
    expect(txt.startsWith("[Dados do serviço – APC]\nEspécie da árvore (nome popular): Oiti")).toBe(true);
    const lido = lerDadosDemanda(txt)!;
    expect(lido).toEqual({ sigla: "APC", dados, livre: "Galhos na rede." });
    expect(lerDadosDemanda("Descrição comum de licença")).toBeNull();
    expect(paresDemanda("ASE", { data_inicio: "2026-10-10" })).toEqual([["Data de início", "10/10/2026"]]);
    expect(grandezaDaDemanda("APC", dados)).toBe(2);
    expect(grandezaDaDemanda("ACS", {})).toBe(1);
    for (const s of SIGLAS_DEMANDAS) expect(CAMPOS_DEMANDA[s].length).toBeGreaterThan(3);
  });

  it("documentos condicionais e validade específica", () => {
    expect(documentosCondicionais("ASE", { area_residencial: "Não", publico: "200" })).toEqual([]);
    expect(documentosCondicionais("ASE", { area_residencial: "Sim", publico: "1500" }).map((c) => c.prefixo)).toEqual(["Anuência da vizinhança", "ART / laudo acústico"]);
    expect(documentosCondicionais("APC", { area_residencial: "Sim" })).toEqual([]);
    const emissao = new Date("2026-09-28T12:00:00-03:00");
    expect(validadeDemanda("ASE", { data_fim: "2026-10-11" }, emissao)!.toISOString()).toBe("2026-10-12T02:59:59.000Z");
    expect(Math.round((validadeDemanda("ACS", { periodo_dias: "30 dias" }, emissao)!.getTime() - emissao.getTime()) / 86400000)).toBe(30);
    expect(validadeDemanda("APC", {}, emissao)).toBeNull();
  });

  it("condicionantes-padrão: compensação (nº de mudas), limites em dB(A)/horário e placa", () => {
    const apc = condicionantesPadrao("APC", { especie: "Ficus", intervencao: "Corte (supressão)" }, { v7: "Corte (supressão)", v8: 3 });
    expect(apc.some((c) => /plantar 3 muda\(s\)/.test(c.descricao) && c.prazo_dias === 90)).toBe(true);
    expect(condicionantesPadrao("APC", { especie: "Oiti" }, { v7: "Poda", v8: 0 }).some((c) => /muda/.test(c.descricao))).toBe(false);
    const ase = condicionantesPadrao("ASE", { horario_fim: "23:00" });
    expect(ase.map((c) => c.descricao).join(" ")).toMatch(/55 dB\(A\).*50 dB\(A\)[\s\S]*às 23:00/);
    expect(condicionantesPadrao("ACS", { placa: "DEM0A01" }).map((c) => c.descricao).join(" ")).toMatch(/hospitais[\s\S]*70 dB\(A\)[\s\S]*DEM0A01/);
  });
});

describe("caminho simplificado (máquina de estados)", () => {
  const LOR = "11111111-1111-1111-1111-111111111111";
  const CSE = "22222222-2222-2222-2222-222222222222";
  const usuario = (papeis: PapelVinculo[]): UsuarioSessao => ({ id: "u", nome: "U", email: "u@x", cargo: null, pessoa_id: null, trocar_senha: false, papeis, organizacao_id: "org", municipios_org: [LOR, CSE] });
  const tecLor = usuario([{ papel: "TEC_MUNICIPAL", municipio_id: LOR }]);
  const tecCse = usuario([{ papel: "TEC_MUNICIPAL", municipio_id: CSE }]);
  const tecConsorcio = usuario([{ papel: "TEC_CONSORCIO", municipio_id: null }]);
  const fiscal = usuario([{ papel: "FISCAL", municipio_id: LOR }]);
  const sema = usuario([{ papel: "SEMA_INEMA", municipio_id: null }]);
  const ctx = (status: StatusProcesso, sigla: string, exige_parecer: boolean): ContextoAcao => ({
    status, municipio_id: LOR, requerente_id: "p", exige_parecer, delega_decisao: false, decisao_tecnico: decisaoPeloTecnico({ sigla, exige_parecer }),
  });

  it("decisão pelo técnico só nas demandas urbanas sem parecer", () => {
    expect(decisaoPeloTecnico({ sigla: "APC", exige_parecer: false })).toBe(true);
    expect(decisaoPeloTecnico({ sigla: "APC", exige_parecer: true })).toBe(false); // órgão voltou a exigir parecer
    expect(decisaoPeloTecnico({ sigla: "AA", exige_parecer: false })).toBe(false);
    expect(ehDemandaUrbana("LO")).toBe(false);
  });

  it("técnico do município defere/indefere direto da análise (APC/ASE/ACS)", () => {
    for (const s of SIGLAS_DEMANDAS) {
      expect(acoesDisponiveis(ctx("EM_ANALISE", s, false), tecLor)).toEqual(expect.arrayContaining(["deferir", "indeferir"]));
      expect(acoesDisponiveis(ctx("EM_ANALISE", s, false), tecConsorcio)).toContain("deferir");
    }
  });

  it("demais atos não mudam: técnico não decide LO/AA; escopo e somente leitura continuam valendo", () => {
    expect(acoesDisponiveis(ctx("AGUARDANDO_DECISAO", "LO", true), tecLor)).not.toContain("deferir");
    expect(acoesDisponiveis(ctx("EM_ANALISE", "AA", false), tecLor)).not.toContain("deferir");
    expect(acoesDisponiveis(ctx("EM_ANALISE", "APC", true), tecLor)).not.toContain("deferir");
    expect(acoesDisponiveis(ctx("EM_ANALISE", "APC", false), tecCse)).toEqual([]);
    expect(permitido(fiscal, "deferir", ctx("EM_ANALISE", "APC", false))).toBe(false);
    expect(acoesDisponiveis(ctx("EM_ANALISE", "APC", false), sema)).toEqual([]);
  });

  const base = { sigla: "APC", acao: "deferir" as const, exige_vistoria: true, exige_parecer: false, temChecklist: true, checklistPendente: [] as string[], vistoriasRealizadas: 1, respostas: { v7: "Poda", v8: 2 } };
  it("pré-requisitos do deferimento simplificado", () => {
    expect(erroDecisaoDemanda(base)).toBeNull();
    expect(erroDecisaoDemanda({ ...base, vistoriasRealizadas: 0 })).toMatch(/vistoria/);
    expect(erroDecisaoDemanda({ ...base, checklistPendente: ["DAP"] })).toMatch(/checklist/);
    expect(erroDecisaoDemanda({ ...base, respostas: { v7: "Indeferir", v8: 0 } })).toMatch(/indeferimento/);
    expect(erroDecisaoDemanda({ ...base, respostas: { v7: "Poda", v8: 1.5 } })).toMatch(/inteiro/);
    // indeferir, tipo com parecer ou outro ato: sem exigências extras
    expect(erroDecisaoDemanda({ ...base, acao: "indeferir", vistoriasRealizadas: 0 })).toBeNull();
    expect(erroDecisaoDemanda({ ...base, exige_parecer: true, vistoriasRealizadas: 0 })).toBeNull();
    expect(erroDecisaoDemanda({ ...base, sigla: "LO", vistoriasRealizadas: 0 })).toBeNull();
    // ASE/ACS: sem vistoria, mas com checklist completo
    expect(erroDecisaoDemanda({ ...base, sigla: "ASE", exige_vistoria: false, vistoriasRealizadas: 0, respostas: {} })).toBeNull();
    expect(erroDecisaoDemanda({ ...base, sigla: "ASE", exige_vistoria: false, vistoriasRealizadas: 0, checklistPendente: ["Horário"] })).toMatch(/checklist/);
  });
});

describe("modelos de documento específicos (poda / som)", () => {
  const ctx = (sigla: string, over: Partial<ContextoDocumento> = {}): ContextoDocumento => ({
    tipo: "AUTORIZACAO", titulo: "Autorização", numero: `${sigla}-LOR-001/2026`, codigo: "7KQ2-M9XA-D3PL", url_validacao: "https://x/validar/7KQ2-M9XA-D3PL", dominio: "x",
    emitido_em: new Date("2026-09-28T15:00:00Z"), signatario: { nome: "Técnica", cargo: "Analista" },
    municipio: { nome: "Lagoa do Orvalho", sigla: "LOR", orgao: "Secretaria de Meio Ambiente", endereco: null, email: null, telefone: null, brasao: "data:image/svg+xml;base64,AA==", organizacao: null },
    titular: { nome: "Helena", tipo: "PF", documento: "***.203.847-**", endereco: "Rua A" },
    processo: { numero: "LOR-2026-000001", data_protocolo: new Date("2026-09-20T12:00:00Z"), tipo_ato_nome: "Autorização", tipo_ato_sigla: sigla, descricao_atividade: null },
    empreendimento: { nome: "Residência – Rua A, 1", endereco: "Rua A, 1", latitude: "-12.4", longitude: "-40.1", tipologia: null, porte: null, potencial_poluidor: null, area_m2: null, numero_car: null },
    rt: null, validade_ate: new Date("2027-03-28T12:00:00Z"), condicionantes: [{ descricao: "Plantar 3 muda(s)" }], parecer: null, auto: null, notificacao: null, fiscalizacao: null, anexos: [], dados: {},
    ...over,
  });

  it("resolução: modelo do tipo de ato ou sigla APC/ASE/ACS; demais autorizações usam o modelo geral", () => {
    expect(chaveModeloEspecifico(ctx("APC"))).toBe("AUTORIZACAO_PODA");
    expect(chaveModeloEspecifico(ctx("ASE"))).toBe("AUTORIZACAO_SOM");
    expect(chaveModeloEspecifico(ctx("ACS"))).toBe("AUTORIZACAO_SOM");
    expect(chaveModeloEspecifico(ctx("AA"))).toBeNull();
    expect(chaveModeloEspecifico(ctx("XYZ", { modelo_ato: "AUTORIZACAO_PODA" }))).toBe("AUTORIZACAO_PODA");
    expect(chaveModeloEspecifico(ctx("APC", { tipo: "OFICIO" }))).toBeNull();
  });

  it("APC traz compensação e dados da vistoria; ignora o modelo genérico de AUTORIZACAO", () => {
    const html = renderizarDocumento(
      ctx("APC", { dados: { demanda: { sigla: "APC", campos: { especie: "Ficus", quantidade: "1", motivo: "Risco à edificação" }, vistoria: { especie: "Ficus benjamina", dap_cm: 48, altura_m: 9, fitossanidade: "Regular", risco: "Alto", recomendacao: "Corte (supressão)", mudas: 3, observacoes: null } } } }),
      "<p>MODELO GENERICO {{numero}}</p>",
    );
    expect(html).not.toContain("MODELO GENERICO");
    expect(html).toContain('data-compensacao="3"');
    expect(html).toMatch(/plantio de <b>3 muda\(s\)<\/b>/);
    expect(html).toContain("Ficus benjamina");
    expect(html).toContain("supressão (corte)");
  });

  it("ASE/ACS trazem limite em dB(A), horário e placa (com escape)", () => {
    const ase = renderizarDocumento(ctx("ASE", { dados: { demanda: { sigla: "ASE", campos: { evento: "Arraiá <b>", data_inicio: "2026-10-13", data_fim: "2026-10-14", horario_inicio: "18:00", horario_fim: "23:00", publico: "600" }, limite_db: 55 } } }));
    expect(ase).toContain("55 dB(A)");
    expect(ase).toContain("Horário limite:</b> 23:00");
    expect(ase).toContain("de 13/10/2026 a 14/10/2026");
    expect(ase).toContain("Arraiá &lt;b&gt;");
    const acs = renderizarDocumento(ctx("ACS", { dados: { demanda: { sigla: "ACS", campos: { placa: "DEM0A01", periodo_dias: "90 dias" } } } }));
    expect(acs).toContain("<b>Placa:</b> DEM0A01");
    expect(acs).toContain("propaganda sonora em veículo");
  });
});
