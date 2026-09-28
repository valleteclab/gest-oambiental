#!/usr/bin/env bash
# Backup lógico sob demanda (a rotina diária roda no worker, fila `backup` – ver docs/backup.md).
# Mesma implementação do worker: lib/backup/executar.ts (pg_dump -Fc | openssl AES-256 → bucket fora do provedor).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
exec npx --no-install tsx scripts/backup/executar.ts backup
