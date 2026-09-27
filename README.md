# LicenciaGov

Sistema web multi-município de **licenciamento e fiscalização ambiental** para órgãos ambientais municipais e consórcios públicos (primeiro cliente: CDS Piemonte do Paraguaçu – Programa GAC/SEMA-BA/INEMA).

- Especificação: [`docs/SPEC.md`](docs/SPEC.md)
- Guia de desenvolvimento e convenções: [`CLAUDE.md`](CLAUDE.md)

## Início rápido
```bash
cp .env.example .env            # ajuste DATABASE_URL, AUTH_SECRET, DATA_KEY
npm ci
npx prisma migrate deploy
npm run seed:demo               # dados de demonstração (NUNCA em produção de cliente)
npm run dev                     # http://localhost:3000
```
Usuários demo: `admin@licenciagov.demo`, `tecnico.itb@licenciagov.demo`, `laticinio@licenciagov.demo` … senha `Demo@2026licencia`.

## Testes
```bash
npm run typecheck && npm run lint && npm test      # unitários (vitest)
npm run test:e2e:poc                               # aceite da PoC T1–T10 (Playwright) – re-seed antes: npm run seed:demo em banco limpo
```
Documentação: `docs/arquitetura.md`, `docs/operacao.md`, `docs/backup.md`, `docs/restore.md`, `deploy/README.md`; API em `/api/docs` (OpenAPI em `/api/docs/openapi.json`).
