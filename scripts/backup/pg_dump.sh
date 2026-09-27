#!/usr/bin/env bash
# Backup lógico diário do PostgreSQL (SPEC 9.2) – complementa o backup automático do Postgres gerenciado.
#   pg_dump → gzip → criptografia (age ou openssl AES-256-CBC/PBKDF2) → bucket em OUTRA região/provedor
#   → retenção de 30 dias (local e remota) → registro em backup_registro.
#
# Agendamento sugerido (cron do host/CI, 02:15 America/Bahia):
#   15 2 * * *  cd /srv/licenciagov && ./scripts/backup/pg_dump.sh >> /var/log/licenciagov-backup.log 2>&1
#
# Variáveis:
#   DATABASE_URL          (obrigatória) conexão do banco de produção (o sufixo ?schema=… é removido)
#   BACKUP_PASSPHRASE     (obrigatória se não usar age) senha da criptografia simétrica (secret manager!)
#   BACKUP_AGE_RECIPIENT  (opcional) chave pública age (age1…) – se definida, usa age em vez de openssl
#   BACKUP_DIR            diretório local retido (padrão ./storage/.backups – ignorado pelo git)
#   BACKUP_BUCKET         destino remoto, ex.: s3://licenciagov-dr/pg  (outra região/provedor)
#   BACKUP_ENDPOINT_URL   endpoint S3-compatível (R2, B2, MinIO, Wasabi…) – opcional
#   BACKUP_AWS_PROFILE    perfil do aws-cli – opcional
#   BACKUP_RETENCAO_DIAS  padrão 30
#   BACKUP_SKIP_REGISTRO  =1 para não gravar em backup_registro
set -Eeuo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$RAIZ"
if [[ -f .env && -z "${DATABASE_URL:-}" ]]; then set -a; source .env; set +a; fi

: "${DATABASE_URL:?DATABASE_URL não definida}"
BACKUP_DIR="${BACKUP_DIR:-$RAIZ/storage/.backups}"
RETENCAO="${BACKUP_RETENCAO_DIAS:-30}"
PGURL="${DATABASE_URL%%\?*}"
CARIMBO="$(date -u +%Y%m%dT%H%M%SZ)"
NOME_BASE="licenciagov-${CARIMBO}.sql.gz"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

registrar() { # sucesso tamanho destino observacao
  [[ "${BACKUP_SKIP_REGISTRO:-0}" == "1" ]] && return 0
  npx --no-install tsx scripts/backup/registrar.ts --tipo BACKUP --sucesso "$1" --tamanho "$2" --destino "$3" --observacao "$4" || echo "AVISO: falha ao registrar em backup_registro" >&2
}

falha() {
  local msg="$1"
  echo "ERRO: $msg" >&2
  registrar false 0 "${BACKUP_BUCKET:-$BACKUP_DIR}" "Falha: $msg"
  exit 1
}
trap 'falha "comando falhou na linha $LINENO"' ERR

# 1) Dump + compressão + criptografia (nunca grava o dump em claro no disco)
if [[ -n "${BACKUP_AGE_RECIPIENT:-}" ]]; then
  command -v age >/dev/null || falha "age não instalado"
  ARQ="$BACKUP_DIR/$NOME_BASE.age"
  pg_dump --no-owner --no-acl --format=plain "$PGURL" | gzip -9 | age -r "$BACKUP_AGE_RECIPIENT" -o "$ARQ"
  CIFRA="age"
else
  : "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE não definida (ou defina BACKUP_AGE_RECIPIENT)}"
  ARQ="$BACKUP_DIR/$NOME_BASE.enc"
  pg_dump --no-owner --no-acl --format=plain "$PGURL" | gzip -9 | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -out "$ARQ"
  CIFRA="openssl-aes-256-cbc-pbkdf2"
fi
TAMANHO="$(stat -c %s "$ARQ")"
SHA="$(sha256sum "$ARQ" | cut -d' ' -f1)"
echo "$SHA  $(basename "$ARQ")" > "$ARQ.sha256"
[[ "$TAMANHO" -gt 1024 ]] || falha "arquivo de backup muito pequeno ($TAMANHO bytes)"
echo "Dump gerado: $ARQ ($TAMANHO bytes, sha256 $SHA, $CIFRA)"

# 2) Envio para bucket em outra região/provedor
DESTINO="$ARQ"
if [[ -n "${BACKUP_BUCKET:-}" ]]; then
  command -v aws >/dev/null || falha "aws-cli não instalado (necessário para BACKUP_BUCKET)"
  AWS_ARGS=()
  [[ -n "${BACKUP_ENDPOINT_URL:-}" ]] && AWS_ARGS+=(--endpoint-url "$BACKUP_ENDPOINT_URL")
  [[ -n "${BACKUP_AWS_PROFILE:-}" ]] && AWS_ARGS+=(--profile "$BACKUP_AWS_PROFILE")
  aws "${AWS_ARGS[@]}" s3 cp --only-show-errors "$ARQ" "${BACKUP_BUCKET%/}/$(basename "$ARQ")"
  aws "${AWS_ARGS[@]}" s3 cp --only-show-errors "$ARQ.sha256" "${BACKUP_BUCKET%/}/$(basename "$ARQ").sha256"
  DESTINO="${BACKUP_BUCKET%/}/$(basename "$ARQ")"
  echo "Enviado para $DESTINO"

  # Retenção remota (além disso, configure lifecycle rule de 30 dias no bucket)
  LIMITE="$(date -u -d "-${RETENCAO} days" +%Y%m%d)"
  aws "${AWS_ARGS[@]}" s3 ls "${BACKUP_BUCKET%/}/" | awk '{print $4}' | grep -E '^licenciagov-[0-9]{8}T' | while read -r obj; do
    DIA="${obj:12:8}"
    if [[ "$DIA" < "$LIMITE" ]]; then
      aws "${AWS_ARGS[@]}" s3 rm --only-show-errors "${BACKUP_BUCKET%/}/$obj" && echo "Removido (retenção): $obj"
    fi
  done
fi

# 3) Retenção local
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'licenciagov-*' -mtime "+$RETENCAO" -print -delete || true

# 4) Registro (aparece em /admin/backup)
trap - ERR
registrar true "$TAMANHO" "$DESTINO" "pg_dump diário ($CIFRA), sha256 $SHA"
echo "Backup concluído."
