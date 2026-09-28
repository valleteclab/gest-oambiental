// Massa de dados dos testes E2E, por conjunto (dataset). Selecione com E2E_DATASET (padrão: demo):
//
//   demo     → demonstração pública: consórcio FICTÍCIO CID-DEMO (prisma/seed/base.ts + demo.ts), municípios
//              Lagoa do Orvalho (LOR, principal), Serra Serena (SSR), Campo das Seriemas (CSE)…; T12 também exige o
//              cliente Riachão das Neves (onboard riachao-das-neves --demo + seed:riachao-demo).
//   poc-cds  → ambiente da PoC (Pregão SRP 005/2026): CDS Piemonte do Paraguaçu, 8 municípios reais
//              (onboard cds-piemonte --demo + seed:cds-poc – prisma/seed/clientes/cds-poc-demo.ts). `npm run test:e2e:poc-cds`.
//
// Os specs NÃO citam nomes/siglas/e-mails diretamente: usam os PAPÉIS abaixo –
//   município "principal" (T1, T3, T4, T5, T8, T11), "t2" (T2 – Posto Estrela) e "outro" (T7/T11 – escopo negado).
// Para adicionar um conjunto: acrescente uma entrada em CONJUNTOS com os mesmos campos.

export type Dataset = "demo" | "poc-cds";

/** Chaves de usuário usadas pelos specs (login(page, chave)). */
export type ChaveUsuario =
  | "admin"
  | "tecConsorcio1"
  | "tecConsorcio2"
  | "sema"
  | "tecnicoPrincipal"
  | "gestorPrincipal"
  | "fiscalPrincipal"
  | "tecnicoT2"
  | "gestorT2"
  | "fiscalT2"
  | "tecnicoOutro"
  | "gestorOutro"
  | "fiscalOutro"
  // requerentes com login
  | "laticinio"
  | "posto"
  | "joao"
  | "maria"
  | "ceramica";

export const REQUERENTES: ChaveUsuario[] = ["laticinio", "posto", "joao", "maria", "ceramica"];

type Municipio = { sigla: string; nome: string };

export type DadosE2E = {
  dataset: Dataset;
  organizacao: { sigla: string; nome: string };
  /** Todos os municípios (órgãos) da organização, na ordem do cadastro. */
  municipios: Municipio[];
  /** Papéis dos municípios nos cenários. */
  principal: Municipio;
  t2: Municipio;
  outro: Municipio;
  usuarios: Record<ChaveUsuario, string>;
  /** Órgão escolhido no login por usuário; ausente → principal. */
  orgaoDoUsuario: Partial<Record<ChaveUsuario, string>>;
  /** Nomes exibidos (linha do tempo, cabeçalhos de relatório). */
  nomes: { admin: string; tecnicoPrincipal: string; gestorPrincipal: string };
  cenarios: {
    /** T1/T5/T8 – requerente "laticinio" cria LO para este empreendimento (só LP/LI anteriores). */
    t1: { empreendimento: string; requerente: string; cnpj: string; cnpjFormatado: string };
    /** T2 – ficha com LP, LI e LO concluídas e RT com registro em conselho. */
    t2: { empreendimento: string; busca: string; requerente: string; bbox: { latMin: number; latMax: number; lngMin: number; lngMax: number } };
    /** T4 – ponto do GPS simulado do fiscal (dentro do município principal). */
    t4Gps: { latitude: number; longitude: number; accuracy: number };
    /** T11 – balcão: requerente PJ SEM login com UM empreendimento no município principal; coordenadas de um novo empreendimento. */
    t11: { requerente: string; busca: string; empreendimento: string; novoLat: string; novoLng: string };
  };
  contagens: {
    /** Processos carregados pelo seed (T10 confere a exportação: tabela processo ≥ este número). */
    processosSeed: number;
  };
  /** T12 – segunda organização no MESMO banco (isolamento entre clientes). null → T12 não se aplica (pulado). */
  isolamento: { sigla: string; municipio: string; admin: string; tecnico: string } | null;
};

const DEMO_DOM = "licenciagov.demo";
const POC_DOM = "poc.licenciagov.app";

const CONJUNTOS: Record<Dataset, DadosE2E> = {
  demo: {
    dataset: "demo",
    organizacao: { sigla: "CID-DEMO", nome: "Consórcio Intermunicipal de Demonstração" },
    municipios: [
      { sigla: "LOR", nome: "Lagoa do Orvalho" },
      { sigla: "SSR", nome: "Serra Serena" },
      { sigla: "CSE", nome: "Campo das Seriemas" },
      { sigla: "PCA", nome: "Pedra do Candeeiro" },
      { sigla: "AUM", nome: "Alto do Umbuzeiro" },
      { sigla: "VMA", nome: "Várzea do Mandacaru" },
    ],
    principal: { sigla: "LOR", nome: "Lagoa do Orvalho" },
    t2: { sigla: "SSR", nome: "Serra Serena" },
    outro: { sigla: "CSE", nome: "Campo das Seriemas" },
    usuarios: {
      admin: `admin@${DEMO_DOM}`,
      tecConsorcio1: `tec.consorcio1@${DEMO_DOM}`,
      tecConsorcio2: `tec.consorcio2@${DEMO_DOM}`,
      sema: `sema@${DEMO_DOM}`,
      tecnicoPrincipal: `tecnico.lor@${DEMO_DOM}`,
      gestorPrincipal: `gestor.lor@${DEMO_DOM}`,
      fiscalPrincipal: `fiscal.lor@${DEMO_DOM}`,
      tecnicoT2: `tecnico.ssr@${DEMO_DOM}`,
      gestorT2: `gestor.ssr@${DEMO_DOM}`,
      fiscalT2: `fiscal.ssr@${DEMO_DOM}`,
      tecnicoOutro: `tecnico.cse@${DEMO_DOM}`,
      gestorOutro: `gestor.cse@${DEMO_DOM}`,
      fiscalOutro: `fiscal.cse@${DEMO_DOM}`,
      laticinio: `laticinio@${DEMO_DOM}`,
      posto: `posto@${DEMO_DOM}`,
      joao: `joao@${DEMO_DOM}`,
      maria: `maria@${DEMO_DOM}`,
      ceramica: `ceramica@${DEMO_DOM}`,
    },
    orgaoDoUsuario: { tecnicoT2: "SSR", gestorT2: "SSR", fiscalT2: "SSR", tecnicoOutro: "CSE", gestorOutro: "CSE", fiscalOutro: "CSE", laticinio: "LOR", posto: "SSR", joao: "CSE", maria: "LOR", ceramica: "PCA" },
    nomes: { admin: "Ana Administradora", tecnicoPrincipal: "Técnico(a) de Lagoa do Orvalho", gestorPrincipal: "Gestor(a) de Lagoa do Orvalho" },
    cenarios: {
      t1: { empreendimento: "Laticínio Boa Vista – Lagoa do Orvalho", requerente: "Laticínio Boa Vista Ltda", cnpj: "11222333000181", cnpjFormatado: "11.222.333/0001-81" },
      t2: { empreendimento: "Posto Estrela – Serra Serena", busca: "Posto Estrela", requerente: "Posto Estrela Comércio de Combustíveis Ltda", bbox: { latMin: -13.5, latMax: -11.5, lngMin: -41.5, lngMax: -39.5 } },
      t4Gps: { latitude: -12.403812, longitude: -40.116245, accuracy: 8 },
      t11: { requerente: "Clínica Odontológica Sorriso Ltda", busca: "Sorriso", empreendimento: "Clínica Odontológica Sorriso – Lagoa do Orvalho", novoLat: "-12.4031", novoLng: "-40.1162" },
    },
    contagens: { processosSeed: 44 },
    isolamento: { sigla: "RDN", municipio: "Riachão das Neves", admin: `admin.rdn@${DEMO_DOM}`, tecnico: `tecnico.rdn@${DEMO_DOM}` },
  },

  // Códigos IBGE/coordenadas conferidos: prisma/seed/clientes/cds-piemonte.json; cenários: cds-poc-demo.ts.
  "poc-cds": {
    dataset: "poc-cds",
    organizacao: { sigla: "CDS-PIEMONTE", nome: "Consórcio de Desenvolvimento Sustentável do Piemonte do Paraguaçu" },
    municipios: [
      { sigla: "IAC", nome: "Iaçu" },
      { sigla: "IBQ", nome: "Ibiquera" },
      { sigla: "ITB", nome: "Itaberaba" },
      { sigla: "ITT", nome: "Itatim" },
      { sigla: "MNV", nome: "Mundo Novo" },
      { sigla: "RJB", nome: "Rafael Jambeiro" },
      { sigla: "RUY", nome: "Ruy Barbosa" },
      { sigla: "TPM", nome: "Tapiramutá" },
    ],
    principal: { sigla: "ITB", nome: "Itaberaba" },
    t2: { sigla: "RUY", nome: "Ruy Barbosa" },
    outro: { sigla: "IAC", nome: "Iaçu" },
    usuarios: {
      admin: `admin.cds@${POC_DOM}`,
      tecConsorcio1: `tec.consorcio1@${POC_DOM}`,
      tecConsorcio2: `tec.consorcio2@${POC_DOM}`,
      sema: `sema@${POC_DOM}`,
      tecnicoPrincipal: `tecnico.itb@${POC_DOM}`,
      gestorPrincipal: `gestor.itb@${POC_DOM}`,
      fiscalPrincipal: `fiscal.itb@${POC_DOM}`,
      tecnicoT2: `tecnico.ruy@${POC_DOM}`,
      gestorT2: `gestor.ruy@${POC_DOM}`,
      fiscalT2: `fiscal.ruy@${POC_DOM}`,
      tecnicoOutro: `tecnico.iac@${POC_DOM}`,
      gestorOutro: `gestor.iac@${POC_DOM}`,
      fiscalOutro: `fiscal.iac@${POC_DOM}`,
      laticinio: `laticinio@${POC_DOM}`,
      posto: `posto@${POC_DOM}`,
      joao: `joao@${POC_DOM}`,
      maria: `maria@${POC_DOM}`,
      ceramica: `ceramica@${POC_DOM}`,
    },
    orgaoDoUsuario: { tecnicoT2: "RUY", gestorT2: "RUY", fiscalT2: "RUY", tecnicoOutro: "IAC", gestorOutro: "IAC", fiscalOutro: "IAC", laticinio: "ITB", posto: "RUY", joao: "IAC", maria: "ITB", ceramica: "ITT" },
    nomes: { admin: "Administrador(a) do Consórcio", tecnicoPrincipal: "Técnico(a) de Itaberaba", gestorPrincipal: "Gestor(a) de Itaberaba" },
    cenarios: {
      t1: { empreendimento: "Laticínio Boa Vista – Itaberaba", requerente: "Laticínio Boa Vista Ltda", cnpj: "36184527000160", cnpjFormatado: "36.184.527/0001-60" },
      // bbox = região limítrofe da malha municipal do IBGE (api/v3/malhas/municipios/2927200/metadados)
      t2: { empreendimento: "Posto Estrela – Ruy Barbosa", busca: "Posto Estrela", requerente: "Posto Estrela Comércio de Combustíveis Ltda", bbox: { latMin: -12.4531, latMax: -12.0786, lngMin: -41.0491, lngMax: -40.1122 } },
      // zona urbana de Itaberaba (conferido dentro da malha municipal do IBGE)
      t4Gps: { latitude: -12.521512, longitude: -40.303217, accuracy: 8 },
      t11: { requerente: "Clínica Odontológica Sorriso Ltda", busca: "Sorriso", empreendimento: "Clínica Odontológica Sorriso – Itaberaba", novoLat: "-12.5262", novoLng: "-40.3081" },
    },
    contagens: { processosSeed: 44 },
    // O ambiente da PoC tem um único cliente: o isolamento entre organizações (T12) é demonstrado no ambiente de demonstração.
    isolamento: null,
  },
};

function lerDataset(): Dataset {
  const v = (process.env.E2E_DATASET || "demo").trim();
  if (!(v in CONJUNTOS)) throw new Error(`E2E_DATASET inválido: "${v}" (use ${Object.keys(CONJUNTOS).join(" | ")})`);
  return v as Dataset;
}

/** Conjunto de dados ativo (E2E_DATASET). */
export const DADOS: DadosE2E = CONJUNTOS[lerDataset()];

/** Ano corrente (numeração AAAA dos processos/documentos gerados pelo seed e pelos testes). */
export const ANO = new Date().getFullYear();

/** Escapa texto para uso literal em RegExp. */
export const re = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Nº de processo do município: SIG-AAAA-000000. */
export const reProcesso = (sigla: string, ancorado = true) => new RegExp(`${ancorado ? "^" : ""}${sigla}-${ANO}-\\d{6}${ancorado ? "$" : ""}`);
