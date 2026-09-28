# Deploy no Railway

Topologia: 1 projeto com **Postgres** (plugin), serviço **app** (Next.js) e serviço **worker** (pg-boss: alertas, exportações, migrações). Arquivos: bucket S3-compatível externo (Cloudflare R2 recomendado) – o disco do container é efêmero.

## 1. Criar o projeto
1. railway.com → **New Project → Deploy from GitHub repo** → `valleteclab/gest-oambiental` (branch do deploy).
2. **+ New → Database → PostgreSQL**.
3. Serviço `app` (do repo): *Settings → Build → Dockerfile path* = `Dockerfile`; *Deploy → Healthcheck path* = `/api/health`.
4. Serviço `worker` (mesmo repo): *Dockerfile path* = `Dockerfile.worker`; *Pre-deploy command* =
   `sh scripts/predeploy.sh` (migrações a cada deploy + seeds/onboarding opcionais – ver §3).
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

## 3. Pré-deploy do worker: migrações, seeds e onboarding de clientes
`scripts/predeploy.sh` roda, nesta ordem, conforme as variáveis do serviço **worker**:

| Variável | Efeito |
|---|---|
| `RESET_DB=true` | **Apaga** o banco e recria (`prisma migrate reset`). Só homologação/demonstração – remova a variável logo depois do deploy. |
| _(sempre)_ | `prisma migrate deploy` |
| `SEED_DEMO=true` | `npm run seed:demo` – consórcio fictício CID-DEMO (idempotente). Só homologação. |
| `SEED_ONBOARDING=riachao-das-neves` | `npm run onboard -- riachao-das-neves` (arquivo `prisma/seed/clientes/<cliente>.json`; vários clientes separados por vírgula). Com `DEMO_MODE=true` roda com `--demo` (senha demo `Demo@2026licencia`, sem troca obrigatória). Idempotente: cria só o que falta. |
| `SEED_RIACHAO_DEMO=true` | `npm run seed:riachao-demo` – empreendimentos, processos, licenças, denúncias e vistorias **fictícios** de Riachão das Neves (exige o onboarding acima; idempotente). |
| `ONBOARD_SENHA` | (opcional) senha fixa dos usuários criados pelo onboarding. Sem ela e sem `--demo`, cada usuário novo recebe uma senha temporária **impressa uma única vez no log do pré-deploy** (troca obrigatória no 1º acesso). |

Ambiente de apresentação para Riachão das Neves (exemplo): `DEMO_MODE=true`, `SEED_DEMO=true`, `SEED_ONBOARDING=riachao-das-neves`, `SEED_RIACHAO_DEMO=true`.
Produção de um cliente: apenas `SEED_ONBOARDING=<cliente>` no primeiro deploy (sem `DEMO_MODE`/`SEED_DEMO`/`SEED_RIACHAO_DEMO`); guarde as senhas temporárias do log e depois remova a variável.

Manual: `railway run --service worker npm run onboard -- <cliente> [--demo] [--atualizar]` (`--atualizar` sobrescreve os dados cadastrais do órgão com os do JSON; `--redefinir-senhas` gera novas senhas).

**Isolamento por cliente:** cada organização (tenant) só enxerga os próprios municípios, usuários, configurações, relatórios e exportações; o consórcio de demonstração e Riachão das Neves ficam isolados mesmo no mesmo banco. Os limites municipais são obtidos do IBGE pelo `codigo_ibge` (nada a configurar).

## 4. Homolog × produção
Crie dois *Environments* no projeto (`homolog`, `production`) – cada um tem seu próprio Postgres, bucket e domínio. Região: o Railway não tem região no Brasil; se a exigência de hospedagem no Brasil (SPEC §3) for contratual, use AWS sa-east-1 (`deploy/README.md`).

## 5. Monitoramento
Uptime monitor externo (Better Stack/UptimeRobot) em `https://<domínio>/api/health` a cada 1 min. Backups: habilite backups do Postgres no Railway e agende `scripts/backup/pg_dump.sh` (ver `docs/backup.md`).
