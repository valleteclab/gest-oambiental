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

### Backup real (worker + botão em /admin/backup – `docs/backup.md`)
Defina no **app e no worker** (o botão "Executar backup agora" roda no app; o agendamento, no worker). As imagens já trazem `postgresql-client-18` (compatível com o Postgres 18 do template `postgres-ssl:18`) e `openssl`.

| Variável | Valor |
|---|---|
| `BACKUP_PASSPHRASE` | `openssl rand -base64 48` – senha da criptografia AES-256 dos dumps. **Guarde no cofre fora do Railway** (sem ela o backup é irrecuperável). Sem ela, a chave é derivada da `DATA_KEY` (aviso em /admin/backup). |
| `BACKUP_S3_ENDPOINT` | bucket em **outro provedor**: Cloudflare R2 `https://<conta>.r2.cloudflarestorage.com` ou Backblaze B2 `https://s3.<região>.backblazeb2.com` |
| `BACKUP_S3_BUCKET` / `BACKUP_S3_REGION` | ex.: `licenciagov-dr` / `auto` (R2) ou `us-west-004` (B2) |
| `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` | credencial restrita a esse bucket (ler, gravar, listar, apagar) |
| `BACKUP_S3_PREFIX` | opcional, padrão `pg/` · `BACKUP_S3_FORCE_PATH_STYLE=true` só para MinIO |
| `BACKUP_ALERTA_EMAIL` | e-mail(s) da operação (vírgula) avisados em **falha** do backup/teste (além do aviso diário aos ADMIN do `backup-check`) |
| `BACKUP_RETENCAO_DIAS` | opcional, padrão `30` |
| `BACKUP_CRON` / `BACKUP_RESTORE_CRON` | opcionais, padrão `15 3 * * *` (diário 03:15) e `45 4 1 * *` (dia 1, 04:45), fuso `JOBS_TZ` (America/Bahia) |
| `BACKUP_RESTORE_DATABASE_URL` | opcional: banco descartável para o teste de restauração. Sem ela o teste cria e apaga `licenciagov_restore_test` no mesmo Postgres (o usuário `postgres` do Railway pode criar bancos; exige espaço livre no volume ≈ 2× o banco). |

Sem as variáveis `BACKUP_S3_*`, os dumps vão para o storage da própria aplicação (`backups/` no `S3_BUCKET`) e /admin/backup mostra "cópia fora do provedor não configurada".

### Antivírus nos uploads (opcional – ClamAV)
1. No projeto: *New → Docker Image* `clamav/clamav:stable` e nomeie o serviço `clamav` (sem domínio público; ≥ 2 GB de RAM – a base de assinaturas ocupa ~1,2 GB; o `freshclam` embutido atualiza as assinaturas sozinho). Opcional: volume em `/var/lib/clamav` para não baixar a base a cada restart.
2. No **app e no worker** (o worker processa a mídia dos canais): `CLAMAV_HOST=clamav.railway.internal` (rede privada), `CLAMAV_PORT=3310`.
3. `CLAMAV_OBRIGATORIO=true` em produção se a política exigir recusar uploads com o antivírus fora do ar; padrão `false` (aceita e registra aviso no log).
4. O clamd leva alguns minutos para subir na 1ª vez (download das assinaturas). Teste com o arquivo EICAR (ver `docs/operacao.md` §10).

### Limite de login por IP
Padrão: 20 falhas por IP em 15 min (`LOGIN_LIMITE_IP`, `LOGIN_LIMITE_IP_JANELA_MIN`). Contagem em memória por réplica – mantenha 1 réplica do app ou limite também no proxy.

## 3. Pré-deploy do worker: migrações, seeds e onboarding de clientes
`scripts/predeploy.sh` roda, nesta ordem, conforme as variáveis do serviço **worker**:

| Variável | Efeito |
|---|---|
| `RESET_DB=true` | **Apaga** o banco e recria (`prisma migrate reset`). Só homologação/demonstração – remova a variável logo depois do deploy. |
| _(sempre)_ | `prisma migrate deploy` |
| `SEED_DEMO=true` | `npm run seed:demo` – consórcio fictício CID-DEMO (idempotente). Só homologação. |
| `SEED_ONBOARDING=riachao-das-neves` | `npm run onboard -- riachao-das-neves` (arquivo `prisma/seed/clientes/<cliente>.json`; vários clientes separados por vírgula). Com `DEMO_MODE=true` roda com `--demo` (senha demo `Demo@2026licencia`, sem troca obrigatória). Idempotente: cria só o que falta. |
| `SEED_RIACHAO_DEMO=true` | `npm run seed:riachao-demo` – empreendimentos, processos, licenças, denúncias e vistorias **fictícios** de Riachão das Neves (exige o onboarding acima; idempotente). |
| `SEED_CERTIFICADO_DEMO=true` | `npm run seed:certificado-demo` – certificado A1 de **teste** (sem valor legal) para Lagoa do Orvalho e Riachão das Neves: os documentos saem assinados digitalmente (PAdES) com o selo "certificado de teste". Idempotente. Nunca em produção – ver `docs/assinatura-digital.md`. |
| `SEED_CDS_POC=true` | **Somente no projeto da PoC** (`licenciagov-poc`, `DEMO_MODE=false`): onboarding `cds-piemonte --demo` (senha = `ONBOARD_SENHA`) + `npm run seed:cds-poc` (CDS Piemonte do Paraguaçu, 8 municípios reais, cenários T1–T10). Aborta com `DEMO_MODE=true`/`SEED_DEMO=true` ou com `cds-piemonte` em `SEED_ONBOARDING`. Ver `docs/poc-cds.md`. |
| `ONBOARD_SENHA` | (opcional) senha fixa dos usuários criados pelo onboarding. Sem ela e sem `--demo`, cada usuário novo recebe uma senha temporária **impressa uma única vez no log do pré-deploy** (troca obrigatória no 1º acesso). |

Ambiente de apresentação para Riachão das Neves (exemplo): `DEMO_MODE=true`, `SEED_DEMO=true`, `SEED_ONBOARDING=riachao-das-neves`, `SEED_RIACHAO_DEMO=true` (opcional: `SEED_CERTIFICADO_DEMO=true` para PDFs assinados digitalmente).
Produção de um cliente: apenas `SEED_ONBOARDING=<cliente>` no primeiro deploy (sem `DEMO_MODE`/`SEED_DEMO`/`SEED_RIACHAO_DEMO`); guarde as senhas temporárias do log e depois remova a variável.

Manual: `railway run --service worker npm run onboard -- <cliente> [--demo] [--atualizar]` (`--atualizar` sobrescreve os dados cadastrais do órgão com os do JSON; `--redefinir-senhas` gera novas senhas).

**Isolamento por cliente:** cada organização (tenant) só enxerga os próprios municípios, usuários, configurações, relatórios e exportações; o consórcio de demonstração e Riachão das Neves ficam isolados mesmo no mesmo banco. Os limites municipais são obtidos do IBGE pelo `codigo_ibge` (nada a configurar).

### OCR do GED (worker dedicado)
O OCR de documentos digitalizados do GED (`docs/ged.md` §13) usa `ocrmypdf` + Tesseract (português), instalados no **estágio `worker`** de `Dockerfile`/`Dockerfile.worker`: a imagem do worker fica **~400–600 MB maior** (a do `app` não muda). Como o OCR consome muita CPU/memória, a recomendação é um **segundo serviço worker** (mesmo repo e `Dockerfile.worker`) só para essa fila:
- serviço `worker` (geral): `GED_OCR_DESATIVADO=true` (não disputa CPU com exportações, alertas e extração de texto);
- serviço `worker-ocr`: `JOBS_FILAS=ged-ocr` (sem *Pre-deploy command*; as migrações ficam no `worker` geral), mesmas variáveis de banco/storage (`DATABASE_URL`, `DATA_KEY`, `STORAGE_*`/`S3_*`, `CLAMAV_*` se houver) e memória de ≥ 1 GB; ajuste `GED_OCR_JOBS` (padrão 2) ao nº de vCPUs.
Com um único worker, deixe tudo como está: ele também processa a fila `ged-ocr`. Sem nenhum worker com `ocrmypdf` os digitalizados ficam "OCR pendente"/"indisponível" (nada quebra). Cota mensal por cliente: `/ged/admin/configuracoes` (padrão 5000 páginas).

## 4. Homolog × produção
Crie dois *Environments* no projeto (`homolog`, `production`) – cada um tem seu próprio Postgres, bucket e domínio. Região: o Railway não tem região no Brasil; se a exigência de hospedagem no Brasil (SPEC §3) for contratual, use AWS sa-east-1 (`deploy/README.md`).

## 5. Monitoramento
Uptime monitor externo (Better Stack/UptimeRobot) em `https://<domínio>/api/health` a cada 1 min. Backups: habilite também os backups nativos do volume do Postgres no Railway (*Postgres → Backups*, camada 1) – o dump lógico diário cifrado e o teste de restauração mensal rodam sozinhos no **worker** (filas `backup` e `restore-test`); confira em `/admin/backup` (ver `docs/backup.md`).
