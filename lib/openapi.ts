// Documento OpenAPI 3.1 da API REST /api/v1 (SPEC 12). Servido em /api/docs/openapi.json e visualizado em /api/docs.
// Mantenha em sincronia com app/api/v1/**: ao criar/alterar rota, atualize aqui.

type Obj = Record<string, unknown>;

const ref = (nome: string) => ({ $ref: `#/components/schemas/${nome}` });
const uuid = { type: "string", format: "uuid" };
const data = { type: "string", format: "date" };
const dataHora = { type: "string", format: "date-time" };
const str = { type: "string" };
const strN = { type: ["string", "null"] };
const num = { type: "number" };
const bool = { type: "boolean" };
const enumStr = (...v: string[]) => ({ type: "string", enum: v });
const arr = (items: Obj) => ({ type: "array", items });
const obj = (properties: Obj, required: string[] = []) => ({ type: "object", properties, ...(required.length ? { required } : {}) });

const json = (schema: Obj) => ({ "application/json": { schema } });
const corpo = (schema: Obj, required = true) => ({ required, content: json(schema) });
const ok = (schema: Obj, description = "OK") => ({ description, content: json(schema) });
const pagina = (item: string) => ok(ref(`Pagina${item}`), "Lista paginada");

const erros = (...codigos: number[]) =>
  Object.fromEntries(codigos.map((c) => [String(c), { $ref: `#/components/responses/Erro${c}` }]));
const errosInternos = erros(401, 403, 422, 500);

const pId = (nome = "id", desc = "Identificador (uuid)") => ({ name: nome, in: "path", required: true, description: desc, schema: nome === "id" ? uuid : str });
const q = (name: string, description: string, schema: Obj = str) => ({ name, in: "query", required: false, description, schema });
const paginacao = [{ $ref: "#/components/parameters/page" }, { $ref: "#/components/parameters/size" }];
const filtroMun = q("municipio", "Filtra por município (uuid ou sigla). Sempre limitado ao escopo do usuário.");
const busca = q("q", "Busca textual (nome, nº, CPF/CNPJ – busca por hash)");

const publico = { security: [] as unknown[] };

type Op = { tags: string[]; summary: string; description?: string; parameters?: unknown[]; requestBody?: unknown; responses: Obj; security?: unknown[] };
const op = (o: Op) => o;

// ───────────── CRUD de cadastros (GET lista / POST cria / GET+PATCH por id) ─────────────
function crud(tag: string, base: string, schema: string, criar: string, atualizar: string, extrasLista: unknown[] = []) {
  return {
    [`/api/v1/${base}`]: {
      get: op({ tags: [tag], summary: `Lista ${base}`, parameters: [...paginacao, filtroMun, busca, ...extrasLista], responses: { "200": pagina(schema), ...errosInternos } }),
      post: op({ tags: [tag], summary: `Cria registro em ${base}`, requestBody: corpo(ref(criar)), responses: { "201": ok(ref(schema), "Criado"), ...erros(401, 403, 409, 422, 500) } }),
    },
    [`/api/v1/${base}/{id}`]: {
      get: op({ tags: [tag], summary: `Detalha registro de ${base}`, parameters: [pId()], responses: { "200": ok(ref(schema)), ...erros(401, 403, 404, 500) } }),
      patch: op({ tags: [tag], summary: `Atualiza parcialmente (auditado)`, parameters: [pId()], requestBody: corpo(ref(atualizar)), responses: { "200": ok(ref(schema)), ...erros(401, 403, 404, 409, 422, 500) } }),
    },
  };
}

function listaCria(tag: string, base: string, schema: string, criar: string, extras: unknown[] = [], descricao?: string) {
  return {
    [`/api/v1/${base}`]: {
      get: op({ tags: [tag], summary: `Lista ${base}`, parameters: [...paginacao, filtroMun, busca, ...extras], responses: { "200": pagina(schema), ...errosInternos } }),
      post: op({ tags: [tag], summary: `Registra ${base}`, description: descricao, requestBody: corpo(ref(criar)), responses: { "201": ok(ref(schema), "Criado"), ...erros(401, 403, 422, 500) } }),
    },
    [`/api/v1/${base}/{id}`]: {
      get: op({ tags: [tag], summary: `Detalha ${base}`, parameters: [pId()], responses: { "200": ok(ref(schema)), ...erros(401, 403, 404, 500) } }),
    },
  };
}

const ACOES = ["protocolar", "distribuir", "pendencia", "responder", "aceitar", "parecer", "deferir", "indeferir", "arquivar"];

const endereco = obj({ logradouro: str, numero: str, bairro: str, cep: str, municipio: str, uf: str, complemento: str });

const schemas: Obj = {
  Erro: obj(
    {
      code: { type: "string", description: "Código estável do erro", examples: ["NAO_AUTENTICADO", "PROIBIDO", "NAO_ENCONTRADO", "INVALIDO", "CONFLITO", "ERRO_INTERNO"] },
      message: { type: "string", description: "Mensagem em português para o usuário" },
      details: { description: "Detalhes (ex.: issues do zod) ou null" },
    },
    ["code", "message"],
  ),
  Paginacao: obj({ page: { type: "integer", minimum: 1 }, size: { type: "integer", minimum: 1, maximum: 200 }, total: { type: "integer" } }, ["page", "size", "total"]),
  Tokens: obj(
    { access_token: str, refresh_token: str, token_type: { const: "Bearer" }, expires_in: { type: "integer", description: "Segundos (900 = 15 min)" }, usuario: ref("UsuarioSessao") },
    ["access_token", "refresh_token", "token_type", "expires_in"],
  ),
  UsuarioSessao: obj({
    id: uuid, nome: str, email: { type: "string", format: "email" }, trocar_senha: bool,
    papeis: arr(obj({ papel: enumStr("ADMIN", "TEC_CONSORCIO", "TEC_MUNICIPAL", "GESTOR_MUNICIPAL", "FISCAL", "SEMA_INEMA", "REQUERENTE"), municipio_id: { ...uuid, type: ["string", "null"] } })),
  }),
  Pessoa: obj({
    id: uuid, tipo: enumStr("PF", "PJ"), nome: str, nome_fantasia: strN,
    cpf_cnpj: { type: "string", description: "Mascarado conforme perfil (PF cifrado em repouso)" },
    email: strN, telefone: strN, endereco, municipio_id: uuid, created_at: dataHora,
  }),
  PessoaCriar: obj({ tipo: enumStr("PF", "PJ"), cpf_cnpj: { type: "string", description: "Somente dígitos; dígito verificador validado" }, nome: str, nome_fantasia: str, email: str, telefone: str, endereco, municipio_id: uuid }, ["tipo", "cpf_cnpj", "nome", "municipio_id"]),
  PessoaAtualizar: obj({ nome: str, nome_fantasia: str, email: str, telefone: str, endereco }),
  ResponsavelTecnico: obj({ id: uuid, pessoa_id: uuid, pessoa: ref("Pessoa"), formacao: str, conselho: { type: "string", examples: ["CREA", "CRBio", "CRQ"] }, registro_conselho: str, uf_conselho: str }),
  ResponsavelTecnicoCriar: obj({ pessoa_id: uuid, formacao: str, conselho: str, registro_conselho: str, uf_conselho: str }, ["pessoa_id", "conselho", "registro_conselho", "uf_conselho"]),
  ResponsavelTecnicoAtualizar: obj({ formacao: str, conselho: str, registro_conselho: str, uf_conselho: str }),
  Empreendimento: obj({
    id: uuid, municipio_id: uuid, requerente_id: uuid, nome: str, endereco,
    latitude: { type: "number", minimum: -90, maximum: 90 }, longitude: { type: "number", minimum: -180, maximum: 180 },
    poligono_geojson: { type: ["object", "null"], description: "GeoJSON Polygon/MultiPolygon" },
    tipologia_id: uuid, porte: enumStr("MICRO", "PEQUENO", "MEDIO", "GRANDE", "EXCEPCIONAL"), potencial_poluidor: enumStr("BAIXO", "MEDIO", "ALTO"),
    area_m2: { type: ["number", "null"] }, numero_car: strN, status: enumStr("ATIVO", "INATIVO"),
  }),
  EmpreendimentoCriar: obj({ municipio_id: uuid, requerente_id: uuid, nome: str, endereco, latitude: num, longitude: num, poligono_geojson: { type: "object" }, tipologia_id: uuid, grandeza_porte: { type: "number", description: "Valor na unidade da tipologia – porte calculado" }, area_m2: num, numero_car: str, rt_ids: arr(uuid) }, ["municipio_id", "requerente_id", "nome", "tipologia_id", "latitude", "longitude"]),
  EmpreendimentoAtualizar: obj({ nome: str, endereco, latitude: num, longitude: num, poligono_geojson: { type: "object" }, porte: str, justificativa_porte: str, status: enumStr("ATIVO", "INATIVO") }),
  Processo: obj({
    id: uuid, numero: { type: "string", examples: ["LOR-2026-000042"] }, municipio_id: uuid, empreendimento_id: uuid, requerente_id: uuid, rt_id: { ...uuid, type: ["string", "null"] }, tipo_ato_id: uuid,
    status: enumStr("RASCUNHO", "PROTOCOLADO", "EM_TRIAGEM", "AGUARDANDO_REQUERENTE", "EM_ANALISE", "AGUARDANDO_VISTORIA", "AGUARDANDO_DECISAO", "DEFERIDO", "INDEFERIDO", "CONCLUIDO", "ARQUIVADO"),
    etapa_atual: str, tecnico_id: { type: ["string", "null"] }, gestor_id: { type: ["string", "null"] },
    data_protocolo: { type: ["string", "null"], format: "date-time" }, prazo_etapa_ate: { type: ["string", "null"], format: "date" }, prazo_pausado: bool,
    semaforo: enumStr("VERDE", "AMARELO", "VERMELHO", "CINZA"), descricao_atividade: str, observacoes: strN,
  }),
  ProcessoDetalhe: {
    allOf: [
      ref("Processo"),
      obj({ tramitacao: arr(ref("Tramitacao")), pendencias: arr(ref("Pendencia")), anexos: arr(ref("Anexo")), documentos: arr(ref("Documento")), condicionantes: arr(obj({ id: uuid, descricao: str, periodicidade: str, prazo_ate: data, status: str })) }),
    ],
  },
  ProcessoCriar: obj({ empreendimento_id: uuid, tipo_ato_id: uuid, rt_id: uuid, descricao_atividade: str, observacoes: str }, ["empreendimento_id", "tipo_ato_id", "descricao_atividade"]),
  Tramitacao: obj({ id: uuid, de_status: strN, para_status: str, de_usuario: obj({ id: uuid, nome: str }), para_usuario_id: { type: ["string", "null"] }, despacho: str, created_at: dataHora }),
  Pendencia: obj({ id: uuid, descricao: str, prazo_dias: { type: "integer" }, prazo_ate: data, status: enumStr("ABERTA", "RESPONDIDA", "VENCIDA", "CANCELADA"), resposta: strN, respondida_em: { type: ["string", "null"], format: "date-time" } }),
  Anexo: obj({ id: uuid, tipo: str, nome_arquivo: str, mime: str, tamanho: { type: "integer" }, sha256: str, created_at: dataHora }),
  AcaoProcesso: {
    type: "object",
    description:
      "Corpo conforme a ação: `distribuir` {tecnico_id, despacho}; `pendencia` {descricao, prazo_dias}; `responder` {pendencia_id, resposta, anexo_ids}; " +
      "`parecer` {conclusao, texto_html, condicionantes[]}; `deferir`/`indeferir`/`arquivar`/`aceitar`/`protocolar` {despacho}.",
    properties: {
      despacho: str, tecnico_id: uuid, descricao: str, prazo_dias: { type: "integer", minimum: 1 }, pendencia_id: uuid, resposta: str, anexo_ids: arr(uuid),
      conclusao: enumStr("FAVORAVEL", "DESFAVORAVEL", "FAVORAVEL_COM_CONDICIONANTES"), texto_html: str,
      condicionantes: arr(obj({ descricao: str, periodicidade: str, prazo_ate: data }, ["descricao"])),
    },
  },
  UploadSolicitar: obj({ nome_arquivo: str, mime: { type: "string", examples: ["application/pdf", "image/jpeg"] }, tamanho: { type: "integer", maximum: 26214400 }, tipo: str, sha256: str }, ["nome_arquivo", "mime", "tamanho"]),
  UploadUrl: obj({ anexo_id: uuid, upload_url: { type: "string", format: "uri", description: "URL pré-assinada (PUT), expira em 15 min" }, storage_key: str, expira_em: dataHora }),
  Documento: obj({
    id: uuid, municipio_id: uuid, processo_id: { type: ["string", "null"] }, fiscalizacao_id: { type: ["string", "null"] },
    tipo: enumStr("LICENCA", "AUTORIZACAO", "CERTIDAO", "AUTO_INFRACAO", "NOTIFICACAO", "PARECER", "OFICIO", "RECIBO"),
    numero: { type: "string", examples: ["LO-LOR-012/2026"] }, ano: { type: "integer" }, codigo_verificador: { type: "string", examples: ["7KQ2-M9XA-D3PL"] },
    sha256_pdf: str, validade_ate: { type: ["string", "null"], format: "date" }, emitido_em: dataHora, status: enumStr("VALIDO", "CANCELADO", "SUBSTITUIDO"),
    motivo_cancelamento: strN, url_pdf: { type: "string", format: "uri" },
  }),
  DocumentoEmitir: obj({ tipo: str, processo_id: uuid, fiscalizacao_id: uuid, validade_meses: { type: "integer" }, dados: { type: "object", description: "Campos específicos do modelo" } }, ["tipo"]),
  DocumentoCancelar: obj({ motivo: { type: "string", minLength: 10 } }, ["motivo"]),
  ValidacaoPublica: obj({ codigo: str, situacao: enumStr("VALIDO", "CANCELADO", "SUBSTITUIDO", "NAO_ENCONTRADO"), tipo: str, numero: str, municipio: str, emitido_em: dataHora, validade_ate: { type: ["string", "null"] }, titular: { type: "string", description: "Nome abreviado se PF; CPF/CNPJ mascarado" }, empreendimento: str, sha256_pdf: str, motivo_cancelamento: strN }),
  ProcessoPublico: obj({ numero: str, municipio: str, tipo_ato: str, situacao: str, requerente: { type: "string", description: "Mascarado (***.456.789-**) / abreviado" }, empreendimento: str, linha_do_tempo: arr(obj({ data: dataHora, etapa: str })) }),
  LicencaPublica: obj({ numero: str, tipo: str, municipio: str, titular: str, empreendimento: str, emitido_em: dataHora, validade_ate: { type: ["string", "null"] }, codigo_verificador: str, situacao: str }),
  DenunciaPublicaCriar: obj({ municipio_id: uuid, anonima: bool, denunciante_nome: str, contato: str, descricao: { type: "string", minLength: 20 }, latitude: num, longitude: num, endereco: str }, ["municipio_id", "descricao", "anonima"]),
  DenunciaProtocolo: obj({ protocolo: { type: "string", examples: ["DEN-LOR-2026-000007"] }, criada_em: dataHora }),
  Denuncia: obj({ id: uuid, municipio_id: uuid, protocolo: str, canal: enumStr("PORTAL", "PRESENCIAL", "TELEFONE", "OUTRO"), anonima: bool, denunciante_nome: strN, descricao: str, latitude: { type: ["number", "null"] }, longitude: { type: ["number", "null"] }, endereco: strN, status: enumStr("NOVA", "EM_APURACAO", "CONCLUIDA", "ARQUIVADA"), created_at: dataHora }),
  DenunciaCriar: obj({ municipio_id: uuid, canal: enumStr("PORTAL", "PRESENCIAL", "TELEFONE", "OUTRO"), anonima: bool, denunciante_nome: str, contato: str, descricao: str, latitude: num, longitude: num, endereco: str }, ["municipio_id", "canal", "descricao"]),
  Fiscalizacao: obj({ id: uuid, municipio_id: uuid, origem: enumStr("DENUNCIA", "ROTINA", "PROCESSO"), denuncia_id: { type: ["string", "null"] }, processo_id: { type: ["string", "null"] }, empreendimento_id: { type: ["string", "null"] }, data_hora: dataHora, latitude: num, longitude: num, precisao_m: num, equipe: arr(obj({ usuario_id: uuid, nome: str })), relato: str, constatacao: enumStr("IRREGULAR", "REGULAR", "INCONCLUSIVA"), status: enumStr("AGENDADA", "REALIZADA", "CANCELADA"), fotos: arr(ref("Anexo")) }),
  FiscalizacaoCriar: obj({ municipio_id: uuid, origem: enumStr("DENUNCIA", "ROTINA", "PROCESSO"), denuncia_id: uuid, processo_id: uuid, empreendimento_id: uuid, data_hora: dataHora, latitude: num, longitude: num, precisao_m: num, equipe: arr(uuid), relato: str, constatacao: enumStr("IRREGULAR", "REGULAR", "INCONCLUSIVA") }, ["municipio_id", "origem", "data_hora", "latitude", "longitude"]),
  AutoInfracao: obj({ id: uuid, fiscalizacao_id: uuid, numero: { type: "string", examples: ["AI-LOR-003/2026"] }, autuado_id: uuid, enquadramento_legal: str, descricao_infracao: str, penalidade: enumStr("ADVERTENCIA", "MULTA", "EMBARGO", "INTERDICAO", "OUTRA"), valor_multa: { type: ["number", "null"] }, prazo_defesa_dias: { type: "integer" }, status: enumStr("LAVRADO", "EM_DEFESA", "JULGADO", "PAGO", "CANCELADO"), documento: ref("Documento") }),
  AutoInfracaoCriar: obj({ fiscalizacao_id: uuid, autuado_id: uuid, enquadramento_legal: str, descricao_infracao: str, penalidade: enumStr("ADVERTENCIA", "MULTA", "EMBARGO", "INTERDICAO", "OUTRA"), valor_multa: num, prazo_defesa_dias: { type: "integer", default: 20 } }, ["fiscalizacao_id", "autuado_id", "enquadramento_legal", "descricao_infracao", "penalidade"]),
  Notificacao: obj({ id: uuid, fiscalizacao_id: { type: ["string", "null"] }, processo_id: { type: ["string", "null"] }, numero: { type: "string", examples: ["NOT-LOR-005/2026"] }, notificado_id: uuid, exigencia: str, prazo_dias: { type: "integer" }, prazo_ate: data, status: enumStr("EMITIDA", "ATENDIDA", "VENCIDA", "CANCELADA"), documento: ref("Documento") }),
  NotificacaoCriar: obj({ fiscalizacao_id: uuid, processo_id: uuid, notificado_id: uuid, exigencia: str, prazo_dias: { type: "integer", minimum: 1 } }, ["notificado_id", "exigencia", "prazo_dias"]),
  Indicadores: obj({
    filtro: obj({ municipio: strN, de: data, ate: data }),
    cards: obj({ processos_abertos: { type: "integer" }, protocolados_periodo: { type: "integer" }, licencas_emitidas: { type: "integer" }, vencendo: { type: "integer" }, vencidos: { type: "integer" }, tempo_medio_dias: num, denuncias_abertas: { type: "integer" }, autos_lavrados: { type: "integer" }, valor_multas: num }),
    por_status: arr(obj({ status: str, total: { type: "integer" } })),
    por_mes: arr(obj({ mes: { type: "string", examples: ["2026-05"] }, protocolados: { type: "integer" }, concluidos: { type: "integer" } })),
    por_municipio: arr(obj({ municipio_id: uuid, municipio: str, abertos: { type: "integer" }, licencas: { type: "integer" }, vencidos: { type: "integer" }, fiscalizacoes: { type: "integer" } })),
  }),
  ExportacaoSolicitar: obj({ escopo: { type: "string", enum: ["COMPLETA", "MUNICIPIO"], default: "COMPLETA" }, municipio_id: uuid }),
  Exportacao: obj({ id: uuid, escopo: str, status: enumStr("PENDENTE", "PROCESSANDO", "CONCLUIDA", "ERRO"), created_at: dataHora, concluida_em: { type: ["string", "null"] }, url_download: { type: ["string", "null"], format: "uri", description: "ZIP (CSV+JSON por tabela, anexos, manifest.json)" }, tamanho_bytes: { type: ["integer", "null"] }, sha256: strN }),
  SeiaProcesso: obj({
    numero: str,
    status: enumStr("PROTOCOLADO", "EM_TRIAGEM", "AGUARDANDO_REQUERENTE", "EM_ANALISE", "AGUARDANDO_VISTORIA", "AGUARDANDO_DECISAO", "DEFERIDO", "INDEFERIDO", "CONCLUIDO", "ARQUIVADO"),
    municipio: obj({ codigo_ibge: str, nome: str, sigla: str }),
    tipo_ato: obj({ sigla: str, nome: str }),
    tipologia: { type: ["object", "null"], properties: { codigo: str, nome: str } },
    porte: enumStr("MICRO", "PEQUENO", "MEDIO", "GRANDE", "EXCEPCIONAL"),
    potencial_poluidor: enumStr("BAIXO", "MEDIO", "ALTO"),
    datas: obj({ protocolo: { type: ["string", "null"], format: "date-time" }, conclusao: { type: ["string", "null"], format: "date-time" }, atualizado_em: dataHora }),
    empreendimento: obj({ nome: str, latitude: { type: ["number", "null"] }, longitude: { type: ["number", "null"] }, numero_car: strN }),
    requerente: obj({ nome: str, tipo: enumStr("PF", "PJ"), documento: { type: "string", description: "CPF/CNPJ sempre mascarado (***.456.789-** / 12.345.678/****-**)", examples: ["***.456.789-**"] } }),
    documentos: arr(obj({
      tipo: enumStr("LICENCA", "AUTORIZACAO", "CERTIDAO", "NOTIFICACAO", "AUTO_INFRACAO"),
      numero: str, sigla_ato: strN, emitido_em: dataHora, validade_ate: { type: ["string", "null"], format: "date-time" },
      status: enumStr("VALIDO", "CANCELADO", "SUBSTITUIDO"),
      url_validacao: { type: "string", format: "uri", description: "Página pública de validação (/validar/{codigo})" },
      sha256: { type: "string", description: "SHA-256 do PDF (assinado) emitido" },
    })),
  }),
  PaginaSeiaProcesso: obj({
    formato: { type: "string", examples: ["LicenciaGov-SEIA v0 (provisório – a confirmar com SEMA/INEMA)"] },
    gerado_em: dataHora, page: { type: "integer" }, size: { type: "integer" }, total: { type: "integer" }, items: arr(ref("SeiaProcesso")),
  }, ["formato", "page", "size", "total", "items"]),
};

for (const n of ["Pessoa", "ResponsavelTecnico", "Empreendimento", "Processo", "Denuncia", "Fiscalizacao", "AutoInfracao", "Notificacao", "LicencaPublica"]) {
  schemas[`Pagina${n}`] = obj({ items: arr(ref(n)), page: { type: "integer" }, size: { type: "integer" }, total: { type: "integer" } }, ["items", "page", "size", "total"]);
}

const erroResp = (desc: string, exemplo: Obj) => ({ description: desc, content: { "application/json": { schema: ref("Erro"), example: exemplo } } });

const paths: Obj = {
  // ───────────── Autenticação ─────────────
  "/api/v1/auth/login": {
    post: op({
      tags: ["Autenticação"], summary: "Login (e-mail + senha)", ...publico,
      description: "Retorna access token (15 min) e refresh token (8 h); também grava cookies HttpOnly. Bloqueio da conta após 5 falhas (15 min) e limite por IP: 20 falhas em 15 min → 429 `MUITAS_TENTATIVAS` (só falhas contam; `LOGIN_LIMITE_IP`/`LOGIN_LIMITE_IP_JANELA_MIN`). `orgao` (opcional): sigla ou id do município em que o usuário vai atuar – usuários municipais só nos municípios dos seus papéis; ADMIN, TEC_CONSORCIO, SEMA_INEMA e requerentes em qualquer órgão.",
      requestBody: corpo(obj({ email: { type: "string", format: "email" }, senha: str, orgao: { type: "string", examples: ["LOR"] } }, ["email", "senha"])),
      responses: { "200": ok(ref("Tokens")), "401": erroResp("Credenciais inválidas", { code: "CREDENCIAIS_INVALIDAS", message: "E-mail ou senha inválidos.", details: null }), "403": erroResp("Sem acesso ao órgão", { code: "ORGAO_SEM_ACESSO", message: "Seu usuário não tem acesso a este órgão.", details: null }), ...erros(422, 429, 500) },
    }),
  },
  "/api/v1/auth/refresh": {
    post: op({ tags: ["Autenticação"], summary: "Renova tokens", ...publico, description: "Aceita `refresh_token` no corpo ou o cookie `lg_refresh`. Tokens inválidos contam para o limite por IP (429 `MUITAS_TENTATIVAS`).", requestBody: corpo(obj({ refresh_token: str }), false), responses: { "200": ok(ref("Tokens")), ...erros(401, 429, 500) } }),
  },
  "/api/v1/auth/logout": {
    post: op({ tags: ["Autenticação"], summary: "Encerra a sessão (auditado)", responses: { "200": ok(obj({ ok: bool })), ...erros(401, 500) } }),
  },

  // ───────────── Cadastros ─────────────
  ...crud("Cadastros", "pessoas", "Pessoa", "PessoaCriar", "PessoaAtualizar", [q("tipo", "PF ou PJ", enumStr("PF", "PJ")), q("cpf_cnpj", "Busca exata por CPF/CNPJ (via hash)")]),
  ...crud("Cadastros", "responsaveis-tecnicos", "ResponsavelTecnico", "ResponsavelTecnicoCriar", "ResponsavelTecnicoAtualizar"),
  ...crud("Cadastros", "empreendimentos", "Empreendimento", "EmpreendimentoCriar", "EmpreendimentoAtualizar", [q("tipologia_id", "Filtra por tipologia", uuid), q("requerente_id", "Filtra por requerente", uuid)]),

  // ───────────── Processos ─────────────
  "/api/v1/processos": {
    get: op({
      tags: ["Processos"], summary: "Lista processos (escopo do usuário)",
      parameters: [...paginacao, filtroMun, busca, q("status", "Status (pode repetir)", arr(str)), q("tecnico_id", "Técnico responsável", uuid), q("semaforo", "VERDE|AMARELO|VERMELHO", enumStr("VERDE", "AMARELO", "VERMELHO")), q("numero", "Número exato (ex.: LOR-2026-000042)")],
      responses: { "200": pagina("Processo"), ...errosInternos },
    }),
    post: op({ tags: ["Processos"], summary: "Cria requerimento (RASCUNHO)", description: "Use a ação `protocolar` para gerar o número.", requestBody: corpo(ref("ProcessoCriar")), responses: { "201": ok(ref("Processo"), "Criado"), ...erros(401, 403, 422, 500) } }),
  },
  "/api/v1/processos/{id}": {
    get: op({ tags: ["Processos"], summary: "Detalha processo (linha do tempo, pendências, anexos, documentos)", parameters: [pId()], responses: { "200": ok(ref("ProcessoDetalhe")), ...erros(401, 403, 404, 500) } }),
  },
  "/api/v1/processos/{id}/acoes/{acao}": {
    post: op({
      tags: ["Processos"], summary: "Executa transição da máquina de estados",
      description: "Transições validadas por perfil e status (SPEC 6). Gera registro imutável em `tramitacao` e auditoria. Transição inválida → 409.",
      parameters: [pId(), { name: "acao", in: "path", required: true, schema: enumStr(...ACOES) }],
      requestBody: corpo(ref("AcaoProcesso")),
      responses: { "200": ok(ref("ProcessoDetalhe")), ...erros(401, 403, 404, 409, 422, 500) },
    }),
  },
  "/api/v1/processos/{id}/anexos": {
    post: op({
      tags: ["Processos"], summary: "Solicita upload de anexo (URL pré-assinada)",
      description: "Whitelist: pdf, jpg, png, dwg, kml, kmz, shp.zip; máx. 25 MB. Após o PUT na `upload_url`, o SHA-256 é conferido.",
      parameters: [pId()], requestBody: corpo(ref("UploadSolicitar")),
      responses: { "201": ok(ref("UploadUrl"), "URL gerada"), ...erros(401, 403, 404, 413, 415, 422, 500) },
    }),
  },

  // ───────────── Documentos oficiais ─────────────
  "/api/v1/documentos": {
    post: op({ tags: ["Documentos"], summary: "Emite documento oficial (PDF + QR + código verificador + SHA-256)", requestBody: corpo(ref("DocumentoEmitir")), responses: { "201": ok(ref("Documento"), "Emitido"), ...erros(401, 403, 409, 422, 500) } }),
  },
  "/api/v1/documentos/{id}/cancelar": {
    post: op({ tags: ["Documentos"], summary: "Cancela documento (com justificativa; o PDF original é mantido)", parameters: [pId()], requestBody: corpo(ref("DocumentoCancelar")), responses: { "200": ok(ref("Documento")), ...erros(401, 403, 404, 409, 422, 500) } }),
  },

  // ───────────── Portal público ─────────────
  "/api/v1/public/validar/{codigo}": {
    get: op({ tags: ["Público"], summary: "Valida autenticidade de documento", ...publico, parameters: [{ name: "codigo", in: "path", required: true, schema: { type: "string", examples: ["7KQ2-M9XA-D3PL"] } }], responses: { "200": ok(ref("ValidacaoPublica")), ...erros(404, 429, 500) } }),
  },
  "/api/v1/public/processos": {
    get: op({ tags: ["Público"], summary: "Consulta pública de processo", ...publico, parameters: [{ ...q("numero", "Nº do processo"), required: true }, q("doc", "CPF/CNPJ do requerente (opcional, confirma titularidade)")], responses: { "200": ok(ref("ProcessoPublico")), ...erros(404, 422, 429, 500) } }),
  },
  "/api/v1/public/licencas": {
    get: op({ tags: ["Público"], summary: "Licenças emitidas (transparência)", ...publico, parameters: [...paginacao, filtroMun, busca, q("tipo", "Sigla do tipo de ato (LO, LP…)"), q("situacao", "VALIDO|CANCELADO|VENCIDO")], responses: { "200": pagina("LicencaPublica"), ...erros(422, 500) } }),
  },
  "/api/v1/public/denuncias": {
    post: op({ tags: ["Público"], summary: "Registra denúncia ambiental (anônima opcional)", ...publico, requestBody: corpo(ref("DenunciaPublicaCriar")), responses: { "201": ok(ref("DenunciaProtocolo"), "Registrada"), ...erros(422, 429, 500) } }),
  },

  // ───────────── Fiscalização ─────────────
  ...listaCria("Fiscalização", "fiscalizacoes", "Fiscalizacao", "FiscalizacaoCriar", [q("origem", "DENUNCIA|ROTINA|PROCESSO"), q("constatacao", "IRREGULAR|REGULAR|INCONCLUSIVA")], "Coordenadas capturadas no celular (precisão em metros)."),
  ...listaCria("Fiscalização", "autos-infracao", "AutoInfracao", "AutoInfracaoCriar", [q("status", "Status do auto")], "Gera numeração AI-{MUN}-{000}/{ANO} e o PDF oficial."),
  ...listaCria("Fiscalização", "notificacoes", "Notificacao", "NotificacaoCriar", [q("status", "Status")], "Gera numeração NOT-{MUN}-{000}/{ANO} e o PDF oficial."),
  ...listaCria("Fiscalização", "denuncias", "Denuncia", "DenunciaCriar", [q("status", "NOVA|EM_APURACAO|CONCLUIDA|ARQUIVADA")]),

  // ───────────── Indicadores e relatórios ─────────────
  "/api/v1/indicadores": {
    get: op({ tags: ["Dashboard"], summary: "Indicadores do dashboard", parameters: [filtroMun, q("de", "Data inicial", data), q("ate", "Data final", data)], responses: { "200": ok(ref("Indicadores")), ...errosInternos } }),
  },
  "/api/v1/relatorios/{tipo}": {
    get: op({
      tags: ["Relatórios"], summary: "Gera relatório em PDF ou XLSX (cabeçalho institucional)",
      parameters: [
        { name: "tipo", in: "path", required: true, schema: { type: "string", examples: ["indicadores-municipio", "processos", "licencas", "vencimentos", "fiscalizacoes", "autos"] } },
        { name: "formato", in: "query", required: true, schema: enumStr("pdf", "xlsx") }, filtroMun, q("de", "Data inicial", data), q("ate", "Data final", data),
      ],
      responses: {
        "200": { description: "Arquivo", content: { "application/pdf": { schema: { type: "string", format: "binary" } }, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { schema: { type: "string", format: "binary" } } } },
        ...erros(401, 403, 404, 422, 500),
      },
    }),
  },

  // ───────────── Administração / portabilidade ─────────────
  "/api/v1/admin/exportacoes": {
    post: op({ tags: ["Administração"], summary: "Solicita exportação completa (job assíncrono)", description: "ADMIN e SEMA_INEMA. ZIP com CSV e JSON por tabela, dicionário de dados, anexos e manifest.json.", requestBody: corpo(ref("ExportacaoSolicitar"), false), responses: { "202": ok(ref("Exportacao"), "Aceita"), ...erros(401, 403, 422, 500) } }),
  },
  "/api/v1/admin/exportacoes/{id}": {
    get: op({ tags: ["Administração"], summary: "Situação da exportação / link de download", parameters: [pId()], responses: { "200": ok(ref("Exportacao")), ...erros(401, 403, 404, 500) } }),
  },

  // ───────────── Integração (P2) ─────────────
  "/api/v1/integracao/seia/processos": {
    get: op({
      tags: ["Integração"], summary: "(P2) Feed de processos para SEMA/INEMA (SEIA) – somente leitura",
      description: "Formato **provisório** `LicenciaGov-SEIA v0` (a confirmar com SEMA/INEMA; também no cabeçalho `X-LicenciaGov-Formato`). Usuários internos com permissão de ver processos (consumidor previsto: SEMA_INEMA; também ADMIN), sempre no escopo de municípios do usuário. Somente processos protocolados, ordenados por `datas.atualizado_em` (sincronização incremental: guarde o maior valor recebido e use-o em `desde`). Não inclui despachos, pareceres nem observações internas; CPF/CNPJ do requerente sempre mascarado. Documentos: licenças, autorizações, certidões, notificações e autos (sem pareceres/ofícios/recibos).",
      parameters: [
        q("desde", "Processos alterados (ou com documento alterado) desde esta data/hora ISO 8601", dataHora),
        q("municipio", "Sigla do município (ex.: LOR). Fora do escopo → 403; inexistente → 422."),
        q("status", "Status do processo", enumStr("PROTOCOLADO", "EM_TRIAGEM", "AGUARDANDO_REQUERENTE", "EM_ANALISE", "AGUARDANDO_VISTORIA", "AGUARDANDO_DECISAO", "DEFERIDO", "INDEFERIDO", "CONCLUIDO", "ARQUIVADO")),
        ...paginacao,
      ],
      responses: { "200": ok(ref("PaginaSeiaProcesso")), ...errosInternos },
    }),
  },

  // ───────────── Operação ─────────────
  "/api/health": {
    get: op({ tags: ["Operação"], summary: "Health check (banco + storage) – monitor externo a cada 1 min", ...publico, responses: { "200": ok(obj({ status: enumStr("ok", "degradado"), db: bool, storage: bool, latencia_ms: { type: "integer" }, em: dataHora })), "503": { description: "Degradado (mesmo corpo, status=degradado)" } } }),
  },
};

// operationId estável: <método>_<caminho> (ex.: get_processos_id_acoes_acao)
for (const [caminho, metodos] of Object.entries(paths)) {
  for (const [metodo, o] of Object.entries(metodos as Record<string, Obj>)) {
    const base = caminho.replace(/^\/api\/(v1\/)?/, "").replace(/[{}]/g, "").replace(/[^a-zA-Z0-9]+/g, "_");
    o.operationId ??= `${metodo}_${base}`;
  }
}

export function documentoOpenApi(servidor?: string): Obj {
  return {
    openapi: "3.1.0",
    info: {
      title: "LicenciaGov API",
      version: "1.0.0",
      description:
        "API REST do LicenciaGov (licenciamento e fiscalização ambiental multi-município).\n\n" +
        "- **Autenticação**: `Authorization: Bearer <access_token>` obtido em `POST /api/v1/auth/login` (15 min; renove com `/auth/refresh`).\n" +
        "- **Escopo**: toda rota interna aplica o escopo de município do usuário; registro fora do escopo → 403.\n" +
        "- **Paginação**: `?page=1&size=20` (máx. 200); respostas `{items, page, size, total}`.\n" +
        "- **Erros**: sempre `{code, message, details}` (ex.: `NAO_AUTENTICADO`, `PROIBIDO`, `NAO_ENCONTRADO`, `INVALIDO`).\n" +
        "- Datas em ISO 8601 (UTC); valores monetários em reais (número decimal).",
      contact: { name: "VALLETECLAB – suporte LicenciaGov" },
    },
    servers: [{ url: servidor || "/", description: "Este ambiente" }],
    security: [{ bearerAuth: [] }],
    tags: ["Autenticação", "Cadastros", "Processos", "Documentos", "Público", "Fiscalização", "Dashboard", "Relatórios", "Administração", "Integração", "Operação"].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT", description: "Access token de /api/v1/auth/login" },
        cookieAuth: { type: "apiKey", in: "cookie", name: "lg_access", description: "Sessão do navegador (mesma origem)" },
      },
      parameters: {
        page: { name: "page", in: "query", required: false, description: "Página (1..n)", schema: { type: "integer", minimum: 1, default: 1 } },
        size: { name: "size", in: "query", required: false, description: "Itens por página", schema: { type: "integer", minimum: 1, maximum: 200, default: 20 } },
      },
      responses: {
        Erro401: erroResp("Não autenticado", { code: "NAO_AUTENTICADO", message: "Autenticação necessária.", details: null }),
        Erro403: erroResp("Sem permissão ou fora do escopo de município", { code: "PROIBIDO", message: "Acesso negado.", details: null }),
        Erro404: erroResp("Não encontrado", { code: "NAO_ENCONTRADO", message: "Registro não encontrado.", details: null }),
        Erro409: erroResp("Conflito (duplicidade ou transição inválida)", { code: "CONFLITO", message: "Transição não permitida no status atual.", details: { status: "EM_ANALISE" } }),
        Erro413: erroResp("Arquivo acima de 25 MB", { code: "ARQUIVO_GRANDE", message: "Arquivo acima do limite de 25 MB.", details: null }),
        Erro415: erroResp("Tipo de arquivo não permitido", { code: "TIPO_NAO_PERMITIDO", message: "Tipo de arquivo não permitido.", details: null }),
        Erro422: erroResp("Dados inválidos", { code: "INVALIDO", message: "Dados inválidos.", details: [{ path: ["email"], message: "E-mail inválido" }] }),
        Erro429: erroResp("Muitas requisições", { code: "LIMITE_REQUISICOES", message: "Muitas tentativas. Aguarde.", details: null }),
        Erro500: erroResp("Erro interno", { code: "ERRO_INTERNO", message: "Erro interno.", details: null }),
      },
      schemas,
    },
  };
}
