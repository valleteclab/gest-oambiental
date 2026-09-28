// Tipos e constantes puras do agente de denúncias (sem dependências de servidor – testáveis).

export const TIPOS_OCORRENCIA = [
  { id: "desmatamento", rotulo: "Desmatamento / supressão de vegetação", emoji: "🌳", palavras: /desmat|supress[aã]o|derrubad|mata (sendo )?(cortad|derrubad)|motosserra|trator derrubando|ro[cç]ad[ao] (de|na) mata|mata ciliar|app\b/i },
  { id: "queimada", rotulo: "Queimada / incêndio", emoji: "🔥", palavras: /queimad|fogo|inc[eê]ndio|queimando|fuma[cç]a de (mato|lixo)|tocando fogo|ateando fogo/i },
  { id: "poluicao_sonora", rotulo: "Poluição sonora (barulho)", emoji: "🔊", palavras: /barulho|som alto|paredão|poluiç[aã]o sonora|ru[ií]do|m[uú]sica alta|carro de som/i },
  { id: "residuos", rotulo: "Descarte irregular de resíduos / lixo", emoji: "🗑️", palavras: /lixo|entulho|res[ií]duo|descarte|lix[aã]o|jogando (lixo|entulho)|restos de obra|pneus?\b/i },
  { id: "esgoto", rotulo: "Lançamento de esgoto / efluente", emoji: "🚱", palavras: /esgoto|efluente|fossa|[aá]gua suja|chorume|despejo (no|em) (rio|riacho|c[oó]rrego)|vazamento de esgoto/i },
  { id: "poluicao_ar", rotulo: "Poluição do ar / fumaça", emoji: "🏭", palavras: /fuma[cç]a|fuligem|poeira|poluiç[aã]o do ar|chamin[eé]|cheiro forte|odor|mau cheiro/i },
  { id: "fauna", rotulo: "Maus-tratos à fauna / pesca predatória", emoji: "🐾", palavras: /maus[- ]tratos|animal|animais|p[aá]ssaro|gaiola|ca[cç]a\b|ca[cç]ador|pesca|rede de pesca|tartaruga|silvestre/i },
  { id: "extracao", rotulo: "Extração irregular (areia, cascalho)", emoji: "⛏️", palavras: /areia|cascalho|extra[cç][aã]o|draga|garimpo|pedreira|barro|argila|minera[cç][aã]o/i },
  { id: "agrotoxicos", rotulo: "Agrotóxicos / embalagens", emoji: "☣️", palavras: /agrot[oó]xico|veneno|pulveriz|embalage(m|ns) de (veneno|agrot)|defensivo/i },
  { id: "arvore", rotulo: "Poda / corte irregular de árvore", emoji: "🪓", palavras: /[aá]rvore|poda|podando|cortando (a |uma )?[aá]rvore|corte de [aá]rvore/i },
  { id: "outros", rotulo: "Outros", emoji: "📌", palavras: /^$/ },
] as const;

export type TipoOcorrencia = (typeof TIPOS_OCORRENCIA)[number]["id"];
export const IDS_TIPOS = TIPOS_OCORRENCIA.map((t) => t.id) as [TipoOcorrencia, ...TipoOcorrencia[]];
export const rotuloTipo = (id: string | null | undefined) => TIPOS_OCORRENCIA.find((t) => t.id === id)?.rotulo ?? "Outros";

/** Detecta o tipo pelas palavras-chave (fallback determinístico). Queimada tem precedência sobre fumaça. */
export function detectarTipo(texto: string): TipoOcorrencia | null {
  for (const t of TIPOS_OCORRENCIA) if (t.id !== "outros" && t.palavras.test(texto)) return t.id;
  return null;
}

export const MAX_FOTOS_CONVERSA = 5;

export type FotoColetada = { key: string; mime: string; nome: string; tamanho: number; sha256: string; descricao_ia?: string | null };

/** Dados coletados na conversa (conversa.dados_coletados). */
export type DadosColetados = {
  municipio_id?: string | null;
  tipo_ocorrencia?: TipoOcorrencia | null;
  descricao?: string | null;
  endereco?: string | null;
  referencia?: string | null;
  referencia_pulada?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  fotos?: FotoColetada[];
  fotos_encerradas?: boolean;
  anonima?: boolean | null;
  nome?: string | null;
  /** Chat do site: telefone/e-mail informado para acompanhar (opcional). */
  contato_informado?: string | null;
  contato_pulado?: boolean;
  /** Relato enviado antes do consentimento LGPD (aproveitado depois). */
  relato_inicial?: string | null;
  /** Campo perguntado por último (o fallback interpreta a próxima resposta como esse campo). */
  perguntou?: Campo | "correcao" | "confirmacao" | "municipio" | "lgpd" | "nova" | null;
  /** Ids dos botões oferecidos na última pergunta ("1" → primeiro botão). */
  botoes?: string[];
  /** Voltar à confirmação depois de corrigir um campo. */
  corrigindo?: boolean;
  estado_anterior?: string | null;
  avaliacao_pendente?: boolean;
  avaliacao?: number | null;
  assunto_email?: string | null;
  limite_avisado_em?: string | null;
  municipios_opcoes?: string[];
};

export type Campo = "municipio" | "tipo_ocorrencia" | "descricao" | "localizacao" | "referencia" | "fotos" | "identificacao" | "nome" | "contato";

/** Resultado da interpretação de uma mensagem (LLM via ferramenta atualizar_denuncia, ou fallback). */
export type Extracao = {
  tipo_ocorrencia?: TipoOcorrencia | null;
  descricao?: string | null;
  endereco?: string | null;
  referencia?: string | null;
  anonima?: boolean | null;
  nome?: string | null;
  confirma?: boolean | null;
  quer_consultar_protocolo?: string | null;
  fora_do_tema?: boolean | null;
  emergencia?: boolean | null;
  descricao_imagem?: string | null;
  pular?: boolean | null;
  contato?: string | null;
  municipio_indice?: number | null;
  corrigir_campo?: Campo | null;
  nova_denuncia?: boolean | null;
};

export const RE_PROTOCOLO = /\bDEN-[A-Z]{3}-\d{3,}\/\d{4}\b/i;
