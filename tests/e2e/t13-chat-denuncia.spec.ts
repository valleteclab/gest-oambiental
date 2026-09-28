import { test, expect, type APIRequestContext } from "@playwright/test";
import { apenasNoProjeto, DADOS, FOTOS_VISTORIA, login, PROJETO_DESKTOP, tokenApi } from "./helpers";

// T13 – Agente de denúncias (docs/agente-denuncias.md).
// 1) Chat do site, no modo questionário determinístico (servidor SEM OPENROUTER_API_KEY): LGPD → tipo → descrição →
//    localização (GPS) → foto → anônimo → contato → resumo → confirmação → protocolo; aparece em Denúncias e Atendimento;
//    acompanhamento público só com o mesmo contato.
// 2) Webhook Evolution API (segredo no header): 401 sem segredo, dedup do mesmo id, resposta gravada (envio simulado com
//    CANAIS_ENVIO_SIMULADO=true, ou ERRO se o servidor tentar a instância inexistente), privacidade do protocolo e
//    atendente humano (fromMe) pausando a IA.

const P = DADOS.principal;
const RE_PROT = new RegExp(`DEN-${P.sigla}-\\d{3,}/\\d{4}`);

test("T13 – chat do site: registra denúncia pelo assistente e ela aparece em Denúncias e Atendimento", async ({ page, context }) => {
  apenasNoProjeto(PROJETO_DESKTOP);
  test.setTimeout(120_000);
  const marca = `E2E-CHAT-${Date.now()}`;
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: DADOS.cenarios.t4Gps.latitude, longitude: DADOS.cenarios.t4Gps.longitude, accuracy: 10 });

  await page.goto(`/denuncia?municipio=${P.sigla}`);
  const chat = page.getByTestId("chat-denuncia");
  await expect(chat).toBeVisible();
  await expect(page.getByTestId("modo-formulario")).toBeVisible(); // formulário continua disponível
  const bot = chat.getByTestId("chat-msg-bot");

  await chat.getByTestId("chat-comecar").click();
  await expect(bot.last()).toContainText("Você concorda em continuar?");
  await chat.getByTestId("chat-botao-lgpd_sim").click();
  await expect(bot.last()).toContainText("tipo de problema");

  const enviar = async (t: string) => {
    await chat.getByTestId("chat-input").fill(t);
    await chat.getByTestId("chat-enviar").click();
  };
  await enviar("4"); // descarte irregular de resíduos
  await expect(bot.last()).toContainText("o que está acontecendo");
  await enviar(`${marca} descarte de entulho e embalagens toda noite na margem do riacho`);
  await expect(bot.last()).toContainText("Onde");

  await chat.getByTestId("chat-localizacao").click();
  await expect(chat.getByText("📍 Localização recebida!")).toBeVisible();
  await expect(bot.last()).toContainText("fotos");

  await chat.getByTestId("chat-arquivo").setInputFiles(FOTOS_VISTORIA[0]);
  await expect(bot.last()).toContainText("Foto 1 recebida");
  await chat.getByTestId("chat-botao-fotos_pronto").click();
  await expect(bot.last()).toContainText("se identificar");
  await chat.getByTestId("chat-botao-anonima").click();
  await expect(bot.last()).toContainText("telefone ou e-mail");
  const email = `cidadao.${Date.now()}@exemplo.com`;
  await enviar(email);
  await expect(bot.last()).toContainText("Resumo da denúncia");
  await expect(bot.last()).toContainText("Descarte irregular de resíduos");
  await expect(bot.last()).toContainText("Fotos:* 1".replace("*", ""));
  await chat.getByTestId("chat-botao-confirmar").click();
  await expect(bot.last()).toContainText("Denúncia registrada");
  const protocolo = RE_PROT.exec(await bot.last().innerText())?.[0];
  expect(protocolo, "protocolo na resposta").toBeTruthy();

  // Acompanhamento público: só com o mesmo contato
  await page.goto(`/denuncia/acompanhar?protocolo=${encodeURIComponent(protocolo!)}&contato=${encodeURIComponent("outra.pessoa@exemplo.com")}`);
  await expect(page.getByTestId("resultado-denuncia")).toHaveCount(0);
  await expect(page.getByText("Não encontramos denúncia")).toBeVisible();
  await page.goto(`/denuncia/acompanhar?protocolo=${encodeURIComponent(protocolo!)}&contato=${encodeURIComponent(email.toUpperCase())}`);
  await expect(page.getByTestId("resultado-denuncia")).toContainText(protocolo!);
  await expect(page.getByTestId("resultado-denuncia")).toContainText(marca);

  // Fila de denúncias da fiscalização (mesmo registro, canal Chat do site, com a foto)
  await login(page, "fiscalPrincipal");
  await page.goto(`/fiscalizacao/denuncias?q=${encodeURIComponent(marca)}`);
  const item = page.getByTestId("lista-denuncias").locator("li").first();
  await expect(item).toContainText(protocolo!);
  await expect(item).toContainText("Chat do site");
  await item.getByRole("link").click();
  await expect(page.getByTestId("fotos-denuncia").locator("img")).toHaveCount(1);
  await page.getByTestId("link-conversa").click();

  // Atendimento: conversa com as mensagens, resposta do atendente pausa a IA
  await expect(page).toHaveURL(/\/atendimento\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("mensagens-conversa")).toContainText(marca);
  await expect(page.getByTestId("link-denuncia")).toHaveText(protocolo!);
  await page.getByTestId("resposta-atendente").fill("Olá! Sou da fiscalização, obrigado pela denúncia.");
  await page.getByTestId("enviar-resposta").click();
  await expect(page.getByTestId("mensagens-conversa")).toContainText("Sou da fiscalização");
  await expect(page.getByText("Com atendente").first()).toBeVisible();
  await page.goto("/atendimento");
  await expect(page.getByTestId("lista-conversas")).toContainText(protocolo!);
});

test("T13 – chat do site cabe na tela (sem rolagem horizontal)", async ({ page }) => {
  await page.goto(`/denuncia?municipio=${P.sigla}`);
  await expect(page.getByTestId("chat-denuncia")).toBeVisible();
  const larguras = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vp: window.innerWidth }));
  expect(larguras.doc).toBeLessThanOrEqual(larguras.vp + 1);
  await page.getByTestId("modo-formulario").click();
  await expect(page.getByLabel("O que está acontecendo? *")).toBeVisible();
});

async function conversaPorNome(request: APIRequestContext, token: string, nome: string) {
  let id: string | null = null;
  await expect.poll(async () => {
    const r = await request.get("/api/v1/atendimento/conversas?canal=WHATSAPP_EVOLUTION&size=50", { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    id = (j.itens as { id: string; nome: string | null }[]).find((c) => c.nome === nome)?.id ?? null;
    return id;
  }, { timeout: 20_000 }).toBeTruthy();
  return id!;
}

async function detalhe(request: APIRequestContext, token: string, id: string) {
  const r = await request.get(`/api/v1/atendimento/conversas/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(r.ok()).toBeTruthy();
  return r.json() as Promise<{ estado: string; mensagens: { direcao: string; autor: string; texto: string | null; status_envio: string | null }[] }>;
}

test("T13 – webhook Evolution: segredo, dedup, resposta via provedor simulado, privacidade e atendente humano", async ({ request }) => {
  apenasNoProjeto(PROJETO_DESKTOP);
  test.setTimeout(90_000);
  const token = await tokenApi(request, "admin");
  const auth = { Authorization: `Bearer ${token}` };
  const c = await request.post("/api/v1/admin/canais", {
    headers: auth,
    data: { tipo: "WHATSAPP_EVOLUTION", nome: `E2E Evolution ${Date.now()}`, municipio_sigla: P.sigla, publicos: { instance_name: `e2e-${Date.now()}`, base_url: "http://127.0.0.1:9" }, segredos: { api_key: "e2e" } },
  });
  expect(c.status(), await c.text()).toBe(201);
  const canal = await c.json();
  expect(canal.webhook_url_sem_token).toContain(`/api/webhooks/${canal.id}`);

  const fone = `55759${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  const nome = `E2E Evo ${Date.now()}`;
  const msg = (id: string, message: object, fromMe = false) => ({ event: "messages.upsert", instance: "e2e", data: { key: { remoteJid: `${fone}@s.whatsapp.net`, fromMe, id }, pushName: nome, messageTimestamp: Math.floor(Date.now() / 1000), message } });
  const url = `/api/webhooks/${canal.id}`;
  const comSegredo = { "x-webhook-secret": canal.webhook_secret };

  // sem segredo → 401
  expect((await request.post(url, { data: msg("E2E-0", { conversation: "oi" }) })).status()).toBe(401);
  // mesma mensagem duas vezes → uma só na conversa
  const primeira = msg(`E2E-${Date.now()}`, { conversation: "Bom dia, tem uma queimada no terreno atrás da escola municipal" });
  expect((await request.post(url, { headers: comSegredo, data: primeira })).ok()).toBeTruthy();
  expect((await request.post(url, { headers: comSegredo, data: primeira })).ok()).toBeTruthy();
  const conversaId = await conversaPorNome(request, token, nome);
  await expect.poll(async () => (await detalhe(request, token, conversaId)).mensagens.filter((m) => m.direcao === "OUT").length, { timeout: 20_000 }).toBeGreaterThan(0);
  let d = await detalhe(request, token, conversaId);
  expect(d.mensagens.filter((m) => m.direcao === "IN")).toHaveLength(1);
  expect(d.estado).toBe("AGUARDANDO_LGPD");
  const resposta = d.mensagens.find((m) => m.direcao === "OUT")!;
  expect(resposta.autor).toBe("IA");
  expect(resposta.texto).toContain("LGPD");
  expect(["SIMULADA", "ERRO"]).toContain(resposta.status_envio);

  // botão "Sim" (texto "1") → coleta; a queimada do relato inicial já foi entendida → pergunta o local
  await request.post(url, { headers: comSegredo, data: msg(`E2E-${Date.now()}-b`, { conversation: "1" }) });
  await expect.poll(async () => (await detalhe(request, token, conversaId)).estado, { timeout: 20_000 }).toBe("COLETANDO");
  await expect.poll(async () => (await detalhe(request, token, conversaId)).mensagens.at(-1)?.texto ?? "", { timeout: 20_000 }).toContain("Onde");

  // protocolo de OUTRA pessoa → não revela
  await request.post(url, { headers: comSegredo, data: msg(`E2E-${Date.now()}-c`, { conversation: `qual a situação da DEN-${P.sigla}-001/${new Date().getFullYear()}?` }) });
  await expect.poll(async () => (await detalhe(request, token, conversaId)).mensagens.some((m) => m.direcao === "OUT" && (m.texto ?? "").includes("vinculada a este contato")), { timeout: 20_000 }).toBe(true);
  // e retoma a pergunta pendente (a mensagem seguinte pode sair alguns segundos depois: ritmo de envio do provedor)
  await expect.poll(async () => (await detalhe(request, token, conversaId)).mensagens.at(-1)?.texto ?? "", { timeout: 30_000 }).toContain("Onde");

  // atendente responde pelo celular do órgão (fromMe, não enviado pela API) → HUMANO, IA pausada
  await request.post(url, { headers: comSegredo, data: msg(`E2E-${Date.now()}-d`, { conversation: "Aqui é o fiscal, vou verificar." }, true) });
  await expect.poll(async () => (await detalhe(request, token, conversaId)).estado, { timeout: 20_000 }).toBe("HUMANO");
  const antes = (await detalhe(request, token, conversaId)).mensagens.length;
  await request.post(url, { headers: comSegredo, data: msg(`E2E-${Date.now()}-e`, { conversation: "Obrigado!" }) });
  await expect.poll(async () => (await detalhe(request, token, conversaId)).mensagens.length, { timeout: 20_000 }).toBe(antes + 1);
  d = await detalhe(request, token, conversaId);
  expect(d.mensagens.at(-1)?.direcao).toBe("IN"); // a IA não respondeu
  expect(d.mensagens.some((m) => m.autor === "ATENDENTE")).toBeTruthy();

  // desativa o canal de teste (não deixa lixo ativo)
  await request.patch(`/api/v1/admin/canais/${canal.id}`, { headers: auth, data: { ativo: false } });
});
