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
5. `tests/unit/ged-schema.test.ts` falha se faltar `organizacao_id`, índice ou regra de exportação. Se a tabela tiver arquivo no storage, inclua a chave na replicação (`inventarioDesde`/`inventarioCompleto` em `lib/backup/arquivos.ts`) e na exportação de anexos.

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

## 12. Importação em lote de ZIP (fase 2)

Para quem digitaliza no Windows, organiza em pastas por cliente (licitação, pagamentos, controle interno…) e envia cópias periódicas: o **ZIP inteiro** é enviado de uma vez e a **estrutura de pastas do ZIP vira a árvore de pastas do GED**. Quem pode: **GED_ADMIN e GED_GESTOR** (`podeImportarGed`, capacidade `importar` em `lib/ged/papeis.ts`).

**Como usar (tela `/ged/importar`, menu "Importar ZIP")**: escolha o `.zip` (até 300 MB), a pasta de destino (padrão: raiz), o tipo de documento e a sensibilidade (valem para todos os documentos do lote; a sensibilidade sugerida vem da pasta). Ao enviar, a tela do lote (`/ged/importar/[id]`) se atualiza sozinha e mostra contadores e o **relatório por arquivo** (importado, duplicado, ignorado, erro + motivo), filtrável e com **CSV** (`?formato=csv`). O Admin vê todos os lotes do cliente; o Gestor só os que enviou.

**Regras de importação** (`lib/ged/importacao/*`):

| Tema | Regra |
|---|---|
| Pastas | cada pasta do ZIP é criada se faltar (via `criarPasta()`: exige EDITAR na pasta-pai) ou reaproveitada se já existir com o mesmo nome (sem diferenciar maiúsculas) no mesmo pai; pasta existente **arquivada** gera erro nos itens dela. Pastas novas herdam a ACL do pai (padrão) e recebem a sensibilidade escolhida como padrão. |
| Documentos | um por PDF, via `criarDocumentoUpload()` (origem `UPLOAD`: antivírus, número `…-DOC-…`, versão 1, ACL do criador, texto indexável/OCR, auditoria `GED_DOCUMENTO_CRIADO`). Título = nome do arquivo sem `.pdf` (`_` vira espaço). Exige EDITAR na pasta de destino. |
| Extensões | só **PDF** (mesma regra de `validarUploadGed`, fase 1); `.xlsx`, `.docx`, imagens etc. aparecem como "Ignorado". Conteúdo que não é PDF (sem `%PDF-`) vira "Erro". Máx. 25 MB por arquivo. |
| Duplicados | mesmo **sha256** já existente na **organização** (documento não excluído) → pulado e relatado (também dentro do próprio ZIP e em reenvios da cópia mensal). O número/link do original só é mostrado se o usuário puder ver o documento. Nunca compara com outro cliente. |
| Lixo | `__MACOSX`, `.DS_Store`, `Thumbs.db`, `desktop.ini`, `~$*` e qualquer item oculto (`.nome`) são ignorados sem aparecer no relatório (só um contador). |
| Nomes | UTF-8 (flag 11), Info-ZIP `0x7075`, UTF-8 sem flag ou CP850 (Windows pt-BR antigo); normalizados em NFC; `\` vira `/`; segmentos até 120 caracteres. |
| zip-slip | caminho absoluto, unidade (`C:`), `..` e caracteres de controle → o **item** vira "Erro" (nada é gravado fora da árvore; os arquivos nunca são gravados em disco com o nome do ZIP: só viram registros do banco e chaves `ged/{org}/{ano}/{doc}/v{n}-{sha8}.pdf`). Links simbólicos são ignorados. |
| zip-bomb | limites em `lib/ged/importacao/limites.ts`: ZIP 300 MB; 10 000 entradas; 3 000 arquivos; 1 000 pastas; 10 níveis; 2 GB descompactados (soma **declarada**); 25 MB por arquivo; razão de compressão ≤ 250 (acima de 1 MiB). Violação global → recusa o ZIP (422 na hora). A inflação é cortada no tamanho declarado (`maxOutputLength`), conferindo CRC e tamanho (declaração mentirosa → erro do item). ZIP64 e arquivos com senha não são suportados (mensagem clara). |
| Isolamento | tudo via `gedDb(organizacao_id)`; ZIP em `ged/{org}/importacao/{id}.zip` (só o job lê, nunca por URL); `ged_importacao`/`ged_importacao_item` com `organizacao_id` NOT NULL, trigger `ged_mesmo_tenant` (usuário, pasta, tipo, documento), regra em `filtroTabela()`/`DESCRICAO_TABELA`. Lote de outro cliente → 404. Pasta/tipo de destino de outro cliente → recusado. |

**Execução**: `POST /api/v1/ged/importacoes` (multipart: `arquivo`, `pasta_id?`, `tipo_id?`, `sensibilidade?`) valida o ZIP (diretório central e limites; 422 se inválido/sem PDF/limite), grava o ZIP e registra o lote `PENDENTE` (no máximo 3 lotes ativos por cliente; 429 acima). O job `ged-importar` (`jobs/ged-importar.ts`) processa em segundo plano: **sem worker no ar**, a própria API processa em segundo plano no processo web (mesmo critério do OCR/texto; `GED_IMPORTACAO_INLINE=true` força). Cada arquivo é independente (falha vira item "Erro" e o lote continua); o processamento é **retomável** (itens já gravados são pulados por `ordem`; um lote `PROCESSANDO` sem sinal de vida por 10 min é retomado). Ao fim o ZIP é **removido** (também em `FALHOU`), o status vira `CONCLUIDA`, `CONCLUIDA_COM_ERROS` ou `FALHOU` e a auditoria registra `GED_IMPORTACAO_CRIADA` / `GED_IMPORTACAO_CONCLUIDA` / `GED_IMPORTACAO_FALHOU`. `GET /api/v1/ged/importacoes` lista os lotes; `GET /api/v1/ged/importacoes/{id}?status=&page=&size=` traz o lote e os itens.

**Testes**: `tests/unit/ged-importacao-zip.test.ts` (parser, nomes/encoding, zip-slip, lixo, zip-bomb, limites, permissão) e `tests/e2e/t21-ged-importacao.spec.ts` (ZIP gerado em memória contra VAC e AAC: pastas, duplicados, lixo, zip-slip, reenvio só duplica, isolamento e papéis). Limites desta fase: só PDF (outros formatos aguardam a ampliação de `validarUploadGed`), ZIP ≤ 300 MB lido em memória, sem ZIP64.

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
