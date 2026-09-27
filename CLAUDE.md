# LicenciaGov – guia para desenvolvedores e agentes

Especificação completa: `docs/SPEC.md` (fonte da verdade). Stack: Next.js 15 (App Router) + TypeScript + Tailwind v4 + Prisma 6 + PostgreSQL 16.

## Ambiente local
- Postgres: `service postgresql start` (DB `licenciagov`, user/senha `postgres`). `.env` na raiz (modelo em `.env.example`).
- `npx prisma migrate deploy && npm run seed:base` (ou `seed:demo` com dados completos) — senha de todos os usuários demo: `Demo@2026licencia`
  (admin@licenciagov.demo, tec.consorcio1@…, tecnico.lor@…, gestor.lor@…, fiscal.lor@…, tecnico.cse@…, tecnico.ssr@…, sema@…, laticinio@… (requerente) etc. – ver `prisma/seed/base.ts`).
- Dados demo são **fictícios**: organização "Consórcio Intermunicipal de Demonstração" (CID-DEMO) e municípios Lagoa do Orvalho (LOR, principal), Serra Serena (SSR), Campo das Seriemas (CSE), Pedra do Candeeiro (PCA), Alto do Umbuzeiro (AUM), Várzea do Mandacaru (VMA) – códigos IBGE fictícios `99…`. Nunca usar nomes de municípios/consórcios reais em seed, testes ou textos do app. `DEMO_MODE=true` exibe a faixa "Ambiente de demonstração".
- Dev: `npm run dev`. Vários servidores no mesmo checkout: `NEXT_DIST_DIR=.next-x npx next dev -p 3005`.
- Checagens: `npm run typecheck`, `npm run lint`, `npm test` (vitest, `tests/unit`), `npm run test:e2e` (Playwright, `tests/e2e`).
- Chromium para PDF: `CHROMIUM_PATH` (no container de dev: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`).

## Convenções obrigatórias
- **Escopo multi-município**: toda query de negócio usa `whereMunicipio(u)` / `whereProcessoEscopo(u)` de `lib/rbac.ts`; acesso por URL a registro fora do escopo → `forbidden()`/403 (use `podeVerMunicipio`). Nunca confiar no front.
- **Permissões**: `can(usuario, acao, recurso, municipioId?)` (`lib/rbac.ts`). SEMA_INEMA é somente leitura: esconder botões de ação (`isSomenteLeitura`).
- **Auditoria**: toda escrita chama `auditar({usuario_id, acao, entidade, entidade_id, antes, depois}, tx?)` (`lib/audit.ts`).
- **Sessão**: páginas usam `exigirUsuario({interno:true})`; Server Actions/rotas usam `getUsuario()` e checam permissão de novo.
- **Órgão ativo**: o login exige escolher o órgão (município) – regra `podeAcessarOrgao()` (`lib/rbac.ts`): papéis municipais só nos seus municípios; ADMIN/TEC_CONSORCIO/SEMA_INEMA e REQUERENTE em qualquer um. Cookie `lg_orgao`; `getOrgaoAtivo()` (`lib/auth.ts`); troca em `/trocar-orgao`. É **contexto** (cabeçalho, filtro padrão via `filtroMunicipioPadrao()`, município padrão do requerimento), não fronteira de permissão – o escopo continua em `whereMunicipio()`/`can()`.
- **Build sem banco**: a imagem Docker é construída sem banco – toda página que consulta o banco é dinâmica (`export const dynamic = "force-dynamic"` ou uso de cookies/searchParams). Verifique com `DATABASE_URL="postgresql://x:x@127.0.0.1:1/nada" NEXT_DIST_DIR=.next-nodb npx next build`.
- **API** `/api/v1/*`: handlers envolvidos em `rota()` de `lib/http.ts`; erros `{code,message,details}`; paginação `?page=&size=` via `paginacao()`; validação com zod.
- **Numeração**: `lib/numeracao.ts` (dentro de `prisma.$transaction`).
- **Prazos**: `lib/prazos.ts` (`calcularPrazo`, `etapaAnalise`, `saldoDias`) e `lib/dias.ts` (`semaforo`).
- **Documentos oficiais**: sempre via `emitirDocumento()` / `cancelarDocumento()` de `lib/documentos` (PDF + QR + código verificador + sha256). Documento emitido é imutável.
- **PDF**: `htmlParaPdf()` + `esc()` de `lib/pdf.ts`. **Arquivos**: `lib/storage.ts` (`validarUpload`, `salvarArquivo`, sha256 de `lib/crypto.ts`).
- **Dados pessoais**: CPF/CNPJ, e-mail e telefone de PF cifrados (`cifrar/decifrar`), busca por `hashBusca`; portal público usa `mascararCpfCnpj` e `abreviarNome`.
- **UI**: componentes em `components/ui.tsx` (Card, CabecalhoPagina, Badge, BadgeStatus, PontoSemaforo, Aviso, Campo, Paginacao); classes utilitárias `btn-primario`, `btn-secundario`, `btn-perigo`, `card`, `input`, `label`, `tabela`. Mapa: `components/mapa` (`<Mapa />`, só cliente). Menu interno: `components/nav-interno.tsx`.
- Textos em português; datas `dd/mm/aaaa` e moeda `R$` via `lib/format.ts`. Responsivo a partir de 320 px, labels em todos os campos.
- Tabelas `tramitacao` e `log_auditoria` são imutáveis (trigger no banco).
- Nunca commitar segredos; `.env*` é ignorado (exceto `.env.example`).
