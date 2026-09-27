import { test, expect, type APIRequestContext } from "@playwright/test";
import { SENHA_DEMO, USUARIOS, entrarComo, login, tokenApi } from "./helpers";

// T7 – Perfis [PoC-7] (SPEC 13). Somente leitura: roda nos dois projetos.
// Técnico de Campo das Seriemas não vê processos de Lagoa do Orvalho (lista, busca, URL direta → HTTP 403, API → 403);
// SEMA_INEMA vê tudo mas sem botões de ação; visitante só acessa o portal público.

type Proc = { id: string; numero: string; status: string };

async function processoLor(request: APIRequestContext, status?: string): Promise<Proc> {
  const token = await tokenApi(request, "admin");
  const r = await request.get(`/api/v1/processos?q=LOR-2026-${status ? `&status=${status}` : ""}&size=50`, { headers: { Authorization: `Bearer ${token}` } });
  expect(r.ok()).toBeTruthy();
  const itens = ((await r.json()).items as Proc[]).filter((p) => p.numero?.startsWith("LOR-"));
  expect(itens.length, `processo de Lagoa do Orvalho ${status ?? ""}`).toBeGreaterThan(0);
  return itens[0];
}

test("T7a – técnico de Campo das Seriemas não vê processos de Lagoa do Orvalho (lista, busca, URL direta 403 e API 403)", async ({ page, request }) => {
  const lor = await processoLor(request);
  await login(page, "tecnicoCse");

  await page.goto("/processos");
  const numeros = (await page.locator('main table a[href^="/processos/"]').allInnerTexts()).map((s) => s.trim());
  expect(numeros.length).toBeGreaterThan(0);
  for (const n of numeros) expect(n).toMatch(/^CSE-2026-\d{6}$/);
  await expect(page.getByLabel("Município")).not.toContainText("Lagoa do Orvalho");

  await page.goto(`/processos?q=${encodeURIComponent(lor.numero)}`);
  await expect(page.locator(`main a[href="/processos/${lor.id}"]`)).toHaveCount(0);
  await expect(page.getByText(lor.numero, { exact: true })).toHaveCount(0);

  // URL direta → HTTP 403 + tela de acesso negado
  const resp = await page.goto(`/processos/${lor.id}`);
  expect(resp?.status()).toBe(403);
  await expect(page.getByTestId("acesso-negado")).toBeVisible();
  await expect(page.getByText("Acesso negado")).toBeVisible();
  await expect(page.getByText(lor.numero)).toHaveCount(0);

  // API com o token do técnico de Campo das Seriemas → 403
  const token = await tokenApi(request, "tecnicoCse");
  const api = await request.get(`/api/v1/processos/${lor.id}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(api.status()).toBe(403);
  const lista = await request.get(`/api/v1/processos?q=${lor.numero}`, { headers: { Authorization: `Bearer ${token}` } });
  expect((await lista.json()).total).toBe(0);
});

test("T7b – SEMA/INEMA vê processos de todos os municípios, mas sem botões de ação", async ({ page, request }) => {
  const emAnalise = await processoLor(request, "EM_ANALISE");

  // Controle: o técnico de Lagoa do Orvalho tem ações neste processo
  await login(page, "tecnicoLor");
  await page.goto(`/processos/${emAnalise.id}`);
  await expect(page.getByRole("toolbar", { name: "Ações do processo" })).toBeVisible();

  await entrarComo(page, "sema");
  await page.goto("/processos");
  await expect(page.getByText(/processo\(s\) no seu escopo · acesso somente leitura/)).toBeVisible();
  await page.getByLabel("Município").selectOption({ label: "Lagoa do Orvalho" });
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.locator('main table a[href^="/processos/"]').first()).toHaveText(/^LOR-2026-/);
  await page.getByLabel("Município").selectOption({ label: "Campo das Seriemas" });
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.locator('main table a[href^="/processos/"]').first()).toHaveText(/^CSE-2026-/);

  const r = await page.goto(`/processos/${emAnalise.id}`);
  expect(r?.status()).toBe(200);
  await expect(page.getByTestId("numero-processo")).toHaveText(emAnalise.numero);
  await expect(page.getByRole("toolbar", { name: "Ações do processo" })).toHaveCount(0);
  await expect(page.getByTestId("acoes-processo")).toHaveCount(0);
  await page.goto(`/processos/${emAnalise.id}?aba=documentos`);
  await expect(page.getByText("Anexar documento")).toHaveCount(0);
  await page.goto(`/processos/${emAnalise.id}?aba=parecer`);
  await expect(page.getByRole("button", { name: "Emitir parecer técnico" })).toHaveCount(0);
  await page.goto(`/processos/${emAnalise.id}?aba=vistorias`);
  await expect(page.getByRole("link", { name: "Registrar vistoria" })).toHaveCount(0);

  // API: escrita negada para SEMA
  const token = await tokenApi(request, "sema");
  const w = await request.post(`/api/v1/processos/${emAnalise.id}/acoes/pendencia`, { headers: { Authorization: `Bearer ${token}` }, data: { itens: [{ descricao: "teste" }] } });
  expect(w.status()).toBe(403);
});

test("T7c – visitante sem login é levado ao login nas páginas internas e usa o portal público", async ({ page }) => {
  for (const url of ["/dashboard", "/processos", "/prazos", "/fiscalizacao", "/admin/backup", "/meus-processos"]) {
    await page.goto(url);
    await expect(page, url).toHaveURL(/\/login/);
  }
  const api = await page.request.get("/api/v1/processos");
  expect(api.status()).toBe(401);

  for (const [url, titulo] of [["/", /Licenciamento/i], ["/consulta", /Consultar processo/], ["/licencas", /Licen/], ["/validar", /Valida/], ["/denuncia", /Den[uú]ncia/]] as const) {
    const r = await page.goto(url);
    expect(r?.status(), url).toBe(200);
    await expect(page, url).toHaveURL(new RegExp(`${url === "/" ? "/$" : url}`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText(titulo);
  }
});

test("T7d – órgão no login: técnico de Lagoa do Orvalho não entra no órgão de Campo das Seriemas (UI e API)", async ({ page, request }) => {
  await page.goto("/login?orgao=CSE");
  await expect(page.getByLabel("Órgão")).toHaveValue("CSE");
  await page.getByLabel("E-mail").fill(USUARIOS.tecnicoLor);
  await page.getByLabel("Senha").fill(SENHA_DEMO);
  await page.getByRole("button", { name: /entrar/i }).click();
  await expect(page.getByText("Seu usuário não tem acesso a este órgão.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  expect((await page.context().cookies()).some((c) => c.name === "lg_access")).toBe(false);

  const api = await request.post("/api/v1/auth/login", { data: { email: USUARIOS.tecnicoLor, senha: SENHA_DEMO, orgao: "CSE" } });
  expect(api.status()).toBe(403);
  expect((await api.json()).code).toBe("ORGAO_SEM_ACESSO");
  const ok = await request.post("/api/v1/auth/login", { data: { email: USUARIOS.tecnicoLor, senha: SENHA_DEMO, orgao: "LOR" } });
  expect(ok.ok()).toBeTruthy();
  expect((await ok.json()).orgao.sigla).toBe("LOR");

  // No próprio órgão entra normalmente e o cabeçalho mostra o órgão ativo; a troca só oferece os órgãos permitidos
  await login(page, "tecnicoLor", SENHA_DEMO, "LOR");
  await expect(page.getByTestId("orgao-ativo").first()).toHaveAttribute("data-sigla", "LOR");
  await page.goto("/trocar-orgao");
  await expect(page.getByRole("radio")).toHaveCount(1);
});

test("T7e – usuário de escopo organização troca de órgão sem novo login", async ({ page }) => {
  await login(page, "sema", SENHA_DEMO, "LOR");
  await expect(page.getByTestId("orgao-ativo").first()).toHaveAttribute("data-sigla", "LOR");
  await page.getByTestId("trocar-orgao").first().click();
  await expect(page).toHaveURL(/\/trocar-orgao/);
  await page.getByRole("radio", { name: /Campo das Seriemas/ }).check();
  await page.getByRole("button", { name: "Usar este órgão" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByTestId("orgao-ativo").first()).toHaveAttribute("data-sigla", "CSE");
  await expect(page.getByTestId("dashboard-escopo")).toContainText("Campo das Seriemas");
});
