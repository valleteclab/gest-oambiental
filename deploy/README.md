# Implantação – LicenciaGov (AWS sa-east-1)

Dois ambientes **totalmente separados** (SPEC 9.3): `homolog` e `prod`. Nenhum recurso é compartilhado entre eles
(banco, bucket, domínio, segredos, chaves KMS, logs).

## 1. Topologia

```
Internet ──HTTPS──► Route 53 ─► ALB (ACM/TLS 1.2+, redirect 80→443)
                                   │
                                   ▼
                    ECS Fargate (subnets privadas, 2 AZs)
                    ├─ serviço app     (imagem :app-<sha>, 2+ tasks, 1 vCPU / 2 GB)
                    ├─ serviço worker  (imagem :worker-<sha>, 1 task, `npm run jobs` – pg-boss)
                    └─ task migrate    (imagem :worker-<sha>, one-shot `prisma migrate deploy`)
                                   │
            ┌──────────────────────┼─────────────────────────┐
            ▼                      ▼                         ▼
   RDS PostgreSQL 16        S3 (versionado, SSE-KMS,   Secrets Manager + KMS
   (Multi-AZ em prod,       bloqueio público, CRR/    (DATABASE_URL, AUTH_SECRET,
    backup 30 d, PITR)       replicação diária)         DATA_KEY, HASH_PEPPER, SMTP_URL)
                                                       SES (SMTP) · CloudWatch Logs
```

| Item | homolog | prod |
|---|---|---|
| Domínio | `homolog.licenciagov.com.br` | `licenciagov.com.br` (ou domínio do consórcio) |
| RDS | `licenciagov-homolog` (db.t4g.small, single-AZ) | `licenciagov-prod` (db.t4g.medium, **Multi-AZ**, deletion protection) |
| Bucket arquivos | `licenciagov-homolog-arquivos` | `licenciagov-prod-arquivos` (versionamento + réplica em outra região/provedor) |
| Bucket backups | `licenciagov-homolog-backups` | `licenciagov-prod-backups-us-east-1` (**outra região**, Object Lock 30 d) |
| Secrets | `licenciagov/homolog/*` | `licenciagov/prod/*` |
| ECS | cluster `licenciagov-homolog` | cluster `licenciagov-prod` |
| Seed | `npm run seed:demo` permitido | **somente** `seed:base` na implantação; `seed:demo` **proibido** após a carga de PoC |
| Deploy | automático em push na `main` | tag `v*` ou manual, com aprovação (GitHub Environment `prod`) |

## 2. Segredos (AWS Secrets Manager)

Nunca em código, imagem, variável de GitHub ou `.env` versionado. A task definition injeta via `secrets`:

```json
"secrets": [
  { "name": "DATABASE_URL", "valueFrom": "arn:aws:secretsmanager:sa-east-1:<conta>:secret:licenciagov/prod/app:DATABASE_URL::" },
  { "name": "AUTH_SECRET",  "valueFrom": "…:licenciagov/prod/app:AUTH_SECRET::" },
  { "name": "DATA_KEY",     "valueFrom": "…:licenciagov/prod/app:DATA_KEY::" },
  { "name": "HASH_PEPPER",  "valueFrom": "…:licenciagov/prod/app:HASH_PEPPER::" },
  { "name": "SMTP_URL",     "valueFrom": "…:licenciagov/prod/app:SMTP_URL::" }
]
```
Variáveis não secretas (`environment`): `APP_URL`, `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_REGION=sa-east-1`,
`EMAIL_FROM`, `CHROMIUM_PATH=/usr/bin/chromium`, `TZ=America/Bahia`, `NODE_ENV=production`.
Acesso ao S3 pela **task role** (sem `AWS_ACCESS_KEY_ID`), política restrita ao bucket do ambiente.

Geração: `openssl rand -hex 32` (DATA_KEY), `openssl rand -base64 48` (AUTH_SECRET), `openssl rand -base64 24` (HASH_PEPPER).
> **DATA_KEY e HASH_PEPPER não podem ser trocados sem re-cifrar/re-hashear os dados** (CPF/CNPJ, e-mail e telefone de PF).
> Guardar cópia offline (cofre do consórcio) – sem ela os backups ficam ilegíveis.

## 3. HTTPS / HSTS
- Certificado ACM no ALB; listener 80 só redireciona para 443; política `ELBSecurityPolicy-TLS13-1-2-2021-06`.
- A aplicação já envia `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (next.config.ts)
  e cookies `Secure/HttpOnly/SameSite=Lax` em produção.
- Security groups: ALB → app:3000; app/worker → RDS:5432; RDS sem acesso público.
- Opcional: AWS WAF (rate limit em `/login` e `/api/v1/auth/*`).

## 4. Primeira implantação (por ambiente)
1. Criar VPC (2 AZs, subnets privadas + NAT), RDS PostgreSQL 16, buckets, KMS, Secrets, ECR `licenciagov`, cluster ECS, ALB + ACM, registros Route 53.
2. Criar role OIDC para o GitHub (`token.actions.githubusercontent.com`, condição `repo:<org>/<repo>:environment:<amb>`) com permissão de ECR push, `ecs:RegisterTaskDefinition/UpdateService/RunTask/Describe*` e `iam:PassRole` das roles de task.
3. Registrar as task definitions iniciais (famílias `licenciagov-app`, `licenciagov-worker`, `licenciagov-migrate`; o container de migração deve se chamar `migrate`).
   Health check do target group: `GET /api/health`, 200, intervalo 30 s.
4. Preencher as *vars* do GitHub Environment (ver cabeçalho de `.github/workflows/deploy.yml`).
5. Rodar o workflow **Deploy** (manual). Ele: build → push ECR → nova revisão das task definitions → `prisma migrate deploy` → rolling update → smoke `/api/health`.
6. Carga inicial: `aws ecs run-task … --overrides '{"containerOverrides":[{"name":"migrate","command":["npm","run","seed:base"]}]}'`.
   Em homolog (e **uma única vez** em prod para a PoC – SPEC 15 D8): `npm run seed:demo`.
7. Configurar o monitor externo (seção 6) e os backups (`docs/backup.md`).

## 5. Deploys seguintes
- `main` → homolog automaticamente (workflow `Deploy`). Validar com `E2E_BASE_URL=https://homolog… npm run test:e2e`.
- Prod: criar tag `vAAAA.MM.DD-N` (ou disparo manual) → aprovação no Environment `prod`.
- Migrações precisam ser **compatíveis com a versão anterior** (expand/contract), pois o rolling update mantém tasks antigas por alguns minutos.
- Rollback: `aws ecs update-service --task-definition <revisão anterior>` (imagens ficam no ECR por 90 dias – lifecycle policy).

## 6. Monitoramento e SLA 99%
- **Uptime externo** (Better Stack ou UptimeRobot), **intervalo de 1 min**, `GET https://<domínio>/api/health`,
  esperar HTTP 200 e corpo contendo `"status":"ok"` (checa banco e storage; 503 quando degradado). Timeout 10 s,
  alerta após 2 falhas consecutivas por e-mail + WhatsApp/SMS do plantão. Um monitor por ambiente; página de status pública opcional.
- Segundo monitor (palavra-chave) em `https://<domínio>/` para detectar falha de front/CDN.
- CloudWatch: alarmes de CPU/memória do ECS, `HealthyHostCount` < 1 no target group, 5xx do ALB, CPU/armazenamento/conexões do RDS.
- Logs: stdout/stderr das tasks → CloudWatch Logs (`/ecs/licenciagov-<amb>`), retenção 90 dias (prod).
- Relatório mensal de disponibilidade: exportar do monitor externo (uptime %, incidentes, duração) – base do SLA contratual (ver `docs/operacao.md`).

## 7. Custos de referência (prod, sa-east-1, ordem de grandeza)
RDS t4g.medium Multi-AZ ~US$ 150 · Fargate 3 tasks ~US$ 90 · ALB ~US$ 25 · NAT ~US$ 45 · S3/Backups/Logs ~US$ 15.

## 8. Alternativa sem AWS
A mesma imagem roda em qualquer host Docker na região Brasil (ex.: VM + `docker compose` com Postgres gerenciado e R2/S3):
use `docker-compose.yml` como base, remova `postgres`/`minio`/`mailpit`, aponte `DATABASE_URL`/`S3_*`/`SMTP_URL` para os serviços gerenciados,
coloque um proxy TLS (Caddy/Traefik) na frente e mantenha os segredos em arquivo `env` fora do repositório (ou Docker secrets).
