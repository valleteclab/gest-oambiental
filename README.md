# LicenciaGov

Sistema web multi-município de **licenciamento e fiscalização ambiental** oferecido como SaaS para prefeituras, secretarias municipais de meio ambiente e consórcios públicos.

> Os dados de demonstração (`npm run seed:demo`) usam uma organização e municípios **fictícios** ("Consórcio Intermunicipal de Demonstração", sigla CID-DEMO: Lagoa do Orvalho/LOR, Serra Serena/SSR, Campo das Seriemas/CSE, Pedra do Candeeiro/PCA, Alto do Umbuzeiro/AUM, Várzea do Mandacaru/VMA; códigos IBGE fictícios iniciados em 99). Com `DEMO_MODE=true` o sistema exibe a faixa "Ambiente de demonstração – dados fictícios".

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
Usuários demo: `admin@licenciagov.demo`, `tecnico.lor@licenciagov.demo`, `laticinio@licenciagov.demo` … senha `Demo@2026licencia`.
No login escolhe-se o **órgão** (município); `/login?orgao=LOR` pré-seleciona. Usuários municipais só entram nos órgãos dos seus papéis; ADMIN, TEC_CONSORCIO e SEMA_INEMA em qualquer um; requerentes escolhem livremente.

## Testes
```bash
npm run typecheck && npm run lint && npm test      # unitários (vitest)
npm run test:e2e:poc                               # aceite da PoC T1–T10 (Playwright) – re-seed antes: npm run seed:demo em banco limpo
```
Documentação: `docs/arquitetura.md`, `docs/operacao.md`, `docs/backup.md`, `docs/restore.md`, `deploy/README.md`; API em `/api/docs` (OpenAPI em `/api/docs/openapi.json`).
