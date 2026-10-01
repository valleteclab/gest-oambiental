import { test, expect } from "@playwright/test";
import { DADOS, entrarComo, login, reProcesso, USUARIOS } from "./helpers";

// T3 – Prazos e alertas [PoC-3] (SPEC 13). Somente leitura (não marca alertas como lidos): roda nos dois projetos.
// Seed: o técnico do município principal (demo: tecnico.lor; PoC: tecnico.itb) tem um processo vencendo em 3 dias e outro vencido; o job de alertas já rodou
// (alertas no sino + e-mails na caixa de teste, pois não há SMTP na demo).

test("T3 – técnico vê 2 alertas no sino, os processos nas abas Vencendo/Vencidos com semáforo e o e-mail na caixa de teste", async ({ page }) => {
  await login(page, "tecnicoPrincipal");

  // Sino com 2 alertas não lidos
  const sino = page.getByTestId("sino-alertas");
  await expect(sino).toBeVisible();
  await expect(page.getByTestId("sino-contador")).toHaveText("2");
  await expect(sino).toHaveAttribute("aria-label", /Alertas: 2 não lido\(s\)/);

  // Os 2 alertas: um vencendo em 3 dias, outro vencido
  await sino.click();
  await expect(page).toHaveURL(/\/alertas/);
  await page.getByRole("tab", { name: /Não lidos/ }).click();
  const alertas = page.getByTestId("alerta-item");
  await expect(alertas).toHaveCount(2);
  const msgs = await alertas.locator("a").allInnerTexts();
  const vencendo = msgs.find((m) => /vence em 3 dia\(s\)/.test(m));
  const vencido = msgs.find((m) => /vencido há \d+ dia\(s\)/.test(m));
  expect(vencendo, `alertas: ${msgs.join(" | ")}`).toBeTruthy();
  expect(vencido, `alertas: ${msgs.join(" | ")}`).toBeTruthy();
  const numVencendo = vencendo!.match(reProcesso(DADOS.principal.sigla, false))![0];
  const numVencido = vencido!.match(reProcesso(DADOS.principal.sigla, false))![0];

  // Tela de prazos, filtrada nos processos do técnico
  await page.goto("/prazos");
  await page.getByLabel("Técnico responsável").selectOption({ label: "Meus processos" });
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page).toHaveURL(/tecnico=/);

  await page.getByRole("tab", { name: /^Vencidos/ }).click();
  await expect(page.getByRole("tab", { name: /^Vencidos/ })).toHaveAttribute("aria-selected", "true");
  const linhasVencidos = page.getByTestId("linha-prazo");
  await expect(linhasVencidos).toHaveCount(1);
  await expect(linhasVencidos.first()).toContainText(numVencido);
  await expect(linhasVencidos.first()).toHaveAttribute("data-semaforo", "vermelho");

  await page.getByRole("tab", { name: /^Vencem em 7 dias/ }).click();
  await expect(page.getByRole("tab", { name: /^Vencem em 7 dias/ })).toHaveAttribute("aria-selected", "true");
  const linhasVencendo = page.getByTestId("linha-prazo");
  await expect(linhasVencendo).toHaveCount(1);
  await expect(linhasVencendo.first()).toContainText(numVencendo);
  await expect(linhasVencendo.first()).toHaveAttribute("data-semaforo", "amarelo");

  // E-mails de alerta na caixa de teste (admin)
  await entrarComo(page, "admin");
  await page.goto(`/admin/emails?q=${encodeURIComponent(USUARIOS.tecnicoPrincipal)}`);
  const caixa = page.getByTestId("caixa-emails");
  for (const numero of [numVencendo, numVencido]) {
    const email = caixa.locator("li").filter({ hasText: `Processo ${numero}: prazo da etapa` });
    await expect(email).toHaveCount(1);
    await expect(email).toContainText(`para ${USUARIOS.tecnicoPrincipal}`);
    await expect(email).toContainText(/Caixa de teste|Enviado/);
  }
});
