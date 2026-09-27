import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("smoke", () => {
  test("página inicial do portal público", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Licenciamento/i);
    await expect(page.getByRole("main").getByRole("link", { name: /Consultar processo/i }).first()).toBeVisible();
  });

  test("tela de login tem campos rotulados", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("E-mail")).toBeVisible();
    await expect(page.getByLabel("Senha")).toBeVisible();
    await expect(page.getByRole("button", { name: /entrar/i })).toBeVisible();
  });

  test("/api/health responde ok (banco e storage)", async ({ request }) => {
    const r = await request.get("/api/health");
    expect(r.status()).toBe(200);
    const corpo = await r.json();
    expect(corpo).toMatchObject({ status: "ok", db: true, storage: true });
  });

  test("HSTS e cabeçalhos de segurança", async ({ request }) => {
    const r = await request.get("/");
    expect(r.headers()["strict-transport-security"]).toContain("max-age=");
    expect(r.headers()["x-content-type-options"]).toBe("nosniff");
  });

  test("documentação OpenAPI publicada", async ({ request }) => {
    const r = await request.get("/api/docs/openapi.json");
    expect(r.ok()).toBeTruthy();
    const doc = await r.json();
    expect(doc.openapi).toMatch(/^3\.1/);
    expect(Object.keys(doc.paths)).toContain("/api/v1/processos");
  });
});

test("login pela UI (admin) leva ao painel interno", async ({ page }) => {
  await login(page, "admin");
});
