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
| Busca | `pdftotext` (poppler-utils) → `GedConteudoTexto.tsv` (português, sem acento) – job `ged-extrair-texto`. PDF só de imagem → `SEM_TEXTO` (OCR é fase 2). |

## 2. Tabelas

Todas com `organizacao_id`, `created_at`, `updated_at` e `@@map("ged_…")`:
`ged_config`, `ged_membro`, `ged_setor`, `ged_setor_membro`, `ged_tipo_documento`, `ged_pasta`, `ged_documento`, `ged_versao_documento`, `ged_conteudo_texto`, `ged_deteccao_dado_pessoal`, `ged_marcador`, `ged_documento_marcador`, `ged_acl`, `ged_tramite`, `ged_solicitacao_assinatura`, `ged_assinante`, `ged_comentario`, `ged_acesso_log`, `ged_comunicacao`, `ged_preferencia_notificacao`, `ged_sequencia`. Definição: `prisma/schema.prisma` e §2 do desenho.

## 3. Rotas

Páginas (`app/(ged)/ged/…`, todas `force-dynamic`; **conforme entregue** por cada frente): `/ged` (início), `/ged/documentos`, `/ged/documentos/novo`, `/ged/documentos/[id]`, `/ged/editor/novo`, `/ged/editor/[id]`, `/ged/pastas`, `/ged/assinaturas`, `/ged/assinaturas/[id]`, `/ged/tramite`, `/ged/logs`, `/ged/minha-conta`, `/ged/minha-conta/notificacoes`, `/ged/admin` (+ `setores`, `marcadores`, `tipos`; membros/canal/certificado/exportação conforme entregue). Pública: `/verificar` e `/verificar/[codigo]`.

API `/api/v1/ged/*` (sempre `rota()` + `ctxGedApi()`): `documentos` (+ `/[id]`, `/[id]/arquivo`, `arquivar`, `restaurar`, `marcadores`, `dados-pessoais`), `busca`, `pastas`, `marcadores`, `tipos`, `setores`, `acl`, `comentarios`, `tramite` (+ `caixa`, `/[id]`), `editor` (+ `/[id]/rascunho|finalizar|reabrir`), e (conforme entregue) `assinaturas`, `logs`, `notificacoes`.

Login: usuário só-GED entra sem escolher órgão e cai em `/ged`; usuário só-GED em `/dashboard` ou `/processos` é redirecionado para `/ged`.

## 4. Jobs (worker `npm run jobs`; fuso `JOBS_TZ`, padrão America/Bahia)

`registrarJobsGed()` (`jobs/ged.ts`) carrega um arquivo por frente:

| Fila | Arquivo | Quando | O que faz |
|---|---|---|---|
| `ged-extrair-texto` | `jobs/ged-texto.ts` | varredura a cada `JOBS_GED_TEXTO_MS` (15 s) | extrai texto dos PDFs pendentes de todos os clientes (job com o escopo da organização) |
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

Dados criados (idempotente; reconhecidos pelo título dentro do cliente): ver o cabeçalho de `prisma/seed/ged-demo.ts` e o roteiro `docs/poc-ged.md`. Resumo VAC: Ofício 12/2026 (em trâmite), Contrato 001/2026 (aguardando assinaturas, comentários, ACL), Termo Aditivo 001/2026 (reservado para assinar ao vivo), Parecer 07/2026 (assinatura **recusada** com justificativa), Minuta de Ofício 15/2026 (rascunho do editor), Ofício recebido nº 0045 (PDF de imagem, `SEM_TEXTO`), Ata 018/2026 (dados pessoais + anonimização pendente), Processo Administrativo Disciplinar 003/2026 (SIGILOSO em `Pessoal`), Edital/Ata do Pregão 03/2026 (públicos), Empenho, Nota fiscal e Relatório; ACLs de pasta por setor e usuário; logs de acesso e de comunicação de exemplo. **Pendente (Parte 2):** documento assinado e selado com QR (depende do serviço de assinaturas).

## 8. Como rodar os testes

```bash
npm run typecheck && npm run lint
npm test                                   # vitest (tests/unit): ged-*.test.ts, onboarding-ged.test.ts, backup-arquivos.test.ts
# integração com banco (isolamento via gedDb): tests/integration/ged-isolamento-db.ts (ver o cabeçalho do arquivo)
# E2E (Playwright) – dados: dois clientes fictícios
E2E_GED_IDS=1 npm run seed:ged-demo        # grava tests/e2e/.ged-ids.json
npx playwright test tests/e2e/t16-ged-isolamento.spec.ts --project=desktop-chromium
```
`t16` **não** está no seed padrão do CI (o orquestrador o liga depois). Banco isolado para trabalho paralelo: `CREATE DATABASE licenciagov_ged_x` + `DATABASE_URL=… npx prisma migrate deploy` (linhas imutáveis não podem ser apagadas).

## 9. Como adicionar uma tabela ao GED

1. Modelo `Ged…` no `schema.prisma` com `organizacao_id String @db.Uuid` (NOT NULL), relação para `Organizacao` e **índice com `organizacao_id` na frente**.
2. Migração: trigger `ged_mesmo_tenant()` para cada FK para outra tabela do GED/usuário; trigger de imutabilidade se for trilha (`bloqueia_alteracao()`).
3. Regra em `filtroTabela()` (`lib/export/exportar.ts`) e descrição em `DESCRICAO_TABELA`; coluna `tsv`/binária fora da exportação.
4. Acesso **somente** via `ctx.db`/`gedDb()`; escrita com `auditarGed()` na mesma transação.
5. `tests/unit/ged-schema.test.ts` falha se faltar `organizacao_id`, índice ou regra de exportação. Se a tabela tiver arquivo no storage, inclua a chave na replicação (`inventarioDesde`/`inventarioCompleto` em `lib/backup/arquivos.ts`) e na exportação de anexos.

## 10. Limites conhecidos (fase 1)

- Upload somente **PDF**, até **25 MB**; cota por cliente em `GedConfig.cota_bytes` (aplicação conforme entregue).
- PDF só de imagem não é pesquisável por conteúdo (`SEM_TEXTO`) até a fase 2 (OCR).
- Assinatura por signatário é eletrônica avançada; o selo PAdES é do **órgão** (e-CNPJ A1). Sem certificado cadastrado, o PDF recebe aviso de "assinatura eletrônica avançada". Sem carimbo de tempo RFC 3161 nem LTV. Certificado da PoC é de teste, sem valor legal.
- Validade jurídica do digitalizado (Decreto 10.278/2020) a confirmar com a assessoria jurídica do cliente.
- Replicação de arquivos cobre `Anexo`, `DocumentoOficial` e `GedVersaoDocumento`. **Não** cobre `ReuniaoConselho.ata_pdf_key`, `MensagemConversa.midia_key`, `Cobranca.comprovante_key` nem os ZIPs de `Exportacao` (transitórios).
- Residência dos dados: a Railway não tem região no Brasil – risco de transferência internacional a tratar com o cliente.
- WhatsApp: provedor não oficial tem risco de banimento; a API oficial exige templates. Ter o modo simulado como plano B.
- `ged_acesso_log` cresce rápido: retenção por `GedConfig.retencao_acesso_log_dias` (job `ged-retencao-logs`); particionar por mês se passar de ~50 milhões de linhas.

## 11. Roadmap

OCR (fase 2: fila `ged-ocr` em worker separado, `ocrmypdf`, nova versão `origem=OCR`) · importação de pasta/ZIP · portal do cliente (exposição pública só de derivados anonimizados, `whereExposicaoPublica()`) · fechamento mensal da digitalização · motor de anonimização (detecção de CPF/CNPJ/e-mail/telefone e IA opcional; o modelo já existe) · **hardening com RLS** (role `NOSUPERUSER NOBYPASSRLS`, role separado para migração, `set_config('app.org', …, true)` por transação) · assinatura ICP-Brasil por signatário (PAdES incremental) · carimbo de tempo/LTV · lixeira e retenção de documentos · replicação com versionamento/Object Lock no bucket de backup.
