import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { DADOS, SENHA_DEMO, USUARIOS, login, tokenApi } from "./helpers";

// T12 – Isolamento entre organizações (clientes SaaS). O consórcio de demonstração (CID-DEMO) e a Prefeitura de
// Riachão das Neves (PM-RDN, onboarding `npm run onboard -- riachao-das-neves --demo` + `npm run seed:riachao-demo`)
// convivem no mesmo banco e um nunca enxerga o outro. Somente leitura: roda nos dois projetos.
// Dataset sem segunda organização (DADOS.isolamento = null, ex.: poc-cds – ambiente com um único cliente): pulado.

const ISO = DADOS.isolamento;
test.skip(!ISO, `Dataset ${DADOS.dataset}: sem segunda organização no banco – isolamento entre clientes não se aplica.`);
const RDN = { sigla: ISO?.sigla ?? "", nome: ISO?.municipio ?? "outra organização", admin: ISO?.admin ?? "", tecnico: ISO?.tecnico ?? "" };
const NOMES_CONSORCIO = DADOS.municipios.map((m) => m.nome);
const NUM_CONSORCIO = new RegExp(`(${DADOS.municipios.map((m) => m.sigla).join("|")})-\\d{4}-`);

async function tokenEmail(request: APIRequestContext, email: string) {
  const r = await request.post("/api/v1/auth/login", { data: { email, senha: SENHA_DEMO } });
  expect(r.ok(), `login API de ${email}: ${r.status()}`).toBeTruthy();
  return (await r.json()).access_token as string;
}

async function processos(request: APIRequestContext, token: string) {
  const r = await request.get("/api/v1/processos?size=100", { headers: { Authorization: `Bearer ${token}` } });
  expect(r.ok()).toBeTruthy();
  return (await r.json()) as { total: number; items: { id: string; numero: string | null; municipio_id: string }[] };
}

async function loginSemOrgao(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Órgão").selectOption("");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA_DEMO);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
}

test(`T12a – admin de ${RDN.nome}: só o próprio órgão no login/troca, painel e listas sem dados do consórcio`, async ({ page }) => {
  // Sem escolher órgão: o único órgão permitido (RDN) é ativado automaticamente
  await loginSemOrgao(page, RDN.admin);
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByTestId("orgao-ativo").first()).toHaveAttribute("data-sigla", RDN.sigla);
  await expect(page.getByTestId("dashboard-escopo")).toContainText(RDN.nome);

  // "Trocar órgão" oferece somente o órgão da outra organização
  await page.goto("/trocar-orgao");
  await expect(page.getByText(RDN.nome).first()).toBeVisible();
  for (const outro of NOMES_CONSORCIO) await expect(page.getByText(outro)).toHaveCount(0);

  // Processos, municípios e usuários do admin: nada do consórcio de demonstração
  await page.goto("/processos?municipio=");
  await expect(page.getByText(new RegExp(`${RDN.sigla}-\\d{4}-`)).first()).toBeVisible();
  await expect(page.getByText(NUM_CONSORCIO)).toHaveCount(0);
  await page.goto("/admin/municipios");
  await expect(page.getByText(RDN.nome).first()).toBeVisible();
  await expect(page.getByText(DADOS.principal.nome)).toHaveCount(0);
  await page.goto("/admin/usuarios");
  await expect(page.getByText(RDN.tecnico)).toBeVisible();
  await expect(page.getByText(USUARIOS.admin)).toHaveCount(0);
  await expect(page.getByText(USUARIOS.tecnicoPrincipal)).toHaveCount(0);
});

test(`T12b – admin do consórcio não entra no órgão de ${RDN.nome} nem vê seus processos (UI e API)`, async ({ page, request }) => {
  // UI: escolher RDN no login → acesso negado
  await page.goto(`/login?orgao=${RDN.sigla}`);
  await expect(page.getByLabel("Órgão")).toHaveValue(RDN.sigla);
  await page.getByLabel("E-mail").fill(USUARIOS.admin);
  await page.getByLabel("Senha").fill(SENHA_DEMO);
  await page.getByRole("button", { name: /entrar/i }).click();
  await expect(page.getByText("Seu usuário não tem acesso a este órgão.")).toBeVisible();

  // API: login no órgão RDN → 403; lista de processos sem RDN
  const negado = await request.post("/api/v1/auth/login", { data: { email: USUARIOS.admin, senha: SENHA_DEMO, orgao: RDN.sigla } });
  expect(negado.status()).toBe(403);
  const tokAdmin = await tokenApi(request, "admin");
  const lista = await processos(request, tokAdmin);
  expect(lista.total).toBeGreaterThan(0);
  expect(lista.items.some((p) => p.numero?.startsWith(`${RDN.sigla}-`))).toBe(false);

  // Acesso direto (por id) a processo de Riachão → 403 para o admin e para o SEMA/INEMA do consórcio
  const tokRdn = await tokenEmail(request, RDN.admin);
  const doRdn = await processos(request, tokRdn);
  expect(doRdn.items.length).toBeGreaterThan(0);
  expect(doRdn.items.every((p) => p.numero === null || p.numero.startsWith(`${RDN.sigla}-`))).toBe(true);
  const alvo = doRdn.items.find((p) => p.numero)!;
  for (const tok of [tokAdmin, await tokenApi(request, "sema")]) {
    const r = await request.get(`/api/v1/processos/${alvo.id}`, { headers: { Authorization: `Bearer ${tok}` } });
    expect(r.status()).toBe(403);
  }
  // …e o inverso: admin de Riachão não abre processo do consórcio
  const doConsorcio = lista.items.find((p) => p.numero)!;
  const r = await request.get(`/api/v1/processos/${doConsorcio.id}`, { headers: { Authorization: `Bearer ${tokRdn}` } });
  expect(r.status()).toBe(403);
  await page.goto("/sair");
});

test(`T12c – painel do consórcio (Todos) não soma dados de ${RDN.nome}`, async ({ page }) => {
  await login(page, "admin");
  await page.goto("/dashboard?municipio=");
  await expect(page.getByTestId("dashboard-escopo")).toContainText("Todos");
  await expect(page.getByText(RDN.nome)).toHaveCount(0);
  await page.goto("/trocar-orgao");
  await expect(page.getByText(DADOS.principal.nome).first()).toBeVisible();
  await expect(page.getByText(RDN.nome)).toHaveCount(0);
});
