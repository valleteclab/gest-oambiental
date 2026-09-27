# Estratégia de backup e portabilidade – LicenciaGov

Referência: SPEC §9.2 e teste de aceite **T10**. Checklist de restauração: [`docs/restore.md`](restore.md).

## 1. Camadas de proteção

| Camada | O quê | Onde | Frequência | Retenção |
|---|---|---|---|---|
| 1. Backup gerenciado | Snapshot + PITR (WAL) do Postgres gerenciado (RDS/Cloud SQL/Azure/…) | Mesmo provedor, região primária | Contínuo + snapshot diário | 7–35 dias (config. do provedor) |
| 2. Dump lógico cruzado | `scripts/backup/pg_dump.sh`: `pg_dump` → gzip → **criptografia** → bucket em **outra região ou outro provedor** | Ex.: primário AWS `sa-east-1`, cópia em Cloudflare R2/Backblaze B2 ou AWS `us-east-1` | Diário (02:15 America/Bahia) | **30 dias** (script + lifecycle rule) |
| 3. Arquivos (anexos/PDFs) | Bucket de storage com **versionamento** ligado + **replicação** para bucket em outra região/provedor | S3/R2 | Contínuo (replicação) / diário (rclone sync) | Versões antigas 30 dias |
| 4. Portabilidade | Exportação completa em `/admin/exportar` (CSV+JSON por tabela, dicionário, anexos, `manifest.json` com SHA-256) | Download pelo órgão | Sob demanda | Responsabilidade do órgão |

Objetivos: **RPO ≤ 24 h** (≤ 5 min com PITR da camada 1) · **RTO ≤ 4 h**.

## 2. Dump diário (`scripts/backup/pg_dump.sh`)

1. `pg_dump --no-owner --no-acl` (formato SQL) → `gzip -9` → criptografia **no pipe** (o dump nunca toca o disco em claro):
   - `age -r $BACKUP_AGE_RECIPIENT` (preferido – chave privada fica fora do servidor), **ou**
   - `openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE`.
2. Gera `.sha256` ao lado do arquivo.
3. `aws s3 cp` para `$BACKUP_BUCKET` (aceita `--endpoint-url` via `BACKUP_ENDPOINT_URL` → R2, B2, MinIO, Wasabi).
4. Apaga dumps com mais de `BACKUP_RETENCAO_DIAS` (30) no bucket e no diretório local.
5. Registra o resultado em `backup_registro` (tipo `BACKUP`, tamanho, destino, sha256) via `scripts/backup/registrar.ts` – é o que aparece em **/admin/backup**. Falhas também são registradas (`sucesso=false`).

Variáveis (secret manager, nunca no repositório):

```
DATABASE_URL=postgresql://backup_ro:…@db-prod:5432/licenciagov   # usuário somente leitura
BACKUP_AGE_RECIPIENT=age1…            # ou BACKUP_PASSPHRASE=…
BACKUP_BUCKET=s3://licenciagov-dr/pg
BACKUP_ENDPOINT_URL=https://<conta>.r2.cloudflarestorage.com   # opcional
AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (credencial só de escrita no bucket de DR)
```

Agendamento (cron do host, job do Kubernetes ou GitHub Actions agendado):

```
15 2 * * *  cd /srv/licenciagov && ./scripts/backup/pg_dump.sh >> /var/log/licenciagov-backup.log 2>&1
```

## 3. Bucket de destino (DR)

- Outra **região** (mínimo) ou outro **provedor** (recomendado) em relação ao banco primário.
- **Versionamento** + **Object Lock** (modo governance, 30 dias) para proteger contra ransomware/remoção acidental.
- **Lifecycle rule**: expirar objetos com prefixo `pg/` após 30 dias (redundante com o script).
- Credencial do servidor de aplicação: somente `PutObject`/`ListBucket`; `DeleteObject` apenas para a rotina de retenção ou deixar a expiração para a lifecycle rule.
- Criptografia no servidor (SSE) ligada **além** da criptografia do cliente.

## 4. Arquivos (anexos e documentos oficiais)

- Bucket principal (`S3_BUCKET`) com **versionamento** ligado – um upload nunca sobrescreve sem guardar a versão anterior.
- **Replicação** (S3 CRR / R2 → B2 via `rclone sync --backup-dir` diário) para bucket em outra região/provedor.
- PDFs de documentos oficiais são imutáveis; o `sha256_pdf` no banco permite verificar a integridade após uma restauração.

## 5. Monitoramento

- Worker (`npm run jobs`), fila `backup-check` diária às 07:10: se o último backup bem-sucedido tem **> 24 h**, se a última execução falhou ou se o último teste de restauração tem **> 31 dias**, envia e-mail aos ADMIN (registrado em `email_enviado`).
- `/admin/backup` destaca em vermelho backup com mais de 24 h e em amarelo teste de restauração vencido.
- Monitor externo em `/api/health` (SPEC 9.1).

## 6. Exportação completa (portabilidade)

`/admin/exportar` (ADMIN e SEMA/INEMA) ou `POST /api/v1/admin/exportacoes` → acompanha em `GET /api/v1/admin/exportacoes/{id}`.

Conteúdo do ZIP:

```
tabelas/<tabela>.csv      UTF-8 com BOM, separador ';', CRLF – uma por tabela do banco
tabelas/<tabela>.json     array de objetos – uma por tabela
dicionario_dados.md/.json tabela, coluna, tipo, obrigatório, PK, único, referência, descrição (gerado do esquema Prisma)
anexos/<storage_key>      todos os anexos, PDFs de documentos oficiais e atas
manifest.json             generated_at, contagens por tabela, SHA-256 e tamanho de cada arquivo, anexos ausentes
LEIA-ME.txt
```

- **Não exporta** `usuario.senha_hash`.
- Colunas cifradas (CPF/CNPJ, e-mail e telefone de PF, `usuario.cpf_cifrado`, contato de denúncia) saem **cifradas** (AES-256-GCM `v1:iv:tag:dados`). Na rescisão/migração, a `DATA_KEY` é entregue ao órgão por canal separado, mediante termo, permitindo decifrar.
- Processamento: fila `exportacao` do worker pg-boss; sem worker no ar, o próprio servidor web processa em segundo plano. O ZIP fica no storage em `exports/{id}.zip`; download auditado (`EXPORTACAO_DOWNLOAD`).
- Verificação: `unzip x.zip -d x && cd x && jq -r '.arquivos[] | "\(.sha256)  \(.caminho)"' manifest.json | sha256sum -c`.
