#!/usr/bin/env bash
# Teste de restauração (SPEC 9.2 – mensal, checklist em docs/restore.md).
# Restaura o dump mais recente em um banco descartável, executa contagens de sanidade,
# compara com a produção e registra RESTORE_TESTE em backup_registro.
#
# Variáveis: as mesmas de pg_dump.sh, mais
#   RESTORE_ARQUIVO   arquivo específico (.enc/.age); padrão = mais recente local ou do BACKUP_BUCKET
#   RESTORE_DB        nome do banco descartável (padrão licenciagov_restore_teste)
#   BACKUP_AGE_KEY    arquivo de identidade age (se o dump for .age)
#   RESTORE_MANTER=1  não apaga o banco descartável ao final
set -Eeuo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$RAIZ"
if [[ -f .env && -z "${DATABASE_URL:-}" ]]; then set -a; source .env; set +a; fi
: "${DATABASE_URL:?DATABASE_URL não definida}"

BACKUP_DIR="${BACKUP_DIR:-$RAIZ/storage/.backups}"
PGURL="${DATABASE_URL%%\?*}"
BASE_URL="${PGURL%/*}"
RESTORE_DB="${RESTORE_DB:-licenciagov_restore_teste}"
RESTORE_URL="$BASE_URL/$RESTORE_DB"
INICIO="$(date +%s)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

registrar() { # sucesso observacao
  [[ "${BACKUP_SKIP_REGISTRO:-0}" == "1" ]] && return 0
  npx --no-install tsx scripts/backup/registrar.ts --tipo RESTORE_TESTE --sucesso "$1" --destino "$RESTORE_DB" --tamanho "${TAMANHO:-0}" --observacao "$2" || true
}
falha() { echo "ERRO: $1" >&2; registrar false "Falha: $1"; exit 1; }
trap 'falha "comando falhou na linha $LINENO"' ERR

# 1) Localiza o dump
ARQ="${RESTORE_ARQUIVO:-}"
if [[ -z "$ARQ" && -n "${BACKUP_BUCKET:-}" ]]; then
  AWS_ARGS=(); [[ -n "${BACKUP_ENDPOINT_URL:-}" ]] && AWS_ARGS+=(--endpoint-url "$BACKUP_ENDPOINT_URL")
  ULT="$(aws "${AWS_ARGS[@]}" s3 ls "${BACKUP_BUCKET%/}/" | awk '{print $4}' | grep -E '^licenciagov-.*\.(enc|age)$' | sort | tail -1)"
  [[ -n "$ULT" ]] || falha "nenhum dump no bucket"
  aws "${AWS_ARGS[@]}" s3 cp --only-show-errors "${BACKUP_BUCKET%/}/$ULT" "$TMP/$ULT"
  ARQ="$TMP/$ULT"
fi
if [[ -z "$ARQ" ]]; then
  ARQ="$(ls -1 "$BACKUP_DIR"/licenciagov-*.{enc,age} 2>/dev/null | sort | tail -1 || true)"
fi
[[ -n "$ARQ" && -f "$ARQ" ]] || falha "nenhum dump encontrado (BACKUP_DIR=$BACKUP_DIR)"
TAMANHO="$(stat -c %s "$ARQ")"
echo "Dump: $ARQ ($TAMANHO bytes)"
if [[ -f "$ARQ.sha256" ]]; then (cd "$(dirname "$ARQ")" && sha256sum -c "$(basename "$ARQ").sha256") || falha "sha256 não confere"; fi

# 2) Banco descartável
psql "$BASE_URL/postgres" -v ON_ERROR_STOP=1 -qc "DROP DATABASE IF EXISTS \"$RESTORE_DB\"" -c "CREATE DATABASE \"$RESTORE_DB\""

# 3) Descriptografa + restaura
if [[ "$ARQ" == *.age ]]; then
  : "${BACKUP_AGE_KEY:?BACKUP_AGE_KEY (arquivo de identidade age) não definido}"
  age -d -i "$BACKUP_AGE_KEY" "$ARQ" | gunzip | psql "$RESTORE_URL" -v ON_ERROR_STOP=1 -q >/dev/null
else
  : "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE não definida}"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$ARQ" | gunzip | psql "$RESTORE_URL" -v ON_ERROR_STOP=1 -q >/dev/null
fi

# 4) Contagens de sanidade (restaurado x produção – produção pode ter crescido desde o dump)
TABELAS=(organizacao municipio usuario pessoa empreendimento processo tramitacao documento_oficial anexo log_auditoria)
RESUMO=""
for t in "${TABELAS[@]}"; do
  R="$(psql "$RESTORE_URL" -tAc "SELECT count(*) FROM \"$t\"")"
  P="$(psql "$PGURL" -tAc "SELECT count(*) FROM \"$t\"" 2>/dev/null || echo '?')"
  printf '  %-20s restaurado=%-8s produção=%s\n' "$t" "$R" "$P"
  RESUMO+="$t=$R "
  if [[ "$P" =~ ^[0-9]+$ && "$R" -gt "$P" ]]; then falha "tabela $t tem mais linhas no dump que na produção"; fi
done
[[ "$(psql "$RESTORE_URL" -tAc 'SELECT count(*) FROM usuario')" -gt 0 ]] || falha "tabela usuario vazia no restaurado"
# Imutabilidade preservada (trigger da tramitacao restaurado)
TRG="$(psql "$RESTORE_URL" -tAc "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid = 'tramitacao'::regclass")"
[[ "$TRG" -gt 0 ]] || falha "trigger de imutabilidade de tramitacao ausente no restaurado"
MIG="$(psql "$RESTORE_URL" -tAc 'SELECT count(*) FROM _prisma_migrations' 2>/dev/null || echo 0)"

DURACAO=$(( $(date +%s) - INICIO ))
[[ "${RESTORE_MANTER:-0}" == "1" ]] || psql "$BASE_URL/postgres" -qc "DROP DATABASE IF EXISTS \"$RESTORE_DB\""

trap - ERR
registrar true "Restauração automática OK de $(basename "$ARQ") em ${DURACAO}s; migrações=$MIG; triggers tramitacao=$TRG; $RESUMO"
echo "Teste de restauração concluído em ${DURACAO}s."
