# SPEC – Sistema de Gestão de Licenciamento e Fiscalização Ambiental ("LicenciaGov")

> **Versão 1.0 – 27/09/2026 · VALLETECLAB**
> Referência de negócio: Pregão Eletrônico SRP 005/2026 – CDS Piemonte do Paraguaçu (Programa GAC / SEMA-BA / INEMA), Termo de Referência (Anexo X), Formulário de Avaliação da PoC e Errata 01.
> Público: desenvolvedores (humanos e agentes de código). Tudo marcado **[PoC]** precisa estar em produção antes da Prova de Conceito.

---

## 0. Como usar este documento

1. A seção 2 (escopo) diz **o que** construir e em que ordem.
2. As seções 4–6 (dados, estados, regras) são a **fonte da verdade** para modelagem e validações.
3. A seção 13 traz os **testes de aceite** (Given/When/Then) – um por item da PoC. Nenhum item está pronto sem o teste passando em produção.
4. Nomes de tabelas/campos estão em `snake_case` e em português, para casar com o vocabulário do cliente.

---

## 1. Visão do produto

Sistema web (SaaS, multi-município) para órgãos ambientais municipais e consórcios públicos:

- **Requerente** (empresa/pessoa + responsável técnico) pede licenças pela internet e acompanha o processo.
- **Técnicos** analisam, pedem complementação, emitem pareceres, fazem vistorias e fiscalização.
- **Gestores** decidem e emitem licenças com verificação de autenticidade.
- **Coordenação do consórcio, SEMA e INEMA** acompanham indicadores de todos os municípios.
- **Cidadão** consulta processos e licenças emitidas (transparência).

Primeiro cliente: **CDS Piemonte do Paraguaçu** – 8 municípios: Iaçu, Ibiquera, Itaberaba, Itatim, Mundo Novo, Rafael Jambeiro, Ruy Barbosa, Tapiramutá. O produto deve nascer **multi-tenant** para ser vendido a outros consórcios/prefeituras do GAC.

---

## 2. Escopo e prioridades

| Prioridade | Módulo | Itens da PoC |
|---|---|---|
| **P0 – PoC** | Autenticação, perfis, multi-município | 7 |
| **P0 – PoC** | Cadastros: pessoa, responsável técnico, empreendimento, tipologia | 2 |
| **P0 – PoC** | Processo de licenciamento: protocolo, tramitação, pendências, checklist, parecer, decisão | 1 |
| **P0 – PoC** | Motor de prazos e alertas | 3 |
| **P0 – PoC** | Documentos oficiais (licença/certidão/auto/notificação) com QR e validação pública | 5 |
| **P0 – PoC** | Fiscalização: denúncia, vistoria mobile com GPS e fotos, auto de infração, notificação | 4 |
| **P0 – PoC** | Portal público de consulta | 8 |
| **P0 – PoC** | Dashboard por município + relatórios PDF/XLSX | 6, 9 |
| **P0 – PoC** | Backup documentado + exportação completa em formato aberto | 10 |
| P1 – Implantação (60 dias) | Condicionantes e renovação; modelos de Termo de Referência para estudos; conselhos municipais de meio ambiente (pautas, atas, deliberações); relatório mensal de SLA/disponibilidade; importação de planilhas legadas | – |
| P2 – Evolução | Integração SEIA (SEMA/INEMA); login gov.br; cálculo de taxas/boleto; assinatura ICP-Brasil; app offline de fiscalização | – |

**Fora de escopo**: geoprocessamento avançado (análise de sobreposição com APP/UC), cálculo automático de compensação ambiental.

---

## 3. Arquitetura recomendada

> Se a VALLETECLAB já tiver uma base (ex.: SISGOV) com autenticação, multi-tenant e geração de PDF, **reaproveitar** – o prazo é o risco nº 1. Caso contrário:

| Camada | Escolha | Observação |
|---|---|---|
| App | **Next.js 14+ (App Router) + TypeScript** | Painel interno, portal público e tela mobile de vistoria no mesmo projeto |
| UI | Tailwind + shadcn/ui; Recharts (gráficos); react-leaflet + OpenStreetMap (mapas) | Responsivo, sem plug-ins |
| API | Route Handlers / Server Actions do Next **ou** NestJS separado | Expor REST documentada (OpenAPI) em `/api/v1` para integrações |
| ORM/DB | Prisma + **PostgreSQL 16** | Coordenadas em `numeric(9,6)`; polígonos em `jsonb` GeoJSON (PostGIS opcional em P2) |
| Auth | Auth.js (credenciais + e-mail); senha com **argon2id**; sessão JWT curta + refresh | Rate limit no login; bloqueio após 5 falhas |
| Arquivos | Storage S3-compatível (AWS S3 / Cloudflare R2 / MinIO) | Chave por município/processo; hash SHA-256 salvo no banco |
| PDF | Modelos HTML + **Puppeteer** (ou @react-pdf) | QR Code com lib `qrcode` |
| Planilhas | `exceljs` | XLSX com cabeçalho institucional |
| Jobs | `pg-boss` (fila no próprio Postgres) | Alertas de prazo, e-mails, exportações pesadas |
| E-mail | SMTP transacional (SES/Resend/SendGrid) | |
| Infra | Docker; nuvem com **região Brasil** (ex.: AWS sa-east-1); Postgres gerenciado | 2 ambientes: `homolog` e `prod` |
| Observabilidade | Uptime monitor (ex.: Better Stack/UptimeRobot) + logs estruturados | Base do relatório de 99% |

### 3.1 Estrutura de pastas (sugestão)

```
/app
  /(publico)/consulta, /validar/[codigo], /denuncia
  /(interno)/dashboard, /processos, /empreendimentos, /pessoas,
             /fiscalizacao, /documentos, /relatorios, /admin
  /(requerente)/meus-processos, /novo-requerimento
  /api/v1/...
/lib   (auth, rbac, prazos, numeracao, pdf, storage, audit, export)
/prisma (schema.prisma, seed.ts)
/templates (licenca.html, certidao.html, auto_infracao.html, notificacao.html, parecer.html)
/jobs  (alertas.ts, backup-check.ts, export.ts)
/tests (e2e Playwright por item da PoC)
```

---

## 4. Multi-tenant, perfis e permissões **[PoC-7]**

### 4.1 Hierarquia
`organizacao` (ex.: CDS Piemonte) → `municipio` (8) → dados (processos, empreendimentos, fiscalizações…).
Toda tabela de negócio tem `municipio_id NOT NULL` e `organizacao_id`. **Toda query passa por um filtro de escopo** (`lib/rbac.ts`) – nunca confiar no front.

### 4.2 Perfis

| Código | Perfil | Escopo | Pode |
|---|---|---|---|
| `ADMIN` | Administrador do consórcio | organização | Tudo + configurações (municípios, usuários, tipos de ato, tipologias, prazos, modelos) |
| `TEC_CONSORCIO` | Técnico do consórcio | todos os municípios | Triagem, análise, pendências, parecer, vistoria, minutas; decidir se o município delegar |
| `TEC_MUNICIPAL` | Técnico municipal | **só o(s) município(s) vinculados** | Igual ao anterior, no próprio município |
| `GESTOR_MUNICIPAL` | Secretário/gestor ambiental | município | Decidir (deferir/indeferir), assinar licenças e autos |
| `FISCAL` | Fiscal ambiental | município | Denúncias, vistorias, autos, notificações |
| `SEMA_INEMA` | Gestor estadual | organização | **Somente leitura** de tudo + exportações |
| `REQUERENTE` | Empresa/pessoa ou RT | próprios processos | Requerer, anexar, responder pendências, baixar documentos |
| (anônimo) | Consulta pública | – | Portal público |

Implementação: tabela `usuario_papel(usuario_id, papel, municipio_id NULL)` – um usuário pode ter papéis em mais de um município. Matriz de permissões em código (`can(user, acao, recurso)`), coberta por testes.

### 4.3 Regras
- Usuário desativado mantém histórico (nunca deletar usuários).
- Toda ação de escrita gera `log_auditoria` (seção 9.3).
- Troca de senha obrigatória no primeiro acesso; política mínima 10 caracteres.

---

## 5. Modelo de dados

> Tipos: `uuid` PK em todas as tabelas; `created_at`, `updated_at`, `created_by` em todas. Soft delete **não** é usado para atos administrativos – usa-se `status = CANCELADO` + justificativa.

### 5.1 Configuração
```
organizacao(id, nome, cnpj, sigla, logo_url)
municipio(id, organizacao_id, nome, codigo_ibge, orgao_ambiental_nome, brasao_url,
          endereco, email, telefone, ativo)
usuario(id, nome, cpf_cifrado, email UNIQUE, senha_hash, ativo, ultimo_login)
usuario_papel(id, usuario_id, papel, municipio_id NULL)

tipologia(id, organizacao_id, codigo, divisao, descricao,
          unidade_porte,            -- ex.: 'área construída (m²)', 'nº de cabeças'
          faixas_porte jsonb,       -- [{porte:'MICRO', ate: 500}, {porte:'PEQUENO', ate: 2000}, ...]
          potencial_poluidor,       -- BAIXO | MEDIO | ALTO
          ativo)
  -- Carregar do anexo da Resolução CEPRAM nº 4.327/2013 (impacto local). Validar com SEMA/INEMA.

tipo_ato(id, organizacao_id, sigla, nome, categoria,   -- LICENCA | AUTORIZACAO | CERTIDAO | DECLARACAO
         validade_meses_padrao, exige_vistoria bool, exige_parecer bool,
         modelo_documento, checklist_modelo_id, prazo_analise_dias, ativo)
  -- Seed: LP, LI, LO, LS (Licença Simplificada), LU (Unificada), LAC (Adesão e Compromisso),
  --       RLO (Renovação de LO), AA (Autorização Ambiental), ASV (Supressão de Vegetação),
  --       CERT_DISP (Certidão de Dispensa/Não Exigibilidade), DECL (Declaração).
  -- Nomes e validades PARAMETRIZÁVEIS – confirmar a lista com SEMA/INEMA na implantação.

documento_exigido(id, tipo_ato_id, tipologia_id NULL, nome, obrigatorio, formatos)
checklist_modelo(id, nome, itens jsonb)   -- [{id, texto, tipo:'SIM_NAO'|'TEXTO'|'NUMERO', obrigatorio}]
prazo_config(id, organizacao_id, municipio_id NULL, etapa, dias, dias_alerta, conta_dias_uteis bool)
feriado(id, municipio_id NULL, data, descricao)
modelo_documento(id, tipo, nome, html, versao, ativo)
```

### 5.2 Cadastros **[PoC-2]**
```
pessoa(id, tipo PF|PJ, cpf_cnpj_cifrado, cpf_cnpj_hash UNIQUE,  -- hash para busca/unicidade
       nome, nome_fantasia, email, telefone, endereco jsonb, municipio_id)
responsavel_tecnico(id, pessoa_id, formacao, conselho, registro_conselho, uf_conselho)
empreendimento(id, municipio_id, requerente_id -> pessoa, nome, endereco jsonb,
               latitude, longitude, poligono_geojson jsonb NULL,
               tipologia_id, porte, potencial_poluidor, area_m2, numero_car NULL,
               status ATIVO|INATIVO)
empreendimento_rt(empreendimento_id, rt_id, desde, ate)
```
Regras: CPF/CNPJ validados (dígito); unicidade por `cpf_cnpj_hash`; `porte` calculado a partir da tipologia + grandeza informada (editável pelo técnico com justificativa).

### 5.3 Processo **[PoC-1]**
```
processo(id, municipio_id, numero UNIQUE,           -- ex.: RUY-2026-000123
         empreendimento_id, requerente_id, rt_id, tipo_ato_id,
         status, etapa_atual, tecnico_id NULL, gestor_id NULL,
         data_protocolo, prazo_etapa_ate, prazo_pausado bool,
         valor_taxa NULL, taxa_paga bool,
         descricao_atividade, observacoes)
tramitacao(id, processo_id, de_status, para_status, de_usuario_id, para_usuario_id NULL,
           despacho text, created_at)                -- IMUTÁVEL (sem UPDATE/DELETE)
anexo(id, processo_id NULL, fiscalizacao_id NULL, tipo, nome_arquivo, storage_key,
      mime, tamanho, sha256, enviado_por, created_at)
pendencia(id, processo_id, descricao, prazo_dias, prazo_ate, status ABERTA|RESPONDIDA|VENCIDA|CANCELADA,
          resposta text, respondida_em)
checklist_preenchido(id, processo_id, checklist_modelo_id, respostas jsonb, preenchido_por)
parecer(id, processo_id, numero, conclusao FAVORAVEL|DESFAVORAVEL|FAVORAVEL_COM_CONDICIONANTES,
        texto_html, autor_id, created_at, documento_id NULL)
condicionante(id, processo_id, documento_id NULL, descricao, periodicidade, prazo_ate, status)
```

### 5.4 Documentos oficiais **[PoC-5]**
```
documento_oficial(id, municipio_id, processo_id NULL, fiscalizacao_id NULL,
                  tipo LICENCA|AUTORIZACAO|CERTIDAO|AUTO_INFRACAO|NOTIFICACAO|PARECER,
                  numero, ano, codigo_verificador UNIQUE,   -- 12 chars base32, ex.: 7KQ2-M9XA-D3PL
                  sha256_pdf, storage_key, validade_ate NULL,
                  emitido_por, emitido_em, status VALIDO|CANCELADO|SUBSTITUIDO,
                  motivo_cancelamento NULL)
```

### 5.5 Fiscalização **[PoC-4]**
```
denuncia(id, municipio_id, protocolo, canal PORTAL|PRESENCIAL|TELEFONE|OUTRO,
         anonima bool, denunciante_nome NULL, contato NULL, descricao,
         latitude NULL, longitude NULL, endereco, status NOVA|EM_APURACAO|CONCLUIDA|ARQUIVADA)
fiscalizacao(id, municipio_id, origem DENUNCIA|ROTINA|PROCESSO, denuncia_id NULL, processo_id NULL,
             empreendimento_id NULL, data_hora, latitude, longitude, precisao_m,
             equipe jsonb, relato, constatacao IRREGULAR|REGULAR|INCONCLUSIVA, status)
auto_infracao(id, fiscalizacao_id, numero, autuado_id -> pessoa, enquadramento_legal,
              descricao_infracao, penalidade ADVERTENCIA|MULTA|EMBARGO|INTERDICAO|OUTRA,
              valor_multa NULL, prazo_defesa_dias, status, documento_id)
notificacao(id, fiscalizacao_id NULL, processo_id NULL, numero, notificado_id, exigencia,
            prazo_dias, prazo_ate, status, documento_id)
```

### 5.6 Conselhos (P1)
```
conselho(id, municipio_id, nome, lei_criacao)
reuniao_conselho(id, conselho_id, data, tipo ORDINARIA|EXTRAORDINARIA, pauta, ata_pdf_key, deliberacoes jsonb)
```

### 5.7 Transversais
```
alerta(id, usuario_id NULL, municipio_id, tipo, referencia_tipo, referencia_id,
       mensagem, vence_em, lido bool, enviado_email bool)
log_auditoria(id, usuario_id, acao, entidade, entidade_id, antes jsonb, depois jsonb, ip, user_agent, created_at)
exportacao(id, solicitada_por, escopo, status, storage_key, created_at)
chamado_suporte(id, municipio_id, aberto_por, severidade CRITICO|NAO_CRITICO|DUVIDA,
                descricao, status, aberto_em, primeira_resposta_em, resolvido_em)   -- P1 (SLA do contrato)
```

### 5.8 Numeração
Função única `proximo_numero(municipio, tipo, ano)` com `SELECT ... FOR UPDATE` em `sequencia(municipio_id, tipo, ano, ultimo)`. Formatos:
- Processo: `{SIGLA_MUN}-{ANO}-{000000}` (ex.: `ITB-2026-000042`)
- Licença: `{SIGLA_ATO}-{SIGLA_MUN}-{000}/{ANO}` (ex.: `LO-ITB-012/2026`)
- Auto de infração: `AI-{SIGLA_MUN}-{000}/{ANO}`; Notificação: `NOT-{SIGLA_MUN}-{000}/{ANO}`

---

## 6. Fluxo do processo (máquina de estados) **[PoC-1, PoC-3]**

```
RASCUNHO ──protocolar──▶ PROTOCOLADO ──distribuir──▶ EM_TRIAGEM
EM_TRIAGEM ──pendência doc.──▶ AGUARDANDO_REQUERENTE ──responder──▶ EM_TRIAGEM
EM_TRIAGEM ──aceitar──▶ EM_ANALISE
EM_ANALISE ──pendência técnica──▶ AGUARDANDO_REQUERENTE ──responder──▶ EM_ANALISE
EM_ANALISE ──agendar──▶ AGUARDANDO_VISTORIA ──vistoria concluída──▶ EM_ANALISE
EM_ANALISE ──emitir parecer──▶ AGUARDANDO_DECISAO
AGUARDANDO_DECISAO ──deferir──▶ DEFERIDO ──emitir documento──▶ CONCLUIDO
AGUARDANDO_DECISAO ──indeferir──▶ INDEFERIDO (gera ofício/decisão) ──▶ CONCLUIDO
qualquer ──arquivar (justificativa)──▶ ARQUIVADO
AGUARDANDO_REQUERENTE ──prazo vencido──▶ ARQUIVADO (automático, configurável)
```

Regras:
1. Transições só pelo serviço `processo.transicionar(id, acao, payload)` – valida perfil, estado atual e pré-requisitos (ex.: não deferir sem parecer se `tipo_ato.exige_parecer`).
2. Cada transição grava `tramitacao` + `log_auditoria` e recalcula `prazo_etapa_ate`.
3. **Relógio**: pausa em `AGUARDANDO_REQUERENTE` (`prazo_pausado = true`) e retoma do saldo restante ao responder.
4. Distribuição: manual pelo gestor/admin ou automática por rodízio entre técnicos do município (configurável).
5. Requerente vê apenas status "amigável" (Protocolado, Em análise, Pendência – ação necessária, Concluído).

### 6.1 Motor de prazos e alertas **[PoC-3]**
- Job a cada 1 h (`jobs/alertas.ts`):
  - `prazo_etapa_ate - hoje <= dias_alerta` → alerta **"vencendo"** ao técnico responsável e ao gestor.
  - `prazo_etapa_ate < hoje` → alerta **"vencido"** + destaque vermelho no painel.
  - Pendências com `prazo_ate` próximo/vencido → alerta ao requerente (e-mail) e ao técnico.
  - Licenças com `validade_ate` em 120/60/30 dias → alerta de renovação (requerente + técnico).
  - Condicionantes e notificações com prazo → idem.
- Tela **"Prazos"**: abas Vencidos / Vencem em 7 dias / Em dia, filtro por município/técnico.
- Dias úteis: usar `feriado` + fins de semana quando `conta_dias_uteis = true`.
- Valores iniciais (editáveis): triagem 5 dias úteis; análise 30 dias (LS/AA/CERT) ou 60 dias (LP/LI/LO/LU); resposta a pendência 30 dias corridos; alerta 5 dias antes.

---

## 7. Documentos oficiais e autenticidade **[PoC-5]**

1. Emissão: `documentos.emitir(tipo, referencia)` → renderiza `modelo_documento.html` com dados + brasão do município → gera PDF (Puppeteer) → calcula `sha256` → grava no storage → cria `documento_oficial` com `codigo_verificador` aleatório (12 chars, sem ambiguidade 0/O/1/I).
2. Rodapé do PDF: nº do documento, **QR Code** para `https://{dominio}/validar/{codigo}`, texto "Verifique a autenticidade em {dominio}/validar informando o código {codigo}", data/hora de emissão e nome/cargo de quem assinou.
3. Página pública `/validar/{codigo}` (e formulário `/validar`): mostra tipo, número, titular (nome; CPF/CNPJ mascarado), empreendimento, município, validade, status (**VÁLIDO / CANCELADO / VENCIDO**) e o hash. Opcional: upload do PDF para comparar o hash.
4. Documento emitido é **imutável**. Correção = cancelar (com motivo) e emitir substituto (`SUBSTITUIDO`).
5. Assinatura: P0 = assinatura eletrônica simples (usuário autenticado + registro no log). P2 = ICP-Brasil / gov.br.
6. Modelos mínimos: Licença (com condicionantes e validade), Certidão, Parecer técnico, Auto de infração, Notificação, Ofício de indeferimento.

---

## 8. Fiscalização (mobile-first) **[PoC-4]**

- Tela `/fiscalizacao/nova` otimizada para celular: botão **"Capturar localização"** (`navigator.geolocation`, `enableHighAccuracy`, salva lat/long/precisão), **fotos pela câmera** (`<input type="file" accept="image/*" capture="environment">`, compressão no cliente para ≤ 1,5 MB, EXIF preservado quando houver), relato, constatação.
- Mapa `/fiscalizacao/mapa` com pins por status/município (Leaflet), clique abre a ficha.
- A partir da fiscalização: **Gerar Auto de Infração** ou **Gerar Notificação** → formulário → PDF numerado (seção 7).
- Denúncia pública em `/denuncia` (anônima opcional, com mapa para marcar o local) gera protocolo e entra na fila do município.
- (P2) Rascunho offline com IndexedDB e sincronização.

---

## 9. Requisitos não funcionais **[PoC-10 e habilitação]**

### 9.1 Disponibilidade e desempenho
- Meta 99% mensal; monitor externo a cada 1 min em `/api/health` (checa DB e storage).
- Páginas internas < 2 s (p95) com 50 usuários simultâneos.

### 9.2 Backup e portabilidade
- **Banco**: backup automático diário do Postgres gerenciado + `pg_dump` diário para bucket em **outra região/provedor**, retenção 30 dias, criptografado.
- **Arquivos**: versionamento no bucket + replicação diária.
- **Teste de restauração** mensal documentado (checklist em `/docs/restore.md`) – mostrar na PoC.
- **Exportação completa** (`/admin/exportar`): job gera ZIP com um **CSV e um JSON por tabela** (UTF-8, dicionário de dados incluído) + pasta de anexos + `manifest.json` com hashes. Disponível para ADMIN e SEMA_INEMA.
- Página `/admin/backup`: data/hora do último backup, tamanho, última restauração testada.

### 9.3 Segurança e LGPD
- HTTPS obrigatório (HSTS); cookies `Secure/HttpOnly/SameSite=Lax`; CSRF nas mutações.
- CPF/CNPJ, telefones e e-mails de pessoas físicas **criptografados em repouso** (AES-256-GCM, chave em secret manager) + hash para busca.
- `log_auditoria` para login, logout, falhas de login, toda criação/alteração/transição, emissão/cancelamento de documento, exportação. Tela de consulta do log para ADMIN.
- Portal público mascara dados: `***.456.789-**`, nomes de PF abreviados quando pessoa física.
- Upload: whitelist de tipos (pdf, jpg, png, dwg/kml/kmz/shp.zip), limite 25 MB, antivírus opcional (ClamAV) em P1.
- Ambientes **homolog** e **prod** separados (bancos, buckets e domínios distintos).
- Política de privacidade e termo de uso no portal.

### 9.4 Usabilidade
- Responsivo (320 px+), acessibilidade básica (contraste, labels, navegação por teclado).
- Busca global por nº de processo, CPF/CNPJ, nome, empreendimento.

---

## 10. Telas

### Público (sem login) **[PoC-8]**
- `/consulta`: busca por nº do processo **ou** CPF/CNPJ + nº (dupla chave evita varredura) → situação, etapa (linha do tempo com datas, sem despachos internos), documentos públicos emitidos.
- `/licencas`: lista de licenças emitidas (filtros município, tipo, período) – transparência.
- `/validar` e `/validar/{codigo}`.
- `/denuncia`.

### Requerente
- Cadastro/Login; **Novo requerimento** (wizard): 1) empreendimento (novo ou existente, mapa para marcar ponto) 2) tipologia e porte 3) tipo de ato 4) documentos exigidos (lista gerada por `documento_exigido`) 5) revisão e protocolo → recibo PDF com nº.
- Meus processos; responder pendência; baixar documentos.

### Interno
- **Dashboard** **[PoC-6]** (seção 11).
- **Caixa de entrada** do técnico: meus processos por prazo.
- **Processo** (tela principal): cabeçalho (nº, status, prazo com semáforo), abas: Dados · Documentos · Tramitação (linha do tempo) · Pendências · Checklist · Parecer · Vistorias · Documentos emitidos · Log. Botões de ação conforme estado + perfil.
- Empreendimentos (ficha com mapa e **histórico de processos e licenças** **[PoC-2]**), Pessoas, Responsáveis técnicos.
- Fiscalização: denúncias, vistorias, mapa, autos, notificações.
- Prazos (seção 6.1).
- Relatórios **[PoC-9]**.
- Admin: municípios, usuários/papéis, tipos de ato, tipologias (importar CSV), documentos exigidos, checklists, prazos, feriados, modelos de documento, backup/exportação, log.

---

## 11. Dashboard e relatórios **[PoC-6, PoC-9]**

Filtros globais: **município** (todos ou um), período, tipo de ato, técnico.

Indicadores (cards + gráficos):
- Processos protocolados, em andamento, concluídos no período; por status (barra); por tipo de ato (pizza).
- Tempo médio de tramitação (protocolo → conclusão) por tipo de ato.
- Processos com prazo vencido / vencendo.
- Licenças emitidas por tipo e por município (barra empilhada); licenças vencendo em 90 dias.
- Denúncias recebidas/apuradas; fiscalizações; autos de infração e valor total de multas; notificações.
- Tabela comparativa **por município** (uma linha por município com todos os números acima) – alimenta o quadro de indicadores do SISMUMAS/GAC.
- Adesão dos municípios (usuários ativos e processos por município – meta do convênio: ≥ 60% de adesão).

Relatórios (todos com botão **PDF** e **XLSX**; cabeçalho com logo do consórcio + município + filtros + data de emissão):
1. Processos por período/status/tipo.
2. Licenças emitidas e vencimentos.
3. Fiscalização (denúncias, vistorias, autos, notificações).
4. Produtividade por técnico.
5. Indicadores consolidados por município (o do dashboard).
6. (P1) Relatório mensal de SLA/disponibilidade e chamados.

---

## 12. API (REST `/api/v1`, JSON, OpenAPI em `/api/docs`)

| Método | Rota | Uso |
|---|---|---|
| POST | `/auth/login`, `/auth/refresh`, `/auth/logout` | autenticação |
| GET/POST/PATCH | `/pessoas`, `/responsaveis-tecnicos`, `/empreendimentos` | cadastros |
| GET/POST | `/processos` · GET `/processos/{id}` | processos |
| POST | `/processos/{id}/acoes/{acao}` | transições (protocolar, distribuir, pendencia, responder, aceitar, parecer, deferir, indeferir, arquivar) |
| POST | `/processos/{id}/anexos` | upload (URL pré-assinada) |
| POST | `/documentos` · POST `/documentos/{id}/cancelar` | emissão/cancelamento |
| GET | `/public/validar/{codigo}` · `/public/processos?numero=&doc=` · `/public/licencas` | portal público |
| POST | `/public/denuncias` | denúncia |
| GET/POST | `/fiscalizacoes`, `/autos-infracao`, `/notificacoes`, `/denuncias` | fiscalização |
| GET | `/indicadores?municipio=&de=&ate=` | dashboard |
| GET | `/relatorios/{tipo}?formato=pdf|xlsx&...` | relatórios |
| POST | `/admin/exportacoes` · GET `/admin/exportacoes/{id}` | portabilidade |
| GET | `/integracao/seia/processos?desde=` | (P2) feed para SEMA/INEMA |

Paginação `?page=&size=`; erros no formato `{code, message, details}`; toda rota interna exige token e aplica escopo de município.

---

## 13. Testes de aceite da PoC (E2E – Playwright, rodar em **prod**)

> Dados de demonstração da seção 14 carregados. Cada teste = um item do Formulário de Avaliação.

**T1 – Processo completo [PoC-1]**
Dado um requerente logado, quando ele cria requerimento de **LO** para "Laticínio Boa Vista – Itaberaba" e anexa os documentos obrigatórios, então recebe nº `ITB-2026-xxxxxx` e recibo PDF. Quando o técnico abre pendência, o requerente responde, o técnico preenche o checklist e emite parecer favorável com condicionantes, e o gestor defere, então a **LO é emitida** e a linha do tempo mostra todas as etapas com data, usuário e despacho.

**T2 – Cadastros e histórico [PoC-2]**
Dado o empreendimento "Posto Estrela – Ruy Barbosa" com 3 processos (LP, LI, LO), quando abro a ficha, então vejo requerente, RT (com registro no conselho), coordenadas no mapa e a lista dos 3 processos e das licenças vinculadas.

**T3 – Prazos e alertas [PoC-3]**
Dado um processo com prazo vencendo em 3 dias e outro vencido, quando o técnico entra, então vê 2 alertas no sino e os dois processos na aba "Vencendo/Vencidos" com semáforo; o e-mail de alerta aparece na caixa de teste.

**T4 – Fiscalização [PoC-4]**
Dado um fiscal no **celular**, quando registra vistoria com "Capturar localização" e 2 fotos a partir de uma denúncia, então a vistoria aparece no mapa no ponto capturado; quando gera **Auto de Infração** e **Notificação**, então os PDFs numerados são emitidos.

**T5 – Autenticidade [PoC-5]**
Dada a LO emitida em T1, quando leio o QR Code com outro celular, então `/validar/{codigo}` mostra "VÁLIDO" com os dados; quando o documento é cancelado, a mesma página mostra "CANCELADO".

**T6 – Dashboard [PoC-6]**
Quando filtro "Itaberaba" e depois "Todos", então os cards, gráficos e a tabela por município mudam coerentemente com os dados.

**T7 – Perfis [PoC-7]**
Quando entro como técnico de **Iaçu**, não vejo processos de Itaberaba (nem por URL direta → 403); como SEMA_INEMA vejo tudo mas sem botões de ação; como visitante só acesso o portal.

**T8 – Portal público [PoC-8]**
Sem login, quando consulto pelo nº do processo de T1, então vejo a linha do tempo pública e o CPF mascarado.

**T9 – Relatórios [PoC-9]**
Quando exporto "Indicadores por município" em PDF e XLSX, então os arquivos abrem com cabeçalho institucional e os mesmos números da tela.

**T10 – Backup e portabilidade [PoC-10]**
Quando abro `/admin/backup`, vejo o último backup (≤ 24 h) e a última restauração testada; quando peço exportação completa, recebo ZIP com CSV/JSON por tabela, anexos e `manifest.json`.

---

## 14. Dados de demonstração (seed)

- Organização CDS Piemonte do Paraguaçu + 8 municípios (siglas: IAC, IBQ, ITB, ITT, MNV, RJB, RUY, TPM) com brasão genérico.
- Usuários: 1 admin, 2 técnicos do consórcio, 1 técnico + 1 gestor + 1 fiscal por município (pelo menos Itaberaba, Ruy Barbosa, Iaçu), 1 SEMA_INEMA, 5 requerentes.
- ~40 processos distribuídos em **todos os status**, 25 empreendimentos realistas (laticínio, posto de combustível, olaria, loteamento, avicultura, lava-jato, oficina, extração de areia), 15 licenças emitidas (algumas vencendo), 10 denúncias, 8 vistorias com coordenadas reais dos municípios, 4 autos e 5 notificações.
- Tipologias e tipos de ato de exemplo (seção 5.1).
- Script `npm run seed:demo` idempotente; **nunca** rodar em produção de cliente após a implantação.

---

## 15. Plano de entrega (até a PoC)

| Dia | Entrega | Testes |
|---|---|---|
| D1 | Repositório, CI/CD, infra homolog/prod (região BR), auth, RBAC, multi-município, log de auditoria | T7 |
| D2 | Cadastros (pessoa, RT, empreendimento com mapa), tipologias, tipos de ato, seed | T2 |
| D3 | Processo: wizard do requerente, protocolo, numeração, tramitação, pendências, anexos | T1 (parte) |
| D4 | Checklist, parecer, decisão, motor de prazos + alertas (job + e-mail) | T1, T3 |
| D5 | Documentos oficiais (PDF, QR, validação, cancelamento) + portal público | T5, T8 |
| D6 | Fiscalização mobile, denúncia, mapa, auto de infração, notificação | T4 |
| D7 | Dashboard, relatórios PDF/XLSX, exportação completa, tela de backup | T6, T9, T10 |
| D8 | Carga de demonstração em prod, testes E2E em prod, ensaio da PoC com cronômetro (≤ 4 h) | todos |

Pós-contrato (60 dias): P1 completo, importação de planilhas dos municípios, 1º ciclo de treinamento, relatório de implementação + manual operacional (exigidos pelo TR, item 5.3), relatório mensal de disponibilidade e chamados.

---

## 16. Definição de pronto (DoD)

- Funciona em **produção**, em Chrome/Edge/Firefox e num celular Android real.
- Teste E2E do item passa; regras de escopo testadas (unitário).
- Toda escrita gera auditoria; nenhum segredo no código (variáveis de ambiente/secret manager).
- Textos em português, datas `dd/mm/aaaa`, moeda `R$`.

---

## 17. Pontos a confirmar com o cliente (na implantação)

1. Lista oficial de **tipos de ato**, validades e documentos exigidos por tipologia (SEMA/INEMA e legislação municipal).
2. Tabela de **tipologias/porte/potencial poluidor** a carregar (Resolução CEPRAM nº 4.327/2013 e atualizações).
3. Quem decide/assina em cada município (delegação ao consórcio?).
4. Cobrança de taxas (valores, DAM/boleto) – hoje fora do escopo.
5. Formato de integração desejado com o **SEIA**.
6. Modelos oficiais de licença, auto e notificação de cada município (brasão, textos legais).
