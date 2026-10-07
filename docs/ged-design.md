# Módulo GED – desenho de arquitetura (v1, aprovado para construção da Fase 1)

Módulo de Gestão Eletrônica de Documentos dentro da plataforma LicenciaGov, habilitado por cliente. Requisitos de origem: Anexo VII (Prova de Conceito) de uma Câmara Municipal, 14 itens, 100% de conformidade exigida. Decisões do dono do produto: SaaS multi-cliente com **zero vazamento entre clientes**; sem cobrança/faturamento no sistema; dados de demonstração sempre fictícios; anonimização prevista no modelo e adiada na implementação.

## 1. Tenancy e isolamento

- **Tenant = `Organizacao`**. Novo campo `Organizacao.modulos ModuloPlataforma[] @default([LICENCIAMENTO])` (`LICENCIAMENTO`, `GED`). Cliente GED-only não precisa de `Municipio`.
- **Papéis GED em tabela própria** (`GedMembro` + `GedPapel`: GED_ADMIN, GED_GESTOR, GED_USUARIO, GED_LEITOR, GED_AUDITOR), sem tocar em `Papel`/`UsuarioPapel`. Motivo: novos valores em `Papel` quebram `MATRIZ`, `ROTULO_PAPEL`, zod do onboarding e telas de admin, e arriscam virar "interno" e abrir telas de licenciamento. ADMIN de licenciamento não vê documentos GED automaticamente.
- **Sessão GED**: `lib/ged/escopo.ts` com `exigirGed()` (páginas) e `ctxGedApi()` (rotas) → `CtxGed {usuario, organizacao_id, membro, setor_ids}` (memoizado por `React.cache`); exige módulo GED ativo na organização e `GedMembro` ativo. Não estender `UsuarioSessao`.
- **Rotas**: grupo `app/(ged)/ged/...` com layout e navegação próprios; API em `/api/v1/ged/*` (sempre `rota()` + `ctxGedApi()`). Redirecionamento do login: `isInterno ? /dashboard : temGed ? /ged : /meus-processos`.
- **Choke point obrigatório `lib/ged/db.ts`**: único módulo de GED autorizado a importar `lib/db`. `gedDb(orgId)` = `prisma.$extends` em todos os modelos `Ged*`, injetando `organizacao_id` em leituras/updateMany/deleteMany/count/aggregate/groupBy, no where único de `findUnique/update/delete/upsert` e em `create/createMany` (rejeita valor divergente). Lógica pura em `injetarEscopo()` (testável). `$queryRaw/$executeRaw` proibidos em GED, exceto `lib/ged/busca.ts` (exige `organizacao_id` como parâmetro).
- **Defesa em profundidade**: `organizacao_id` denormalizado, NOT NULL e primeiro campo de índice em toda tabela `Ged*`; trigger `ged_mesmo_tenant()` compara a org da linha com a do pai; storage `ged/{organizacao_id}/{ano}/{documento_id}/v{n}-{sha8}.pdf` com `lerArquivoGed(orgId,key)` exigindo o prefixo; cliente nunca envia `storage_key`; download/preview só por rota autenticada (`/api/v1/ged/documentos/[id]/arquivo`), sem URL pré-assinada, `Cache-Control: private, no-store`, `nosniff`, `X-Robots-Tag: noindex`; páginas `force-dynamic`, sem `unstable_cache`/ISR em GED. Registro de outro tenant → 404; mesmo tenant sem `VER` → 404; com `VER` sem a ação → 403.
- **Testes**: `tests/unit/ged-schema.test.ts` (todo modelo `Ged*` tem `organizacao_id`, índice com ele na frente, regra em `filtroTabela`, descrição em `DESCRICAO_TABELA`, `tsv` fora da exportação); `ged-escopo.test.ts` (`injetarEscopo`); `ged-fontes.test.ts` (varre fontes: proíbe `lib/db`, `$queryRaw`, `$executeRaw` fora da lista branca); `ged-storage.test.ts` (rejeita chave de outro tenant, `..`, URL); e2e `t16-ged-isolamento.spec.ts` (dois tenants fictícios com documentos de mesmo título; tenant B tenta por ID direto página, arquivo, versão, comentário, assinatura, log de A → 404; busca/exportação de B sem nada de A; GED-only barrado em `/dashboard` e `/processos`; usuário de licenciamento sem membro GED barrado em `/ged`).
- **RLS do Postgres: adiado** (documentar como hardening). O app conecta como superuser na Railway e superuser ignora RLS; valeria só com role `NOSUPERUSER NOBYPASSRLS` + role separado de migration + `set_config('app.org',…,true)` por transação. `organizacao_id` e `gedDb` já deixam o caminho aberto.

## 2. Schema Prisma

Todo modelo `Ged*`: `id uuid`, `organizacao_id uuid` (NOT NULL), `created_at`, `updated_at`, `@@map("ged_…")`; relações ao pai com `onDelete: Restrict`.

```prisma
enum ModuloPlataforma { LICENCIAMENTO GED }
// Organizacao: modulos ModuloPlataforma[] @default([LICENCIAMENTO]) + back-relations
// LogAuditoria: organizacao_id String? @db.Uuid + @@index([organizacao_id, created_at])

enum GedPapel { GED_ADMIN GED_GESTOR GED_USUARIO GED_LEITOR GED_AUDITOR }
enum GedStatusDocumento { RASCUNHO PUBLICADO EM_ASSINATURA ASSINADO RECUSADO ARQUIVADO }
enum GedSensibilidade { PUBLICO RESTRITO SIGILOSO }
enum GedAnonimizacao { NAO_NECESSARIA PENDENTE ANONIMIZADA }
enum GedOrigemVersao { UPLOAD EDITOR SCAN OCR ANONIMIZACAO SELO }
enum GedStatusTexto { PENDENTE EXTRAIDO SEM_TEXTO OCR_PENDENTE ERRO }
enum GedAcao { VER EDITAR ASSINAR TRAMITAR ADMINISTRAR ANONIMIZAR }
enum GedPrincipalTipo { USUARIO SETOR }
enum GedTipoTramite { ENVIO DESPACHO CIENCIA DEVOLUCAO RECUSA ARQUIVAMENTO }
enum GedModoAssinatura { SEQUENCIAL PARALELO }
enum GedStatusSolicitacao { ABERTA CONCLUIDA RECUSADA CANCELADA EXPIRADA }
enum GedStatusAssinante { AGUARDANDO PENDENTE ASSINADO RECUSADO EXPIRADO }
enum GedMetodoAssinatura { ELETRONICA_AVANCADA ICP_BRASIL_A1 }
enum GedCanalCom { EMAIL WHATSAPP }
enum GedStatusCom { PENDENTE ENVIADA SIMULADA ERRO IGNORADA }

model GedConfig {                         // 1 por tenant
  organizacao_id String @unique @db.Uuid
  cota_bytes BigInt?
  ia_habilitada Boolean @default(false)   // LGPD: IA opcional (fase 2)
  canal_whatsapp_id String? @db.Uuid      // CanalAtendimento (somente envio)
  assinatura_prazo_dias Int @default(15)
  lembrete_dias Int[] @default([3,1,0])
  retencao_acesso_log_dias Int @default(730)
  @@map("ged_config")
}
model GedMembro {
  usuario_id String @db.Uuid
  papel GedPapel
  ativo Boolean @default(true)
  telefone_cifrado String?                // lib/crypto cifrar; E.164
  whatsapp_optin_em DateTime?             // só após confirmação por código
  @@unique([organizacao_id, usuario_id])
  @@map("ged_membro")
}
model GedSetor { nome String; sigla String; ativo Boolean @default(true)
  @@unique([organizacao_id, sigla]) @@map("ged_setor") }
model GedSetorMembro { setor_id String @db.Uuid; usuario_id String @db.Uuid; chefe Boolean @default(false)
  @@unique([setor_id, usuario_id]) @@index([organizacao_id, usuario_id]) @@map("ged_setor_membro") }
model GedTipoDocumento { nome String; @@unique([organizacao_id, nome]) @@map("ged_tipo_documento") }

model GedPasta {
  parent_id String? @db.Uuid
  nome String
  caminho_ids String[] @db.Uuid           // ancestrais + si (materializado)
  caminho_heranca String[] @db.Uuid       // de acl_raiz (herda_acl=false mais próximo) até si
  caminho_nome String                     // "Controle interno/Relatórios"
  herda_acl Boolean @default(true)
  sensibilidade_padrao GedSensibilidade @default(RESTRITO)
  excluido_em DateTime?
  @@index([organizacao_id, parent_id])
  // raw SQL: GIN(caminho_ids), GIN(caminho_heranca); UNIQUE(org,parent_id,lower(nome)) + parcial p/ parent NULL
  @@map("ged_pasta")
}
model GedDocumento {
  pasta_id String? @db.Uuid
  numero String                           // {SIGLA}-DOC-2026-000123 (GedSequencia)
  titulo String
  tipo_id String? @db.Uuid
  remetente String?                       // origem/remetente
  data_documento DateTime? @db.Date
  status GedStatusDocumento @default(RASCUNHO)
  criado_por_id String @db.Uuid
  versao_atual_id String? @db.Uuid
  setor_atual_id String? @db.Uuid         // trâmite: localização atual (denormalizada)
  responsavel_id String? @db.Uuid
  acl_propria Boolean @default(false)     // true = não herda ACL da pasta
  codigo_verificador String? @unique      // gerarCodigoVerificador(); só após selo
  sha256_final String?
  // Sensibilidade / LGPD / anonimização (motor futuro; modelo pronto)
  sensibilidade GedSensibilidade @default(RESTRITO)
  contem_dados_pessoais Boolean @default(false)
  anonimizacao_status GedAnonimizacao @default(NAO_NECESSARIA)
  anonimizado_por_id String? @db.Uuid
  anonimizado_em DateTime?
  documento_original_id String? @db.Uuid // derivado anonimizado → original
  excluido_em DateTime?                   // lixeira (fase 3)
  @@unique([organizacao_id, numero])
  @@unique([organizacao_id, documento_original_id])   // no máx. 1 versão anonimizada ativa
  @@index([organizacao_id, pasta_id]) @@index([organizacao_id, status])
  @@index([organizacao_id, data_documento]) @@index([organizacao_id, responsavel_id, status])
  // raw: pg_trgm GIN (titulo, remetente); CHECK(anonimizacao_status<>'PENDENTE' OR sensibilidade<>'PUBLICO')
  @@map("ged_documento")
}
model GedVersaoDocumento {
  documento_id String @db.Uuid
  n Int
  origem GedOrigemVersao
  derivada_de_id String? @db.Uuid          // OCR/ANONIMIZACAO/SELO apontam p/ a versão-base
  storage_key String; nome_arquivo String; mime String; tamanho Int; sha256 String
  paginas Int?
  conteudo_html String?                    // só origem EDITOR (sanitizado)
  texto_status GedStatusTexto @default(PENDENTE)
  selada Boolean @default(false)           // trigger: imutável quando true; DELETE bloqueado
  criado_por_id String @db.Uuid
  @@unique([documento_id, n]) @@index([organizacao_id, documento_id])
  @@map("ged_versao_documento")
}
model GedConteudoTexto {
  versao_id String @unique @db.Uuid; documento_id String @db.Uuid
  texto String; metodo String              // PDF_TEXTO | OCR | EDITOR
  tsv Unsupported("tsvector")?             // GENERATED STORED (raw SQL) + GIN
  @@index([organizacao_id, documento_id]) @@map("ged_conteudo_texto")
}
model GedDeteccaoDadoPessoal {             // gancho futuro (CPF/CNPJ/e-mail/tel/IA); NÃO guarda o dado
  versao_id String @db.Uuid; tipo String; pagina Int?; ocorrencias Int; status String @default("SUGERIDA")
  @@index([organizacao_id, versao_id]) @@map("ged_deteccao_dado_pessoal")
}
model GedMarcador { nome String; cor String @default("#0f766e")
  @@unique([organizacao_id, nome]) @@map("ged_marcador") }       // + UNIQUE(org, lower(nome)) raw
model GedDocumentoMarcador { documento_id String @db.Uuid; marcador_id String @db.Uuid
  @@unique([documento_id, marcador_id]) @@index([organizacao_id, marcador_id]) @@map("ged_documento_marcador") }

model GedAcl {                             // CHECK raw: exatamente 1 recurso e 1 principal
  pasta_id String? @db.Uuid; documento_id String? @db.Uuid
  principal_tipo GedPrincipalTipo; usuario_id String? @db.Uuid; setor_id String? @db.Uuid
  acoes GedAcao[]
  expira_em DateTime?; concedido_por_id String @db.Uuid
  @@index([organizacao_id, pasta_id]) @@index([organizacao_id, documento_id])
  @@index([organizacao_id, usuario_id]) @@index([organizacao_id, setor_id]) @@map("ged_acl")
}
model GedTramite {                         // IMUTÁVEL (trigger bloqueia_alteracao)
  documento_id String @db.Uuid; tipo GedTipoTramite
  de_usuario_id String? @db.Uuid; de_setor_id String? @db.Uuid
  para_usuario_id String? @db.Uuid; para_setor_id String? @db.Uuid
  despacho String?; prazo_em DateTime?
  referencia_id String? @db.Uuid           // CIENCIA → tramite de ENVIO que ciencia
  @@index([organizacao_id, documento_id, created_at]) @@index([organizacao_id, para_usuario_id, created_at])
  @@map("ged_tramite")
}
model GedSolicitacaoAssinatura {
  documento_id String @db.Uuid; versao_id String @db.Uuid   // versão exata a assinar
  sha256_alvo String                       // snapshot do hash
  modo GedModoAssinatura; status GedStatusSolicitacao @default(ABERTA)
  prazo_em DateTime; mensagem String?; criada_por_id String @db.Uuid
  concluida_em DateTime?; versao_selo_id String? @db.Uuid
  @@index([organizacao_id, status, prazo_em]) @@index([organizacao_id, documento_id])
  @@map("ged_solicitacao_assinatura")
}
model GedAssinante {                       // imutável após ASSINADO/RECUSADO (trigger)
  solicitacao_id String @db.Uuid; usuario_id String @db.Uuid
  ordem Int; rotulo String @default("Assinar")
  status GedStatusAssinante @default(PENDENTE)
  visualizou_em DateTime?; ultimo_lembrete_em DateTime?
  assinado_em DateTime?; recusado_em DateTime?
  comentario String?; justificativa_recusa String?
  metodo GedMetodoAssinatura?; reautenticacao String?       // SENHA | OTP_EMAIL | OTP_WHATSAPP
  ip String?; user_agent String?
  hash_documento String?                   // sha256 recalculado do arquivo no ato
  hash_cadeia String?                      // sha256(hash_anterior|assinante|usuario|hash_doc|data|metodo)
  otp_hash String?; otp_expira_em DateTime?; otp_tentativas Int @default(0)
  @@unique([solicitacao_id, usuario_id]) @@index([organizacao_id, usuario_id, status])
  @@map("ged_assinante")
}
model GedComentario {                      // append-only (trigger)
  documento_id String @db.Uuid; versao_id String? @db.Uuid; solicitacao_id String? @db.Uuid
  autor_id String @db.Uuid; contexto String  // GERAL | ASSINATURA | RECUSA | TRAMITE
  texto String
  @@index([organizacao_id, documento_id, created_at]) @@map("ged_comentario")
}
model GedAcessoLog {                       // alto volume
  id BigInt @id @default(autoincrement())
  usuario_id String? @db.Uuid; documento_id String? @db.Uuid; versao_id String? @db.Uuid
  acao String                              // VISUALIZAR BAIXAR BUSCAR LISTAR NEGADO LOGIN_GED
  ip String?; user_agent String?
  @@index([organizacao_id, created_at]) @@index([organizacao_id, documento_id, created_at])
  @@map("ged_acesso_log")                  // BRIN(created_at) raw; retenção por job; particionar por mês se >50M linhas
}
model GedComunicacao {
  documento_id String? @db.Uuid; assinante_id String? @db.Uuid; usuario_id String @db.Uuid
  evento String; canal GedCanalCom; destinatario_mascarado String
  assunto String?; status GedStatusCom @default(PENDENTE); erro String?
  provider_message_id String?; email_enviado_id String? @db.Uuid  // sem FK (EmailEnviado não tem org)
  enviado_em DateTime?                     // data/hora real do envio
  @@index([organizacao_id, created_at]) @@index([organizacao_id, documento_id])
  @@map("ged_comunicacao")
}
model GedPreferenciaNotificacao { usuario_id String @db.Uuid; evento String
  email Boolean @default(true); whatsapp Boolean @default(false)
  @@unique([usuario_id, evento]) @@map("ged_preferencia_notificacao") }
model GedSequencia { tipo String; ano Int; ultimo Int @default(0)
  @@unique([organizacao_id, tipo, ano]) @@map("ged_sequencia") }
```

**Migration (raw SQL, orquestrador):** `CREATE EXTENSION IF NOT EXISTS unaccent, pg_trgm`; função `ged_unaccent()` IMMUTABLE; coluna `tsv` gerada (`to_tsvector('portuguese', ged_unaccent(texto))`) + GIN; GIN em `caminho_ids`/`caminho_heranca`; trigram em título/remetente; CHECKs de ACL e anonimização; triggers `ged_mesmo_tenant()`, `bloqueia_alteracao()` em `ged_tramite` e `ged_comentario`, imutabilidade de `ged_versao_documento` (quando `selada`) e `ged_assinante` (quando decidido); índice parcial único de pasta raiz.

**Reutilização:** `EmailEnviado` via `enviarEmail()` (vínculo em `GedComunicacao.email_enviado_id`); `CanalAtendimento` como credencial de WhatsApp (`municipio_id` nulo, `config.somente_envio="true"`, e `lib/agente/ingestao.ts` ignora eventos de canais `somente_envio`; não registrar webhook no provedor); `LogAuditoria` via `auditar()` (com `organizacao_id` novo); `CertificadoDigital` titular ORGAO (`municipio_id` nulo) para o selo; `UsoIa` na fase 2. **Não** reutilizar `DocumentoOficial` (ciclo de vida diferente).

## 3. Fluxo de assinatura

Cada signatário assina com **assinatura eletrônica avançada** (Lei 14.063/2020) com evidências no banco; o PDF final recebe o **selo PAdES A1 do órgão** (e-CNPJ da organização). Não prometer assinatura qualificada por signatário.

1. Autor abre solicitação sobre uma versão: grava `sha256_alvo`, documento vira `EM_ASSINATURA`, edição bloqueada (editar cancela a solicitação e cria nova versão).
2. Escolhe signatários (usuários do tenant com `ASSINAR`), modo SEQUENCIAL/PARALELO e prazo; em sequencial só o da vez fica `PENDENTE`.
3. Comentários antes e durante (`GedComentario`, contexto `ASSINATURA`).
4. **Assinar**: reautenticação (senha ou OTP de 6 dígitos por e-mail/WhatsApp, guardado só como hash, 10 min, máx. 5 tentativas); relê o arquivo e recalcula sha256 (aborta se ≠ `sha256_alvo`); grava `assinado_em` (servidor), ip, user-agent, método, `hash_documento` e `hash_cadeia = sha256(hash_cadeia_anterior || assinante_id || usuario_id || hash_documento || assinado_em || metodo)` (primeiro elo usa `sha256_alvo`); tudo numa transação com `auditar()` e `GedTramite`.
5. **Recusar**: justificativa obrigatória (≥10 caracteres); `RECUSADO`; solicitação encerra (também no paralelo); documento `RECUSADO`; autor notificado; registro em `GedTramite` (RECUSA) e `LogAuditoria`.
6. **Conclusão** → `selarDocumento`: folha de assinaturas via `htmlParaPdf` (signatários com nome abreviado, data/hora, método, hashes da cadeia, QR, código verificador); QR no rodapé de cada página com `pdf-lib`; PAdES com `certificadoParaOrganizacao(orgId)` (em `lib/ged/assinaturas`, usando `abrirCertificado`/`assinarComCertificado` já exportados, sem editar `lib/assinatura`); sem certificado → eletrônica avançada com aviso visível; cria versão `origem=SELO`, `selada=true`, `derivada_de_id` = original; grava `sha256_final`, `codigo_verificador`, status ASSINADO.
7. **Verificação pública** `/verificar/[codigo]` (página nova, sem login; não editar `/validar`): órgão, nº, data de selagem, signatários (nome abreviado, método, horário), cadeia de hashes; título só se `sensibilidade=PUBLICO`; o navegador calcula o sha256 do PDF escolhido (WebCrypto, sem upload) e compara com `sha256_final`/`sha256_alvo`; servidor recalcula a cadeia e roda `verificarAssinaturaPdf`; link para validar.iti.gov.br; rate limit por IP (nos moldes de `lib/limite-login.ts`).
8. **Painel** `/ged/assinaturas`: abas "Aguardando minha assinatura", "Enviadas por mim", "Concluídas", "Recusadas".
9. **Lembretes/expiração**: job `ged-assinaturas` (horário) — lembretes conforme `lembrete_dias`; após `prazo_em` → EXPIRADA e notifica o autor.

Limites declarados: tempo da assinatura individual é do servidor (sem carimbo RFC 3161); PAdES-B-B sem LTV; assinatura ICP por signatário exige PAdES incremental (`pdf-lib` regrava o arquivo e quebra selos anteriores) → spike futuro.

## 4. Notificações

- **Outbox**: o evento grava `GedComunicacao` `PENDENTE` na mesma transação; job `ged-notificar` envia e atualiza `status/enviado_em/provider_message_id` (não bloqueia o request). Eventos: trâmite recebido, assinatura solicitada/concluída/recusada, lembrete, expirada, documento compartilhado.
- **E-mail**: templates puros em `lib/ged/templates.ts`; `enviarEmail()`; corpo com "Enviado em dd/mm/aaaa às HH:mm (horário de Brasília)" e link `/ged/documentos/{id}`; **sem anexos**; título só se não for SIGILOSO.
- **WhatsApp**: `carregarCanal` + `provedor(tipo).sendText` dentro de `comRitmo`; `envioSimulado()` grava `SIMULADA`; destino = `GedMembro.telefone_cifrado`; **opt-in** confirmado por código antes de enviar; canal oficial fora da janela de 24h → `IGNORADA` (igual a `lib/agente/envio.ts`); fase 1 usa Evolution/Z-API.
- Logs de comunicação em `/ged/logs`; preferências em `/ged/minha-conta/notificacoes`.

## 5. Editor de texto

TipTap (`@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit` + tabela/alinhamento), MIT; confirmar compatibilidade com a versão de React antes de instalar. Componente cliente com `dynamic(..., {ssr:false})`; HTML sanitizado no servidor (se `sanitizarHtml` não cobrir tabelas/títulos, criar wrapper em `lib/ged/editor`, sem editar `render.ts`); autosave na versão RASCUNHO; "Finalizar" gera PDF com `htmlParaPdf` (cabeçalho do órgão), versão `origem=EDITOR`, texto indexado direto.

## 6. Busca e OCR

- **Fase 1**: `pdftotext`/`pdfinfo` (poppler-utils, apt) via `execFile` no worker (instalar nos estágios `worker` de `Dockerfile` e `Dockerfile.worker`); job `ged-extrair-texto {versao_id}` + varredura de `PENDENTE`; < ~25 caracteres/página → `SEM_TEXTO` (candidato a OCR); UI "Indexando…". Testes de extração condicionais à presença de `pdftotext`.
- **Consulta** (`lib/ged/busca.ts`, único SQL cru): `c.organizacao_id=$1 AND c.tsv @@ websearch_to_tsquery('portuguese', ged_unaccent($q))` com `ts_rank`/`ts_headline`; filtros de título/remetente (trigram), data, tipo, marcador, pasta; visibilidade (§7) no mesmo SQL.
- **Fase 2 (OCR)** – *implementada* (detalhes e operação em `docs/ged.md` §13): fila `ged-ocr` (`jobs/ged-ocr.ts`, `singletonKey` por versão, worker dedicado com `JOBS_FILAS=ged-ocr`), imagem do worker com `ocrmypdf tesseract-ocr tesseract-ocr-por ghostscript qpdf unpaper` (+400–600 MB), `ocrmypdf -l por --skip-text --jobs 2`, nova versão `origem=OCR` (`derivada_de_id` = scan, que permanece), texto em `GedConteudoTexto` (`metodo=OCR`). Estado por versão-base em `GedVersaoDocumento.ocr_status` (`GedStatusOcr`: PENDENTE, PROCESSANDO, CONCLUIDO, OCR_INDISPONIVEL, COTA_EXCEDIDA, ERRO) + `ocr_mensagem`; cota de páginas por mês em `GedConfig.ocr_cota_paginas_mes` (padrão 5000; consumo = soma das páginas das versões OCR do mês). Decisões: (a) OCR **não** cancela solicitação de assinatura aberta e nunca roda em versão selada/documento assinado; (b) a versão OCR vira a atual, o scan segue baixável com o mesmo sha256; (c) binário ausente degrada para `OCR_INDISPONIVEL` sem afetar o upload; (d) o web só executa o OCR inline se não houver worker e tiver o binário.

### Fase 2 – Importação em lote de ZIP

Decisões (detalhe operacional em `docs/ged.md` §12):
- **Estrutura do ZIP = árvore de pastas.** O fluxo do dono é digitalizar no Windows, organizar por cliente (licitação, pagamentos, controle interno) e enviar cópias mensais; por isso o lote importa pastas **e** documentos, reaproveita pastas já existentes (mesmo nome, sem diferenciar maiúsculas) e **deduplica por sha256 dentro da organização**, de modo que reenviar a cópia do mês só traz o que é novo.
- **Leitor de ZIP próprio** (`lib/ged/importacao/zip.ts`, só `node:zlib`, sem dependência nova): lê o diretório central e descompacta um arquivo por vez com teto de saída, para aplicar os limites (nº de arquivos/pastas/profundidade, soma declarada, razão de compressão) **antes** de gastar memória e conferir CRC/tamanho real. `jszip` (já no projeto) carregaria tudo em memória e não expõe esses controles.
- **Origem `UPLOAD`** (sem novo valor de enum): o documento é indistinguível de um envio manual, passa pelo antivírus e pelo mesmo `criarDocumentoUpload()` (permissões, número, versão, ACL, texto/OCR, auditoria). A rastreabilidade do lote fica em `ged_importacao_item` (caminho original → documento).
- **Lote registrado** (`ged_importacao` + `ged_importacao_item`, `organizacao_id` NOT NULL, `ged_mesmo_tenant`, índice `(organizacao_id, sha256)` em `ged_versao_documento` para a deduplicação). Execução assíncrona pelo job `ged-importar` (varredura de pendentes, retomável por `ordem`); ZIP temporário em `ged/{org}/importacao/{id}.zip`, removido ao fim.
- **Permissão**: capacidade `importar` = GED_ADMIN e GED_GESTOR (cria estrutura em massa). ACL: o documento herda a da pasta de destino; quem importa recebe a ACL de criador, como em qualquer upload.
- **Fora desta fase**: formatos além de PDF e metadados por planilha (data/remetente).

### Importação v2 – pasta, ZIP grande e ZIP aninhado
- **Pasta direto do navegador** (`webkitdirectory` + arrastar-e-soltar): lote `RECEBENDO` + um `POST` por arquivo (`/importacoes/{id}/arquivos`), idempotente por caminho, com sha256 conferido; `concluir` fecha o lote. A fila de trabalho é o banco (`ged_importacao_item` `RECEBIDO`), então a memória é constante e a retomada trivial (`GET …/recebidos`).
- **ZIP grande**: envio em partes de 8 MB (proxies cortam requisições longas), remontagem em disco temporário no job e leitura por posição (`ZipDisco`, ZIP64). Escolha: partes como objetos no storage (e não arquivo local no web) porque web e worker podem ser contêineres diferentes.
- **ZIP aninhado**: ZIP com pasta irmã de mesmo nome-base = cópia da pasta → ignorado; senão expandido como pasta (aninhamento ≤ 2, extração em fluxo para disco). **Pastas repetidas A/A não são unidas por padrão** (a estrutura é preservada); há opção por lote.
- Sem tabela nova: colunas `origem`, `unir_pastas`, `partes_total`, `total_esperado` em `ged_importacao`, `storage_key` em `ged_importacao_item`, estados `RECEBENDO`/`RECEBIDO` (migração `20261010120000_ged_importacao_v2`). Descarte automático de lotes `RECEBENDO` com mais de 3 dias.

## 7. Permissões

Ações: VER, EDITAR, ASSINAR, TRAMITAR, ADMINISTRAR, ANONIMIZAR (EDITAR/ASSINAR/TRAMITAR implicam VER); principais: usuário ou setor. Permissão efetiva = união de: (1) criador (VER, EDITAR, TRAMITAR, ADMINISTRAR; ASSINAR nunca implícito); (2) ACL direta no documento (respeita `expira_em`); (3) ACL de pasta herdada se `acl_propria=false` (via `caminho_heranca`, recalculado em transação ao mover/alternar herança); (4) signatário de solicitação aberta (VER + ASSINAR na versão alvo); (5) destinatário atual do trâmite (VER + TRAMITAR); (6) GED_ADMIN: ADMINISTRAR tudo, mas **VER de SIGILOSO exige ACL explícita**; GED_AUDITOR lê logs, sem conteúdo salvo por ACL; (7) SIGILOSO desliga herança de pasta; (8) selado/ASSINADO nega EDITAR (cria derivado); (9) o ato de assinar exige a linha `GedAssinante`.

```ts
podeNoDocumento(ctx: CtxGed, doc: GedDocumentoMin, acao: GedAcao): Promise<boolean>   // acesso por ID
whereGedVisivel(ctx: CtxGed, acao: GedAcao): Prisma.GedDocumentoWhereInput            // listas
```

Listas filtram no SQL (nunca pós-paginação). **Exposição pública futura**: `lib/ged/publico.ts` com `whereExposicaoPublica()`: documento original com `contem_dados_pessoais` ou anonimização PENDENTE/ANONIMIZADA nunca é público; portal só expõe o derivado (`documento_original_id` não nulo) com sensibilidade PUBLICO. Motor de anonimização, detecção (regex CPF/CNPJ/e-mail/telefone e IA opcional) e `GedDeteccaoDadoPessoal` entram depois como job, sem mudar o schema.

## 8. Rotas e roteiro da PoC

Páginas (`app/(ged)/ged/…`, `force-dynamic`): `/ged` (início), `/ged/documentos` (filtros avançados), `/ged/documentos/novo`, `/ged/documentos/[id]`, `/ged/editor/[id]`, `/ged/pastas`, `/ged/assinaturas`, `/ged/tramite`, `/ged/logs`, `/ged/minha-conta/notificacoes`, `/ged/admin/{membros,setores,marcadores,canal,certificado,exportacao}`; pública: `/verificar/[codigo]`. API `/api/v1/ged/…`: `documentos` (+`arquivo`), `pastas`, `marcadores`, `busca`, `tramite`, `comentarios`, `assinaturas` (solicitar, assinar, recusar, otp), `acl`, `logs`, `notificacoes`. Server actions com a mesma checagem duas vezes. UI responsiva desde 320 px, labels em todos os campos (`components/ui.tsx`).

| Item do edital | Demonstração |
|---|---|
| 1 | Filtrar por título/data/remetente; buscar palavra só existente dentro do PDF e ver o trecho |
| 2 | Criar no editor e finalizar (gera PDF); subir PDF |
| 3 | Conceder VER/EDITAR/ASSINAR a usuários diferentes; logar como cada um; herança de pasta e sigilo |
| 4 | Criar marcadores com cor, aplicar e filtrar |
| 5 | Disparar trâmite; abrir e-mail (caixa de teste ou SMTP) mostrando data e hora do envio |
| 6 | Mesmo evento por WhatsApp (número pareado) ou modo simulado |
| 7 | Enviar a um setor, despacho, ciência, devolução; linha do tempo imutável |
| 8 | `/ged/assinaturas` com status por signatário |
| 9 | Comentários antes e durante a assinatura |
| 10 | Recusa com justificativa e registro no histórico |
| 11 | `/ged/logs`: acessos, alterações e comunicações |
| 12 | PDF selado com QR em cada página; ler o QR; `/verificar/…`; alterar um byte e ver a falha |
| 13 | HTTPS/HSTS, cabeçalhos, isolamento entre tenants, certificado A1, LGPD, navegadores |

**Seed demo (fictício)**: tenant A "Câmara Municipal de Vale das Acácias (DEMO)" e tenant B "Autarquia de Águas do Cerrado (DEMO)" (documentos de títulos parecidos para provar isolamento); usuários A: admin, gestor, dois servidores (signatários), vereador (leitor/signatário), auditor; pastas "Documentação da licitação", "Processos de pagamento/2026", "Controle interno", "Pessoal" (sigiloso); documentos cobrindo rascunho, em trâmite, aguardando assinatura (2 signatários sequenciais), assinado com QR, recusado, um PDF só de imagem (`SEM_TEXTO`) e um com `contem_dados_pessoais` + anonimização PENDENTE. Nada de nomes reais (regra do CLAUDE.md).

## 9. Onboarding, exportação e backup de arquivos

- **Onboarding** (`prisma/seed/onboarding.ts`): campo `modulos` (padrão `["LICENCIAMENTO"]`) e bloco `ged` (config, setores, tipos, marcadores, pastas, usuários com `papel_ged` e setores); relaxar `municipios .min(1)` e `usuarios[].papeis .min(1)` para cliente GED-only; pular `aplicarCatalogo` sem LICENCIAMENTO; usuário GED-only = `organizacao_id` + zero `UsuarioPapel` + `GedMembro`; idempotente; aborta se o e-mail já pertence a outra organização; módulo desativado → "módulo não contratado" e dados preservados.
- **Exportação**: regra explícita por modelo `Ged*` em `filtroTabela`, `DESCRICAO_TABELA`, excluir `tsv`, incluir `storage_key` da versão em `exportarAnexos`; `LogAuditoria` passa a filtrar também por `organizacao_id`; tela `/ged/admin/exportacao`.
- **Replicação de arquivos** (lacuna atual): job diário `storage-replicar` (`lib/backup/arquivos.ts`) copia chaves de `Anexo`, `DocumentoOficial` e `GedVersaoDocumento` criadas após a última marca d'água para o bucket `BACKUP_S3_*` sob `arquivos/{key}` (sha256 no metadata, confere tamanho, nunca apaga), reconciliação semanal, resultado em `backup_registro` (`REPLICACAO_ARQUIVOS`), alerta no `backup-check` se > 24 h, script `npm run backup:restore-arquivos`.

## 10. Divisão de trabalho (Fase 1)

**Etapa 0 (somente o orquestrador)** – arquivos compartilhados: `prisma/schema.prisma`, migrations, `package.json`/lockfile (TipTap), `components/nav-interno.tsx`, `CLAUDE.md`, `lib/export/*`, `scripts/predeploy.sh`, `next.config.ts` (cabeçalhos), `Dockerfile`/`Dockerfile.worker` (poppler), `jobs/worker.ts` (`registrarJobsGed`), `app/(auth)/login/actions.ts`, `app/(requerente)/layout.tsx`, `lib/audit.ts` (`organizacao_id`), `lib/agente/ingestao.ts` (canal `somente_envio`).

**Ordem**: Etapa 0 → WS-A → WS-B, C, D, E, F em paralelo. A define em `lib/ged/contratos.ts` as assinaturas dos serviços compartilhados (`criarVersao`, `registrarComentario`, `registrarTramite`, `notificar`, `podeNoDocumento`).

| WS | Escopo | Arquivos exclusivos |
|---|---|---|
| **A. Núcleo e tenancy** | `gedDb`, `exigirGed`/`ctxGedApi`, permissões, ACL, setores, storage por tenant, numeração, shell `(ged)` | `lib/ged/{db,escopo,permissoes,storage,numeracao,contratos,tipos}.ts`, `app/(ged)/layout.tsx`, `app/(ged)/ged/page.tsx`, `components/ged/nav-ged.tsx`, telas de ACL/setores, `tests/unit/ged-{schema,escopo,fontes,storage,permissoes}.test.ts` |
| **B. Documentos, pastas, marcadores, busca** | upload, lista com filtros, preview/download, árvore de pastas, marcadores, extração de texto, busca | `lib/ged/documentos/*`, `lib/ged/busca.ts`, `app/(ged)/ged/{documentos,pastas}/**`, `app/api/v1/ged/{documentos,pastas,marcadores,busca}/**`, `components/ged/{lista,filtros,upload,preview,pastas}*`, `jobs/ged-texto.ts` |
| **C. Editor, trâmite, comentários** | TipTap, PDF, trâmite imutável, comentários | `lib/ged/{editor,tramite,comentarios}/**`, `app/(ged)/ged/{editor,tramite}/**`, `app/api/v1/ged/{tramite,comentarios}/**`, `components/ged/{editor,tramite,comentarios}/**` |
| **D. Assinaturas e verificação** | solicitação, assinar, recusar, OTP, selo PAdES, QR, página pública, lembretes | `lib/ged/assinaturas/**`, `app/(ged)/ged/assinaturas/**`, `app/api/v1/ged/assinaturas/**`, `app/(publico)/verificar/**`, `jobs/ged-assinaturas.ts`, `tests/unit/ged-assinaturas.test.ts` |
| **E. Notificações, logs, admin GED** | outbox, templates, e-mail/WhatsApp, preferências/opt-in, logs, administração | `lib/ged/{notificar,templates,logs,admin}/**`, `jobs/ged-notificar.ts`, `app/(ged)/ged/{logs,minha-conta,admin}/**`, `app/api/v1/ged/{notificacoes,logs}/**` |
| **F. Onboarding, seed, E2E, docs, backup** | extensão do onboarding, seed demo, replicação de arquivos, E2E, documentação | `prisma/seed/onboarding.ts`, `prisma/seed/clientes/ged-*.json`, `prisma/seed/ged-demo.ts`, `lib/backup/arquivos.ts`, `jobs/ged-backup.ts`, `tests/e2e/t16…t20-*.spec.ts`, `docs/ged.md`, `docs/poc-ged.md` |

Regra geral: nada de `lib/db` direto em GED (só `gedDb`), `auditar()` em toda escrita, `force-dynamic`, `rota()` nas APIs.

## 11. Riscos e pontos em aberto

- **Validade jurídica do digitalizado** (Decreto 10.278/2020: integridade, metadados, assinatura qualificada): confirmar com assessoria jurídica; a PoC demonstra o fluxo, não afirma equivalência.
- **LGPD**: cliente = controlador, prestador = operador (contrato/DPA); IA só com `ia_habilitada` e base legal.
- **Residência dos dados**: Railway não tem região no Brasil → tratar como risco (transferência internacional) ou avaliar provedor nacional.
- **Assinatura**: eletrônica avançada por signatário depende da aceitação do órgão; selo A1 é do órgão (o cliente precisa de e-CNPJ A1); sem carimbo de tempo/LTV na fase 1; na PoC, certificado de teste sem valor legal.
- **WhatsApp**: item 6 ao vivo exige número pareado; provedor não oficial tem risco de banimento; API oficial exige templates; ter modo simulado como plano B.
- **Volume e custo**: scans são grandes (limite de 25 MB e cota por tenant); `ged_acesso_log` cresce rápido (retenção/partição); OCR consome CPU/memória.
- **Sigilo × administrador**: proposta = GED_ADMIN não vê SIGILOSO sem ACL (confirmar).
- **RLS**: adiado; revisar antes de abrir mais clientes.
- **Acessibilidade** (e-MAG/WCAG) e **matriz de navegadores** a declarar; validar o TipTap.
- **Suporte da plataforma**: sem usuário cross-tenant na fase 1; suporte por scripts auditados.
- **Colisão de código verificador** entre `documento_oficial` e `ged_documento`: verificar nos dois ao gerar.

## 12. Protocolo (livro de entrada, saída e interno; portal do cidadão)

Lacuna que motivou: o GED numerava documentos e tramitava, mas não havia o *ato de protocolar* nem *comprovante*. Detalhe operacional em `docs/ged.md` §14. Decisões:

- **Protocolo ≠ documento.** Um protocolo é o **registro de um ato** (quem entregou/enviou, quando, o quê, para onde) e pode ter zero ou mais arquivos; cada PDF vira `GedDocumento` e fica **vinculado** (`ged_protocolo_documento`, com nome, tamanho e sha256 no ato). Reaproveita upload, versão, ACL, texto/OCR, trâmite e auditoria existentes em vez de criar outro repositório de arquivos. O protocolo de saída/interno sem arquivo é válido (ato registrado).
- **Tabelas novas** (`GedProtocolo`, `GedProtocoloEvento`, `GedProtocoloDocumento`, `GedProtocoloAssunto`) seguem a regra de todo `Ged*` (`organizacao_id` NOT NULL e primeiro nos índices, `ged_mesmo_tenant`, `filtroTabela()`, dicionário). O **livro é por cliente e por tipo**: `GedSequencia` com tipo `PROT_ENT|PROT_SAI|PROT_INT` por ano (mesmo padrão e a mesma garantia de concorrência da numeração de documentos); número `PROT-ENT-2026-000123` — a sigla do livro no número evita colisão entre livros e o ano é o de Brasília.
- **Imutável por desenho**: trigger `ged_protocolo_imutavel` compara a linha inteira menos uma lista **fechada** de colunas mutáveis (situação, posse atual, conclusão, comprovante); novas colunas nascem imutáveis por padrão (negar por omissão). O andamento é uma tabela só-INSERT e **a situação do protocolo é derivada do último evento** gravado na mesma transação (a coluna `situacao` só acelera filtros/listas). O comprovante só pode ser preenchido uma vez.
- **Dois códigos aleatórios distintos**: de *consulta* (credencial do cidadão, por cliente) e de *verificação* (vai no QR, único na plataforma para resolver `/verificar/protocolo/{código}` sem sessão). Quem tem o QR do comprovante não ganha acesso ao andamento, e vice-versa.
- **Consulta pública sem dado pessoal**: o andamento exposto é composto por **rótulos fixos** por tipo de evento mais o `texto_publico` — um campo à parte, preenchido só por responder/devolver/indeferir (a UI avisa o servidor). O despacho interno nunca sai. Bloqueio por falhas é também por *protocolo-alvo* (contra chute distribuído); custo aceito: quem insistir em errar um número pode bloquear a consulta daquele número por alguns minutos.
- **Portal público sem usuário**: nenhuma sessão, nenhum cookie. O cliente é identificado por `organizacao.slug_publico`; a resolução (`resolverSlugPortal`, em `lib/ged/db.ts` como as demais consultas entre clientes) devolve **só ids**. Os documentos precisam de um criador: `ged_config.protocolo_responsavel_id` (membro ativo com papel que cria documentos), validado ao ligar e a cada envio. Alternativas descartadas: usuário-robô por cliente (mais uma conta para administrar e auditar) e criador nulo (quebra FKs, ACL do criador e trâmite).
- **Comprovante como `GedDocumento`** (origem `COMPROVANTE`, enum novo): herda storage por cliente, hash, extração de texto, replicação de backup e exportação sem tocar em `lib/backup`/`lib/export` e sem outro formato de chave. Selo: não reutiliza a *solicitação de assinatura* (que existe para signatários humanos), mas o **mesmo certificado A1 do órgão** (`certificadoDoCliente` + `assinarComCertificado`); sem certificado, assinatura eletrônica simples. A verificação pública recalcula o sha256 do arquivo guardado, valida o PAdES e deixa o navegador conferir o PDF que o cidadão tem.
- **Notificação ao cidadão pela caixa de saída existente** (`GedComunicacao`): `usuario_id` virou opcional e ganhou `protocolo_id` (CHECK: um dos dois). O e-mail é montado no envio a partir do protocolo (dados pessoais continuam cifrados no banco; a linha da caixa guarda só o e-mail mascarado). Sem WhatsApp para o cidadão nesta fase.
- **Permissões**: duas capacidades novas em `papeis.ts` — `protocolar` (Admin, Gestor, Usuário) e `protocolo_geral` (Admin, Gestor, Auditor). O livro é por **envolvimento/setor** (autor, responsável, destinatário, setores de origem/destino/atual), aplicado no SQL; abrir o arquivo continua sendo regra do documento. Leitor e Auditor são somente leitura.
- **Fora desta fase**: anexar mais arquivos a um protocolo depois de criado (a resposta pode levar um PDF), busca por nome do interessado (cifrado), aviso interno por e-mail quando o protocolo não tem documentos, WhatsApp/SMS ao cidadão, captcha (só honeypot + limite), limite compartilhado entre réplicas (em memória, como o login), e protocolo de saída com assinatura do destinatário.
