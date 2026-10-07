import { test, expect } from "@playwright/test";
import { USUARIOS_GED, aceitarDialogos, aguardarHidratacao, auth, bancoCmd, carregarIdsGed, criarDocumentoApi, irPara, itensDe, loginGed, marcasDe, MOTIVO_SEM_IDS, semVazamento, sufixoUnico, submeter, temBanco, tokenCache } from "./ged-helpers";

// T20 – GED: notificações (e-mail com data/hora do envio e sem anexo; WhatsApp em modo simulado com opt-in) e logs de acesso, alterações e
// comunicações (abas, filtros, CSV; Leitor/Usuário não veem). Itens 5, 6 e 11 do edital. Desktop apenas (altera dados).
// O envio da caixa de saída é feito pelo worker `ged-notificar`; no E2E não há worker, então tests/e2e/t20-banco.ts executa o mesmo
// processamento (lib/ged/notificar/enviar.ts) direto no banco – por isso os testes de envio exigem DATABASE_URL no ambiente do teste.

test.beforeEach(() => {
  test.skip(test.info().project.name !== "desktop-chromium", "Altera dados – executado apenas no projeto desktop.");
});
const IDS = carregarIdsGed();
test.skip(!IDS, MOTIVO_SEM_IDS);
const ids = IDS!;
const A = USUARIOS_GED.A;
test.describe.configure({ timeout: 180_000 });

type Com = { id: string; evento: string; canal: string; status: string; usuario_id: string; enviado_em: string | null; destinatario_mascarado: string; email: { para: string; assunto: string; corpo: string } | null };

const hhmmBrasilia = (d: Date) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
const dataBrasilia = (d: Date) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);

test("T20a – trâmite dispara e-mail: assunto, link, 'Enviado em dd/mm/aaaa às HH:mm (horário de Brasília)' e nenhum anexo; registro em Comunicações", async ({ request }) => {
  test.skip(!temBanco(), "Sem DATABASE_URL: o processamento da caixa de saída roda direto no banco (substitui o worker).");
  const suf = sufixoUnico();
  const tk1 = await tokenCache(request, A.servidor1);
  const doc = await criarDocumentoApi(request, tk1, { titulo: `Ofício para notificar ${suf}` });
  const r = await request.post(`/api/v1/ged/tramite/${doc.id}`, { headers: auth(tk1), data: { acao: "ENVIAR", destino: { tipo: "USUARIO", id: ids.A.usuarios[A.servidor2] }, despacho: `Para conhecimento ${suf}` } });
  expect(r.ok(), await r.text()).toBeTruthy();

  const antes = new Date();
  bancoCmd("processar");
  const depois = new Date();
  const linhas = bancoCmd<Com[]>("comunicacoes", doc.id);
  const mail = linhas.find((l) => l.canal === "EMAIL" && l.evento === "TRAMITE_RECEBIDO");
  expect(mail, "linha de e-mail do trâmite").toBeTruthy();
  expect(["ENVIADA", "SIMULADA"]).toContain(mail!.status); // SIMULADA com CANAIS_ENVIO_SIMULADO=true (nada é enviado de verdade)
  expect(mail!.usuario_id).toBe(ids.A.usuarios[A.servidor2]);
  expect(mail!.email!.para).toBe(A.servidor2);
  expect(mail!.email!.assunto).toMatch(/recebido em trâmite/); // o assunto traz o número (o título só vai no corpo, e nunca se SIGILOSO)
  const corpo = mail!.email!.corpo;
  expect(corpo).toContain(`Ofício para notificar ${suf}`);
  const m = corpo.match(/Enviado em (\d{2}\/\d{2}\/\d{4}) às (\d{2}:\d{2}) \(horário de Brasília\)/);
  expect(m, "linha 'Enviado em dd/mm/aaaa às HH:mm (horário de Brasília)'").toBeTruthy();
  expect(m![1]).toBe(dataBrasilia(antes) === dataBrasilia(depois) ? dataBrasilia(antes) : m![1]);
  expect([hhmmBrasilia(antes), hhmmBrasilia(depois)]).toContain(m![2]); // hora do ENVIO (não a do trâmite)
  expect(corpo).toContain(`/ged/documentos/${doc.id}`); // link para o documento
  expect(corpo).not.toMatch(/<a [^>]*href="[^"]*\.pdf/i); // sem link direto/anexo de arquivo
  expect(corpo).toContain("Sem anexos");
  expect(mail!.destinatario_mascarado).not.toContain(A.servidor2); // e-mail mascarado no log
  expect(mail!.enviado_em).toBeTruthy();
});

test("T20b – WhatsApp: canal em modo simulado, opt-in por código, preferência e envio registrado como SIMULADA", async ({ page, request }) => {
  test.skip(!temBanco(), "Sem DATABASE_URL: precisa processar a caixa de saída e ler o código de confirmação.");
  test.skip(process.env.CANAIS_ENVIO_SIMULADO !== "true", "Só em modo simulado (CANAIS_ENVIO_SIMULADO=true): não envia WhatsApp real.");
  aceitarDialogos(page);
  const suf = sufixoUnico();

  // 1) administrador garante o canal (Evolution, simulado) vinculado
  await loginGed(page, A.admin);
  await irPara(page, "/ged/admin/canal");
  await expect(page.getByText("modo de envio").first()).toBeVisible();
  if ((await page.getByTestId("canal-vinculado").count()) === 0) {
    await page.locator("#WHATSAPP_EVOLUTION-nome").fill("WhatsApp do GED (ensaio)");
    await page.locator("#WHATSAPP_EVOLUTION-p-instance_name").fill("ged-vac-ensaio");
    await aguardarHidratacao(page);
    await page.getByRole("form", { name: "Canal WhatsApp (Evolution API)" }).getByRole("button", { name: "Criar e vincular canal" }).click();
    await expect(page.getByTestId("canal-vinculado")).toBeVisible({ timeout: 30_000 });
  }

  // 2) servidor2: cadastra telefone, recebe o código (derivado no servidor), confirma e liga a preferência de WhatsApp
  await page.goto("/sair");
  await loginGed(page, A.servidor2);
  await irPara(page, "/ged/minha-conta/notificacoes");
  if ((await page.getByText("Confirmado", { exact: true }).count()) === 0) {
    await page.locator("#wa-tel").fill("(75) 99999-8888");
    await submeter(page, page.getByRole("button", { name: "Enviar código por WhatsApp" }), "Aguardando código");
    await page.reload();
    await expect(page.getByText(/\*\*\*|\(\d{2}\)/).first()).toBeVisible();
    const { codigo } = bancoCmd<{ codigo: string | null }>("codigo-optin", ids.A.usuarios[A.servidor2]);
    expect(codigo).toMatch(/^\d{6}$/);
    await page.locator("#wa-codigo").fill(codigo!);
    await aguardarHidratacao(page);
    await page.getByRole("button", { name: "Confirmar telefone" }).click();
    await expect(page.getByText("Confirmado", { exact: true })).toBeVisible({ timeout: 20_000 });
  }
  const cx = page.getByRole("checkbox", { name: /Documento recebido em trâmite – WhatsApp/ });
  await cx.check();
  await submeter(page, page.getByRole("button", { name: "Salvar preferências" }), /referências|salv/i);

  // 3) trâmite para servidor2 → e-mail + WhatsApp (SIMULADA)
  const tk1 = await tokenCache(request, A.servidor1);
  const doc = await criarDocumentoApi(request, tk1, { titulo: `Ofício WhatsApp ${suf}` });
  const r = await request.post(`/api/v1/ged/tramite/${doc.id}`, { headers: auth(tk1), data: { acao: "ENVIAR", destino: { tipo: "USUARIO", id: ids.A.usuarios[A.servidor2] }, despacho: "Ensaio WhatsApp" } });
  expect(r.ok(), await r.text()).toBeTruthy();
  bancoCmd("processar");
  const linhas = bancoCmd<Com[]>("comunicacoes", doc.id);
  const wa = linhas.find((l) => l.canal === "WHATSAPP");
  expect(wa, "linha de WhatsApp").toBeTruthy();
  expect(wa!.status).toBe("SIMULADA");
  expect(wa!.enviado_em).toBeTruthy();
  expect(linhas.some((l) => l.canal === "EMAIL" && ["ENVIADA", "SIMULADA"].includes(l.status))).toBe(true);

  // 4) a mesma linha aparece em /ged/logs → Comunicações (auditor)
  await page.goto("/sair");
  await loginGed(page, A.auditor);
  await irPara(page, "/ged/logs?aba=comunicacoes&canal=WHATSAPP");
  await expect(page.getByTestId("tabela-comunicacoes").locator("tbody tr").filter({ hasText: "Simulada" }).first()).toBeVisible();

  // 5) desativar o WhatsApp (revogação do opt-in) deixa o cadastro limpo para a próxima execução
  await page.goto("/sair");
  await loginGed(page, A.servidor2);
  await irPara(page, "/ged/minha-conta/notificacoes");
  await page.getByRole("button", { name: "Desativar WhatsApp e remover telefone" }).click();
  await expect(page.getByText("Confirmado", { exact: true })).toHaveCount(0, { timeout: 20_000 });
});

test("T20c – /ged/logs: abas Acessos, Alterações e Comunicações, filtros e CSV; Leitor e Usuário não veem; sem dados do outro cliente", async ({ page, request }) => {
  await loginGed(page, A.auditor);
  await irPara(page, "/ged/logs");
  await expect(page.getByRole("heading", { name: "Logs" })).toBeVisible();
  const abas = page.getByRole("navigation", { name: "Tipos de log" });
  await expect(abas.getByRole("link")).toHaveText(["Acessos", "Alterações", "Comunicações"]);

  await abas.getByRole("link", { name: "Acessos" }).click();
  await expect(page.getByTestId("tabela-acessos").locator("tbody tr").first()).toBeVisible();
  // filtro por ação
  await page.goto("/ged/logs?aba=acessos&acao=NEGADO");
  const linhasNeg = page.getByTestId("tabela-acessos").locator("tbody tr");
  expect(await linhasNeg.count()).toBeGreaterThan(0);
  for (const t of await linhasNeg.allTextContents()) expect(t).toContain("Acesso negado");

  await page.goto("/ged/logs?aba=alteracoes");
  await expect(page.getByTestId("tabela-alteracoes").locator("tbody tr").first()).toBeVisible();
  await page.goto("/ged/logs?aba=comunicacoes");
  await expect(page.getByTestId("tabela-comunicacoes").locator("tbody tr").first()).toBeVisible();
  await expect(page.getByTestId("tabela-comunicacoes")).toContainText(/E-mail|WhatsApp/);

  // CSV (filtro atual) com a sessão da página
  const href = await page.getByTestId("exportar-csv").getAttribute("href");
  const csv = await page.request.get(href!);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const texto = await csv.text();
  expect(texto.split("\n").length).toBeGreaterThan(1);
  semVazamento(texto, marcasDe(ids.B), "CSV de logs de VAC");

  // quem não é Admin/Auditor: sem acesso (página 403; API 403)
  for (const quem of [A.vereador, A.servidor1, A.gestor]) {
    const tk = await tokenCache(request, quem);
    const r = await request.get("/api/v1/ged/logs?aba=acessos", { headers: auth(tk) });
    expect(r.status(), `logs para ${quem}`).toBe(403);
  }
  await page.goto("/sair");
  await loginGed(page, A.vereador);
  const resp = await page.goto("/ged/logs");
  expect(resp?.status()).toBe(403);
  await expect(page.getByText("Documento a assinar")).toHaveCount(0);

  // o administrador do OUTRO cliente só vê o próprio cliente
  const tkB = await tokenCache(request, USUARIOS_GED.B.admin);
  for (const aba of ["acessos", "alteracoes", "comunicacoes"]) {
    const r = await request.get(`/api/v1/ged/logs?aba=${aba}`, { headers: auth(tkB) });
    expect(r.status()).toBe(200);
    semVazamento(await r.text(), marcasDe(ids.A), `logs de AAC (${aba})`);
    expect(Array.isArray(itensDe(await r.json()))).toBe(true);
  }
});
