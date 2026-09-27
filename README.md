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
