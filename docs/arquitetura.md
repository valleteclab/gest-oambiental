# Arquitetura – LicenciaGov

Visão resumida. Detalhes funcionais em [`SPEC.md`](SPEC.md); implantação em [`../deploy/README.md`](../deploy/README.md); operação em [`operacao.md`](operacao.md).

## Componentes

```
 Navegador (desktop / celular do fiscal)
        │ HTTPS (HSTS)
        ▼
 ┌────────────────────────── Next.js 15 (App Router, standalone) ──────────────────────────┐
 │ (publico)   portal: consulta, licenças, validar/[codigo], denúncia                      │
 │ (auth)      login, cadastro de requerente, troca de senha                               │
 │ (requerente) meus processos, novo requerimento                                          │
 │ (interno)   dashboard, processos, cadastros, fiscalização, documentos, relatórios, admin│
 │ /api/v1/*   REST (Route Handlers, rota() + zod) · /api/docs (OpenAPI 3.1) · /api/health │
 │ Server Actions (UI)                                                                     │
 │ lib/: auth (JWT jose + argon2id) · rbac (escopo multi-município) · audit · numeracao ·   │
 │       prazos/dias · documentos (PDF+QR+código+sha256) · pdf (puppeteer-core+Chromium) · │
 │       storage (S3/local) · crypto (AES-256-GCM + hash de busca) · email (SMTP)           │
 └───────────────┬───────────────────────────┬──────────────────────────┬──────────────────┘
                 │ Prisma 6                  │ S3 API                   │ SMTP
                 ▼                           ▼                          ▼
        PostgreSQL 16                 S3 / MinIO / R2              SES / SMTP
        (dados, fila pg-boss,         (anexos, PDFs oficiais,
         triggers de imutabilidade)    exportações)
                 ▲
                 │ pg-boss
 ┌───────────────┴──────────────┐
 │ Worker (`npm run jobs`)       │  alertas de prazo + e-mail, vencimentos, exportação completa (ZIP),
 │ jobs/worker.ts (tsx)          │  verificação de backup
 └──────────────────────────────┘
```

## Decisões
- **Monólito modular** Next.js: portal público, painel interno, mobile do fiscal e API no mesmo deploy (prazo curto, menos peças).
- **Uma imagem, dois alvos** (`Dockerfile`): `app` (servidor standalone enxuto) e `worker` (fontes + tsx + prisma CLI; também roda migrações e seeds).
- **Fila no próprio Postgres** (pg-boss): sem Redis/SQS a operar.
- **Multi-tenant por coluna** `municipio_id` + escopo aplicado no servidor (`lib/rbac.ts`); nunca confiar no front.
- **Imutabilidade**: `tramitacao` e `log_auditoria` protegidas por trigger; documentos emitidos não mudam (cancelamento gera status + motivo).
- **Autenticidade**: cada PDF oficial tem código verificador + QR para `/validar/{codigo}` + SHA-256 guardado no banco.
- **LGPD**: CPF/CNPJ, e-mail e telefone de PF cifrados (AES-256-GCM, `DATA_KEY` no secret manager); busca por hash com pepper.
- **Região Brasil** (AWS sa-east-1), ambientes `homolog` e `prod` isolados.

## Fluxo de requisição autenticada
1. Login (`/login` ou `POST /api/v1/auth/login`) → cookies `lg_access` (15 min) / `lg_refresh` (8 h) ou Bearer token.
2. Página/rota chama `exigirUsuario()` / `getUsuario()` → `can()` + `whereMunicipio()` na consulta.
3. Escritas em transação com `auditar()`; transições gravam `tramitacao`; numeração via `SELECT … FOR UPDATE`.

## CI/CD
`.github/workflows/ci.yml`: lint → typecheck → vitest → build → E2E (Postgres de serviço + seed + Playwright desktop e Pixel 7) → build Docker.
`.github/workflows/deploy.yml`: `main` → homolog; tag `v*`/manual com aprovação → prod (ECR + ECS, migração one-shot, rolling update, smoke).
