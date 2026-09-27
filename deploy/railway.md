# Deploy no Railway

Topologia: 1 projeto com **Postgres** (plugin), serviço **app** (Next.js) e serviço **worker** (pg-boss: alertas, exportações, migrações). Arquivos: bucket S3-compatível externo (Cloudflare R2 recomendado) – o disco do container é efêmero.

## 1. Criar o projeto
1. railway.com → **New Project → Deploy from GitHub repo** → `valleteclab/gest-oambiental` (branch do deploy).
2. **+ New → Database → PostgreSQL**.
3. Serviço `app` (do repo): *Settings → Build → Dockerfile path* = `Dockerfile`; *Deploy → Healthcheck path* = `/api/health`.
4. Serviço `worker` (mesmo repo): *Dockerfile path* = `Dockerfile.worker`; *Pre-deploy command* =
   `sh -c 'npx prisma migrate deploy && if [ "$SEED_DEMO" = "true" ]; then npm run seed:demo; fi'`
   (migrações a cada deploy; `SEED_DEMO=true` só em homologação – o seed é idempotente).
5. No `app`: *Settings → Networking → Generate Domain* (ou domínio próprio, ex.: `licenciagov.valleteclab.com.br`).

## 2. Variáveis (app e worker – use *Shared Variables*)
| Variável | Valor |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `APP_URL` | `https://<domínio do app>` (vai no QR Code dos documentos) |
| `AUTH_SECRET` | `openssl rand -hex 32` |
| `DATA_KEY` | `openssl rand -hex 32` (**guarde com segurança**: sem ela os CPFs cifrados ficam ilegíveis) |
| `HASH_PEPPER` | `openssl rand -hex 16` (não trocar depois) |
| `STORAGE_DRIVER` | `s3` |
| `S3_ENDPOINT` | ex.: `https://<account>.r2.cloudflarestorage.com` |
| `S3_BUCKET` / `S3_REGION` | ex.: `licenciagov-prod` / `auto` (R2) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | chaves do bucket |
| `CHROMIUM_PATH` | `/usr/bin/chromium` (já definido na imagem) |
| `SMTP_URL` / `EMAIL_FROM` | SMTP transacional (sem SMTP os e-mails ficam só em /admin/emails) |
| `DEMO_MODE` | `true` em ambientes de demonstração (faixa "dados fictícios"); omitir/`false` em produção |
| `TZ` | `America/Bahia` |
| `PORT` | `3000` (app) |

## 3. Dados de demonstração (homolog apenas)
No worker: `railway run --service worker npm run seed:demo` (ou `seed:base` para produção de cliente: cria só configuração e usuários – troque as senhas).

## 4. Homolog × produção
Crie dois *Environments* no projeto (`homolog`, `production`) – cada um tem seu próprio Postgres, bucket e domínio. Região: o Railway não tem região no Brasil; se a exigência de hospedagem no Brasil (SPEC §3) for contratual, use AWS sa-east-1 (`deploy/README.md`).

## 5. Monitoramento
Uptime monitor externo (Better Stack/UptimeRobot) em `https://<domínio>/api/health` a cada 1 min. Backups: habilite backups do Postgres no Railway e agende `scripts/backup/pg_dump.sh` (ver `docs/backup.md`).
