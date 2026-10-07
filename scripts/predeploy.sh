#!/bin/sh
# Pré-deploy do WORKER (Railway: Settings → Deploy → Pre-deploy command = `sh scripts/predeploy.sh`).
# Executa, nesta ordem, controlado por variáveis de ambiente:
#   RESET_DB=true            → APAGA o banco e recria (prisma migrate reset). SOMENTE homologação/demonstração!
#   (sempre)                 → prisma migrate deploy
#   SEED_DEMO=true           → npm run seed:demo  (consórcio fictício CID-DEMO; idempotente)
#   SEED_DEMANDAS_DEMO=true  → npm run seed:demandas-demo (demandas urbanas APC/ASE/ACS fictícias em Lagoa do Orvalho;
#                               opcional, append-only, idempotente; exige o seed:demo – não altera as contagens dos E2E)
#   SEED_ONBOARDING=<cliente> → npm run onboard -- <cliente> [--demo se DEMO_MODE=true]
#                               (arquivo prisma/seed/clientes/<cliente>.json; idempotente; vários: separe por vírgula)
#   SEED_RIACHAO_DEMO=true   → npm run seed:riachao-demo (dados fictícios de Riachão das Neves; exige o onboarding)
#   SEED_CERTIFICADO_DEMO=true → npm run seed:certificado-demo (certificado A1 de TESTE, sem valor legal, para Lagoa do
#                               Orvalho e Riachão das Neves – documentos saem assinados digitalmente (PAdES) com o selo
#                               "certificado de teste"; idempotente; nunca usar em produção – docs/assinatura-digital.md)
#   SEED_GED_DEMO=true       → npm run seed:ged-demo (Gestão de Documentos: 2 clientes fictícios, usuários, pastas e documentos de ensaio)
#   SEED_COBRANCA_DEMO=true  → npm run seed:cobranca-demo (cobrança de taxas SIMULADA – Pix/boleto fictícios e "Simular
#                               pagamento" – e tabela de taxas fictícia em Riachão das Neves e Alto do Umbuzeiro; rodar
#                               depois do seed:demo/onboarding; não toca os municípios dos E2E; docs/cobranca.md)
#   SEED_CDS_POC=true        → SOMENTE no ambiente da PoC (CDS Piemonte – docs/poc-cds.md): onboarding
#                               cds-piemonte --demo (senha = ONBOARD_SENHA) + npm run seed:cds-poc. Recusa rodar com
#                               DEMO_MODE=true ou SEED_DEMO=true (a demonstração pública nunca recebe esses dados).
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

if sim "${SEED_DEMANDAS_DEMO:-}"; then
  log "SEED_DEMANDAS_DEMO=true – demandas urbanas de demonstração (APC/ASE/ACS)"
  npm run seed:demandas-demo
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

if sim "${SEED_CERTIFICADO_DEMO:-}"; then
  log "SEED_CERTIFICADO_DEMO=true – certificado digital de TESTE (sem valor legal) para os órgãos de demonstração"
  npm run seed:certificado-demo
fi

if sim "${SEED_COBRANCA_DEMO:-}"; then
  log "SEED_COBRANCA_DEMO=true – cobrança de taxas SIMULADA + tabela de taxas fictícia (RDN e Alto do Umbuzeiro)"
  npm run seed:cobranca-demo
fi

if sim "${SEED_GED_DEMO:-}"; then
  log "SEED_GED_DEMO=true – Gestão de Documentos: dois clientes FICTÍCIOS de demonstração (isolamento entre clientes)"
  npm run seed:ged-demo
fi

# ── Ambiente da PoC – CDS Piemonte do Paraguaçu (Pregão SRP 005/2026) – ver docs/poc-cds.md ──
if sim "${SEED_CDS_POC:-}"; then
  if sim "${DEMO_MODE:-}" || sim "${SEED_DEMO:-}"; then
    log "ERRO: SEED_CDS_POC=true não pode ser usado com DEMO_MODE=true/SEED_DEMO=true (demonstração pública). Abortado."
    exit 1
  fi
  case ",${SEED_ONBOARDING:-}," in
    *,cds-piemonte,*)
      log "ERRO: com SEED_CDS_POC=true, retire cds-piemonte de SEED_ONBOARDING (este bloco já faz o onboarding com --demo;"
      log "      sem --demo os usuários ficam com senha temporária e troca obrigatória, e os E2E da PoC não entram). Abortado."
      exit 1 ;;
  esac
  [ -n "${ONBOARD_SENHA:-}" ] || log "AVISO: ONBOARD_SENHA vazia – usuários de ensaio com a senha demo padrão (trocar antes da sessão oficial)."
  log "SEED_CDS_POC=true – onboarding cds-piemonte (--demo) + dados de ensaio da PoC"
  npm run onboard -- cds-piemonte --demo
  npm run seed:cds-poc
fi

log "concluído"
