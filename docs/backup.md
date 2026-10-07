# Estratégia de backup e portabilidade – LicenciaGov

Referência: SPEC §9.2 e teste de aceite **T10**. Checklist de restauração: [`docs/restore.md`](restore.md).

## 1. Camadas de proteção

| Camada | O quê | Onde | Frequência | Retenção |
|---|---|---|---|---|
| 1. Backup gerenciado | Backup nativo do volume do Postgres no Railway (*Postgres → Backups*) ou snapshot/PITR do provedor (RDS/Cloud SQL…) | Mesmo provedor | Diário/semanal (config. do provedor) | Config. do provedor |
| 2. Dump lógico cruzado (**implementado e executado pelo sistema**) | Worker, fila `backup`: `pg_dump -Fc` → **AES-256** (openssl) → bucket S3-compatível em **outro provedor** (`BACKUP_S3_*`, ex.: Cloudflare R2 ou Backblaze B2) | Outro provedor/região | Diário 03:15 (America/Bahia) | **30 dias** (`BACKUP_RETENCAO_DIAS`) |
| 3. Arquivos (anexos/PDFs/GED) | Bucket de storage com **versionamento** + **replicação feita pelo sistema** (fila `storage-replicar`) para o bucket de backup em outro provedor, sob `arquivos/` | S3/R2/B2 | Diário 03:00 + reconciliação semanal (dom. 04:30) | **Nunca apaga** no destino; versões antigas por lifecycle do bucket |
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

## 4. Arquivos (anexos, documentos oficiais e arquivos do GED) – replicação

O dump do banco **não** leva os arquivos enviados. Quem os copia é o job **`storage-replicar`** (`lib/backup/arquivos.ts`,
registrado por `jobs/ged-backup.ts` no worker).

- **Quais**: toda `storage_key` de `Anexo`, `DocumentoOficial` e `GedVersaoDocumento` (todos os clientes – é infraestrutura da
  plataforma; descobre as chaves direto no Prisma). **Fora do escopo**: `ReuniaoConselho.ata_pdf_key`, `MensagemConversa.midia_key`,
  `Cobranca.comprovante_key` e os ZIPs de `Exportacao`.
- **Para onde**: `arquivos/{storage_key}` (ex.: `arquivos/ged/<organizacao_id>/2026/<documento_id>/v1-ab12cd34.pdf`), na ordem:
  1. `BACKUP_ARQUIVOS_DIR` – diretório local/NAS (desenvolvimento, testes, ponto de montagem);
  2. bucket externo `BACKUP_S3_*` (mesmo bucket dos dumps; prefixo `BACKUP_ARQUIVOS_PREFIX`, padrão `arquivos/`, independente de `BACKUP_S3_PREFIX=pg/`);
  3. sem nenhum dos dois: storage da própria aplicação em `backups/arquivos/` (**mesmo provedor** – o registro avisa "cópia fora do provedor NÃO configurada").
- **Quando**: `JOBS_CRON_REPLICACAO` (padrão `0 3 * * *`, `JOBS_TZ`) copia o que foi criado **depois da última marca d'água**
  (menos 1 h de sobreposição; "já está no destino com o mesmo tamanho e sha256" não recopia). Em carga inicial grande, o job
  processa em lotes (`REPLICACAO_LOTE`, padrão 2000) até `REPLICACAO_TEMPO_MAX_MIN` (padrão 50 min) e continua no dia seguinte.
  A marca d'água só avança quando não houve erro.
- **Verificação**: depois de gravar, confere **tamanho + sha256** (sha256 no *metadata* do objeto S3 ou em sidecar `<arquivo>.sha256`
  no diretório; ETag/MD5 quando disponível). Arquivo cujo hash difere do registro do banco é copiado e contado em `divergencias`
  (investigar); origem ilegível conta como erro.
- **Nunca apaga** no destino (a interface de destino nem tem "remover"). Em Object Lock/versionamento isso é uma segunda barreira.
- **Reconciliação semanal** (`storage-reconciliar`, `JOBS_CRON_RECONCILIACAO`, padrão `30 4 * * 0`): inventário do banco × listagem
  completa do destino; copia o que **faltar** ou estiver com **tamanho diferente** e informa `sobrando` (só no destino). Pega o que a
  incremental perdeu (ex.: arquivos cujo `created_at` ficou anterior à marca d'água).
- **Registro**: cada execução grava `backup_registro` com `tipo = REPLICACAO_ARQUIVOS` (`tamanho` = bytes copiados, `destino`, `sucesso`,
  `observacao` = `modo`, `marca`, `copiados`, `ja_no_destino`, `erros`, `divergencias`, `sobrando`, duração e amostra de erros) + `log_auditoria`
  (`REPLICACAO_ARQUIVOS_REGISTRO`). Falha também envia e-mail para `BACKUP_ALERTA_EMAIL`. Advisory lock impede duas execuções simultâneas.
- **Alerta de atraso (> 24 h)**: `ultimaReplicacao()` (`lib/backup/arquivos.ts`) devolve `{ ultima, horas, atrasada, marca }`. Integração
  no `jobs/backup-check.ts` (uma linha em `verificarBackup`, depois do bloco de backup):
  `const rep = await ultimaReplicacao(agora); if (rep.atrasada) problemas.push(rep.ultima ? "Última replicação de arquivos há " + Math.floor(rep.horas!) + " h (limite 24 h)." : "Nenhuma replicação de arquivos registrada.");`
  e `/admin/backup` pode rotular `tipo === "REPLICACAO_ARQUIVOS"` como "Replicação de arquivos".
- **Restauração**: `npm run backup:restore-arquivos -- [--prefixo ged/<organizacao_id>/] [--simular] [--sobrescrever] [--origem-dir <dir>]`
  (ver [`restore.md`](restore.md) §D). Restaura **só um cliente** com o prefixo; preserva arquivos que já existem; confere o sha256.
- Bucket principal (`S3_BUCKET`) com **versionamento** ligado – um upload nunca sobrescreve sem guardar a versão anterior.
- PDFs de documentos oficiais são imutáveis; o `sha256_pdf` no banco permite verificar a integridade após uma restauração.

Execução manual de ensaio (sem worker): `npx tsx --conditions=react-server -e "import('./lib/backup/arquivos').then(m => m.replicarArquivos({ origem: 'manual' })).then(r => { console.log(r); process.exit(0) })"`
(com `BACKUP_ARQUIVOS_DIR=/caminho` para um destino local).

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
