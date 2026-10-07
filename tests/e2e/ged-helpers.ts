// Helpers dos E2E do módulo GED (Gestão de Documentos) – usados por t16-ged-isolamento.spec.ts e pelos próximos specs.
//
// DADOS: o seed `npm run seed:ged-demo` (prisma/seed/ged-demo.ts) cria dois clientes FICTÍCIOS – A "Câmara Municipal de Vale das
// Acácias (DEMO)" (VAC) e B "Autarquia de Águas do Cerrado (DEMO)" (AAC) – e, com `E2E_GED_IDS=1`, grava o mapa de IDs
// em tests/e2e/.ged-ids.json (ou no arquivo de E2E_GED_IDS_FILE):
//     E2E_GED_IDS=1 npm run seed:ged-demo      →  tests/e2e/.ged-ids.json   (arquivo local, NÃO versionar)
// O E2E lê esse mapa em vez de consultar o banco (o teste pode rodar contra um ambiente remoto, E2E_BASE_URL).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const SENHA_GED = process.env.E2E_SENHA || "Demo@2026licencia";
export const ARQUIVO_IDS = process.env.E2E_GED_IDS_FILE || path.resolve(__dirname, ".ged-ids.json");

const DOMINIO = "gestaodocumentos.demo";
/** Usuários dos dois clientes de demonstração (ver prisma/seed/clientes/ged-demo-a|b.json). */
export const USUARIOS_GED = {
  A: { admin: `admin.vac@${DOMINIO}`, gestor: `gestor.vac@${DOMINIO}`, servidor1: `servidor1.vac@${DOMINIO}`, servidor2: `servidor2.vac@${DOMINIO}`, vereador: `vereador.vac@${DOMINIO}`, auditor: `auditor.vac@${DOMINIO}` },
  B: { admin: `admin.aac@${DOMINIO}`, gestor: `gestor.aac@${DOMINIO}`, servidor: `servidor.aac@${DOMINIO}` },
} as const;

export type ChaveTenant = "A" | "B";
const SIGLA: Record<ChaveTenant, string> = { A: "VAC", B: "AAC" };

export type IdsTenantGed = {
  organizacao_id: string;
  sigla: string;
  usuarios: Record<string, string>; // e-mail → id
  pastas: Record<string, string>; // caminho → id
  setores: Record<string, string>;
  documentos: Record<string, { id: string; numero: string; titulo: string; versao_id: string; storage_key: string; pasta: string | null; codigo_verificador?: string | null; sha256_final?: string | null; status?: string | null }>;
  comentarios: { id: string; documento: string }[];
  solicitacoes: Record<string, { id: string; documento: string; assinantes: { id: string; usuario: string; status: string }[] }>;
  tramites: { id: string; documento: string; tipo: string }[];
  acls: { id: string; documento: string | null; pasta: string | null }[];
  comunicacoes: string[];
  acessos: string[];
};
export type IdsGed = { A: IdsTenantGed; B: IdsTenantGed };

/** Mapa de IDs do seed, ou null se o arquivo não existe (o spec então se pula, com a instrução no motivo). */
export function carregarIdsGed(): IdsGed | null {
  if (!existsSync(ARQUIVO_IDS)) return null;
  const j = JSON.parse(readFileSync(ARQUIVO_IDS, "utf8")) as { tenants: Record<string, IdsTenantGed> };
  const A = j.tenants[SIGLA.A];
  const B = j.tenants[SIGLA.B];
  return A && B ? { A, B } : null;
}
export const MOTIVO_SEM_IDS = `Sem ${path.basename(ARQUIVO_IDS)}: rode  E2E_GED_IDS=1 npm run seed:ged-demo  (dois clientes fictícios VAC/AAC) antes deste spec.`;

/** Login pela UI do GED: sem escolher órgão (GED-only não tem órgão); espera chegar em /ged (ou /trocar-senha). */
export async function loginGed(page: Page, email: string, senha = SENHA_GED) {
  await page.goto("/login");
  const orgao = page.getByLabel("Órgão");
  if (await orgao.count()) await orgao.selectOption("").catch(() => undefined);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(senha);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
}

/** Token Bearer (API) de um usuário do GED. Poucas chamadas por execução: o login tem limite de tentativas por IP. */
export async function tokenGed(request: APIRequestContext, email: string, senha = SENHA_GED): Promise<string> {
  const r = await request.post("/api/v1/auth/login", { data: { email, senha } });
  expect(r.ok(), `login API de ${email}: ${r.status()}`).toBeTruthy();
  return (await r.json()).access_token as string;
}
export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Itens de uma resposta de lista da API (aceita `data`, `items` ou `itens`). */
export function itensDe(corpo: unknown): Record<string, unknown>[] {
  const c = corpo as Record<string, unknown>;
  const l = c?.data ?? c?.items ?? c?.itens ?? [];
  return Array.isArray(l) ? (l as Record<string, unknown>[]) : [];
}

/** Todo identificador "do outro cliente" que NÃO pode aparecer em nenhuma resposta de um cliente: ids, números, e-mails. */
export function marcasDe(t: IdsTenantGed): string[] {
  return [
    t.organizacao_id,
    ...Object.values(t.documentos).flatMap((d) => [d.id, d.numero, d.versao_id, d.storage_key]),
    ...Object.values(t.usuarios),
    ...Object.keys(t.usuarios),
    ...Object.values(t.pastas),
    ...t.comentarios.map((c) => c.id),
    ...Object.values(t.solicitacoes).flatMap((s) => [s.id, ...s.assinantes.map((a) => a.id)]),
  ];
}

/** Falha listando o que vazou (sem imprimir o corpo inteiro). */
export function semVazamento(corpoTexto: string, marcas: string[], onde: string) {
  const achadas = marcas.filter((m) => m && corpoTexto.includes(m));
  expect(achadas, `${onde}: marcas do OUTRO cliente apareceram na resposta`).toEqual([]);
}

// ───────────────────────── Parte 2: utilitários dos specs t17–t20 ─────────────────────────
import { execFileSync } from "node:child_process";
import { readFileSync as lerArq } from "node:fs";
import { type Locator } from "@playwright/test";

export const PDF_EXEMPLO_GED = path.resolve(__dirname, "../fixtures/documento-exemplo.pdf");

/** Sufixo curto e único por execução (re-executar o spec no mesmo banco não colide com dados anteriores). */
export const sufixoUnico = () => `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;

/** Espera a hidratação do React (os formulários do GED só funcionam depois disso; sem `networkidle`). */
export async function aguardarHidratacao(page: Page) {
  await page.waitForFunction(
    () => [...document.querySelectorAll("main *, form")].some((e) => Object.keys(e).some((k) => k.startsWith("__reactProps"))),
    undefined,
    { timeout: 30_000 },
  );
}

/** Abre uma URL do GED e espera a hidratação. Repete uma vez se `next dev` abortar a 1ª navegação. */
export async function irPara(page: Page, url: string) {
  await page.goto(url).catch(() => page.goto(url));
  await aguardarHidratacao(page);
}

/** window.confirm/alert dos formulários (ex.: "Devolver…?", "Finalizar…?"): aceita sempre. */
export function aceitarDialogos(page: Page) {
  page.on("dialog", (d) => void d.accept().catch(() => undefined));
}

/**
 * Clica no botão de um FormGed e espera a mensagem de sucesso (role=status) – repete uma vez caso a página ainda
 * não estivesse hidratada (o envio nativo recarregaria a página sem salvar).
 */
export async function submeter(page: Page, botao: Locator, sucesso: string | RegExp, regiao?: Locator) {
  const alvo = regiao ?? page.locator("main");
  for (let i = 0; i < 2; i++) {
    await aguardarHidratacao(page);
    await botao.click();
    const ok = await alvo.getByText(sucesso).first().waitFor({ timeout: i === 0 ? 20_000 : 30_000 }).then(() => true, () => false);
    if (ok) return;
  }
  await expect(alvo.getByText(sucesso).first()).toBeVisible({ timeout: 1000 });
}

// ---- API (token Bearer) ----
const cacheTokens = new Map<string, string>();
export async function tokenCache(request: APIRequestContext, email: string) {
  if (!cacheTokens.has(email)) cacheTokens.set(email, await tokenGed(request, email));
  return cacheTokens.get(email)!;
}

export type DocCriado = { id: string; numero?: string };
/** Cria um documento por upload de PDF pela API (rápido, para preparar cenários). */
export async function criarDocumentoApi(
  request: APIRequestContext, token: string,
  d: { titulo: string; remetente?: string; data?: string; pasta_id?: string; sensibilidade?: "PUBLICO" | "RESTRITO" | "SIGILOSO"; marcador_ids?: string[]; pdf?: Buffer; tipo_id?: string },
): Promise<DocCriado> {
  const multipart: Record<string, string | { name: string; mimeType: string; buffer: Buffer }> = {
    arquivo: { name: "doc.pdf", mimeType: "application/pdf", buffer: d.pdf ?? lerArq(PDF_EXEMPLO_GED) },
    titulo: d.titulo,
  };
  if (d.remetente) multipart.remetente = d.remetente;
  if (d.data) multipart.data_documento = d.data;
  if (d.pasta_id) multipart.pasta_id = d.pasta_id;
  if (d.tipo_id) multipart.tipo_id = d.tipo_id;
  if (d.sensibilidade) multipart.sensibilidade = d.sensibilidade;
  const r = await request.post("/api/v1/ged/documentos", { headers: auth(token), multipart });
  expect(r.status(), `criar documento: ${await r.text()}`).toBe(201);
  const j = await r.json();
  return { id: j.id as string, numero: j.numero as string | undefined };
}

/** PDF de uma página com `linhas` de texto (pdf-lib – dependência do projeto) para testes de busca por conteúdo. */
export async function gerarPdf(linhas: string[]): Promise<Buffer> {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([595, 842]);
  linhas.forEach((l, i) => p.drawText(l, { x: 50, y: 780 - i * 22, size: 13, font: f }));
  return Buffer.from(await doc.save());
}

export const temPdftotext = () => {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

/** Id do usuário do seed pelo e-mail. */
export const idUsuario = (ids: IdsGed, t: ChaveTenant, email: string) => ids[t].usuarios[email];

/** Caminho do script de apoio com acesso ao banco (processar a caixa de saída, ler e-mails) – t20. */
export const SCRIPT_BANCO = path.resolve(__dirname, "t20-banco.ts");
export function bancoCmd<T = unknown>(...args: string[]): T {
  const out = execFileSync("npx", ["tsx", SCRIPT_BANCO, ...args], { encoding: "utf8", env: process.env, cwd: path.resolve(__dirname, "../.."), timeout: 120_000 });
  const linha = out.trim().split("\n").filter((l) => l.startsWith("__JSON__")).pop();
  if (!linha) throw new Error(`t20-banco sem saída JSON: ${out.slice(-400)}`);
  return JSON.parse(linha.slice(8)) as T;
}
export const temBanco = () => !!process.env.DATABASE_URL;
