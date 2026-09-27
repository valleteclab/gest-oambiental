import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page, type APIRequestContext, type TestInfo } from "@playwright/test";

// Usuários de demonstração – ver prisma/seed/base.ts (SENHA_DEMO). NUNCA existem em produção de cliente
// após a implantação; para rodar em prod na PoC, sobrescreva com E2E_SENHA se necessário.
export const SENHA_DEMO = process.env.E2E_SENHA || "Demo@2026licencia";

export const USUARIOS = {
  admin: "admin@licenciagov.demo",
  tecConsorcio1: "tec.consorcio1@licenciagov.demo",
  tecConsorcio2: "tec.consorcio2@licenciagov.demo",
  sema: "sema@licenciagov.demo",
  tecnicoLor: "tecnico.lor@licenciagov.demo",
  gestorLor: "gestor.lor@licenciagov.demo",
  fiscalLor: "fiscal.lor@licenciagov.demo",
  tecnicoSsr: "tecnico.ssr@licenciagov.demo",
  gestorSsr: "gestor.ssr@licenciagov.demo",
  fiscalSsr: "fiscal.ssr@licenciagov.demo",
  tecnicoCse: "tecnico.cse@licenciagov.demo",
  gestorCse: "gestor.cse@licenciagov.demo",
  fiscalCse: "fiscal.cse@licenciagov.demo",
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

/** Município principal de teste (órgão usado por padrão pelos usuários de escopo organização). */
export const ORGAO_PRINCIPAL = "LOR";

/** Órgão padrão de cada usuário demo no login: o município do papel/cadastro; escopo organização → ORGAO_PRINCIPAL. */
export function orgaoPadrao(usuario: UsuarioDemo | string): string {
  const m = /^[a-z]+(Lor|Ssr|Cse)$/.exec(usuario);
  if (m) return m[1].toUpperCase();
  const req: Partial<Record<UsuarioDemo, string>> = { laticinio: "LOR", posto: "SSR", joao: "CSE", maria: "LOR", ceramica: "PCA" };
  return req[usuario as UsuarioDemo] ?? ORGAO_PRINCIPAL;
}

/** Login pela UI (/login: "Órgão", "E-mail" e "Senha"). Aguarda sair da tela de login. */
export async function login(page: Page, usuario: UsuarioDemo | string, senha = SENHA_DEMO, orgao = orgaoPadrao(usuario)) {
  const email = usuario in USUARIOS ? USUARIOS[usuario as UsuarioDemo] : usuario;
  await page.goto("/login");
  await page.getByLabel("Órgão").selectOption(orgao);
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

// ───────────── Testes de aceite da PoC (SPEC 13, t01…t10) ─────────────

/** Projetos do playwright.config.ts. Testes que alteram dados rodam em UM projeto só (desktop; T4 só no mobile). */
export const PROJETO_DESKTOP = "desktop-chromium";
export const PROJETO_MOBILE = "mobile-pixel7";

/** Chamar no início do teste: pula nos demais projetos (evita executar mutações duas vezes). */
export function apenasNoProjeto(nome: string, motivo = "Altera dados – executado apenas em um projeto.") {
  test.skip(test.info().project.name !== nome, motivo);
}

export const FIXTURES = path.resolve(__dirname, "../fixtures");
export const PDF_EXEMPLO = path.join(FIXTURES, "documento-exemplo.pdf");
export const FOTOS_VISTORIA = [path.join(FIXTURES, "vistoria-1.jpg"), path.join(FIXTURES, "vistoria-2.jpg")];

/** Troca de usuário na mesma página (encerra a sessão atual e entra com outro). */
export async function entrarComo(page: Page, usuario: UsuarioDemo) {
  await logout(page);
  await login(page, usuario);
}

/**
 * Estado compartilhado T1 → T5/T8 (nº do processo e código da LO emitida).
 * Gravado em test-results/poc-estado.json – por isso a suíte roda com workers=1 e T1 antes de T5/T8
 * (ordem alfabética dos arquivos). Rodar T5/T8 isoladamente exige ter rodado T1 na mesma execução.
 */
const ARQ_ESTADO = path.resolve(__dirname, "../../test-results/poc-estado.json");
export type EstadoPoc = { processo_id?: string; processo_numero?: string; lo_codigo?: string; lo_numero?: string; lo_documento_id?: string };

export function salvarEstado(parcial: EstadoPoc) {
  const atual = lerEstado();
  mkdirSync(path.dirname(ARQ_ESTADO), { recursive: true });
  writeFileSync(ARQ_ESTADO, JSON.stringify({ ...atual, ...parcial }, null, 2));
}

export function lerEstado(): EstadoPoc {
  if (!existsSync(ARQ_ESTADO)) return {};
  try {
    return JSON.parse(readFileSync(ARQ_ESTADO, "utf8")) as EstadoPoc;
  } catch {
    return {};
  }
}

/** Estado exigido (falha com mensagem clara se T1 não rodou antes). */
export function estadoDeT1(testInfo: TestInfo, campo: keyof EstadoPoc): string {
  const v = lerEstado()[campo];
  expect(v, `${testInfo.title}: depende de T1 (t01-processo-completo) ter rodado antes nesta execução (${campo} ausente em ${ARQ_ESTADO})`).toBeTruthy();
  return v!;
}

/** Converte "1.234,5" / "R$ 1.234,50" / "—" em número (— = null). */
export function numeroBr(texto: string | null | undefined): number | null {
  const t = (texto ?? "").replace(/R\$|\s| /g, "").trim();
  if (!t || t === "—") return null;
  return Number(t.replace(/\./g, "").replace(",", "."));
}
