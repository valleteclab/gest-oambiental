import { execFileSync } from "node:child_process";
import path from "node:path";
import { test, expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { DADOS, PROJETO_DESKTOP, apenasNoProjeto, login } from "./helpers";
import { USUARIOS_GED, SENHA_GED, loginGed, sufixoUnico } from "./ged-helpers";

// T28 – Painel do operador da plataforma (/plataforma, docs/plataforma.md).
// Pré-requisitos: seed demo + `onboard riachao-das-neves --demo` + `seed:ged-demo` (clientes VAC/AAC), como nos t12/t16.
// O operador é criado pelo apoio de banco (mesma porta da CLI `npm run plataforma:operador`). Altera dados: só o projeto desktop.
test.describe.configure({ timeout: 240_000, mode: "serial" });

const SCRIPT_BANCO = path.resolve(__dirname, "t28-banco.ts");
function banco<T = unknown>(...args: string[]): T {
  const out = execFileSync("npx", ["tsx", SCRIPT_BANCO, ...args], { encoding: "utf8", env: process.env, cwd: path.resolve(__dirname, "../.."), timeout: 120_000 });
  const linha = out.trim().split("\n").filter((l) => l.startsWith("__JSON__")).pop();
  if (!linha) throw new Error(`t28-banco sem saída JSON: ${out.slice(-400)}`);
  return JSON.parse(linha.slice(8)) as T;
}

const suf = sufixoUnico();
const OPERADOR = { email: `operador.${suf}@plataforma.demo`, senha: `Operador@2026${suf}!` };
const num = Date.now().toString().slice(-5);
const CLIENTE = {
  nome: `Cliente E2E ${suf}`,
  sigla: `E2E${suf.slice(0, 4)}`.toUpperCase(),
  slug: `cliente-e2e-${suf}`,
  municipio: `Teste do Norte ${suf}`,
  ibge: `99${num}`,
  admin: `admin.${suf}@clientee2e.demo`,
  adminNome: "Administradora E2E",
};
const SENHA_P1 = `Primeira@2026${suf}`;
const SENHA_P2 = `Segunda@2026${suf}`;

let senhaTemporaria = "";
let linkConvite = "";
let clienteUrl = "";
let siglaMunicipio = "";

async function loginSemOrgao(page: Page, email: string, senha: string) {
  await page.goto("/login");
  await page.getByLabel("Órgão").selectOption("");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(senha);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
}

async function loginOperador(page: Page) {
  await loginSemOrgao(page, OPERADOR.email, OPERADOR.senha);
  await expect(page).toHaveURL(/\/plataforma/);
  await page.getByLabel("Senha").fill(OPERADOR.senha);
  await page.getByRole("button", { name: /confirmar senha/i }).click();
  await expect(page.getByRole("heading", { name: "Clientes" })).toBeVisible();
}

async function contexto(browser: Browser) {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, locale: "pt-BR" });
  return { ctx, page: await ctx.newPage() };
}

async function status(page: Page, url: string) {
  const r = await page.goto(url);
  return r?.status() ?? 0;
}

async function tokenApi(request: APIRequestContext, email: string, senha: string) {
  const r = await request.post("/api/v1/auth/login", { data: { email, senha } });
  return { status: r.status(), token: r.ok() ? ((await r.json()).access_token as string) : null };
}

test.beforeAll(() => {
  banco("operador", OPERADOR.email, OPERADOR.senha);
});

test.describe("T28 – painel /plataforma", () => {
  test("T28a – quem não é operador recebe 404: sem login, admin de licenciamento, admins GED e requerente (páginas e ações)", async ({ browser, page }) => {
    apenasNoProjeto(PROJETO_DESKTOP);
    // sem login
    expect(await status(page, "/plataforma")).toBe(404);
    expect(await status(page, "/plataforma/novo")).toBe(404);

    // operador abre o formulário (HTML com os campos da Server Action) para que os demais tentem reproduzi-la
    const op = await contexto(browser);
    await loginOperador(op.page);
    await op.page.goto("/plataforma/novo");
    const html = await op.page.content();
    const ocultos = [...html.matchAll(/<input type="hidden" name="(\$ACTION[^"]*)"(?: value="([^"]*)")?/g)].map((m) => [m[1], (m[2] ?? "").replace(/&quot;/g, '"')] as const);
    expect(ocultos.length, "campos $ACTION do formulário").toBeGreaterThan(2);
    await op.ctx.close();

    const intrusos: { nome: string; entrar: (p: Page) => Promise<void> }[] = [
      { nome: "admin do licenciamento", entrar: (p) => login(p, "admin") },
      { nome: "admin GED VAC", entrar: (p) => loginGed(p, USUARIOS_GED.A.admin, SENHA_GED) },
      { nome: "admin GED AAC", entrar: (p) => loginGed(p, USUARIOS_GED.B.admin, SENHA_GED) },
      { nome: "requerente", entrar: (p) => login(p, "laticinio") },
    ];
    for (const i of intrusos) {
      const c = await contexto(browser);
      await i.entrar(c.page);
      for (const url of ["/plataforma", "/plataforma/novo", "/plataforma/clientes/00000000-0000-4000-8000-000000000000"]) {
        expect(await status(c.page, url), `${i.nome}: GET ${url}`).toBe(404);
      }
      // a Server Action (criar cliente) reproduzida por quem não é operador: 404 e NADA é criado
      const campos: Record<string, string> = Object.fromEntries(ocultos);
      Object.assign(campos, { nome: `Invasor ${suf}`, sigla: `INV${suf.slice(0, 3)}`.toUpperCase(), modulos: "GED", admin_nome: "Invasor", admin_email: `invasor.${suf}@x.demo`, entrega: "SENHA" });
      const r = await c.ctx.request.post("/plataforma/novo", { multipart: campos });
      expect(r.status(), `${i.nome}: POST da ação`).toBe(404);
      await c.ctx.close();
    }
    // admin do cliente não vira operador: a porta oficial recusa, e o banco recusa vincular operador a organização
    const admin = DADOS.usuarios.admin;
    const promo = banco<{ ok: boolean; erro?: string }>("tentar-promover", admin);
    expect(promo.ok).toBe(false);
    expect(promo.erro).toMatch(/organização|papéis/);
    const vinc = banco<{ ok: boolean; erro?: string }>("tentar-vincular-operador", OPERADOR.email, "VAC");
    expect(vinc.ok).toBe(false);
    expect(vinc.erro).toMatch(/operador da plataforma/);
  });

  test("T28b – operador: exige reautenticação, vê só metadados e cria cliente com os dois módulos (slug reservado/duplicado recusados)", async ({ page }) => {
    apenasNoProjeto(PROJETO_DESKTOP);
    await loginSemOrgao(page, OPERADOR.email, OPERADOR.senha);
    await expect(page).toHaveURL(/\/plataforma/);
    // antes da senha: só o formulário de confirmação
    await expect(page.getByRole("heading", { name: "Confirme sua senha" })).toBeVisible();
    await expect(page.getByTestId("tabela-clientes")).toHaveCount(0);
    await page.getByLabel("Senha").fill("senha-errada-123");
    await page.getByRole("button", { name: /confirmar senha/i }).click();
    await expect(page.getByText("Senha incorreta.")).toBeVisible();
    await page.getByLabel("Senha").fill(OPERADOR.senha);
    await page.getByRole("button", { name: /confirmar senha/i }).click();
    await expect(page.getByRole("heading", { name: "Clientes" })).toBeVisible();

    // lista: clientes existentes com módulos/situação, mas nenhum dado de negócio
    const tabela = page.getByTestId("tabela-clientes");
    await expect(tabela).toContainText("VAC");
    await expect(tabela).toContainText("AAC");
    await expect(tabela).toContainText("Ativo");
    await expect(tabela).toContainText("Gestão de Documentos");
    const corpo = await page.locator("main").innerText();
    expect(corpo).not.toMatch(/\b[A-Z]{3}-\d{4}-\d{3,}/); // números de processo
    // o operador não tem painel de cliente
    await page.goto("/dashboard");
    await expect(page).not.toHaveURL(/\/dashboard/);

    // novo cliente: erros de validação primeiro
    await page.goto("/plataforma/novo");
    const preencher = async (sigla: string, slug: string) => {
      await page.locator("#nome").fill(CLIENTE.nome);
      await page.locator("#sigla").fill(sigla);
      await page.locator("#slug").fill(slug);
      await page.getByLabel("Licenciamento ambiental").check();
      await page.getByLabel("Gestão de Documentos").check();
      await page.locator("#mn-0").fill(CLIENTE.municipio);
      await page.locator("#mu-0").selectOption("BA");
      await page.locator("#mi-0").fill(CLIENTE.ibge);
      await page.locator("#admin_nome").fill(CLIENTE.adminNome);
      await page.locator("#admin_email").fill(CLIENTE.admin);
      await page.locator("#entrega").selectOption("AMBOS");
      await page.getByRole("button", { name: "Criar cliente" }).click();
    };
    await preencher(CLIENTE.sigla, "admin");
    await expect(page.getByText("Este endereço é reservado").first()).toBeVisible();
    await preencher("VAC", CLIENTE.slug); // sigla duplicada
    await expect(page.getByText("Já existe um cliente com esta sigla.").first()).toBeVisible();
    await preencher(CLIENTE.sigla, "protocolo"); // reservado (rota)
    await expect(page.getByText("Este endereço é reservado").first()).toBeVisible();

    // criação válida
    await preencher(CLIENTE.sigla, CLIENTE.slug);
    await expect(page.getByTestId("acesso-entregue")).toBeVisible({ timeout: 60_000 });
    senhaTemporaria = (await page.getByTestId("senha-temporaria").innerText()).trim();
    linkConvite = (await page.getByTestId("link-convite").innerText()).trim();
    expect(senhaTemporaria).toHaveLength(16);
    expect(linkConvite).toMatch(/\/definir-senha\/[A-Za-z0-9_-]{43}$/);
    await page.getByRole("link", { name: "Abrir o cliente" }).click();
    await expect(page.getByRole("heading", { name: CLIENTE.nome })).toBeVisible();
    clienteUrl = page.url();
    await expect(page.getByTestId("lista-municipios")).toContainText(CLIENTE.municipio);
    siglaMunicipio = ((await page.getByTestId("lista-municipios").innerText()).match(/\(([A-Z]{3})\)/) ?? [])[1];
    expect(siglaMunicipio).toBeTruthy();
    await expect(page.getByTestId("tabela-usuarios")).toContainText(CLIENTE.admin);
    await expect(page.getByTestId("contagens")).toContainText("Processos");

    // nome duplicado de sigla ou e-mail de admin existente é recusado (nunca "adota" cadastro alheio)
    await page.goto("/plataforma/novo");
    await page.locator("#nome").fill("Outro Cliente");
    await page.locator("#sigla").fill(`DUP${suf.slice(0, 3)}`.toUpperCase());
    await page.getByLabel("Licenciamento ambiental").uncheck();
    await page.getByLabel("Gestão de Documentos").check();
    await page.locator("#admin_nome").fill("Alguém Qualquer");
    await page.locator("#admin_email").fill(DADOS.usuarios.admin);
    await page.getByRole("button", { name: "Criar cliente" }).click();
    await expect(page.getByText(/Já existe usuário com este e-mail/).first()).toBeVisible();
  });

  test("T28c – convite por e-mail: link de uso único define a senha (sem troca obrigatória); reuso do link é recusado", async ({ browser }) => {
    apenasNoProjeto(PROJETO_DESKTOP);
    const emails = banco<{ assunto: string; corpo: string }[]>("emails-para", CLIENTE.admin);
    expect(emails.some((e) => /Defina sua senha/.test(e.assunto) && e.corpo.includes(linkConvite))).toBe(true);

    const c = await contexto(browser);
    await c.page.goto(linkConvite);
    await c.page.locator("#nova").fill(SENHA_P1);
    await c.page.locator("#confirmacao").fill(SENHA_P1);
    await c.page.getByRole("button", { name: "Salvar senha" }).click();
    await expect(c.page).toHaveURL(/\/login\?senha=definida/);
    await expect(c.page.getByText("Senha definida.")).toBeVisible();
    // reuso do mesmo link
    await c.page.goto(linkConvite);
    await expect(c.page.getByRole("heading", { name: "Link indisponível" })).toBeVisible();
    // token inválido
    await c.page.goto("/definir-senha/token-que-nao-existe");
    await expect(c.page.getByRole("heading", { name: "Link indisponível" })).toBeVisible();

    // o administrador entra com a senha escolhida e vai direto ao painel (sem /trocar-senha)
    await loginSemOrgao(c.page, CLIENTE.admin, SENHA_P1);
    await expect(c.page).toHaveURL(/\/dashboard/);
    expect(banco<{ trocar_senha: boolean }>("usuario", CLIENTE.admin).trocar_senha).toBe(false);
    await c.ctx.close();
  });

  test("T28d – senha temporária: redefinição pelo operador, troca obrigatória no 1º acesso; admin vê só os dados do próprio cliente (e vice-versa)", async ({ browser }) => {
    apenasNoProjeto(PROJETO_DESKTOP);
    const op = await contexto(browser);
    await loginOperador(op.page);
    await op.page.goto(clienteUrl);
    await op.page.getByRole("button", { name: "Redefinir" }).click();
    await expect(op.page.getByTestId("senha-temporaria")).toBeVisible();
    senhaTemporaria = (await op.page.getByTestId("senha-temporaria").innerText()).trim();
    expect(banco<{ trocar_senha: boolean }>("usuario", CLIENTE.admin).trocar_senha).toBe(true);
    // a senha antiga (P1) deixa de valer; a temporária obriga a trocar
    const velha = await contexto(browser);
    await velha.page.goto("/login");
    await velha.page.getByLabel("Órgão").selectOption("");
    await velha.page.getByLabel("E-mail").fill(CLIENTE.admin);
    await velha.page.getByLabel("Senha").fill(SENHA_P1);
    await velha.page.getByRole("button", { name: /entrar/i }).click();
    await expect(velha.page.getByText("E-mail ou senha inválidos.")).toBeVisible();
    await velha.ctx.close();

    const adm = await contexto(browser);
    await loginSemOrgao(adm.page, CLIENTE.admin, senhaTemporaria);
    await expect(adm.page).toHaveURL(/\/trocar-senha/);
    await adm.page.locator("#atual").fill(senhaTemporaria);
    await adm.page.locator("#nova").fill(SENHA_P2);
    await adm.page.locator("#confirmacao").fill(SENHA_P2);
    await adm.page.getByRole("button", { name: "Salvar" }).click();
    await expect(adm.page).toHaveURL(/\/dashboard/);

    // vê só o próprio cliente
    await expect(adm.page.getByTestId("dashboard-escopo")).toContainText(CLIENTE.municipio);
    await adm.page.goto("/admin/municipios");
    await expect(adm.page.getByText(CLIENTE.municipio).first()).toBeVisible();
    await expect(adm.page.getByText(DADOS.principal.nome)).toHaveCount(0);
    await adm.page.goto("/admin/usuarios");
    await expect(adm.page.getByText(CLIENTE.admin)).toBeVisible();
    await expect(adm.page.getByText(DADOS.usuarios.admin)).toHaveCount(0);
    await adm.page.goto("/processos?municipio=");
    await expect(adm.page.getByText(new RegExp(`(${DADOS.municipios.map((m) => m.sigla).join("|")})-\\d{4}-`))).toHaveCount(0);
    // GED do novo cliente: acessa /ged, vazio, sem documentos dos demais
    await adm.page.goto("/ged");
    await expect(adm.page).toHaveURL(/\/ged/);
    await expect(adm.page.getByTestId("ged-organizacao")).toContainText(CLIENTE.nome);
    await adm.page.goto("/ged/documentos");
    await expect(adm.page.getByText(/Termo de Cooperação 005\/2026/)).toHaveCount(0);
    // o auditor do tenant não enxerga as ações do operador
    await adm.page.goto("/admin/auditoria");
    await expect(adm.page.getByText("PLATAFORMA_")).toHaveCount(0);
    await adm.ctx.close();

    // o inverso: nenhum dos outros clientes enxerga o novo
    const lic = await contexto(browser);
    await login(lic.page, "admin");
    await lic.page.goto("/admin/municipios");
    await expect(lic.page.getByText(CLIENTE.municipio)).toHaveCount(0);
    await lic.page.goto("/admin/usuarios");
    await expect(lic.page.getByText(CLIENTE.admin)).toHaveCount(0);
    await lic.ctx.close();
    const vac = await contexto(browser);
    await loginGed(vac.page, USUARIOS_GED.A.admin, SENHA_GED);
    await vac.page.goto("/ged");
    await expect(vac.page.getByText(CLIENTE.nome)).toHaveCount(0);
    await vac.ctx.close();
    await op.ctx.close();
  });

  test("T28e – suspender derruba sessão/API e tira portais do ar; reativar restaura; confirmação digitada e auditoria", async ({ browser }) => {
    apenasNoProjeto(PROJETO_DESKTOP);
    const op = await contexto(browser);
    await loginOperador(op.page);
    banco("ativar-portal", CLIENTE.sigla);

    // pontos de entrada ativos antes da suspensão
    const adm = await contexto(browser);
    await loginSemOrgao(adm.page, CLIENTE.admin, SENHA_P2);
    await expect(adm.page).toHaveURL(/\/dashboard/);
    const api = await tokenApi(adm.ctx.request, CLIENTE.admin, SENHA_P2);
    expect(api.status).toBe(200);
    const publico = await contexto(browser);
    expect(await status(publico.page, `/protocolo/${CLIENTE.slug}`), "portal de protocolo antes").toBe(200);
    expect(await status(publico.page, `/orgao/${siglaMunicipio}`), "portal do órgão antes").toBe(200);

    // confirmação digitada errada não suspende
    await op.page.goto(clienteUrl);
    await op.page.locator("#sp-motivo").fill("Inadimplência (teste E2E)");
    await op.page.locator("#sp-conf").fill("SIGLA-ERRADA");
    await op.page.getByRole("button", { name: "Suspender cliente" }).click();
    await expect(op.page.getByText(/Digite a sigla do cliente/).first()).toBeVisible();
    // confirmação correta
    await op.page.locator("#sp-conf").fill(CLIENTE.sigla);
    await op.page.getByRole("button", { name: "Suspender cliente" }).click();
    await expect(op.page.getByRole("heading", { name: "Reativar cliente" })).toBeVisible(); // a tela passa a oferecer a reativação
    await expect(op.page.getByText(/Suspenso em/)).toBeVisible();

    // sessão ativa derrubada
    await adm.page.goto("/dashboard");
    await expect(adm.page).toHaveURL(/\/login/);
    await adm.page.goto("/ged");
    await expect(adm.page).toHaveURL(/\/login/);
    // token de API não vale mais; novo login recusado com a mensagem de suspensão
    const r = await adm.ctx.request.get("/api/v1/processos?size=1", { headers: { Authorization: `Bearer ${api.token}` } });
    expect(r.status()).toBe(401);
    expect((await tokenApi(adm.ctx.request, CLIENTE.admin, SENHA_P2)).status).not.toBe(200);
    await adm.page.goto("/login");
    await adm.page.getByLabel("Órgão").selectOption("");
    await adm.page.getByLabel("E-mail").fill(CLIENTE.admin);
    await adm.page.getByLabel("Senha").fill(SENHA_P2);
    await adm.page.getByRole("button", { name: /entrar/i }).click();
    await expect(adm.page.getByText(/acesso desta organização está suspenso/i)).toBeVisible();
    // portais públicos do cliente: 404
    expect(await status(publico.page, `/protocolo/${CLIENTE.slug}`), "portal de protocolo suspenso").toBe(404);
    expect(await status(publico.page, `/orgao/${siglaMunicipio}`), "portal do órgão suspenso").toBe(404);
    // o resto da plataforma não é afetado: outros clientes seguem entrando
    const vac = await contexto(browser);
    await loginGed(vac.page, USUARIOS_GED.A.admin, SENHA_GED);
    await expect(vac.page).toHaveURL(/\/ged/);
    await vac.ctx.close();
    // lista do operador mostra Suspenso
    await op.page.goto("/plataforma");
    await expect(op.page.getByTestId(`cliente-${CLIENTE.sigla}`)).toContainText("Suspenso");

    // reativar (também com confirmação digitada)
    await op.page.goto(clienteUrl);
    await op.page.locator("#re-conf").fill("errada");
    await op.page.getByRole("button", { name: "Reativar cliente" }).click();
    await expect(op.page.getByText(/Digite a sigla do cliente/).first()).toBeVisible();
    await op.page.locator("#re-conf").fill(CLIENTE.sigla);
    await op.page.getByRole("button", { name: "Reativar cliente" }).click();
    await expect(op.page.getByRole("heading", { name: "Suspender cliente" })).toBeVisible();
    await loginSemOrgao(adm.page, CLIENTE.admin, SENHA_P2);
    await expect(adm.page).toHaveURL(/\/dashboard/);
    expect(await status(publico.page, `/protocolo/${CLIENTE.slug}`), "portal de protocolo reativado").toBe(200);
    expect(await status(publico.page, `/orgao/${siglaMunicipio}`), "portal do órgão reativado").toBe(200);
    expect((await tokenApi(adm.ctx.request, CLIENTE.admin, SENHA_P2)).status).toBe(200);
    for (const c of [adm, publico, op]) await c.ctx.close();
  });

  test("T28f – desativar módulo bloqueia o acesso sem apagar dados; reativar restaura", async ({ browser }) => {
    apenasNoProjeto(PROJETO_DESKTOP);
    const op = await contexto(browser);
    await loginOperador(op.page);
    const adm = await contexto(browser);
    await loginSemOrgao(adm.page, CLIENTE.admin, SENHA_P2);

    const salvar = async (...modulos: ("Licenciamento ambiental" | "Gestão de Documentos")[]) => {
      await op.page.goto(clienteUrl);
      const card = op.page.locator("section", { has: op.page.getByRole("heading", { name: "Módulos" }) });
      for (const m of ["Licenciamento ambiental", "Gestão de Documentos"] as const) {
        const cb = card.getByLabel(m);
        if (modulos.includes(m)) await cb.check();
        else await cb.uncheck();
      }
      await card.getByRole("button", { name: "Salvar módulos" }).click();
      await expect(op.page.getByText(/Módulos atualizados/)).toBeVisible();
    };

    await salvar("Licenciamento ambiental"); // desativa o GED
    const g = await adm.page.goto("/ged");
    expect(g?.status(), "GED desativado").toBe(403);
    await adm.page.goto("/dashboard");
    await expect(adm.page).toHaveURL(/\/dashboard/); // licenciamento segue
    expect(await status((await contexto(browser)).page, `/protocolo/${CLIENTE.slug}`)).toBe(404);
    await salvar("Gestão de Documentos"); // desativa o licenciamento, reativa o GED
    await adm.page.goto("/dashboard");
    await expect(adm.page).not.toHaveURL(/\/dashboard/);
    await expect(adm.page.getByTestId("usuario-nome")).toBeVisible(); // continua logado, só sem o módulo
    await adm.page.goto("/ged");
    await expect(adm.page).toHaveURL(/\/ged/);
    expect(await status(adm.page, `/orgao/${siglaMunicipio}`), "portal do órgão sem o módulo").toBe(404);
    await salvar("Licenciamento ambiental", "Gestão de Documentos"); // tudo de volta
    await adm.page.goto("/dashboard");
    await expect(adm.page).toHaveURL(/\/dashboard/);
    await adm.page.goto("/admin/municipios");
    await expect(adm.page.getByText(CLIENTE.municipio).first()).toBeVisible(); // dados preservados
    expect(await status(adm.page, `/orgao/${siglaMunicipio}`)).toBe(200);
    for (const c of [adm, op]) await c.ctx.close();
  });

  test("T28g – auditoria: toda ação do operador registrada com ator, cliente-alvo e antes/depois (sem segredos)", async () => {
    apenasNoProjeto(PROJETO_DESKTOP);
    const logs = banco<{ acao: string; ator_email: string | null; antes: unknown; depois: unknown }[]>("auditoria", CLIENTE.sigla);
    const acoes = logs.map((l) => l.acao);
    for (const a of ["PLATAFORMA_CLIENTE_CRIADO", "PLATAFORMA_CONVITE_ENVIADO", "PLATAFORMA_SENHA_ADMIN_REDEFINIDA", "PLATAFORMA_CLIENTE_SUSPENSO", "PLATAFORMA_CLIENTE_REATIVADO", "PLATAFORMA_MODULOS_ALTERADOS"]) {
      expect(acoes, a).toContain(a);
    }
    for (const l of logs) expect(l.ator_email, l.acao).toBe(OPERADOR.email);
    const susp = logs.find((l) => l.acao === "PLATAFORMA_CLIENTE_SUSPENSO")!;
    expect(susp.antes).toMatchObject({ status: "ATIVO" });
    expect(susp.depois).toMatchObject({ status: "SUSPENSO" });
    const mods = logs.filter((l) => l.acao === "PLATAFORMA_MODULOS_ALTERADOS");
    expect(mods.length).toBeGreaterThanOrEqual(3);
    // nenhum segredo (senhas/tokens) na trilha
    const texto = JSON.stringify(logs);
    for (const segredo of [senhaTemporaria, SENHA_P1, SENHA_P2, OPERADOR.senha, linkConvite.split("/").pop()!]) expect(texto).not.toContain(segredo);
  });
});
