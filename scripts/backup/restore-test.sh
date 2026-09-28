#!/usr/bin/env bash
# Teste de restauração sob demanda (a rotina mensal roda no worker, fila `restore-test` – ver docs/restore.md).
# Baixa o dump mais recente do destino, confere sha256, decifra, restaura num banco descartável, confere e apaga.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
exec npx --no-install tsx scripts/backup/executar.ts restore-test
