# Runbook de operação – LicenciaGov

Público: equipe de operação/suporte VALLETECLAB. Arquitetura: [`arquitetura.md`](arquitetura.md). Infra AWS: [`../deploy/README.md`](../deploy/README.md).
Backups e restauração: [`backup.md`](backup.md) (e checklist mensal em `restore.md`).

## 1. Variáveis de ambiente

| Variável | Obrigatória | Segredo | Descrição |
|---|---|---|---|
| `DATABASE_URL` | sim | **sim** | Conexão Postgres 16 (`postgresql://usuario:senha@host:5432/licenciagov?schema=public&sslmode=require` em nuvem) |
| `APP_URL` | sim | não | URL pública (usada em QR Codes, links de e-mail e validação). Ex.: `https://licenciagov.com.br` |
| `AUTH_SECRET` | sim | **sim** | Chave HMAC dos JWT de sessão (≥ 32 bytes aleatórios). Trocar invalida todas as sessões |
| `DATA_KEY` | sim | **sim** | 32 bytes hex (AES-256-GCM) para dados pessoais. **Não trocar** sem migração de re-cifragem |
| `HASH_PEPPER` | sim | **sim** | Pepper do hash de busca de CPF/CNPJ. **Não trocar** sem recalcular hashes |
| `STORAGE_DRIVER` | sim | não | `s3` (homolog/prod) ou `local` (dev) |
| `STORAGE_LOCAL_DIR` | se local | não | Pasta dos arquivos no driver local (padrão `./storage`; no container `/app/storage`) |
| `S3_BUCKET` / `S3_REGION` | se s3 | não | Bucket do ambiente e região (`sa-east-1`) |
| `S3_ENDPOINT` | MinIO/R2 | não | Endpoint S3-compatível (vazio na AWS) – ativa *path style* |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | MinIO/R2 | **sim** | Na AWS usar a role da task (deixar vazio) |
| `CHROMIUM_PATH` | sim | não | Binário do Chromium para PDF (`/usr/bin/chromium` na imagem) |
| `SMTP_URL` | prod | **sim** | Ex.: `smtps://usuario:senha@email-smtp.sa-east-1.amazonaws.com:465`. Vazio = e-mails só na caixa de teste (`/admin/emails`) |
| `EMAIL_FROM` | sim | não | Remetente, ex.: `LicenciaGov <nao-responda@licenciagov.com.br>` |
| `NODE_ENV` | sim | não | `production` em homolog/prod (ativa cookies `Secure`) |
| `PORT` / `HOSTNAME` | container | não | Servidor standalone (`3000` / `0.0.0.0`) |
| `TZ` | recomendado | não | `America/Bahia` (prazos e datas em documentos) |
| `ARQUIVAMENTO_AUTO`, `ARQUIVAMENTO_AUTO_CARENCIA_DIAS`, `ALERTAS_MODULO_TRANSICIONAR` | não | não | Parâmetros dos jobs de prazo (ver módulo de prazos/alertas e `.env.example`) |
| `E2E_BASE_URL`, `E2E_SENHA`, `E2E_IGNORE_HTTPS` | testes | – | Playwright contra homolog/prod |

Modelo completo: [`.env.example`](../.env.example). Em homolog/prod os segredos vêm do **AWS Secrets Manager** (nunca em arquivo versionado).

## 2. Deploy
Automatizado pelo GitHub Actions (`.github/workflows/deploy.yml`):
- push na `main` → **homolog**; tag `v*` ou disparo manual → **prod** (exige aprovação).
- Etapas: build das imagens `app`/`worker` → push ECR → `prisma migrate deploy` (task one-shot) → rolling update ECS → smoke `/api/health`.

Manual (emergência, host com Docker):
```bash
docker build -t licenciagov:app --target app .
docker build -t licenciagov:worker --target worker .
docker run --rm --env-file /etc/licenciagov/prod.env licenciagov:worker npx prisma migrate deploy
docker run -d --name app    --env-file /etc/licenciagov/prod.env -p 3000:3000 licenciagov:app
docker run -d --name worker --env-file /etc/licenciagov/prod.env licenciagov:worker
```
Local completo: `docker compose up -d --build` (Postgres 16 + MinIO + Mailpit + migrate + app + worker).

Checklist pós-deploy: `/api/health` = 200 · login de um usuário real · abrir um processo · validar um documento pelo código · `npm run test:e2e:smoke` com `E2E_BASE_URL`.

Rollback: voltar o serviço ECS para a revisão anterior da task definition. Migrações são *expand/contract*; nunca editar migração já aplicada.

## 3. Migrações de banco
- Criar em dev: `npx prisma migrate dev --name <descricao>`; commitar a pasta `prisma/migrations/*`.
- Aplicar: `npx prisma migrate deploy` (feito pelo pipeline; manual: `npm run db:migrate` na imagem worker).
- Antes de migração destrutiva em prod: backup manual (`docs/backup.md`) e janela comunicada.
- Triggers de imutabilidade (`tramitacao`, `log_auditoria`) estão nas migrações – não remover.

## 4. Seeds
| Script | Uso | Onde |
|---|---|---|
| `npm run seed:base` | organização, municípios, tipologias, tipos de ato, prazos, usuários iniciais | todos os ambientes (idempotente) |
| `npm run seed:demo` | base + ~40 processos, empreendimentos, licenças, denúncias, vistorias (SPEC 14) | dev, CI, homolog e **apenas** a carga da PoC em prod |

> **`seed:demo` NUNCA deve rodar em produção de cliente após a implantação.** Após a PoC, desativar os usuários `@licenciagov.demo`
> (senha pública) e trocar a senha do admin. Usuários demo usam a senha `Demo@2026licencia`.

## 5. Worker de jobs
- Processo separado: `npm run jobs` (`jobs/worker.ts`, pg-boss usando o mesmo Postgres). Em ECS: serviço `worker` com 1 task.
- Funções: alertas de prazo (sino + e-mail), vencimento de pendências/condicionantes/licenças, exportação completa (ZIP), verificação de backup.
- Saúde: ver logs (`/ecs/licenciagov-<amb>`, stream `worker`); fila no schema `pgboss` (`select name, state, count(*) from pgboss.job group by 1,2`).
- Reinício é seguro (jobs idempotentes; pg-boss retoma o que ficou pendente). Não rodar mais de 1 réplica sem revisar agendamentos.

## 6. Backups
Procedimentos, retenção (30 dias, outra região, criptografado), teste de restauração mensal e tela `/admin/backup`: ver **[`docs/backup.md`](backup.md)**.

## 7. Monitoramento e SLA (99% mensal)
- Monitor externo a cada **1 min** em `GET /api/health` (banco + storage; 200 = ok, 503 = degradado) – configuração em `deploy/README.md` §6.
- **Base do relatório de disponibilidade**: `disponibilidade = 1 − (minutos com falha confirmada / minutos do mês)`, apurada pelo monitor externo;
  janelas de manutenção programada comunicadas com 48 h de antecedência são descontadas conforme contrato. 99% ≈ até 7 h 18 min de indisponibilidade/mês.
- Relatório mensal: uptime %, lista de incidentes (início, fim, duração, causa, ação), chamados de suporte por severidade
  (`chamado_suporte`: primeira resposta e resolução) – anexar export do monitor.
- Alertas: 2 falhas seguidas → plantão (e-mail + mensagem). Incidente crítico: registrar em `chamado_suporte` com severidade `CRITICO`.

## 8. Incidentes comuns
| Sintoma | Verificar |
|---|---|
| `/api/health` 503 com `db:false` | RDS disponível? conexões esgotadas? `DATABASE_URL`/SG |
| `/api/health` 503 com `storage:false` | bucket/role da task; em MinIO, `S3_ENDPOINT` e chaves |
| PDF não gera | `CHROMIUM_PATH`; memória da task (≥ 2 GB); logs "Failed to launch the browser" |
| E-mails não chegam | `SMTP_URL`; SES fora do sandbox; caixa de teste `/admin/emails` |
| Alertas não aparecem | serviço `worker` rodando? erros no log; fila `pgboss.job` |
| Muitos 401 após deploy | `AUTH_SECRET` mudou (sessões invalidadas – esperado) |

## 9. Testes E2E contra um ambiente
```bash
E2E_BASE_URL=https://homolog.licenciagov.com.br npm run test:e2e         # desktop + Pixel 7
E2E_BASE_URL=http://localhost:3107 CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run test:e2e:smoke   # container de dev
```
Relatório HTML em `playwright-report/`. Documentação da API: `/api/docs` (JSON em `/api/docs/openapi.json`).
