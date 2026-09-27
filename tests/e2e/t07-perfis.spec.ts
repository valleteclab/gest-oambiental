import { test, expect, type APIRequestContext } from "@playwright/test";
import { entrarComo, login, tokenApi } from "./helpers";

// T7 – Perfis [PoC-7] (SPEC 13). Somente leitura: roda nos dois projetos.
// Técnico de Iaçu não vê processos de Itaberaba (lista, busca, URL direta → HTTP 403, API → 403);
// SEMA_INEMA vê tudo mas sem botões de ação; visitante só acessa o portal público.

type Proc = { id: string; numero: string; status: string };

async function processoItb(request: APIRequestContext, status?: string): Promise<Proc> {
  const token = await tokenApi(request, "admin");
  const r = await request.get(`/api/v1/processos?q=ITB-2026-${status ? `&status=${status}` : ""}&size=50`, { headers: { Authorization: `Bearer ${token}` } });
  expect(r.ok()).toBeTruthy();
  const itens = ((await r.json()).items as Proc[]).filter((p) => p.numero?.startsWith("ITB-"));
  expect(itens.length, `processo de Itaberaba ${status ?? ""}`).toBeGreaterThan(0);
  return itens[0];
}

test("T7a – técnico de Iaçu não vê processos de Itaberaba (lista, busca, URL direta 403 e API 403)", async ({ page, request }) => {
  const itb = await processoItb(request);
  await login(page, "tecnicoIac");

  await page.goto("/processos");
  const numeros = (await page.locator('main table a[href^="/processos/"]').allInnerTexts()).map((s) => s.trim());
  expect(numeros.length).toBeGreaterThan(0);
  for (const n of numeros) expect(n).toMatch(/^IAC-2026-\d{6}$/);
  await expect(page.getByLabel("Município")).not.toContainText("Itaberaba");

  await page.goto(`/processos?q=${encodeURIComponent(itb.numero)}`);
  await expect(page.locator(`main a[href="/processos/${itb.id}"]`)).toHaveCount(0);
  await expect(page.getByText(itb.numero, { exact: true })).toHaveCount(0);

  // URL direta → HTTP 403 + tela de acesso negado
  const resp = await page.goto(`/processos/${itb.id}`);
  expect(resp?.status()).toBe(403);
  await expect(page.getByTestId("acesso-negado")).toBeVisible();
  await expect(page.getByText("Acesso negado")).toBeVisible();
  await expect(page.getByText(itb.numero)).toHaveCount(0);

  // API com o token do técnico de Iaçu → 403
  const token = await tokenApi(request, "tecnicoIac");
  const api = await request.get(`/api/v1/processos/${itb.id}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(api.status()).toBe(403);
  const lista = await request.get(`/api/v1/processos?q=${itb.numero}`, { headers: { Authorization: `Bearer ${token}` } });
  expect((await lista.json()).total).toBe(0);
});

test("T7b – SEMA/INEMA vê processos de todos os municípios, mas sem botões de ação", async ({ page, request }) => {
  const emAnalise = await processoItb(request, "EM_ANALISE");

  // Controle: o técnico de Itaberaba tem ações neste processo
  await login(page, "tecnicoItb");
  await page.goto(`/processos/${emAnalise.id}`);
  await expect(page.getByRole("toolbar", { name: "Ações do processo" })).toBeVisible();

  await entrarComo(page, "sema");
  await page.goto("/processos");
  await expect(page.getByText(/processo\(s\) no seu escopo · acesso somente leitura/)).toBeVisible();
  await page.getByLabel("Município").selectOption({ label: "Itaberaba" });
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.locator('main table a[href^="/processos/"]').first()).toHaveText(/^ITB-2026-/);
  await page.getByLabel("Município").selectOption({ label: "Iaçu" });
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.locator('main table a[href^="/processos/"]').first()).toHaveText(/^IAC-2026-/);

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
