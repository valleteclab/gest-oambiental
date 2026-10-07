// Dicionário de dados gerado a partir do DMMF do Prisma (SPEC 9.2 – exportação completa).
import { Prisma } from "@prisma/client";

/** Colunas que NUNCA saem na exportação (segredos). */
export const COLUNAS_EXCLUIDAS: Record<string, string[]> = {
  Usuario: ["senha_hash"],
  ConfigCobranca: ["asaas_api_key_cifrada", "asaas_webhook_token"],
  CertificadoDigital: ["pfx_cifrado", "senha_cifrada"],
  GedAssinante: ["otp_hash", "otp_expira_em", "otp_tentativas"], // segredo temporário de assinatura – nunca exportar
};

/** Colunas exportadas CIFRADAS (AES-256-GCM, formato v1:iv:tag:dados). Decifrar exige a DATA_KEY do órgão. */
export const COLUNAS_CIFRADAS: Record<string, string[]> = {
  Usuario: ["cpf_cifrado"],
  Pessoa: ["cpf_cnpj_cifrado", "email (quando PF)", "telefone (quando PF)"],
  Denuncia: ["contato"],
  CanalAtendimento: ["webhook_secret", "config (chave segredos)"],
  Conversa: ["destino_cifrado", "contato_cifrado"],
  CertificadoDigital: ["documento_titular"],
  GedMembro: ["telefone_cifrado"],
  GedProtocolo: ["interessado_nome_cifrado", "interessado_doc_cifrado", "interessado_email_cifrado", "interessado_telefone_cifrado"],
};

export const DESCRICAO_TABELA: Record<string, string> = {
  Organizacao: "Consórcio/organização titular do sistema.",
  Municipio: "Municípios consorciados (tenant); todo registro de negócio pertence a um município.",
  Usuario: "Usuários do sistema (internos e requerentes). senha_hash NÃO é exportado.",
  UsuarioPapel: "Papéis (perfis) do usuário, opcionalmente restritos a um município.",
  Tipologia: "Tipologias de atividades licenciáveis (CEPRAM 4.327/2013), faixas de porte e potencial poluidor.",
  TipoAto: "Tipos de ato administrativo (LP, LI, LO, AA, certidões…), validade e prazos de análise.",
  DocumentoExigido: "Documentos exigidos por tipo de ato/tipologia.",
  ChecklistModelo: "Modelos de checklist de análise.",
  PrazoConfig: "Prazos por etapa (dias, dias de alerta, dias úteis); município sobrepõe organização.",
  Feriado: "Feriados (nacionais quando municipio_id nulo) usados no cálculo de dias úteis.",
  ModeloDocumento: "Modelos HTML dos documentos oficiais.",
  Sequencia: "Sequenciais de numeração por município/tipo/ano.",
  Pessoa: "Pessoas físicas e jurídicas (requerentes, autuados, RTs). Dados pessoais de PF cifrados.",
  ResponsavelTecnico: "Responsáveis técnicos e registro no conselho profissional.",
  Empreendimento: "Empreendimentos/atividades, localização, tipologia, porte e potencial poluidor.",
  EmpreendimentoRt: "Vínculo histórico entre empreendimento e responsável técnico.",
  Processo: "Processos de licenciamento, status, etapa, prazos e responsáveis.",
  Tramitacao: "Linha do tempo imutável do processo (transições de status e despachos).",
  Anexo: "Arquivos enviados (processo, pendência, fiscalização, fotos de denúncias pelo assistente). Conteúdo em anexos/{storage_key}.",
  Pendencia: "Pendências/exigências ao requerente e respostas.",
  ChecklistPreenchido: "Checklists de análise preenchidos.",
  Parecer: "Pareceres técnicos.",
  Condicionante: "Condicionantes das licenças e situação de cumprimento.",
  DocumentoOficial: "Documentos oficiais emitidos (licenças, autos, notificações…), com hash do PDF e código verificador. PDF em anexos/{storage_key}.",
  Denuncia: "Denúncias ambientais recebidas.",
  Fiscalizacao: "Fiscalizações/vistorias com geolocalização.",
  AutoInfracao: "Autos de infração.",
  Notificacao: "Notificações ambientais e prazos.",
  Conselho: "Conselhos municipais de meio ambiente.",
  ReuniaoConselho: "Reuniões dos conselhos e deliberações.",
  Alerta: "Alertas de prazo gerados pelo motor de prazos.",
  EmailEnviado: "Trilha de e-mails transacionais enviados.",
  LogAuditoria: "Log de auditoria imutável de todas as ações.",
  Exportacao: "Solicitações de exportação completa (portabilidade).",
  BackupRegistro: "Registros de backups e testes de restauração.",
  ChamadoSuporte: "Chamados de suporte (SLA).",
  CanalAtendimento: "Canais do assistente de denúncias (WhatsApp, chat do site, e-mail). Credenciais e segredo do webhook cifrados.",
  Conversa: "Conversas do assistente de denúncias (máquina de estados, dados coletados, consentimento LGPD). Contato cifrado + hash.",
  MensagemConversa: "Mensagens das conversas (cidadão, IA, atendente). Mídias em anexos/{midia_key} não são copiadas; as fotos da denúncia estão em anexo.",
  EventoWebhook: "Caixa bruta de webhooks (transitória) – NÃO exportada por organização (somente cabeçalho).",
  UsoIa: "Consumo de IA (tokens e custo estimado em US$) por organização.",
  AlertaDesmatamento: "Alertas de desmatamento por satélite (INPE DETER/PRODES, MapBiomas) do município: polígono (GeoJSON WGS84), área, cruzamento com CAR e licenças locais, sugestão e situação do tratamento.",
  MonitoramentoSync: "Execuções da sincronização do monitoramento por satélite (origem, situação, resumo por fonte).",
  ConfigCobranca: "Configuração de cobrança de taxas do município (gateway Asaas, vencimento, bloqueio de etapa). Chave da API e token do webhook NÃO são exportados.",
  TabelaTaxa: "Tabela de taxas de licenciamento: tipo de ato × fase × porte × potencial poluidor → valor.",
  Cobranca: "Cobranças (DAM) de taxas por processo e fase: Pix/boleto via Asaas ou baixa manual, situação e pagamento.",
  GedConfig: "GED – configuração do cliente (cota, cota mensal de páginas de OCR, canal de WhatsApp, prazos de assinatura, retenção de logs).",
  GedMembro: "GED – membros do cliente e seu papel no módulo (administrador, gestor, usuário, leitor, auditor). Telefone cifrado.",
  GedSetor: "GED – setores/grupos do cliente (usados em permissões e trâmite).",
  GedSetorMembro: "GED – participação de usuários nos setores.",
  GedTipoDocumento: "GED – tipos de documento cadastrados pelo cliente.",
  GedPasta: "GED – árvore de pastas (caminho materializado, herança de permissões, sensibilidade padrão).",
  GedDocumento: "GED – documentos: título, remetente, data, status, sensibilidade, dados pessoais e anonimização (original × versão anonimizada).",
  GedVersaoDocumento: "GED – versões do arquivo/texto de cada documento (sha256, origem, selada). Arquivos em anexos/{storage_key}.",
  GedConteudoTexto: "GED – texto extraído (ou por OCR) para busca; a coluna de índice de busca (tsv) não é exportada.",
  GedDeteccaoDadoPessoal: "GED – detecções de dados pessoais sugeridas (tipo e quantidade; não guarda o dado detectado).",
  GedMarcador: "GED – marcadores (tags) personalizáveis.",
  GedDocumentoMarcador: "GED – vínculo documento × marcador.",
  GedAcl: "GED – permissões por pasta ou documento (usuário ou setor × ações).",
  GedTramite: "GED – histórico imutável de trâmite (envio, despacho, ciência, devolução, recusa).",
  GedSolicitacaoAssinatura: "GED – solicitações de assinatura (versão alvo, hash, modo, prazo, status).",
  GedAssinante: "GED – signatários e seus atos (assinou/recusou, data/hora, método, hashes e cadeia). Segredos de OTP não são exportados.",
  GedComentario: "GED – comentários em documentos e assinaturas (imutáveis).",
  GedAcessoLog: "GED – registro de acessos (visualizar, baixar, buscar, negado).",
  GedImportacao: "GED – lotes de importação de ZIP: arquivo, pasta de destino, situação e contadores (o ZIP é removido ao fim).",
  GedImportacaoItem: "GED – relatório da importação em lote: um item por arquivo do ZIP (importado, duplicado, ignorado ou com erro e o motivo).",
  GedComunicacao: "GED – comunicações enviadas (e-mail/WhatsApp): evento, destinatário mascarado, data/hora e situação.",
  GedPreferenciaNotificacao: "GED – preferências de notificação por usuário e evento.",
  GedProtocolo: "GED – livro de protocolo (entrada, saída, interno): número, assunto, situação, destino e comprovante. Dados pessoais do interessado cifrados; registro imutável.",
  GedProtocoloEvento: "GED – andamento imutável do protocolo (registro, análise, encaminhamento, resposta, arquivamento, devolução, indeferimento).",
  GedProtocoloDocumento: "GED – anexos do protocolo (documento, versão, nome, tamanho e sha256 do arquivo no ato).",
  GedProtocoloAssunto: "GED – assuntos oferecidos no portal público de protocolo e o setor de destino de cada um.",
  GedExclusao: "GED – execuções de exclusão controlada (documento, pasta, conteúdo de importação): alvo, modo, situação e contadores. O histórico de cada item excluído fica na auditoria.",
  GedSequencia: "GED – contador de numeração de documentos por cliente/tipo/ano.",
  CertificadoDigital: "Certificados digitais A1 (e-CNPJ do órgão / e-CPF do servidor) usados para assinar documentos: somente metadados; arquivo .pfx e senha NÃO são exportados.",
};

const DESCRICAO_COLUNA: Record<string, string> = {
  id: "Identificador único (UUID).",
  created_at: "Data/hora de criação (UTC).",
  updated_at: "Data/hora da última alteração (UTC).",
  created_by: "Usuário que criou o registro.",
  organizacao_id: "Organização (consórcio).",
  municipio_id: "Município ao qual o registro pertence.",
  processo_id: "Processo relacionado.",
  usuario_id: "Usuário relacionado.",
  pessoa_id: "Pessoa relacionada.",
  status: "Situação do registro.",
  numero: "Número oficial.",
  latitude: "Latitude (WGS84, graus decimais).",
  longitude: "Longitude (WGS84, graus decimais).",
  storage_key: "Chave do arquivo no storage; conteúdo em anexos/{storage_key} no ZIP.",
  sha256: "Hash SHA-256 do arquivo.",
  sha256_pdf: "Hash SHA-256 do PDF emitido.",
  prazo_ate: "Data-limite.",
  prazo_etapa_ate: "Data-limite da etapa atual do processo.",
  validade_ate: "Fim da validade do documento.",
  cpf_cnpj_hash: "HMAC-SHA256 do CPF/CNPJ (busca/unicidade sem expor o valor).",
  cpf_hash: "HMAC-SHA256 do CPF (busca/unicidade).",
  cpf_cnpj_mascara: "CPF/CNPJ mascarado para exibição pública.",
  codigo_verificador: "Código de autenticidade exibido no documento e em /validar.",
};

export type ColunaDicionario = {
  coluna: string;
  campo_prisma: string;
  tipo: string;
  obrigatorio: boolean;
  lista: boolean;
  chave_primaria: boolean;
  unico: boolean;
  padrao: string | null;
  referencia: string | null;
  cifrada: boolean;
  descricao: string;
};
export type TabelaDicionario = { tabela: string; modelo: string; descricao: string; colunas: ColunaDicionario[] };

export function modelos() {
  return Prisma.dmmf.datamodel.models;
}

export const nomeTabela = (m: { name: string; dbName: string | null }) => m.dbName ?? m.name;

/** Campos escalares/enum exportados de um modelo (sem os excluídos). */
export function camposExportados(m: (typeof Prisma.dmmf.datamodel.models)[number]) {
  const excl = COLUNAS_EXCLUIDAS[m.name] ?? [];
  return m.fields.filter((f) => (f.kind === "scalar" || f.kind === "enum") && !excl.includes(f.name));
}

export function gerarDicionario(): { tabelas: TabelaDicionario[]; enums: { nome: string; valores: string[] }[] } {
  const ms = modelos();
  const tabelas = ms.map((m) => {
    const fks = new Map<string, string>();
    for (const f of m.fields) {
      if (f.kind === "object" && f.relationFromFields?.length) {
        const alvo = ms.find((x) => x.name === f.type);
        f.relationFromFields.forEach((col, i) => fks.set(col, `${alvo ? nomeTabela(alvo) : f.type}.${f.relationToFields?.[i] ?? "id"}`));
      }
    }
    const cifradas = (COLUNAS_CIFRADAS[m.name] ?? []).map((c) => c.split(" ")[0]);
    const colunas: ColunaDicionario[] = camposExportados(m).map((f) => {
      const cifrada = cifradas.includes(f.name);
      const padrao = f.hasDefaultValue ? (typeof f.default === "object" && f.default && "name" in f.default ? `${(f.default as { name: string }).name}()` : JSON.stringify(f.default)) : null;
      const desc = DESCRICAO_COLUNA[f.name] ?? (f.name.endsWith("_id") ? `Referência a ${fks.get(f.name) ?? f.name.replace(/_id$/, "")}.` : "");
      return {
        coluna: f.dbName ?? f.name,
        campo_prisma: f.name,
        tipo: f.kind === "enum" ? `enum ${f.type}` : f.type,
        obrigatorio: f.isRequired,
        lista: f.isList,
        chave_primaria: f.isId,
        unico: f.isUnique,
        padrao,
        referencia: fks.get(f.name) ?? null,
        cifrada,
        descricao: [desc, cifrada ? "CIFRADO (AES-256-GCM) – exportado como está no banco." : ""].filter(Boolean).join(" "),
      };
    });
    return { tabela: nomeTabela(m), modelo: m.name, descricao: DESCRICAO_TABELA[m.name] ?? "", colunas };
  });
  const enums = Prisma.dmmf.datamodel.enums.map((e) => ({ nome: e.name, valores: e.values.map((v) => v.name) }));
  return { tabelas, enums };
}

export function dicionarioMarkdown(d: ReturnType<typeof gerarDicionario>, geradoEm: Date): string {
  const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const l: string[] = [
    "# Dicionário de dados – LicenciaGov",
    "",
    `Gerado em ${geradoEm.toISOString()} a partir do esquema Prisma. Um arquivo CSV (UTF-8 com BOM, separador \`;\`) e um JSON por tabela em \`tabelas/\`.`,
    "",
    "- Datas/horas em ISO 8601 UTC; decimais com ponto; JSON serializado como texto no CSV.",
    "- `usuario.senha_hash` **não** é exportado (segredo).",
    "- Colunas marcadas como **cifradas** saem como estão no banco (AES-256-GCM, `v1:iv:tag:dados`); decifrar exige a `DATA_KEY` do órgão, entregue por canal separado.",
    "- Arquivos (anexos e PDFs de documentos oficiais) em `anexos/{storage_key}`; hashes em `manifest.json`.",
    "",
    "## Tabelas",
    "",
    ...d.tabelas.map((t) => `- [${t.tabela}](#${t.tabela}) – ${t.descricao}`),
    "",
  ];
  for (const t of d.tabelas) {
    l.push(`## ${t.tabela}`, "", t.descricao, "", "| Coluna | Tipo | Obrig. | PK | Único | Referência | Descrição |", "|---|---|---|---|---|---|---|");
    for (const c of t.colunas) {
      l.push(`| ${c.coluna} | ${esc(c.tipo)}${c.lista ? "[]" : ""} | ${c.obrigatorio ? "sim" : "não"} | ${c.chave_primaria ? "sim" : ""} | ${c.unico ? "sim" : ""} | ${c.referencia ?? ""} | ${esc(c.descricao)} |`);
    }
    l.push("");
  }
  l.push("## Enumerações", "");
  for (const e of d.enums) l.push(`- **${e.nome}**: ${e.valores.join(", ")}`);
  l.push("");
  return l.join("\n");
}
