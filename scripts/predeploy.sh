#!/bin/sh
# Pré-deploy do WORKER (Railway: Settings → Deploy → Pre-deploy command = `sh scripts/predeploy.sh`).
# Executa, nesta ordem, controlado por variáveis de ambiente:
#   RESET_DB=true            → APAGA o banco e recria (prisma migrate reset). SOMENTE homologação/demonstração!
#   (sempre)                 → prisma migrate deploy
#   SEED_DEMO=true           → npm run seed:demo  (consórcio fictício CID-DEMO; idempotente)
#   SEED_ONBOARDING=<cliente> → npm run onboard -- <cliente> [--demo se DEMO_MODE=true]
#                               (arquivo prisma/seed/clientes/<cliente>.json; idempotente; vários: separe por vírgula)
#   SEED_RIACHAO_DEMO=true   → npm run seed:riachao-demo (dados fictícios de Riachão das Neves; exige o onboarding)
# Senhas: no onboarding sem --demo cada usuário novo recebe senha temporária impressa UMA vez no log do deploy
# (troca obrigatória); ONBOARD_SENHA fixa a senha. Com DEMO_MODE=true: senha demo, sem troca obrigatória.
set -eu
cd "$(dirname "$0")/.."

log() { echo "[predeploy] $*"; }
sim() { [ "${1:-}" = "true" ] || [ "${1:-}" = "1" ]; }

if sim "${RESET_DB:-}"; then
  log "RESET_DB=true – apagando e recriando o banco (prisma migrate reset)…"
  npx prisma migrate reset --force --skip-seed
fi

log "prisma migrate deploy"
npx prisma migrate deploy

if sim "${SEED_DEMO:-}"; then
  log "SEED_DEMO=true – seed de demonstração (CID-DEMO)"
  npm run seed:demo
fi

if [ -n "${SEED_ONBOARDING:-}" ]; then
  flag=""
  if sim "${DEMO_MODE:-}"; then flag="--demo"; fi
  for cliente in $(echo "$SEED_ONBOARDING" | tr ',' ' '); do
    log "SEED_ONBOARDING – onboarding do cliente '$cliente' $flag"
    npm run onboard -- "$cliente" $flag
  done
fi

if sim "${SEED_RIACHAO_DEMO:-}"; then
  log "SEED_RIACHAO_DEMO=true – dados de demonstração de Riachão das Neves"
  npm run seed:riachao-demo
fi

log "concluído"
