import { expect, type Page, type APIRequestContext } from "@playwright/test";

// Usuários de demonstração – ver prisma/seed/base.ts (SENHA_DEMO). NUNCA existem em produção de cliente
// após a implantação; para rodar em prod na PoC, sobrescreva com E2E_SENHA se necessário.
export const SENHA_DEMO = process.env.E2E_SENHA || "Demo@2026licencia";

export const USUARIOS = {
  admin: "admin@licenciagov.demo",
  tecConsorcio1: "tec.consorcio1@licenciagov.demo",
  tecConsorcio2: "tec.consorcio2@licenciagov.demo",
  sema: "sema@licenciagov.demo",
  tecnicoItb: "tecnico.itb@licenciagov.demo",
  gestorItb: "gestor.itb@licenciagov.demo",
  fiscalItb: "fiscal.itb@licenciagov.demo",
  tecnicoRuy: "tecnico.ruy@licenciagov.demo",
  gestorRuy: "gestor.ruy@licenciagov.demo",
  fiscalRuy: "fiscal.ruy@licenciagov.demo",
  tecnicoIac: "tecnico.iac@licenciagov.demo",
  gestorIac: "gestor.iac@licenciagov.demo",
  fiscalIac: "fiscal.iac@licenciagov.demo",
  // requerentes
  laticinio: "laticinio@licenciagov.demo",
  posto: "posto@licenciagov.demo",
  joao: "joao@licenciagov.demo",
  maria: "maria@licenciagov.demo",
  ceramica: "ceramica@licenciagov.demo",
} as const;

export type UsuarioDemo = keyof typeof USUARIOS;

const REQUERENTES: UsuarioDemo[] = ["laticinio", "posto", "joao", "maria", "ceramica"];
export const ehRequerente = (u: UsuarioDemo) => REQUERENTES.includes(u);

/** Login pela UI (/login, campos "E-mail" e "Senha"). Aguarda sair da tela de login. */
export async function login(page: Page, usuario: UsuarioDemo | string, senha = SENHA_DEMO) {
  const email = usuario in USUARIOS ? USUARIOS[usuario as UsuarioDemo] : usuario;
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(senha);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  const destinoEsperado = usuario in USUARIOS && ehRequerente(usuario as UsuarioDemo) ? /\/meus-processos|\/trocar-senha/ : /\/dashboard|\/trocar-senha/;
  await expect(page).toHaveURL(destinoEsperado);
}

export async function logout(page: Page) {
  await page.goto("/sair");
}

/** Token Bearer via API (/api/v1/auth/login) – para testes de API e escopo (T7). */
export async function tokenApi(request: APIRequestContext, usuario: UsuarioDemo, senha = SENHA_DEMO) {
  const r = await request.post("/api/v1/auth/login", { data: { email: USUARIOS[usuario], senha } });
  expect(r.ok(), `login API de ${usuario}: ${r.status()}`).toBeTruthy();
  const corpo = await r.json();
  return corpo.access_token as string;
}
