// Seed de configuração (idempotente): organização, 8 municípios, tipos de ato, tipologias,
// checklists, prazos, feriados e usuários de demonstração. Executar: npm run seed:base
import { PrismaClient, type Papel } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { cifrar, hashBusca } from "../../lib/crypto";

const prisma = new PrismaClient();
export const SENHA_DEMO = "Demo@2026licencia";

// Códigos IBGE e coordenadas das sedes – conferir com IBGE na implantação (SPEC 17).
export const MUNICIPIOS = [
  { sigla: "IAC", nome: "Iaçu", codigo_ibge: "2913200", lat: -12.7667, lng: -40.2117 },
  { sigla: "IBQ", nome: "Ibiquera", codigo_ibge: "2913507", lat: -12.6447, lng: -40.9333 },
  { sigla: "ITB", nome: "Itaberaba", codigo_ibge: "2914604", lat: -12.5275, lng: -40.3067 },
  { sigla: "ITT", nome: "Itatim", codigo_ibge: "2916856", lat: -12.7103, lng: -39.6953 },
  { sigla: "MNV", nome: "Mundo Novo", codigo_ibge: "2922003", lat: -11.8589, lng: -40.4719 },
  { sigla: "RJB", nome: "Rafael Jambeiro", codigo_ibge: "2926202", lat: -12.4053, lng: -39.5006 },
  { sigla: "RUY", nome: "Ruy Barbosa", codigo_ibge: "2927200", lat: -12.2842, lng: -40.4936 },
  { sigla: "TPM", nome: "Tapiramutá", codigo_ibge: "2931202", lat: -11.8475, lng: -40.7911 },
];

const TIPOS_ATO = [
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
] as const;

// Exemplos baseados na lógica da Resolução CEPRAM nº 4.327/2013 – validar com SEMA/INEMA.
const TIPOLOGIAS = [
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
] as const;

const PORTES = ["MICRO", "PEQUENO", "MEDIO", "GRANDE", "EXCEPCIONAL"] as const;

async function main() {
  const org =
    (await prisma.organizacao.findFirst({ where: { sigla: "CDS-PIEMONTE" } })) ??
    (await prisma.organizacao.create({ data: { nome: "Consórcio de Desenvolvimento Sustentável do Piemonte do Paraguaçu", sigla: "CDS-PIEMONTE", cnpj: "00.000.000/0001-00", logo_url: "/brasao-generico.svg" } }));

  const mun: Record<string, string> = {};
  for (const m of MUNICIPIOS) {
    const r = await prisma.municipio.upsert({
      where: { sigla: m.sigla },
      update: {},
      create: {
        organizacao_id: org.id, sigla: m.sigla, nome: m.nome, codigo_ibge: m.codigo_ibge,
        orgao_ambiental_nome: `Secretaria Municipal de Meio Ambiente de ${m.nome}`, brasao_url: "/brasao-generico.svg",
        endereco: `Praça Central, s/n – ${m.nome}/BA`, email: `meioambiente@${m.sigla.toLowerCase()}.ba.gov.br`, telefone: "(75) 3000-0000",
        latitude: m.lat, longitude: m.lng,
      },
    });
    mun[m.sigla] = r.id;
  }

  const checklist =
    (await prisma.checklistModelo.findFirst({ where: { nome: "Checklist padrão de análise" } })) ??
    (await prisma.checklistModelo.create({
      data: {
        nome: "Checklist padrão de análise",
        itens: [
          { id: "c1", texto: "Documentação obrigatória completa e legível", tipo: "SIM_NAO", obrigatorio: true },
          { id: "c2", texto: "Localização confere com coordenadas informadas", tipo: "SIM_NAO", obrigatorio: true },
          { id: "c3", texto: "Atividade compatível com o zoneamento municipal", tipo: "SIM_NAO", obrigatorio: true },
          { id: "c4", texto: "Distância de corpos hídricos (m)", tipo: "NUMERO", obrigatorio: false },
          { id: "c5", texto: "ART/RRT do responsável técnico apresentada", tipo: "SIM_NAO", obrigatorio: true },
          { id: "c6", texto: "Observações do técnico", tipo: "TEXTO", obrigatorio: false },
        ],
      },
    }));

  for (const t of TIPOS_ATO) {
    const ato = await prisma.tipoAto.upsert({
      where: { organizacao_id_sigla: { organizacao_id: org.id, sigla: t.sigla } },
      update: {},
      create: {
        organizacao_id: org.id, sigla: t.sigla, nome: t.nome, categoria: t.categoria, validade_meses_padrao: t.validade,
        exige_vistoria: t.vistoria, exige_parecer: t.sigla !== "DECL", prazo_analise_dias: t.prazo,
        modelo_documento: t.categoria === "CERTIDAO" || t.categoria === "DECLARACAO" ? "CERTIDAO" : t.categoria === "AUTORIZACAO" ? "AUTORIZACAO" : "LICENCA",
        checklist_modelo_id: checklist.id,
      },
    });
    if ((await prisma.documentoExigido.count({ where: { tipo_ato_id: ato.id } })) === 0) {
      const docs = [
        ["Requerimento assinado", true],
        ["Documento de identificação do requerente (RG/CPF ou contrato social/CNPJ)", true],
        ["Comprovante de posse ou propriedade do imóvel", true],
        ["Certidão de uso e ocupação do solo (Prefeitura)", true],
        ["ART/RRT do responsável técnico", t.categoria === "LICENCA"],
        ["Memorial descritivo da atividade", t.categoria === "LICENCA"],
        ["Planta de localização / croqui (PDF, KML ou DWG)", false],
      ] as const;
      await prisma.documentoExigido.createMany({ data: docs.map(([nome, obrigatorio]) => ({ tipo_ato_id: ato.id, nome, obrigatorio, formatos: nome.includes("KML") ? "pdf,kml,kmz,dwg" : "pdf,jpg,png" })) });
    }
  }

  for (const t of TIPOLOGIAS) {
    await prisma.tipologia.upsert({
      where: { organizacao_id_codigo: { organizacao_id: org.id, codigo: t.codigo } },
      update: {},
      create: {
        organizacao_id: org.id, codigo: t.codigo, divisao: t.divisao, descricao: t.descricao, unidade_porte: t.unidade, potencial_poluidor: t.pp,
        faixas_porte: [...t.faixas.map((ate, i) => ({ porte: PORTES[i], ate })), { porte: "EXCEPCIONAL", ate: null }],
      },
    });
  }

  // Prazos iniciais (SPEC 6.1) – editáveis em /admin/prazos
  if ((await prisma.prazoConfig.count()) === 0) {
    await prisma.prazoConfig.createMany({
      data: [
        { organizacao_id: org.id, etapa: "TRIAGEM", dias: 5, dias_alerta: 2, conta_dias_uteis: true },
        { organizacao_id: org.id, etapa: "ANALISE_CURTA", dias: 30, dias_alerta: 5, conta_dias_uteis: false },
        { organizacao_id: org.id, etapa: "ANALISE_LONGA", dias: 60, dias_alerta: 5, conta_dias_uteis: false },
        { organizacao_id: org.id, etapa: "PENDENCIA", dias: 30, dias_alerta: 5, conta_dias_uteis: false },
        { organizacao_id: org.id, etapa: "VISTORIA", dias: 15, dias_alerta: 3, conta_dias_uteis: true },
        { organizacao_id: org.id, etapa: "DECISAO", dias: 10, dias_alerta: 3, conta_dias_uteis: true },
      ],
    });
  }

  if ((await prisma.feriado.count()) === 0) {
    const f = [["2026-01-01", "Confraternização Universal"], ["2026-02-16", "Carnaval"], ["2026-02-17", "Carnaval"], ["2026-04-03", "Sexta-feira Santa"], ["2026-04-21", "Tiradentes"], ["2026-05-01", "Dia do Trabalho"], ["2026-06-04", "Corpus Christi"], ["2026-06-24", "São João"], ["2026-07-02", "Independência da Bahia"], ["2026-09-07", "Independência do Brasil"], ["2026-10-12", "Nossa Senhora Aparecida"], ["2026-11-02", "Finados"], ["2026-11-15", "Proclamação da República"], ["2026-11-20", "Consciência Negra"], ["2026-12-25", "Natal"]];
    await prisma.feriado.createMany({ data: f.map(([d, descricao]) => ({ data: new Date(`${d}T00:00:00Z`), descricao })) });
  }

  // Usuários de demonstração (senha: SENHA_DEMO). Nunca rodar em produção de cliente.
  const senha_hash = await hash(SENHA_DEMO, { algorithm: 2 });
  const usuarios: { email: string; nome: string; cargo: string; papeis: [Papel, string | null][] }[] = [
    { email: "admin@licenciagov.demo", nome: "Ana Administradora", cargo: "Coordenadora do Consórcio", papeis: [["ADMIN", null]] },
    { email: "tec.consorcio1@licenciagov.demo", nome: "Bruno Técnico Consórcio", cargo: "Analista Ambiental", papeis: [["TEC_CONSORCIO", null]] },
    { email: "tec.consorcio2@licenciagov.demo", nome: "Carla Técnica Consórcio", cargo: "Analista Ambiental", papeis: [["TEC_CONSORCIO", null]] },
    { email: "sema@licenciagov.demo", nome: "Sérgio SEMA/INEMA", cargo: "Gestor Estadual", papeis: [["SEMA_INEMA", null]] },
  ];
  const nomesMun: Record<string, string> = { ITB: "Itaberaba", RUY: "Ruy Barbosa", IAC: "Iaçu" };
  for (const [sig, nomeMun] of Object.entries(nomesMun)) {
    const s = sig.toLowerCase();
    usuarios.push(
      { email: `tecnico.${s}@licenciagov.demo`, nome: `Técnico(a) de ${nomeMun}`, cargo: "Técnico Ambiental Municipal", papeis: [["TEC_MUNICIPAL", mun[sig]]] },
      { email: `gestor.${s}@licenciagov.demo`, nome: `Gestor(a) de ${nomeMun}`, cargo: "Secretário(a) Municipal de Meio Ambiente", papeis: [["GESTOR_MUNICIPAL", mun[sig]]] },
      { email: `fiscal.${s}@licenciagov.demo`, nome: `Fiscal de ${nomeMun}`, cargo: "Fiscal Ambiental", papeis: [["FISCAL", mun[sig]]] },
    );
  }
  for (const u of usuarios) {
    const reg = await prisma.usuario.upsert({
      where: { email: u.email },
      update: {},
      create: { email: u.email, nome: u.nome, cargo: u.cargo, senha_hash, trocar_senha: false },
    });
    for (const [papel, municipio_id] of u.papeis) {
      const existe = await prisma.usuarioPapel.findFirst({ where: { usuario_id: reg.id, papel, municipio_id } });
      if (!existe) await prisma.usuarioPapel.create({ data: { usuario_id: reg.id, papel, municipio_id } });
    }
  }

  // 5 requerentes (PF/PJ) com login
  const requerentes = [
    { email: "laticinio@licenciagov.demo", nome: "Laticínio Boa Vista Ltda", tipo: "PJ", doc: "11222333000181", mun: "ITB" },
    { email: "posto@licenciagov.demo", nome: "Posto Estrela Comércio de Combustíveis Ltda", tipo: "PJ", doc: "45723174000110", mun: "RUY" },
    { email: "joao@licenciagov.demo", nome: "João Pereira dos Santos", tipo: "PF", doc: "52998224725", mun: "IAC" },
    { email: "maria@licenciagov.demo", nome: "Maria de Lourdes Oliveira", tipo: "PF", doc: "11144477735", mun: "ITB" },
    { email: "ceramica@licenciagov.demo", nome: "Cerâmica Paraguaçu Ltda", tipo: "PJ", doc: "04252011000110", mun: "ITT" },
  ] as const;
  for (const r of requerentes) {
    const h = hashBusca(r.doc);
    const pessoa =
      (await prisma.pessoa.findUnique({ where: { cpf_cnpj_hash: h } })) ??
      (await prisma.pessoa.create({
        data: {
          organizacao_id: org.id, tipo: r.tipo, cpf_cnpj_cifrado: cifrar(r.doc), cpf_cnpj_hash: h,
          cpf_cnpj_mascara: r.tipo === "PF" ? `***.${r.doc.slice(3, 6)}.${r.doc.slice(6, 9)}-**` : `${r.doc.slice(0, 2)}.${r.doc.slice(2, 5)}.${r.doc.slice(5, 8)}/****-**`,
          nome: r.nome, email: r.tipo === "PF" ? cifrar(r.email) : r.email, telefone: r.tipo === "PF" ? cifrar("(75) 99999-0000") : "(75) 3333-0000",
          endereco: { logradouro: "Rua Principal", numero: "100", bairro: "Centro", cidade: MUNICIPIOS.find((m) => m.sigla === r.mun)!.nome, uf: "BA", cep: "46880-000" },
          municipio_id: mun[r.mun],
        },
      }));
    const u = await prisma.usuario.upsert({ where: { email: r.email }, update: {}, create: { email: r.email, nome: r.nome, senha_hash, trocar_senha: false, pessoa_id: pessoa.id } });
    if (!(await prisma.usuarioPapel.findFirst({ where: { usuario_id: u.id, papel: "REQUERENTE" } }))) await prisma.usuarioPapel.create({ data: { usuario_id: u.id, papel: "REQUERENTE" } });
  }

  console.log(`Seed base OK – organização ${org.sigla}, ${MUNICIPIOS.length} municípios, ${usuarios.length + requerentes.length} usuários. Senha demo: ${SENHA_DEMO}`);
}

main().finally(() => prisma.$disconnect());
