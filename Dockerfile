# syntax=docker/dockerfile:1.7
# LicenciaGov – imagem multi-stage.
#   target "app"    (padrão): servidor Next.js standalone (porta 3000)
#   target "worker"         : jobs pg-boss (`npm run jobs`), migrações e seeds (tsx + prisma CLI)
# Build:  docker build -t licenciagov:dev .            (app)
#         docker build -t licenciagov-worker:dev --target worker .

ARG NODE_IMAGE=node:22-bookworm-slim

# ───────────── base: SO + Chromium (PDF via puppeteer-core) + fontes ─────────────
FROM ${NODE_IMAGE} AS base
ENV DEBIAN_FRONTEND=noninteractive \
    NEXT_TELEMETRY_DISABLED=1 \
    TZ=America/Bahia
# postgresql-client do repositório oficial (apt.postgresql.org): pg_dump/pg_restore precisam ser da mesma
# versão major do servidor ou mais novos (Railway: ghcr.io/railwayapp-templates/postgres-ssl:18 → cliente 18).
# Usado pelo backup real (lib/backup/executar.ts) no worker e no botão "Executar backup agora" do web.
ARG PG_CLIENT_VERSION=18
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && . /etc/os-release \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      openssl tini tzdata \
      poppler-utils \
      postgresql-client-${PG_CLIENT_VERSION} \
      chromium fonts-liberation fonts-dejavu-core fonts-noto-core fonts-noto-color-emoji \
 && apt-get purge -y --auto-remove curl \
 && rm -rf /var/lib/apt/lists/* \
 && pg_dump --version
ENV CHROMIUM_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_DOWNLOAD=1
WORKDIR /app

# ───────────── deps: node_modules completos (dev incluído, p/ build e worker) ─────────────
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund \
 && npx prisma generate

# ───────────── builder: next build (output standalone) ─────────────
FROM deps AS builder
COPY . .
# Valores fictícios apenas para o build (nenhuma conexão é feita). Segredos reais só em runtime.
ENV NODE_ENV=production \
    NEXT_DIST_DIR=.next \
    DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    AUTH_SECRET="build-only-secret-build-only-secret-000000" \
    DATA_KEY="0000000000000000000000000000000000000000000000000000000000000000" \
    HASH_PEPPER="build-only"
RUN npx prisma generate && npm run build

# ───────────── worker: jobs pg-boss + migrate/seed (tsx) ─────────────
FROM base AS worker
ENV NODE_ENV=production
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
# Fontes completas (jobs/, lib/, prisma/ + seeds/clientes, scripts/ (predeploy.sh), templates/, public/, tests/fixtures…)
# – filtradas pelo .dockerignore. Pré-deploy no Railway: `sh scripts/predeploy.sh` (ver deploy/railway.md).
COPY --chown=node:node . .
RUN mkdir -p /app/storage && chown node:node /app/storage
USER node
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "run", "jobs"]

# ───────────── app: runtime mínimo (standalone) ─────────────
FROM base AS app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    STORAGE_LOCAL_DIR=/app/storage
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/prisma ./prisma
RUN mkdir -p /app/storage && chown node:node /app/storage
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
