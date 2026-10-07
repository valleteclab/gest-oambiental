# Teste de restauração e restauração manual

Referência: SPEC §9.2 ("teste de restauração mensal documentado") e T10. Estratégia: [`docs/backup.md`](backup.md).

## A. Teste automático (mensal, executado pelo sistema)

Quando: worker, fila `restore-test`, `BACKUP_RESTORE_CRON` (padrão `45 4 1 * *` = dia 1 às 04:45, America/Bahia).
Sob demanda: botão **"Executar teste de restauração agora"** em `/admin/backup` (ADMIN, auditado como
`RESTORE_TESTE_SOLICITADO`) ou `./scripts/backup/restore-test.sh`. Implementação: `lib/backup/executar.ts`.

1. Lista o destino (bucket fora do provedor `BACKUP_S3_*`; sem ele, `backups/` do storage da aplicação) e baixa o dump **mais recente**.
2. Confere o SHA-256 do arquivo com o `.sha256` ao lado (ou com o registrado em `backup_registro`).
3. Decifra (`openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000`) com `BACKUP_PASSPHRASE` – testa também a custódia da chave.
4. Banco descartável: `BACKUP_RESTORE_DATABASE_URL` (schema `public` recriado) ou, por padrão, `CREATE DATABASE licenciagov_restore_test`
   no mesmo servidor (nunca o banco de produção – há trava).
5. Cria as extensões do PostgreSQL de que o schema depende (`unaccent`, `pg_trgm` – busca do GED) e só então roda `pg_restore --no-owner --no-acl --exit-on-error --use-list` (qualquer erro = falha), com o índice do dump **sem a entrada do schema `public`** e sem `--clean`. Motivo: o dump é feito com `--schema=public` e **não leva `CREATE EXTENSION`**; e `--clean` tentaria `DROP SCHEMA public`, que falha porque as extensões dependem dele.
6. Verificações:
   - contagens de `organizacao, municipio, usuario, pessoa, empreendimento, processo, tramitacao, documento_oficial, anexo, log_auditoria, _prisma_migrations`
     restaurado × produção: tabelas mutáveis dentro da tolerância (`BACKUP_RESTORE_TOLERANCIA`, padrão 10 %, mín. 2 linhas);
     `tramitacao`/`log_auditoria` (só inserção) restaurado ≤ produção; `_prisma_migrations` igual; `usuario`/`municipio` > 0;
   - triggers de imutabilidade de `tramitacao` e `log_auditoria` presentes e um `UPDATE` em `tramitacao` **bloqueado**.
7. Apaga o banco descartável (`BACKUP_RESTORE_MANTER=true` para inspecionar) e registra `RESTORE_TESTE` em `backup_registro`
   com duração, dump usado e contagens. Falha → registro `sucesso=false` + e-mail para `BACKUP_ALERTA_EMAIL`.

Capacidade: o banco descartável ocupa ≈ o tamanho do banco de produção durante alguns minutos – deixe folga no volume.

## B. Checklist mensal (operador – marcar e anexar evidências)

| # | Item | OK |
|---|---|---|
| 1 | `/admin/backup`: último backup **verde** (< 24 h), tamanho coerente com o mês anterior (variação < 30 %), "cópia fora do provedor: configurada" | ☐ |
| 2 | Último teste de restauração automático **Sucesso** no mês, contagens sem "(!" na observação | ☐ |
| 3 | O objeto existe no bucket de DR (painel R2/B2) e o bucket tem Object Lock/versionamento e lifecycle ativos | ☐ |
| 4 | Restauração manual (seção C) a partir do **bucket de DR** em máquina isolada, com a senha retirada do **cofre** (não do Railway) | ☐ |
| 5 | Subir a aplicação apontando para o banco restaurado (`DATABASE_URL=…/licenciagov_restore npm run start` em homologação) | ☐ |
| 6 | Login com usuário de teste; abrir um processo recente e sua linha do tempo | ☐ |
| 7 | Validar um documento oficial em `/validar/{codigo}` → **VÁLIDO**; o hash do PDF (do bucket replicado) confere com `sha256_pdf` | ☐ |
| 8 | Abrir um anexo recente a partir do bucket replicado | ☐ |
| 9 | Descartar o ambiente restaurado (dados pessoais – LGPD) | ☐ |
| 10 | Registrar em `/admin/backup → Registrar teste de restauração manual` (duração, dump usado, problemas) | ☐ |

Em caso de falha: abrir chamado CRÍTICO, corrigir a causa e repetir o teste em até 5 dias úteis.

## C. Restauração manual passo a passo (desastre ou checklist item 4)

Pré-requisitos: `postgresql-client` da mesma versão major do servidor (ou mais nova), `openssl`, `aws` CLI ou `rclone` (ou o painel do provedor).

```bash
# 1) Baixar o dump mais recente do bucket de DR (exemplo R2 com aws-cli)
export AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=…
EP=https://<conta>.r2.cloudflarestorage.com
aws --endpoint-url $EP s3 ls s3://licenciagov-dr/pg/ | sort | tail -3
ARQ=licenciagov-AAAAMMDDTHHMMSSZ.dump.enc
aws --endpoint-url $EP s3 cp s3://licenciagov-dr/pg/$ARQ .
aws --endpoint-url $EP s3 cp s3://licenciagov-dr/pg/$ARQ.sha256 .

# 2) Integridade
sha256sum -c $ARQ.sha256

# 3) Decifrar (senha do cofre). Se o ambiente não tinha BACKUP_PASSPHRASE, a senha é derivada da DATA_KEY:
#    export BACKUP_PASSPHRASE=$(printf 'licenciagov-backup' | openssl dgst -sha256 -hmac "$DATA_KEY" -r | cut -d' ' -f1)
export BACKUP_PASSPHRASE='…'
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in $ARQ -out licenciagov.dump
pg_restore --list licenciagov.dump | head          # confere o conteúdo

# 4) Banco novo (Postgres ≥ versão de origem) e restauração
createdb -h <host> -U postgres licenciagov
# ANTES do pg_restore: as extensões que o schema usa (o dump com --schema=public não as inclui)
psql -h <host> -U postgres -d licenciagov -c "CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public; CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;"
# Índice do dump sem a entrada do schema public (o banco novo já o tem; --clean tentaria DROP SCHEMA public e falharia)
pg_restore --list licenciagov.dump | grep -v -E '^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public( |$)' > restaurar.lst
pg_restore -h <host> -U postgres -d licenciagov --no-owner --no-acl --exit-on-error --use-list restaurar.lst licenciagov.dump

# 5) Conferências
psql -h <host> -U postgres -d licenciagov -c "SELECT count(*) FROM processo" -c "SELECT count(*) FROM _prisma_migrations"
DATABASE_URL=postgresql://…/licenciagov npx prisma migrate deploy   # deve dizer "No pending migrations"

# 6) Apagar os arquivos em claro
shred -u licenciagov.dump
```

Depois: apontar `DATABASE_URL` do app e do worker para o banco restaurado (e `S3_*` para o bucket de arquivos replicado,
se o primário estiver indisponível), subir os serviços, verificar `/api/health`, comunicar os municípios e registrar o
incidente com RPO/RTO efetivos. Se a camada 1 (backup nativo do Railway/PITR) estiver disponível e for mais recente, prefira-a.
