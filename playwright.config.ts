import { defineConfig, devices } from "@playwright/test";

// E2E (SPEC 13). Alvo: E2E_BASE_URL (ex.: https://homolog.licenciagov.com.br ou prod no dia da PoC).
// Sem E2E_BASE_URL, sobe um servidor local (next dev; em CI, o build standalone).
const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";
// No container de dev o Chromium do Playwright não bate com a versão do pacote: use CHROMIUM_PATH.
const executablePath = process.env.CHROMIUM_PATH || undefined;
const launchOptions = executablePath ? { executablePath } : {};

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Um worker: os testes de aceite compartilham o banco (T1 grava o nº/LO usados por T5 e T8).
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    locale: "pt-BR",
    timezoneId: "America/Bahia",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ignoreHTTPSErrors: !!process.env.E2E_IGNORE_HTTPS,
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], launchOptions } },
    // Fiscal em campo (T4) – emulação de celular Android
    { name: "mobile-pixel7", use: { ...devices["Pixel 7"], launchOptions } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: process.env.CI ? "npm run start" : "npm run dev",
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
