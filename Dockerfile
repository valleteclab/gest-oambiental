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
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      openssl ca-certificates tini tzdata \
      chromium fonts-liberation fonts-dejavu-core fonts-noto-core fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*
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
# Fontes completas (jobs/, lib/, prisma/, templates/…) – filtradas pelo .dockerignore
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
