import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { test, expect } from "@playwright/test";
import { PROJETO_DESKTOP, apenasNoProjeto, login } from "./helpers";

// T10 – Backup e portabilidade [PoC-10] (SPEC 13). Executa um backup REAL e um teste de restauração REAL
// pelos botões de /admin/backup e confere o último backup (≤ 24 h, sha256) e a última restauração testada;
// a exportação completa gera ZIP com CSV + JSON por tabela, anexos/ e manifest.json.
// Cria backup e exportação: roda só no desktop. O servidor precisa de pg_dump/pg_restore/psql e openssl.

/** "dd/mm/aaaa[,] hh:mm" (horário da Bahia, UTC−3) → Date */
function dataBahia(t: string): Date {
  const m = t.match(/(\d{2})\/(\d{2})\/(\d{4}),? (\d{2}):(\d{2})/);
  expect(m, `data/hora em "${t}"`).toBeTruthy();
  const [, d, mo, a, h, mi] = m!;
  return new Date(`${a}-${mo}-${d}T${h}:${mi}:00-03:00`);
}

test("T10 – backup real ≤ 24 h, restauração testada e exportação completa em ZIP", async ({ page }) => {
  apenasNoProjeto(PROJETO_DESKTOP);
  test.setTimeout(900_000);
  await login(page, "admin");

  // ── Backup REAL (nada é fabricado pelo seed) ──
  // Executa um backup de verdade pelo botão (pg_dump -Fc | openssl AES-256 → bucket; lib/backup/executar.ts)
  // e espera o registro aparecer; depois executa o teste de restauração real (banco descartável).
  await page.goto("/admin/backup");
  const t0 = Date.now() - 120_000; // folga para diferença de relógio entre o runner e o servidor
  const novoRegistro = async (testid: string) => {
    const el = page.getByTestId(testid);
    if (!(await el.count())) return 0;
    return new Date((await el.getAttribute("data-executado-em")) ?? 0).getTime();
  };

  await page.getByTestId("executar-backup-agora").click();
  await expect(page.getByText(/Backup iniciado|Concluído/)).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => {
      await page.reload();
      return novoRegistro("ultimo-backup");
    }, { timeout: 240_000, intervals: [2_000, 3_000, 5_000] })
    .toBeGreaterThan(t0);
  await expect(page.getByTestId("ultima-falha-backup")).toHaveCount(0);

  const backup = page.getByTestId("ultimo-backup");
  await expect(backup).toBeVisible();
  await expect(backup).toHaveAttribute("data-atrasado", "0");
  await expect(backup).toContainText("dentro das 24 h");
  const quando = dataBahia(await page.getByTestId("ultimo-backup-data").innerText());
  const horas = (Date.now() - quando.getTime()) / 3_600_000;
  expect(horas).toBeGreaterThanOrEqual(-0.1);
  expect(horas).toBeLessThanOrEqual(24);
  await expect(page.getByTestId("ultimo-backup-tamanho")).toHaveText(/\d/);
  await expect(page.getByTestId("ultimo-backup-sha256")).toHaveText(/^[0-9a-f]{64}$/);
  await expect(page.getByTestId("ultimo-backup-destino")).toContainText("licenciagov-");

  await page.getByTestId("executar-restore-agora").click();
  await expect(page.getByText(/Teste de restauração iniciado|Concluído/)).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => {
      await page.reload();
      return novoRegistro("ultimo-restore");
    }, { timeout: 300_000, intervals: [2_000, 3_000, 5_000] })
    .toBeGreaterThan(t0);
  const restore = page.getByTestId("ultimo-restore");
  await expect(restore).toBeVisible();
  await expect(restore).toHaveAttribute("data-sucesso", "1");
  await expect(restore).toContainText("Sucesso");
  await expect(restore).toContainText("sha256 conferido");
  const quandoRestore = dataBahia(await restore.locator("p").first().innerText());
  expect(quandoRestore.getTime()).toBeLessThanOrEqual(Date.now() + 60_000);

  // ── Exportação completa ──
  await page.getByRole("link", { name: "Exportação completa" }).click();
  await expect(page).toHaveURL(/\/admin\/exportar/);
  const antes = await page.getByTestId("linha-exportacao").count();
  await page.getByTestId("solicitar-exportacao").click();
  await expect(page).toHaveURL(/\/admin\/exportar\?ok=1/);
  await expect(page.getByText("Exportação solicitada.")).toBeVisible();
  await expect(page.getByTestId("linha-exportacao")).toHaveCount(antes + 1);
  // A página se atualiza sozinha enquanto processa; a mais recente é a 1ª linha
  const nova = page.getByTestId("linha-exportacao").first();
  await expect(nova).toHaveAttribute("data-status", "CONCLUIDA", { timeout: 240_000 });

  const [dl] = await Promise.all([page.waitForEvent("download"), nova.getByTestId("baixar-exportacao").click()]);
  expect(dl.suggestedFilename()).toMatch(/\.zip$/);
  const buf = readFileSync((await dl.path())!);
  expect(buf.subarray(0, 2).toString()).toBe("PK");
  const zip = await JSZip.loadAsync(buf);
  const nomes = Object.keys(zip.files).filter((n) => !zip.files[n].dir);

  // manifest.json
  expect(nomes).toContain("manifest.json");
  const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
  expect(manifest.sistema).toBe("LicenciaGov");
  expect(manifest.contagens.tabelas).toBeGreaterThan(10);

  // CSV + JSON por tabela (todas as tabelas do manifest; inclui as principais)
  const tabelas = Object.keys(manifest.tabelas);
  for (const t of ["processo", "pessoa", "empreendimento", "documento_oficial", "tramitacao", "log_auditoria"]) expect(tabelas, t).toContain(t);
  for (const t of tabelas) {
    expect(nomes, `${t}.csv`).toContain(`tabelas/${t}.csv`);
    expect(nomes, `${t}.json`).toContain(`tabelas/${t}.json`);
  }
  const processos = JSON.parse(await zip.file("tabelas/processo.json")!.async("string"));
  expect(Array.isArray(processos)).toBe(true);
  expect(processos.length).toBe(manifest.tabelas.processo.linhas);
  expect(processos.length).toBeGreaterThanOrEqual(44);
  const csv = await zip.file("tabelas/processo.csv")!.async("string");
  expect(csv.replace(/^﻿/, "").split("\r\n")[0]).toContain("numero");

  // anexos/ (arquivos enviados + PDFs oficiais)
  const anexos = nomes.filter((n) => n.startsWith("anexos/"));
  expect(anexos.length).toBeGreaterThan(0);
  expect(anexos.some((n) => n.endsWith(".pdf"))).toBe(true);
  expect(manifest.contagens.anexos).toBeGreaterThan(0);

  // Hashes do manifest conferem (amostra)
  const amostra = manifest.arquivos.filter((a: { caminho: string }) => a.caminho === "tabelas/processo.json" || a.caminho.startsWith("anexos/")).slice(0, 5);
  expect(amostra.length).toBeGreaterThan(1);
  for (const a of amostra as { caminho: string; sha256: string }[]) {
    const conteudo = await zip.file(a.caminho)!.async("nodebuffer");
    expect(createHash("sha256").update(conteudo).digest("hex"), a.caminho).toBe(a.sha256);
  }
});
