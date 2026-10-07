# Gestão de Documentos (GED) – guia para desenvolvedores e operadores

Módulo de gestão eletrônica de documentos da plataforma LicenciaGov, habilitado **por cliente** (organização/tenant). Nome exibido ao cliente: **"Gestão de Documentos"**. Sem cobrança/faturamento. Dados de demonstração são sempre **fictícios**.

- Desenho aprovado (fonte da verdade das decisões): [`docs/ged-design.md`](ged-design.md).
- Roteiro de demonstração da PoC (13 itens do edital, com cliques e logins): [`docs/poc-ged.md`](poc-ged.md).
- Backup/restauração (inclui a **replicação dos arquivos**): [`docs/backup.md`](backup.md) §4 e [`docs/restore.md`](restore.md).

> Estado: texto escrito para o que existe hoje na árvore. Itens de outras frentes marcados **"conforme entregue"** devem ser conferidos contra o código antes de uma demonstração (a lista de verificação está no fim de `poc-ged.md`).

## 1. Arquitetura em resumo

| Tema | Regra |
|---|---|
| Tenant | `Organizacao`. Campo `Organizacao.modulos` (`LICENCIAMENTO`, `GED`; padrão só `LICENCIAMENTO`). Cliente só-GED não tem município. |
| Papéis | Tabela própria: `GedMembro` + `GedPapel` (`GED_ADMIN`, `GED_GESTOR`, `GED_USUARIO`, `GED_LEITOR`, `GED_AUDITOR`). **Não** usa `Papel`/`UsuarioPapel`: um usuário só-GED tem `Usuario.organizacao_id` e zero `UsuarioPapel`. Matriz em `lib/ged/papeis.ts`. |
| Sessão | `exigirGed()` (páginas) e `ctxGedApi()` (rotas/ações) em `lib/ged/escopo.ts` → `CtxGed { usuario, organizacao_id, membro, setor_ids, db }`. Exige módulo GED ativo e `GedMembro` ativo. Usuário só de licenciamento → 403 em `/ged`. |
| Banco | **Único ponto de acesso**: `lib/ged/db.ts` (`gedDb(organizacaoId)`, `ctx.db`). Injeta `organizacao_id` em todo modelo `Ged*`. `lib/db` direto, `$queryRaw` e `$executeRaw` são proibidos no GED (exceto `lib/ged/busca.ts`) – `tests/unit/ged-fontes.test.ts` varre os fontes. Código de **plataforma** (seed, onboarding, `lib/backup`, jobs que descobrem clientes) pode usar `prisma` direto, mas sempre com `organizacao_id` explícito. |
| Defesa em profundidade | `organizacao_id` NOT NULL e primeiro campo dos índices; triggers `ged_mesmo_tenant()` comparam a organização da linha com a do pai; `tramite`, `comentario` e versões seladas são imutáveis (triggers). RLS do Postgres: **adiado** (ver roadmap). |
| Storage | `ged/{organizacao_id}/{ano}/{documento_id}/v{n}-{sha8}.pdf`. Cliente nunca envia `storage_key`; `lerArquivoGed(orgId, key)` recusa chave de outro cliente. Download/preview só por `/api/v1/ged/documentos/[id]/arquivo` (autenticado, `Cache-Control: private, no-store`). |
| Permissões | `podeNoDocumento(ctx, doc, acao)` e `whereGedVisivel(ctx, acao)` (`lib/ged/permissoes.ts`); ACL por usuário ou setor, em documento ou pasta (herança por `caminho_heranca`). Outro cliente → **404**; mesmo cliente sem `VER` → **404**; com `VER` sem a ação → **403**. `GED_ADMIN` administra tudo mas **não vê documento SIGILOSO sem ACL explícita**. |
| Numeração | `{SIGLA}-DOC-{ano}-{000001}` por cliente (`GedSequencia`, `lib/ged/numeracao.ts`, dentro da transação). |
| Auditoria | Toda escrita chama `auditarGed()` (→ `auditar()` com `organizacao_id`) na mesma transação. |
| Assinatura | Assinatura eletrônica **avançada** por signatário (evidências no banco) + **selo PAdES A1 do órgão** no PDF final (`lib/ged/assinaturas`); verificação pública em `/verificar/[codigo]`. Sem carimbo de tempo/LTV na fase 1. |
| Notificações | Outbox `GedComunicacao` + job `ged-notificar` (e-mail e WhatsApp, com modo simulado). |
| Busca | `pdftotext` (poppler-utils) → `GedConteudoTexto.tsv` (português, sem acento) – job `ged-extrair-texto`. PDF só de imagem → `SEM_TEXTO` e, na fase 2, OCR no servidor (fila `ged-ocr`, §13) gera uma nova versão pesquisável. |

## 2. Tabelas

Todas com `organizacao_id`, `created_at`, `updated_at` e `@@map("ged_…")`:
`ged_config`, `ged_membro`, `ged_setor`, `ged_setor_membro`, `ged_tipo_documento`, `ged_pasta`, `ged_documento`, `ged_versao_documento`, `ged_conteudo_texto`, `ged_deteccao_dado_pessoal`, `ged_marcador`, `ged_documento_marcador`, `ged_acl`, `ged_tramite`, `ged_solicitacao_assinatura`, `ged_assinante`, `ged_comentario`, `ged_acesso_log`, `ged_comunicacao`, `ged_preferencia_notificacao`, `ged_sequencia`, `ged_importacao`, `ged_importacao_item`, `ged_protocolo`, `ged_protocolo_evento`, `ged_protocolo_documento`, `ged_protocolo_assunto`. Definição: `prisma/schema.prisma` e §2 do desenho.

## 3. Rotas

Páginas (`app/(ged)/ged/…`, todas `force-dynamic`; **conforme entregue** por cada frente): `/ged` (início), `/ged/documentos`, `/ged/documentos/novo`, `/ged/documentos/[id]`, `/ged/editor/novo`, `/ged/editor/[id]`, `/ged/pastas`, `/ged/importar` (+ `[id]`), `/ged/protocolo` (+ `novo`, `[id]`), `/ged/assinaturas`, `/ged/assinaturas/[id]`, `/ged/tramite`, `/ged/logs`, `/ged/minha-conta`, `/ged/minha-conta/notificacoes`, `/ged/admin` (+ `setores`, `marcadores`, `tipos`; membros/canal/certificado/exportação conforme entregue). Públicas (sem login): `/verificar` e `/verificar/[codigo]`, `/verificar/protocolo/[codigo]`, `/protocolo/[slug]` e `/protocolo/[slug]/consulta` (§14).

API `/api/v1/ged/*` (sempre `rota()` + `ctxGedApi()`; a API **pública** do portal fica em `/api/v1/publico/protocolo/{slug}/…`, sem sessão, §14): `documentos` (+ `/[id]`, `/[id]/arquivo`, `arquivar`, `restaurar`, `marcadores`, `dados-pessoais`), `busca`, `pastas`, `importacoes` (+ `/[id]`), `protocolos` (+ `/[id]`, `/[id]/comprovante`), `marcadores`, `tipos`, `setores`, `acl`, `comentarios`, `tramite` (+ `caixa`, `/[id]`), `editor` (+ `/[id]/rascunho|finalizar|reabrir`), e (conforme entregue) `assinaturas`, `logs`, `notificacoes`.

Login: usuário só-GED entra sem escolher órgão e cai em `/ged`; usuário só-GED em `/dashboard` ou `/processos` é redirecionado para `/ged`.

## 4. Jobs (worker `npm run jobs`; fuso `JOBS_TZ`, padrão America/Bahia)

`registrarJobsGed()` (`jobs/ged.ts`) carrega um arquivo por frente:

| Fila | Arquivo | Quando | O que faz |
|---|---|---|---|
| `ged-extrair-texto` | `jobs/ged-texto.ts` | varredura a cada `JOBS_GED_TEXTO_MS` (15 s) | extrai texto dos PDFs pendentes de todos os clientes (job com o escopo da organização) |
| `ged-ocr` | `jobs/ged-ocr.ts` | varredura a cada `JOBS_GED_OCR_MS` (20 s) | OCR (`ocrmypdf`) das versões digitalizadas pendentes de todos os clientes, 1 por vez (§13); worker dedicado com `JOBS_FILAS=ged-ocr` |
| `ged-importar` | `jobs/ged-importar.ts` | varredura a cada `JOBS_GED_IMPORTAR_MS` (10 s) | processa os lotes de importação de ZIP pendentes (ou parados há > 10 min) de todos os clientes (§12) |
| `ged-assinaturas` | `jobs/ged-assinaturas.ts` | `JOBS_CRON_GED_ASSINATURAS` (padrão `7 * * * *`) | lembretes e expiração de solicitações |
| `ged-notificar`, `ged-retencao-logs` | `jobs/ged-notificar.ts` | sob demanda / `JOBS_CRON_GED_RETENCAO` (padrão `40 3 * * *`) | envia a outbox (e-mail/WhatsApp); retenção de logs de acesso |
| `storage-replicar` | `jobs/ged-backup.ts` | `JOBS_CRON_REPLICACAO` (padrão `0 3 * * *`) | copia arquivos novos para o destino de backup (ver §6) |
| `storage-reconciliar` | `jobs/ged-backup.ts` | `JOBS_CRON_RECONCILIACAO` (padrão `30 4 * * 0`, domingo) | compara banco × destino e copia o que faltar |

## 5. Variáveis de ambiente

| Variável | Uso |
|---|---|
| `CHROMIUM_PATH` | PDFs (editor, folha de assinaturas, seed). Container de dev: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` |
| `STORAGE_DRIVER`, `STORAGE_LOCAL_DIR`, `S3_*` | storage dos arquivos (local ou S3-compatível) |
| `GED_IMPORTACAO_TMP` | disco temporário da importação (ZIP remontado; padrão `<tmp>/ged-importacao`; precisa de espaço para o maior ZIP, ~2 GB) |
| `DATA_KEY` | cifra de telefone/dados pessoais e senha do backup (se não houver `BACKUP_PASSPHRASE`) |
| `SMTP_URL`, `APP_URL` | e-mail e links das notificações |
| `EVOLUTION_API_KEY` (e canal em `GedConfig.canal_whatsapp_id`) | WhatsApp (envio; sem pareamento use o modo simulado do canal) |
| `GED_TEXTO_INLINE=true` | extrai texto no próprio request (sem worker) – desenvolvimento |
| `GED_OCR_BIN`, `GED_OCR_IDIOMA`, `GED_OCR_JOBS`, `GED_OCR_TIMEOUT_MS`, `GED_OCR_MAX_PAGINAS`, `GED_OCR_MAX_MB` | OCR (§13): binário (padrão `ocrmypdf`), idioma (`por`), `--jobs` (2), tempo máximo por arquivo (15 min), limites de páginas (300) e tamanho (25 MB) |
| `GED_OCR_INLINE=true`, `GED_OCR_DESATIVADO=true`, `JOBS_FILAS=ged-ocr`, `JOBS_GED_OCR_MS` | OCR no próprio web mesmo havendo worker (dev) · desliga o OCR neste processo · worker dedicado só de OCR · intervalo da varredura |
| `PROTOCOLO_LIMITE_ENVIO_IP`, `PROTOCOLO_LIMITE_ENVIO_JANELA_MIN`, `PROTOCOLO_LIMITE_ENVIO_PORTAL` | anti-abuso do portal de protocolo (§14): envios por IP na janela (8 em 60 min) e teto por portal (300) |
| `GED_NOTIFICAR_LOTE`, `GED_NOTIFICAR_VARREDURA_MS`, `GED_NOTIFICAR_VARREDURA_LIMITE` | vazão do envio de notificações |
| `JOBS_CRON_REPLICACAO`, `JOBS_CRON_RECONCILIACAO` | agendas da replicação de arquivos |
| `BACKUP_S3_*`, `BACKUP_ARQUIVOS_DIR`, `BACKUP_ARQUIVOS_PREFIX`, `REPLICACAO_LOTE`, `REPLICACAO_TEMPO_MAX_MIN` | destino e dimensionamento da replicação (docs/backup.md §4) |
| `SEED_GED_DEMO=true` | `scripts/predeploy.sh` roda `npm run seed:ged-demo` (Railway) |
| `GED_LIMPAR_ORG`, `GED_LIMPAR_EXECUTAR`, `GED_LIMPAR_CONFIRMAR` | limpeza do conteúdo do GED de um cliente no pré-deploy (§15); sem `EXECUTAR` só dry-run |
| `E2E_GED_IDS=1`, `E2E_GED_IDS_FILE` | o seed grava o mapa de IDs usado pelo E2E (`tests/e2e/.ged-ids.json`) |
| `ONBOARD_SENHA` | senha fixa no onboarding (sem `--demo` mantém a troca obrigatória) |

## 6. Onboarding de um cliente GED – passo a passo

1. **Contrato/DPA**: o cliente é o controlador; o prestador é o operador (LGPD). Confirmar com o cliente: setores, tipos de documento, pastas, quem assina e se há certificado e-CNPJ A1.
2. Crie `prisma/seed/clientes/<cliente>.json` (modelos: `ged-demo-a.json`, `ged-demo-b.json`):
   ```json
   {
     "modulos": ["GED"],
     "organizacao": { "nome": "…", "sigla": "XYZ", "cnpj": null, "logo_url": null },
     "ged": {
       "config": { "assinatura_prazo_dias": 15, "lembrete_dias": [3, 1, 0], "retencao_acesso_log_dias": 730 },
       "setores": [{ "nome": "Protocolo", "sigla": "PROT" }],
       "tipos_documento": ["Ofício", "Contrato"],
       "marcadores": [{ "nome": "Urgente", "cor": "#dc2626" }],
       "pastas": [{ "caminho": "Documentação da licitação/Editais", "sensibilidade_padrao": "PUBLICO" },
                  { "caminho": "Pessoal", "herda_acl": false, "sensibilidade_padrao": "SIGILOSO" }],
       "usuarios": [{ "email": "…", "nome": "…", "cargo": "…", "papel_ged": "GED_ADMIN", "setores": [{ "sigla": "PROT", "chefe": true }] }]
     }
   }
   ```
   Regras: `modulos` aceita `LICENCIAMENTO` e/ou `GED` (padrão `["LICENCIAMENTO"]`; cliente híbrido informa os dois). Sem `LICENCIAMENTO` não há `municipios`, `usuarios[]` de licenciamento nem `catalogo`. Pastas intermediárias são criadas sozinhas (`"A/B/C"` cria A, A/B e A/B/C); sensibilidade não informada herda a da pasta-pai; `herda_acl` padrão `true`.
3. Execute: `npm run onboard -- <cliente> [--demo] [--atualizar] [--redefinir-senhas]`.
   - Idempotente: organização por sigla, usuário por e-mail, setor por sigla, pasta por caminho, tipo/marcador por nome. Nunca apaga.
   - **Aborta** (sem gravar nada) se um e-mail já pertence a **outra organização** ou é de um **requerente**.
   - Senhas temporárias impressas **uma única vez** (troca obrigatória no 1º acesso); `ONBOARD_SENHA` fixa a senha; `--demo` usa `Demo@2026licencia` sem troca obrigatória.
   - Organização que já existe sem o módulo GED só o habilita com `--atualizar` (união de módulos). Pasta existente com `herda_acl` diferente não é alterada pelo onboarding (use a tela de pastas, que recalcula as permissões).
4. Entre como o administrador do cliente (`/login`, deixe o órgão em branco) e confira `/ged/admin`: setores, membros, canal de WhatsApp, certificado A1 do órgão (para o selo PAdES), exportação.
5. Entregue as senhas por canal seguro. Registre o cliente no controle de backup: os arquivos entram na replicação automaticamente (prefixo `ged/<organizacao_id>/`).
6. Módulo desativado depois: dados preservados; as telas respondem "módulo não contratado".

## 7. Contas de demonstração (`npm run seed:ged-demo`)

Senha de todos: `Demo@2026licencia` · e-mails `@gestaodocumentos.demo` · entrar em `/login` com o órgão **em branco**.

| Cliente | Usuário | Papel | Observações |
|---|---|---|---|
| **VAC** – Câmara Municipal de Vale das Acácias (DEMO) | `admin.vac@` | GED_ADMIN | não vê o documento SIGILOSO |
| | `gestor.vac@` | GED_GESTOR | setor Licitações (chefe); 1º signatário do Contrato 001/2026; criador do documento sigiloso |
| | `servidor1.vac@` | GED_USUARIO | Protocolo (chefe) e Licitações; autor da maioria dos documentos |
| | `servidor2.vac@` | GED_USUARIO | Financeiro; recebe o Ofício 12/2026; VER no sigiloso por ACL (30 dias) |
| | `vereador.vac@` | GED_LEITOR | signatário (1º do Termo Aditivo; recusou o Parecer 07/2026) |
| | `auditor.vac@` | GED_AUDITOR | Controle Interno; lê `/ged/logs`; VER no sigiloso por ACL |
| **AAC** – Autarquia de Águas do Cerrado (DEMO) | `admin.aac@`, `gestor.aac@`, `servidor.aac@` | ADMIN / GESTOR / USUARIO | documentos com os mesmos títulos de VAC (isolamento) |

Dados criados (idempotente; reconhecidos pelo título dentro do cliente): ver o cabeçalho de `prisma/seed/ged-demo.ts` e o roteiro `docs/poc-ged.md`. Resumo VAC: Ofício 12/2026 (em trâmite), Contrato 001/2026 (aguardando assinaturas, comentários, ACL), Termo Aditivo 001/2026 (reservado para assinar ao vivo), Parecer 07/2026 (assinatura **recusada** com justificativa), Minuta de Ofício 15/2026 (rascunho do editor), Ofício recebido nº 0045 (PDF de imagem, `SEM_TEXTO`), Ata 018/2026 (dados pessoais + anonimização pendente), Processo Administrativo Disciplinar 003/2026 (SIGILOSO em `Pessoal`), Edital/Ata do Pregão 03/2026 (públicos), Empenho, Nota fiscal e Relatório; ACLs de pasta por setor e usuário; logs de acesso e de comunicação de exemplo. Também: **Termo de Cooperação 005/2026**, assinado (vereador → gestor) e **selado** pelo serviço real de assinaturas, com um certificado A1 de **TESTE** ("CERTIFICADO DE TESTE – SEM VALOR LEGAL", e-CNPJ, titular ORGAO) criado para VAC; o código verificador e os IDs vão para `tests/e2e/.ged-ids.json` com `E2E_GED_IDS=1`.

## 8. Como rodar os testes

```bash
npm run typecheck && npm run lint
npm test                                   # vitest (tests/unit): ged-*.test.ts, onboarding-ged.test.ts, backup-arquivos.test.ts
# integração com banco (isolamento via gedDb): tests/integration/ged-isolamento-db.ts; assinaturas: tests/unit/ged-assinaturas.integracao.ts

# E2E (Playwright) – o GED usa dois clientes fictícios (VAC e AAC) e roda no MESMO banco do licenciamento
npx prisma migrate deploy && npm run seed:demo && npm run onboard -- riachao-das-neves --demo && npm run seed:riachao-demo
E2E_GED_IDS=1 npm run seed:ged-demo        # precisa de CHROMIUM_PATH (PDFs e selo); grava tests/e2e/.ged-ids.json (não versionar)
npm run test:e2e                           # suíte inteira (T1–T15 de licenciamento + T16–T23 do GED)
npx playwright test tests/e2e/t1[6-9]* tests/e2e/t2[0-3]* --project=desktop-chromium   # só o GED
```

| Spec | O que cobre | Observações |
|---|---|---|
| `t16-ged-isolamento` | um cliente por ID direto no outro (páginas, arquivo, versão, comentários, trâmite, ACL, assinaturas, logs) = 404; listas/busca sem vazamento; login/redirecionos | somente leitura (um POST recusado); dois projetos |
| `t17-ged-documentos` | upload, filtros (título, remetente, data, marcador, pasta), busca por conteúdo com trecho, marcadores (CRUD + aplicar), pastas (criar/subpasta/mover), ACL Ver/Editar/Assinar por usuário, sigiloso × administrador, "dados pessoais" rebaixa a sensibilidade | desktop; dados com sufixo único (re-executável) |
| `t18-ged-editor-tramite` | editor (autosave → PDF), trâmite completo, linha do tempo imutável, comentários; triggers do banco recusam `UPDATE` | `t18c` usa `DATABASE_URL` (via `tests/e2e/t20-banco.ts`) |
| `t19-ged-assinaturas` | solicitação sequencial com 2 signatários, ordem, comentário, senha errada, assinar, selo com código, recusa com justificativa, painel por status, PDF selado (PAdES, imagem do QR em cada página, folha de assinaturas), `/verificar/{codigo}` sem login, WebCrypto (íntegro / 1 byte alterado) e código inexistente | a parte "selado" usa o documento do seed |
| `t22-ged-ocr` | PDF "escaneado" (só imagem, gerado no teste) → OCR real: nova versão `origem=OCR` pesquisável, scan original com o mesmo sha256, assinatura aberta **não** cancelada, busca (API e UI), outro cliente sem acesso; cota mensal de OCR em `/ged/admin/configuracoes` | desktop; precisa de `ocrmypdf`+`tesseract-ocr-por` no servidor (senão `test.skip` com o motivo); sem worker o web roda o OCR em segundo plano |
| `t23-ged-protocolo` | servidor registra entrada (balcão) e saída pela UI e baixa o comprovante (PDF, CPF/CNPJ mascarado, sha256 dos anexos); andamento e máquina de situações; **cidadão** protocola no portal público (`/protocolo/{slug}`), baixa o comprovante e consulta o andamento só com número + código; e-mails ao interessado (confirmação e mudança de situação, "Enviado em … (horário de Brasília)"); `/verificar/protocolo/{código}` (autêntico, sem dados pessoais, hash conferido no navegador, 1 byte alterado = falha); registro imutável no banco; permissões (Leitor/Auditor só leem); portal desligado/slug inexistente = 404; consulta nunca cruza clientes; honeypot e limite de IP (429); ligar/desligar o portal em Configurações | desktop; precisa de `DATABASE_URL`/`DATA_KEY` no ambiente do teste (e-mails) e de `pdftotext`; o seed cria o portal fictício de VAC |
| `t20-ged-notificacoes-logs` | e-mail do trâmite (assunto, link, "Enviado em dd/mm/aaaa às HH:mm (horário de Brasília)", sem anexo), WhatsApp simulado com opt-in por código, `/ged/logs` (3 abas, filtros, CSV, 403 para Leitor/Usuário) | no E2E não há worker: `tests/e2e/t20-banco.ts` executa a mesma `processarComunicacao()` direto no banco (precisa de `DATABASE_URL` e `DATA_KEY` iguais aos do servidor; sem elas os testes de envio se pulam) |

Dicas de robustez (helpers em `tests/e2e/ged-helpers.ts`): sem `networkidle`; `aguardarHidratacao()` espera o React hidratar (os `FormGed` só funcionam depois); `submeter()` repete o clique uma vez; formulários que **somem** depois de salvar (ciência, devolução, arquivamento, enviar para assinatura) são conferidos pelo resultado (linha do tempo, painel), não pela mensagem; `window.confirm` é aceito por `aceitarDialogos()`.

**CI** (`.github/workflows/ci.yml`, job E2E): instala o Chromium do Playwright e define `CHROMIUM_PATH` **antes** dos seeds; instala `poppler-utils` (pdftotext, busca por conteúdo de upload) e `ocrmypdf tesseract-ocr tesseract-ocr-por` (t22: OCR real; sem eles o spec se pula); roda `seed:demo`, o onboarding/seed de Riachão e `E2E_GED_IDS=1 npm run seed:ged-demo`; só então faz o build e sobe o servidor. Sem `.ged-ids.json` os specs t16–t20 se pulam com a instrução no motivo. O seed do GED não altera os dados do licenciamento (organizações VAC/AAC são só-GED, sem municípios, e os usuários `@gestaodocumentos.demo` não têm papel de licenciamento).

Banco isolado para trabalho paralelo: `CREATE DATABASE licenciagov_ged_x` + `DATABASE_URL=… npx prisma migrate deploy` (linhas imutáveis não podem ser apagadas).

## 9. Como adicionar uma tabela ao GED

1. Modelo `Ged…` no `schema.prisma` com `organizacao_id String @db.Uuid` (NOT NULL), relação para `Organizacao` e **índice com `organizacao_id` na frente**.
2. Migração: trigger `ged_mesmo_tenant()` para cada FK para outra tabela do GED/usuário; trigger de imutabilidade se for trilha (`bloqueia_alteracao()`).
3. Regra em `filtroTabela()` (`lib/export/exportar.ts`) e descrição em `DESCRICAO_TABELA`; coluna `tsv`/binária fora da exportação.
4. Acesso **somente** via `ctx.db`/`gedDb()`; escrita com `auditarGed()` na mesma transação.
5. `tests/unit/ged-schema.test.ts` falha se faltar `organizacao_id`, índice ou regra de exportação. Inclua a tabela em `TABELAS_APAGADAS` ou `TABELAS_PRESERVADAS` de `scripts/ged/plano-limpeza.ts` (o teste `ged-limpeza` falha sem isso; a ordem precisa respeitar as FKs). Se a tabela tiver arquivo no storage, inclua a chave na replicação (`inventarioDesde`/`inventarioCompleto` em `lib/backup/arquivos.ts`) e na exportação de anexos.

## 10. Limites conhecidos (fase 1)

- Upload somente **PDF**, até **25 MB**; cota por cliente em `GedConfig.cota_bytes` (aplicação conforme entregue).
- PDF só de imagem só fica pesquisável depois do OCR (§13), que exige worker com `ocrmypdf`; sem ele o estado é "OCR indisponível".
- Assinatura por signatário é eletrônica avançada; o selo PAdES é do **órgão** (e-CNPJ A1). Sem certificado cadastrado, o PDF recebe aviso de "assinatura eletrônica avançada". Sem carimbo de tempo RFC 3161 nem LTV. Certificado da PoC é de teste, sem valor legal.
- Validade jurídica do digitalizado (Decreto 10.278/2020) a confirmar com a assessoria jurídica do cliente.
- Replicação de arquivos cobre `Anexo`, `DocumentoOficial` e `GedVersaoDocumento`. **Não** cobre `ReuniaoConselho.ata_pdf_key`, `MensagemConversa.midia_key`, `Cobranca.comprovante_key` nem os ZIPs de `Exportacao` (transitórios).
- Residência dos dados: a Railway não tem região no Brasil – risco de transferência internacional a tratar com o cliente.
- WhatsApp: provedor não oficial tem risco de banimento; a API oficial exige templates. Ter o modo simulado como plano B.
- `ged_acesso_log` cresce rápido: retenção por `GedConfig.retencao_acesso_log_dias` (job `ged-retencao-logs`); particionar por mês se passar de ~50 milhões de linhas.

## 11. Roadmap

~~OCR (fila `ged-ocr`, `ocrmypdf`, nova versão `origem=OCR`)~~ (entregue, §13) · ~~importação de pasta/ZIP~~ (entregue, §12) · portal do cliente para documentos publicados (exposição pública só de derivados anonimizados, `whereExposicaoPublica()`; o **protocolo online** já existe, §14) · fechamento mensal da digitalização · motor de anonimização (detecção de CPF/CNPJ/e-mail/telefone e IA opcional; o modelo já existe) · **hardening com RLS** (role `NOSUPERUSER NOBYPASSRLS`, role separado para migração, `set_config('app.org', …, true)` por transação) · assinatura ICP-Brasil por signatário (PAdES incremental) · carimbo de tempo/LTV · lixeira e retenção de documentos · replicação com versionamento/Object Lock no bucket de backup.

## 12. Importação em lote: pasta e ZIP (fase 2, v2)

Para quem digitaliza no Windows, organiza em pastas (licitação, financeiro, contabilidade…) e envia cópias mensais: a **estrutura de pastas vira a árvore de pastas do GED**. Quem pode: **GED_ADMIN e GED_GESTOR** (`podeImportarGed`). A v2 aguenta pacotes de mais de 1 GB e milhares de arquivos.

**Tela `/ged/importar` (menu "Importar pasta/ZIP")**, duas abas:
- **Enviar pasta (recomendado)**: escolha a pasta (input `webkitdirectory`) ou **arraste** a pasta (recursivo, `webkitGetAsEntry`), sem zipar; o caminho relativo é preservado. Antes de enviar a tela mostra o **resumo**: nº de arquivos e tamanho, PDFs, ZIPs a abrir, ZIPs duplicados (não enviados), ignorados por formato, ocultos. Envio arquivo a arquivo com **concorrência 4**, barra geral + por arquivo, **retentativa** (5x, espera crescente) por arquivo, **pausar/retomar**, cancelar. sha256 calculado no navegador (`crypto.subtle`) e conferido no servidor.
- **Enviar ZIP**: até ~2 GB, em **partes de 8 MB** (`PUT …/partes/{n}`, 6 retentativas, concorrência 2) porque proxies cortam requisições longas.
- Em ambas: pasta de destino, tipo, sensibilidade e a opção **"Unir pastas repetidas (A/A → A)"** (desligada por padrão: a estrutura é preservada exatamente como veio; ligada, pastas consecutivas de mesmo nome, sem diferenciar maiúsculas, viram uma; o relatório mantém o caminho original).
- **Retomada**: um lote cujo envio foi interrompido fica **"Aguardando envio"** (`RECEBENDO`); em `/ged/importar/{id}` escolha de novo a mesma pasta/ZIP e só o que falta é enviado (compara caminho + tamanho + sha256 com `GET …/recebidos`; ZIP: partes já recebidas). Lote nunca finalizado é descartado após 3 dias (job); só ocupa "vaga" por 2 h sem atividade.
- Relatório (`/ged/importar/{id}`): contadores (arquivos, importados, duplicados, ignorados, erros, pastas criadas, tamanho importado/total), lista **filtrável e paginada** por situação e **CSV** (`?formato=csv`). Admin vê todos os lotes do cliente; Gestor só os seus.

**API** (`/api/v1/ged/importacoes`, todas com `ctxGedApi` + `importar`; lote de outro cliente/de outro usuário = 404):

| Rota | Função |
|---|---|
| `POST /` (multipart) | ZIP pequeno (até 64 MB) de uma vez; vira `PENDENTE` |
| `POST /pasta` (JSON) | abre lote de pasta (`RECEBENDO`): `nome, total_esperado, pasta_id, tipo_id, sensibilidade, unir_pastas` |
| `POST /{id}/arquivos` | UM arquivo (corpo = bytes; cabeçalhos `X-Caminho` percent-encoded, `X-Sha256`); idempotente por caminho; só PDF/ZIP guardados (outros = "Ignorado"; oculto/lixo nem vira item; `..` = "Erro"; > 25 MB = "Erro" sem guardar) |
| `POST /zip-partes` (JSON) | inicia ZIP em partes: `nome_arquivo, tamanho` → `partes_total, tamanho_parte` |
| `PUT /{id}/partes/{n}` | parte n (tamanho exato; idempotente; ordem livre) |
| `GET /{id}/recebidos?depois=` | o que o servidor já tem (itens paginados por 5000; `partes`) |
| `POST /{id}/concluir` | fecha o envio → `PENDENTE` (ZIP exige todas as partes: 409 `PARTES_FALTANDO`; pasta aceita `ignorados[]` e `ocultos`); idempotente |
| `DELETE /{id}` | cancela lote `RECEBENDO` e apaga o que foi enviado |

**Regras** (`lib/ged/importacao/*`):

| Tema | Regra |
|---|---|
| Pastas/documentos | como na v1: `criarPasta()` (EDITAR no pai) reaproveitando pasta de mesmo nome; `criarDocumentoUpload()` (origem `UPLOAD`, antivírus, número, versão 1, ACL do criador, auditoria). Título = nome sem `.pdf`. |
| Duplicados | mesmo **sha256** na **organização** (documento não excluído) → pulado e relatado; índice `(organizacao_id, sha256)`; para pasta o sha256 vem do envio e o arquivo nem é relido. Nunca compara com outro cliente. |
| Extensões / lixo | só **PDF** (e `.zip`, ver abaixo); `__MACOSX`, `.DS_Store`, `Thumbs.db`, `desktop.ini`, `~$*` e ocultos viram só um contador. |
| **ZIP aninhado** | `.zip` com **pasta irmã de mesmo nome-base** no mesmo diretório (o zip é cópia da pasta) → **ignorado** ("ZIP duplicado da pasta irmã"); sem pasta irmã → **expandido como pasta** com o nome-base do zip, extraído em fluxo para disco temporário (até 512 MB). Aninhamento máx. 2 (ZIP > ZIP > ZIP); além disso o item vira erro. O ZIP aninhado aparece no relatório como "Ignorado" com a nota de expansão. Mesmas guardas; teto de arquivos vale para o lote todo. A regra roda no navegador (não envia o zip duplicado: economiza centenas de MB) **e** no servidor. |
| zip-slip / zip-bomb | como na v1 (caminho absoluto, `C:`, `..`, controles → erro do item; inflação cortada no tamanho declarado, CRC e tamanho conferidos). Limites em `limites.ts`: ZIP 2 000 000 000 B (cabe em INTEGER); 40 000 entradas; **20 000 arquivos**; 5 000 pastas; 12 níveis; **6 GB** descompactados (por ZIP); 25 MB por arquivo; razão ≤ 250. |
| ZIP grande | partes ficam em `ged/{org}/importacao/{id}/partes/…`; o job as remonta em **disco temporário** (`GED_IMPORTACAO_TMP`, padrão `<tmp>/ged-importacao`) e lê o diretório central e cada entrada **por posição** (`ZipDisco`); **ZIP64** suportado. Memória: uma parte (8 MB) ou um arquivo (≤ 25 MB) por vez. |
| Pasta | arquivos em `ged/{org}/importacao/{id}/arq/{item}`; a fila de processamento é o próprio banco (`ged_importacao_item.status = RECEBIDO`, em ordem de caminho): memória constante, retomável. |
| OCR | a importação **não espera**: `criarDocumentoUpload` já enfileira texto/OCR (PDF com texto indexa, escaneado vai para a fila `ged-ocr`). |
| Isolamento | tudo via `gedDb(organizacao_id)`; chaves de storage validadas sob `ged/{org}/importacao/`; tabelas `ged_importacao`/`ged_importacao_item` (já com `ged_mesmo_tenant` e regra em `filtroTabela()`); nenhuma tabela nova na v2. |

**Execução**: no máximo 3 lotes ativos por cliente (429 acima). O job `ged-importar` processa em segundo plano (sem worker, o web processa inline; `GED_IMPORTACAO_INLINE=true` força); cada arquivo é independente; progresso persistido por item; lote `PROCESSANDO` sem sinal de vida por 10 min é retomado (itens já gravados são pulados; ZIP aninhado por caminho); ao fim storage e disco temporário são limpos (inclusive em `FALHOU`). Auditoria: `GED_IMPORTACAO_CRIADA` / `_ENVIADA` / `_CANCELADA` / `_CONCLUIDA` / `_FALHOU`. Estados do lote: `RECEBENDO` → `PENDENTE` → `PROCESSANDO` → `CONCLUIDA` | `CONCLUIDA_COM_ERROS` | `FALHOU`; item: `RECEBIDO` → `IMPORTADO` | `DUPLICADO` | `IGNORADO` | `ERRO`.

**Teste de carga** (local, build de produção, web processando inline): pasta com 2 000 PDFs (210 MB, A/A): envio 15 s (concorrência 4), processamento 122 s, 2 000 importados; ZIP de 400 MB (40 PDFs de 10 MB incompressíveis, 51 partes): envio 2 s, processamento 14 s. RSS do servidor: 330 MB ocioso → ~635 MB (estável) na pasta → pico 733 MB no ZIP (a v1 precisaria > 1,2 GB só para o ZIP).

**Testes**: `tests/unit/ged-importacao-zip.test.ts` e `ged-importacao-v2.test.ts` (ZIP em disco/ZIP64, aninhado, limites, caminhos, união, plano da pasta, fila/pausa/retentativa), E2E `t21-ged-importacao.spec.ts` (ZIP pela tela) e `t24-ged-importacao-pasta.spec.ts` (pasta via `setInputFiles`, retomada, ZIP em partes, ZIP aninhado, união, validações, isolamento). **Limites conhecidos**: ZIP aninhado > 25 MB sem pasta irmã não sobe pela aba "pasta" (use a aba ZIP); só PDF.

## 13. OCR no servidor (fase 2)

PDFs digitalizados (só imagem) ficavam em `SEM_TEXTO` e a busca não os achava. Agora o servidor reconhece o texto com **`ocrmypdf`** (Tesseract, português) e o documento passa a ser pesquisável. Código em `lib/ged/ocr/*` (`decisao.ts` regras puras · `executar.ts` processo externo · `servico.ts` fila/cota/execução · `reprocessar.ts` ação do usuário) e fila `ged-ocr` (`jobs/ged-ocr.ts`).

**Fluxo**
1. Upload (ou importação de ZIP) → `ged-extrair-texto` roda `pdftotext`. Se o texto é escasso (< ~25 caracteres/página no total, **ou** metade ou mais das páginas sem texto – PDF misto) a versão recebe `ocr_status=PENDENTE`. Imagens PNG/JPG/TIFF sempre precisam de OCR (o upload do GED ainda só aceita PDF; a regra já cobre imagens).
2. O worker (varredura de 20 s, `singletonKey` = versão, fila com `policy: short`) reivindica a versão (`PENDENTE → PROCESSANDO`, atômico), confere limites e **cota**, e executa `ocrmypdf -l por --skip-text --jobs 2 --output-type pdf` (timeout 15 min; `--skip-text` preserva as páginas que já têm texto). `PROCESSANDO` há mais de 30 min (worker caiu) volta a `PENDENTE`.
3. Sucesso → **nova versão** `origem=OCR` (`derivada_de_id` = scan; torna-se a versão atual), com o texto em `GedConteudoTexto` (`metodo=OCR`, alimenta o `tsvector` existente) e `texto_status=EXTRAIDO`. A versão original **permanece** (mesmo sha256, baixável); a base fica `ocr_status=CONCLUIDO`. Auditoria `GED_OCR_CONCLUIDO` (com os hashes das duas versões).
4. Sem texto reconhecido, limites estourados ou falha do processo → `ERRO` (com motivo curto); binário ausente → `OCR_INDISPONIVEL`; cota estourada → `COTA_EXCEDIDA`. O upload nunca falha por causa do OCR.

**Regras de segurança do documento**
- A versão OCR **não cancela** solicitação de assinatura aberta (`OCR` não está em `ORIGENS_QUE_CANCELAM_ASSINATURA`: só acrescenta camada de texto; a solicitação continua apontando para a versão que foi enviada à assinatura).
- OCR **nunca** roda em versão selada, em documento `ASSINADO`/`ARQUIVADO`, nem sobre versões `OCR/SELO/EDITOR/ANONIMIZACAO` (sem laços). Se o documento recebeu outra versão ou foi assinado enquanto o OCR rodava, o resultado é descartado.
- Autor da versão OCR: o autor da versão-base (ou um `GED_ADMIN` ativo); a auditoria marca `automatico: true`.
- Tudo via `gedDb(organizacao_id)`; sem SQL cru; colunas novas em tabelas já cobertas pela exportação (`GedVersaoDocumento`, `GedConfig`).

**Cota** – `GedConfig.ocr_cota_paginas_mes` (padrão **5000** páginas/mês por cliente; vazio = sem limite; 0 = OCR desligado), editável por GED_ADMIN em `/ged/admin/configuracoes`, que também mostra o uso do mês. O consumo é a soma de `paginas` das versões `OCR` criadas no mês (fuso de Brasília); tentativas que falham não consomem. Ao estourar: `COTA_EXCEDIDA`, aviso na ficha do documento e auditoria `GED_OCR_COTA_EXCEDIDA`.

**Interface** – na tabela de versões da ficha do documento: **OCR pendente / processando / concluído / indisponível / cota excedida / falhou** (`data-testid="ocr-status"`). **Reprocessar OCR** (GED_ADMIN e GED_GESTOR com EDITAR) aparece quando a versão atual está em `ERRO`, `OCR_INDISPONIVEL`, `COTA_EXCEDIDA` ou é um scan antigo (`SEM_TEXTO` sem tentativa de OCR); auditoria `GED_OCR_REPROCESSADO`. A API de documento (`GET /api/v1/ged/documentos/:id`) devolve `ocr_status` por versão.

**Operação**
- O OCR é pesado (CPU/memória): rode-o em **worker dedicado** (`JOBS_FILAS=ged-ocr npm run jobs` – só essa fila, `application_name` diferente, sem os agendamentos gerais) e, no worker geral, `GED_OCR_DESATIVADO=true` se ele não deve concorrer. Importações grandes enfileiram muitos scans: um worker processa um por vez.
- Imagem: `ocrmypdf ghostscript tesseract-ocr tesseract-ocr-por qpdf unpaper` instalados no estágio `worker` de `Dockerfile`/`Dockerfile.worker` (**+400–600 MB**; o estágio `app` não os carrega). Veja `deploy/railway.md`.
- Sem worker e **com** o binário no próprio web (dev/CI), o OCR roda em segundo plano no processo web; sem o binário a versão fica `PENDENTE` até um worker pegá-la. `GED_OCR_BIN` aponta outro executável (ex.: wrapper).
- Limites: 300 páginas e 25 MB por arquivo (`GED_OCR_MAX_PAGINAS`, `GED_OCR_MAX_MB`). Não otimiza nem converte para PDF/A (`--output-type pdf`).

**Testes**: `tests/unit/ged-ocr.test.ts` (decisão, elegibilidade, cota, status, chamada do binário com `spawn` mockado, timeout) e `tests/e2e/t22-ged-ocr.spec.ts` (OCR real).

## 14. Protocolo (livro de entrada, saída e interno; portal do cidadão)

Hoje o GED numera documentos (`VAC-DOC-2026-…`) e tramita. O **protocolo** acrescenta o *ato de protocolar* e o *comprovante*: um **livro por cliente** com três livros — **ENTRADA** (recebido de pessoa/órgão externo: balcão ou portal), **SAÍDA** (enviado a externo) e **INTERNO** (entre setores/pessoas) — e um **portal público** em que o cidadão ou fornecedor entrega documentos sem login. Código em `lib/ged/protocolo/*`; desenho e decisões em `docs/ged-design.md` §12.

**Tabelas** (`organizacao_id` NOT NULL, primeiro campo dos índices, trigger `ged_mesmo_tenant`, regras em `filtroTabela()`/`DESCRICAO_TABELA`): `ged_protocolo` (o registro), `ged_protocolo_evento` (andamento), `ged_protocolo_documento` (anexos) e `ged_protocolo_assunto` (assuntos do portal). Também: `organizacao.slug_publico` (único), `ged_config.protocolo_*` (portal ligado, orientação, limites, responsável) e `ged_comunicacao.protocolo_id` (aviso por e-mail ao interessado; `usuario_id` passou a ser opcional).

| Tema | Regra |
|---|---|
| Numeração | anual, sequencial **por cliente e por livro**, dentro da transação (`proximoValorSequencia`, concorrente-safe): `PROT-ENT-2026-000123`, `PROT-SAI-2026-000045`, `PROT-INT-2026-000007`. O ano vira à meia-noite de Brasília. O número é único só **dentro do cliente** (dois clientes têm `PROT-ENT-2026-000001`): toda consulta é escopada pela organização. |
| Imutabilidade | trigger `ged_protocolo_imutavel`: número, data, interessado, assunto, destino original e códigos **não mudam** e o protocolo **não se exclui**; só variam `situacao`, posse atual (`setor_atual_id`/`responsavel_id`), `concluido_em` e o comprovante (preenchido **uma vez**). Andamento (`ged_protocolo_evento`) e anexos (`ged_protocolo_documento`) são só-INSERT (`bloqueia_alteracao`). |
| Situações | RECEBIDO → EM_ANÁLISE / ENCAMINHADO → RESPONDIDO / DEVOLVIDO / INDEFERIDO → ARQUIVADO (terminal). Ações: iniciar análise, encaminhar, responder, arquivar, devolver, indeferir (`regras.ts`: `ACOES_POR_SITUACAO`). Devolver e indeferir exigem **justificativa**; responder, devolver e indeferir **mostram o texto ao interessado**. |
| Dados pessoais | nome, CPF/CNPJ, e-mail e telefone do interessado **cifrados** (`cifrar/decifrar`), busca por `hashBusca` (CPF/CNPJ). Anexos recebidos do público nascem como documentos **restritos**, com "contém dados pessoais" e anonimização pendente. Não há busca por nome (a coluna é cifrada). |
| Permissões | registrar/movimentar = Admin, Gestor e Usuário (`protocolar`); ver o livro todo = Admin, Gestor e Auditor (`protocolo_geral`); Usuário e Leitor veem só o que os envolve (autor, responsável, destinatário ou setor envolvido); Leitor e Auditor **nunca escrevem**. Admin/Gestor movimentam qualquer um; Usuário, os que o envolvem. Outro cliente ou sem acesso = 404. Abrir o **anexo** segue a permissão do documento (`whereGedVisivel`/sigilo): sem `VER`, a ficha mostra "Anexo restrito". |
| Anexos | cada PDF vira `GedDocumento` (`criarDocumentoNaTransacao`, mesma transação do protocolo). Havendo destino (entrada/interno), cada documento segue ao setor/pessoa pelo **trâmite** existente (`registrarTramite`); quem não tem `TRAMITAR` no documento (sigilo) não o move, e o protocolo muda de posse mesmo assim. |
| Comprovante | PDF (`htmlParaPdf`) com brasão/logo, número, data/hora de Brasília, interessado com **CPF/CNPJ mascarado**, assunto, anexos com **sha256**, código de consulta (entrada com portal ativo) e **QR** para `/verificar/protocolo/{código}`. Assinado em **PAdES com o certificado A1 do órgão** quando houver (`certificadoDoCliente`/`assinarComCertificado`); senão, assinatura eletrônica simples (o QR e o código conferem). Guardado como `GedDocumento` de origem `COMPROVANTE` (backup/exportação/OCR/texto ficam por conta do que já existe); o hash final fica no protocolo e **não muda mais**. Falha do Chromium não impede o protocolo: o comprovante pode ser emitido depois ("Emitir comprovante" na ficha). |
| Códigos | `codigo_consulta` (o cidadão acompanha com número + código) e `codigo_verificacao` (QR) são **diferentes**, aleatórios (12 caracteres de alfabeto sem ambiguidade, 60 bits), formato `XXXX-XXXX-XXXX`; o de verificação é único na plataforma. |

### Telas internas

`/ged/protocolo` (livro: filtros por livro, ano, situação, setor, "só os meus/do meu setor" e busca por número, assunto, descrição ou CPF/CNPJ), `/ged/protocolo/novo` (entrada no balcão, saída ou interno; vários PDFs) e `/ged/protocolo/[id]` (ficha, andamento, anexos, comprovante e ações). API: `GET/POST /api/v1/ged/protocolos` (JSON, ou multipart com `dados` + `arquivos`), `GET/POST /api/v1/ged/protocolos/{id}` (ficha; ação `ANALISAR|ENCAMINHAR|RESPONDER|ARQUIVAR|DEVOLVER|INDEFERIR`), `GET/POST …/{id}/comprovante` (baixa/emite). Toda escrita grava `auditarGed` (`GED_PROTOCOLO_*`); o download do comprovante entra no log de acesso do documento.

### Portal do cidadão (público, sem login)

Desligado por padrão. O GED_ADMIN liga em **`/ged/admin/configuracoes` → "Protocolo online"**: endereço público (`slug`, `/protocolo/<slug>`, único na plataforma), responsável que guarda o que chega, texto de orientação, máximo de arquivos (0–10) e tamanho por arquivo (1–25 MB) e a lista de **assuntos** (cada assunto → setor de destino, tipo de documento, prioridade e prazo de resposta; o cidadão escolhe o assunto, nunca o destino). Para ligar é preciso slug, responsável e ao menos um assunto ativo; o setor de cada assunto precisa de participante apto a receber.

- **`/protocolo/[slug]`**: formulário (nome, CPF/CNPJ, e-mail, telefone opcional, assunto, descrição, PDFs, **aceite de LGPD**). Ao enviar: cria o protocolo ENTRADA, mostra número + código de consulta, oferece o **comprovante em PDF**, e enfileira o e-mail de confirmação (sem anexo, só o link de consulta; "Enviado em dd/mm/aaaa às HH:mm (horário de Brasília)"). Os documentos nascem do **responsável** configurado.
- **`/protocolo/[slug]/consulta`**: número + código → situação e andamento **públicos** (rótulos, datas e as mensagens de resposta/devolução/indeferimento), sem dados pessoais, anexos ou despachos internos. Erros são genéricos ("Confira o número e o código").
- **E-mails ao interessado**: confirmação do registro e cada mudança de situação (menos "iniciar análise"), pela mesma caixa de saída do GED (`GedComunicacao` com `protocolo_id`; job `ged-notificar`); aparecem em `/ged/logs` como "Interessado (protocolo)".
- **`/verificar/protocolo/[código]`** (QR do comprovante): órgão, número, livro, data, situação e **conferência do hash** (servidor + arquivo escolhido no navegador, nada é enviado); nunca assunto, interessado ou anexos. Código inexistente = "NÃO ENCONTRADO" (igual para qualquer formato inválido).
- **API pública** `/api/v1/publico/protocolo/{slug}` (`GET` dados do portal, `POST` multipart envia), `…/consulta` (`POST {numero,codigo}`) e `…/comprovante?numero=&codigo=` (PDF), com validação zod.

**Isolamento (requisito nº 1)**: o slug resolve **uma** organização (`resolverSlugPortal`, só devolve o id); tudo depois passa por `gedDb(orgId)`. Slug inexistente, mal formado **ou portal desligado** = 404 idêntico; número de um cliente com o código de outro não consulta nada; o código de consulta não serve de código de verificação. Páginas e API públicas saem com `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow` e `Referrer-Policy: no-referrer` (`next.config.ts`); acesso liberado, indexação não.

**Anti-abuso** (`lib/ged/protocolo/limites.ts`, mesmo mecanismo do login): **honeypot** (`website`, fora da tela; preenchido = sucesso genérico sem criar nada), **limite de envios por IP** (8/hora; toda tentativa conta, inclusive a inválida) e **teto por portal** (300/hora), limite de **consultas** (falhas por IP e por protocolo-alvo → 429), limites de tamanho/quantidade de arquivos, apenas PDF (`validarUploadGed`, antivírus se configurado) e mensagens genéricas. Em memória por processo, como o login; atrás de proxy o IP vem de `X-Forwarded-For`.

**Testes**: `tests/unit/ged-protocolo.test.ts` (numeração, máquina de situações, validação do formulário público e do registro, máscara de CPF/CNPJ, cifra, e-mail e comprovante em HTML, rate limit, permissões), `ged-schema` (4 modelos novos) e E2E `t23-ged-protocolo` + `t16` (protocolo de A inacessível a B).

## 15. Operação: limpar o conteúdo do GED de um cliente

Não há tela de exclusão em massa e as trilhas são imutáveis por trigger (`ged_tramite`, `ged_comentario`, versões seladas, assinantes decididos, protocolo e andamento). Para **zerar um ambiente de teste/demonstração** (ex.: "Câmara Municipal de Vale das Acácias (DEMO)", sigla `VAC`) existe a ferramenta `scripts/ged/limpar-organizacao.ts`:

```bash
npm run ged:limpar -- VAC                                  # DRY-RUN (padrão): só imprime contagens por tabela Ged* e nº/tamanho de arquivos em ged/{org}/
npm run ged:limpar -- VAC --executar --confirmar=VAC       # apaga (a confirmação precisa ser a sigla exata da organização)
```

`<sigla|id>`: sigla (sem diferenciar maiúsculas) ou uuid; sigla que case com mais de uma organização, organização inexistente ou **sem o módulo `GED`** abortam sem alterar nada. Uma organização por execução.

**Apaga** (só linhas com `organizacao_id` = a organização; filhos antes dos pais): importações e itens, protocolos (registro, andamento, anexos), comunicações, assinantes e solicitações de assinatura, detecções de dados pessoais, conteúdo de texto, versões, documentos, marcadores e vínculos, ACLs, trâmites, comentários, logs de acesso, **pastas** e contadores de numeração (`GedSequencia`: os próximos números voltam a 000001); e **todos os arquivos** do storage sob `ged/{organizacao_id}/` (inclusive resíduos de importação).
**Preserva**: membros, setores e participantes, configuração (`GedConfig`, inclusive o portal de protocolo), tipos de documento, assuntos de protocolo, preferências de notificação, canais, certificado digital, usuários, o licenciamento, **o `log_auditoria`** (a limpeza grava `GED_LIMPEZA_ORGANIZACAO` com as contagens e `GED_LIMPEZA_ARQUIVOS`) e todos os outros clientes.

**Como contorna as travas:** dentro de **uma** transação, `SET LOCAL session_replication_role = 'replica'` (local à transação; não persiste nem afeta outras conexões; exige superusuário ou, no PG ≥ 15, privilégio `SET` no parâmetro – o usuário `postgres` do Railway é superusuário). Em `replica` as FKs também não são checadas, por isso a ordem de dependência é fixa e testada contra o `schema.prisma`. Sem esse privilégio o script cai sozinho no método `triggers` (`ALTER TABLE … DISABLE TRIGGER` só dos triggers de DELETE das tabelas apagadas, na mesma transação – DDL transacional, mas com lock exclusivo nessas tabelas até o COMMIT; exige ser dono). Toda instrução leva `WHERE organizacao_id = $1` e passa por `validarSqlLimpeza` antes de executar; ao fim a transação confere que nada da organização sobrou (senão ROLLBACK). O banco é apagado primeiro e o storage depois: falha no meio deixa no máximo arquivos órfãos (rode de novo), nunca registros sem arquivo.

**`--manter-demo` NÃO é suportado** (a flag é recusada com explicação): os documentos criados pelo seed não têm marca confiável – a numeração `{SIGLA}-DOC-ano-nnnnnn` é a mesma dos reais, o criador é um usuário comum e o seed os reconhece apenas pelo título dentro do cliente. Para voltar à massa de exemplo, limpe tudo e rode `npm run seed:ged-demo`.

**Railway (sem acesso ao banco):** variáveis do **worker**, lidas por `scripts/predeploy.sh` (ver `deploy/railway.md` §3): `GED_LIMPAR_ORG=VAC` sozinha = dry-run nos logs; com `GED_LIMPAR_EXECUTAR=true` e `GED_LIMPAR_CONFIRMAR=VAC` apaga. **Remova as variáveis depois** (senão todo deploy limpa de novo).

> **Aviso – `SEED_GED_DEMO`:** com `SEED_GED_DEMO=true` o pré-deploy roda `seed:ged-demo`, que **recria os documentos de exemplo** de VAC e AAC (idempotente por título). Depois de limpar, remova `SEED_GED_DEMO` do worker, senão o deploy seguinte repovoa o cliente. Na mesma execução a limpeza roda **depois** dos seeds.

**Testes:** `tests/unit/ged-limpeza.test.ts` (puro: toda tabela `Ged*` do schema consta no plano, ordem filho→pai contra as FKs, preservadas sem FK para apagadas, todo SQL com filtro por organização, prefixo de storage, argumentos e confirmação) e, com banco/storage descartáveis, `tests/integration/ged-limpeza-db.ts` (seed VAC+AAC, limpa VAC pelos dois métodos, AAC idêntica em linhas e arquivos, VAC vazia salvo membros/setores/config/tipos, log preservado).
