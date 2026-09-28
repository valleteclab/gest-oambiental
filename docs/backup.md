# Estratégia de backup e portabilidade – LicenciaGov

Referência: SPEC §9.2 e teste de aceite **T10**. Checklist de restauração: [`docs/restore.md`](restore.md).

## 1. Camadas de proteção

| Camada | O quê | Onde | Frequência | Retenção |
|---|---|---|---|---|
| 1. Backup gerenciado | Backup nativo do volume do Postgres no Railway (*Postgres → Backups*) ou snapshot/PITR do provedor (RDS/Cloud SQL…) | Mesmo provedor | Diário/semanal (config. do provedor) | Config. do provedor |
| 2. Dump lógico cruzado (**implementado e executado pelo sistema**) | Worker, fila `backup`: `pg_dump -Fc` → **AES-256** (openssl) → bucket S3-compatível em **outro provedor** (`BACKUP_S3_*`, ex.: Cloudflare R2 ou Backblaze B2) | Outro provedor/região | Diário 03:15 (America/Bahia) | **30 dias** (`BACKUP_RETENCAO_DIAS`) |
| 3. Arquivos (anexos/PDFs) | Bucket de storage com **versionamento** + **replicação** para outro provedor | S3/R2 | Contínuo / diário (rclone sync) | Versões antigas 30 dias |
| 4. Portabilidade | Exportação completa em `/admin/exportar` (CSV+JSON por tabela, dicionário, anexos, `manifest.json` com SHA-256) | Download pelo órgão | Sob demanda | Responsabilidade do órgão |

Objetivos: **RPO ≤ 24 h** · **RTO ≤ 4 h**. Teste de restauração **automático mensal** (fila `restore-test`) – ver [`restore.md`](restore.md).

Nada em `/admin/backup` é fabricado: o seed de demonstração **não** cria registros de backup; tudo o que aparece
lá vem de execuções reais (worker, botão ou CLI).

## 2. Dump diário (worker, fila `backup` – `lib/backup/executar.ts`)

Quando: `BACKUP_CRON` (padrão `15 3 * * *`, fuso `JOBS_TZ` = America/Bahia) no serviço **worker** (`npm run jobs`).
Também sob demanda: botão **"Executar backup agora"** em `/admin/backup` (ADMIN, auditado como `BACKUP_SOLICITADO`)
ou `./scripts/backup/pg_dump.sh` (= `npx tsx scripts/backup/executar.ts backup`). Um advisory lock no Postgres
impede duas execuções simultâneas (worker × botão × réplicas).

1. `pg_dump --format=custom --compress=6 --no-owner --no-acl --schema=public` (senha via `PGPASSWORD`, fora da linha de comando).
   - **Escopo: schema `public`** = todos os dados da aplicação, `_prisma_migrations` e os triggers de imutabilidade.
     Ficam de fora o schema `pgboss` (fila de jobs, transitória – o worker a recria) e schemas de outros serviços
     que eventualmente compartilhem o banco (ex.: `evolution` do gateway de WhatsApp, cujas sessões se refazem
     pareando o aparelho de novo). `BACKUP_SCHEMAS` altera a lista.
2. Saída do `pg_dump` vai **por pipe** para `openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:…` – o dump nunca é gravado em claro.
   Senha: `BACKUP_PASSPHRASE` (cofre de segredos). Sem ela, é derivada da `DATA_KEY` (HMAC-SHA256 de `licenciagov-backup`) e /admin/backup exibe aviso.
3. Nome `licenciagov-AAAAMMDDTHHMMSSZ.dump.enc` + `…dump.enc.sha256`; SHA-256 calculado do arquivo cifrado.
4. Upload com `@aws-sdk/client-s3` para `s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX` (padrão `pg/`) no endpoint `BACKUP_S3_ENDPOINT`.
   **Sem `BACKUP_S3_*`**: fallback para o storage da própria aplicação em `backups/` (mesmo provedor) – o destino é
   registrado como "cópia fora do provedor NÃO configurada" e /admin/backup mostra o aviso.
5. Retenção: apaga do destino os dumps com mais de `BACKUP_RETENCAO_DIAS` (30) – **nunca** o mais recente.
6. Registro em `backup_registro` (tipo `BACKUP`, tamanho, destino, sucesso, observação com `sha256=…`, versão do pg_dump,
   duração, removidos, origem) + `log_auditoria`. **Falhas também são registradas** (`sucesso=false`) e disparam e-mail
   para `BACKUP_ALERTA_EMAIL`.

Requisitos da imagem: `postgresql-client-18` (do apt.postgresql.org – `pg_dump` precisa ser ≥ versão do servidor;
Railway usa `postgres-ssl:18`) e `openssl` – instalados no estágio `base` de `Dockerfile` e `Dockerfile.worker`.

Variáveis: ver `deploy/railway.md` §2 ("Backup real") e `.env.example`.

## 3. Bucket de destino (DR)

- **Outro provedor** em relação ao banco (Railway): Cloudflare R2 ou Backblaze B2 (ambos S3-compatíveis).
  - R2: `BACKUP_S3_ENDPOINT=https://<conta>.r2.cloudflarestorage.com`, `BACKUP_S3_REGION=auto`; token de API R2 com permissão *Object Read & Write* só nesse bucket.
  - B2: `BACKUP_S3_ENDPOINT=https://s3.<região>.backblazeb2.com`, `BACKUP_S3_REGION=<região>`; *Application Key* restrita ao bucket.
- **Versionamento/Object Lock** (B2: *Object Lock* 30 dias; R2: *bucket lock rules*) contra ransomware/remoção acidental.
- **Lifecycle rule** de 35 dias no prefixo `pg/` como segunda barreira (a rotina já apaga > 30 dias).
- A credencial precisa de `PutObject`, `GetObject`, `ListBucket` e `DeleteObject` (retenção). Com Object Lock, a remoção só esconde versões.

## 4. Arquivos (anexos e documentos oficiais)

- Bucket principal (`S3_BUCKET`) com **versionamento** ligado – um upload nunca sobrescreve sem guardar a versão anterior.
- **Replicação** (S3 CRR / R2 → B2 via `rclone sync --backup-dir` diário) para bucket em outra região/provedor.
- PDFs de documentos oficiais são imutáveis; o `sha256_pdf` no banco permite verificar a integridade após uma restauração.

## 5. Monitoramento

- `/admin/backup`: último backup (verde ≤ 24 h, vermelho se mais antigo), tamanho, destino, SHA-256, próxima execução
  agendada, estado do worker, se a cópia fora do provedor está configurada, último teste de restauração com detalhes e histórico.
- Falha de backup/teste → e-mail imediato para `BACKUP_ALERTA_EMAIL`.
- Worker, fila `backup-check` diária às 07:10: se o último backup bem-sucedido tem **> 24 h**, se a última execução
  falhou ou se o último teste de restauração tem **> 31 dias**, envia e-mail aos ADMIN (registrado em `email_enviado`).
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
