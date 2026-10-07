import { createHash, randomBytes } from "node:crypto";
import { test, expect, type APIRequestContext } from "@playwright/test";
import JSZip from "jszip";
import { USUARIOS_GED, auth, carregarIdsGed, criarDocumentoApi, gerarPdf, irPara, itensDe, loginGed, MOTIVO_SEM_IDS, sufixoUnico, tokenCache } from "./ged-helpers";

// T25 – GED: "Baixar pasta (ZIP)" para a prestação de contas (TCM-BA): árvore preservada, nomes seguros para Windows, duplicados
// desambiguados, MANIFESTO.csv/LEIAME.txt, documento sigiloso omitido SEM título para quem não pode ver, isolamento entre clientes,
// auditoria e ZIP grande (~96 MB, STORE) sem estourar a memória do cliente de teste.
// Dados: `E2E_GED_IDS=1 npm run seed:ged-demo` (clientes fictícios VAC/AAC).
test.beforeEach(() => {
  test.skip(test.info().project.name !== "desktop-chromium", "Altera dados – executado apenas no projeto desktop.");
});
const IDS = carregarIdsGed();
test.skip(!IDS, MOTIVO_SEM_IDS);
const A = USUARIOS_GED.A;
const B = USUARIOS_GED.B;
test.describe.configure({ timeout: 300_000 });

const H = async (request: APIRequestContext, email: string) => auth(await tokenCache(request, email));
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function criarPasta(request: APIRequestContext, email: string, nome: string, parent_id?: string): Promise<string> {
  const r = await request.post("/api/v1/ged/pastas", { headers: await H(request, email), data: { nome, parent_id } });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()).id as string;
}
async function concederVer(request: APIRequestContext, admin: string, pastaId: string, usuarioId: string) {
  const r = await request.post("/api/v1/ged/acl", { headers: await H(request, admin), data: { alvo: { tipo: "pasta", id: pastaId }, principal: { tipo: "USUARIO", id: usuarioId }, acoes: ["VER"] } });
  expect(r.ok(), await r.text()).toBeTruthy();
}
async function baixar(request: APIRequestContext, email: string, pastaId: string, query = "") {
  return request.get(`/api/v1/ged/pastas/${pastaId}/zip${query}`, { headers: await H(request, email), timeout: 240_000 });
}
const linhasCsv = (csv: string) => csv.replace(/^﻿/, "").split("\r\n").filter(Boolean).map((l) => l.split(";"));

let raizId = "";
let raizNome = "";
let tituloSigiloso = "";
const suf = sufixoUnico();

test.describe.serial("T25 – baixar pasta como ZIP", () => {
  test("T25a – prepara a árvore (raiz, subpastas, PDFs duplicados, sigiloso) e libera VER aos demais", async ({ request }) => {
    raizNome = `TCM-${suf}`;
    raizId = await criarPasta(request, A.admin, raizNome);
    const contratos = await criarPasta(request, A.admin, "Contratos", raizId);
    const licit = await criarPasta(request, A.admin, "Processos Licitatórios", raizId);
    const dispensas = await criarPasta(request, A.admin, "Dispensas: 2026", licit); // ":" é inválido no Windows
    const admin = await tokenCache(request, A.admin);
    const pdf = async (t: string) => gerarPdf([t, suf]);
    await criarDocumentoApi(request, admin, { titulo: `Ata raiz ${suf}`, pasta_id: raizId, pdf: await pdf("raiz") });
    await criarDocumentoApi(request, admin, { titulo: `Contrato 1 ${suf}`, pasta_id: contratos, pdf: await pdf("c1") }); // nome do envio: doc.pdf
    await criarDocumentoApi(request, admin, { titulo: `Contrato 2 ${suf}`, pasta_id: contratos, pdf: await pdf("c2") }); // também doc.pdf → "doc (2).pdf"
    await criarDocumentoApi(request, admin, { titulo: `Dispensa 7 ${suf}`, pasta_id: dispensas, pdf: await pdf("d7") });
    tituloSigiloso = `Parecer reservado ${suf}`;
    await criarDocumentoApi(request, admin, { titulo: tituloSigiloso, pasta_id: contratos, sensibilidade: "SIGILOSO", pdf: await pdf("sig") });
    for (const email of [A.servidor1, A.auditor]) await concederVer(request, A.admin, raizId, IDS!.A.usuarios[email]);
  });

  test("T25b – o admin baixa: árvore, nomes, cabeçalhos, manifesto com sha256 e LEIAME", async ({ request }) => {
    const r = await baixar(request, A.admin, raizId);
    expect(r.status(), await r.text().catch(() => "")).toBe(200);
    const h = r.headers();
    expect(h["content-type"]).toContain("application/zip");
    expect(h["content-disposition"]).toMatch(new RegExp(`filename="${raizNome}-\\d{4}-\\d{2}-\\d{2}\\.zip"`));
    expect(h["cache-control"]).toContain("no-store");
    const zip = await JSZip.loadAsync(await r.body());
    const nomes = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
    expect(nomes).toEqual([
      `${raizNome}/Contratos/doc (2).pdf`,
      `${raizNome}/Contratos/doc (3).pdf`,
      `${raizNome}/Contratos/doc.pdf`,
      `${raizNome}/LEIAME.txt`,
      `${raizNome}/MANIFESTO.csv`,
      `${raizNome}/Processos Licitatórios/Dispensas_ 2026/doc.pdf`,
      `${raizNome}/doc.pdf`,
    ].sort());
    const man = linhasCsv(await zip.files[`${raizNome}/MANIFESTO.csv`].async("string"));
    const cab = man[0];
    expect(cab).toEqual(expect.arrayContaining(["caminho", "numero_documento", "titulo", "tipo", "data_documento", "sha256", "tamanho_bytes", "paginas", "situacao_assinatura", "dpi_ok"]));
    const col = (n: string) => cab.indexOf(n);
    const dados = man.slice(1);
    expect(dados).toHaveLength(5);
    for (const l of dados) {
      expect(l[col("situacao_exportacao")]).toBe("incluido");
      expect(l[col("dpi_ok")]).toBe("nao verificado");
      const bytes = await zip.files[l[col("caminho")]].async("nodebuffer");
      expect(sha(bytes)).toBe(l[col("sha256")]);
      expect(String(bytes.length)).toBe(l[col("tamanho_bytes")]);
      expect(l[col("numero_documento")]).toMatch(/-DOC-/);
    }
    expect(dados.map((l) => l[col("titulo")])).toContain(tituloSigiloso);
    const leiame = await zip.files[`${raizNome}/LEIAME.txt`].async("string");
    expect(leiame).toMatch(/250 DPI/);
    expect(leiame).toMatch(/Brasília/);
    expect(leiame).toContain(raizNome);
  });

  test("T25c – usuário comum: sigiloso fica de fora e entra no manifesto como omitido, sem título nem número", async ({ request }) => {
    const r = await baixar(request, A.servidor1, raizId);
    expect(r.status()).toBe(200);
    const zip = await JSZip.loadAsync(await r.body());
    const nomes = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    expect(nomes.filter((n) => n.endsWith(".pdf"))).toHaveLength(4);
    const texto = (await zip.files[`${raizNome}/MANIFESTO.csv`].async("string")) + (await zip.files[`${raizNome}/LEIAME.txt`].async("string")) + nomes.join("\n");
    expect(texto).not.toContain(tituloSigiloso);
    const man = linhasCsv(await zip.files[`${raizNome}/MANIFESTO.csv`].async("string"));
    const omitidos = man.filter((l) => l.at(-1) === "omitido: sem permissao");
    expect(omitidos).toHaveLength(1);
    expect(omitidos[0].slice(1, -1).every((c) => c === "")).toBe(true); // só a pasta aparece
    expect(omitidos[0][0]).toBe(`${raizNome}/Contratos`);
    expect(r.headers()["x-ged-omitidos"]).toBe("1");
  });

  test("T25d – auditor (VER por ACL) baixa; quem não tem acesso à pasta e o outro cliente recebem 404; API sem login = 401", async ({ request, baseURL }) => {
    expect((await baixar(request, A.auditor, raizId)).status()).toBe(200);
    expect((await baixar(request, A.vereador, raizId)).status()).toBe(404); // leitor sem ACL na pasta
    const b = await baixar(request, B.admin, raizId); // pasta do cliente A com o token do cliente B
    expect(b.status()).toBe(404);
    expect(await b.text()).not.toContain(raizNome);
    const pastaB = Object.values(IDS!.B.pastas)[0];
    expect((await baixar(request, A.admin, pastaB)).status()).toBe(404);
    expect((await fetch(`${baseURL}/api/v1/ged/pastas/${raizId}/zip`)).status).toBe(401); // sem cookie (o login por API do contexto grava sessão)
    expect((await baixar(request, A.admin, "nao-e-uuid")).status()).toBe(404);
  });

  test("T25e – versão=original continua devolvendo o PDF (sem OCR no caso) e a exportação foi auditada", async ({ request }) => {
    const r = await baixar(request, A.admin, raizId, "?versao=original");
    expect(r.status()).toBe(200);
    await expect
      .poll(async () => {
        const l = await request.get("/api/v1/ged/logs?aba=alteracoes&acao=PASTA_EXPORTADA_ZIP", { headers: await H(request, A.admin) });
        const t = JSON.stringify(await l.json());
        return t.includes(raizNome) && /original/.test(t);
      }, { timeout: 30_000 })
      .toBe(true);
    const ac = await request.get("/api/v1/ged/logs?aba=acessos&acao=BAIXAR", { headers: await H(request, A.admin) });
    const j = (await ac.json()) as { total: number; itens: unknown[] };
    expect(j.total).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(itensDe(j))).toBeDefined();
  });

  test("T25f – pela tela: botão 'Baixar pasta (ZIP)' na ficha da pasta", async ({ page }) => {
    await loginGed(page, A.admin);
    await irPara(page, `/ged/pastas?pasta=${raizId}`);
    const botao = page.getByRole("link", { name: "Baixar pasta (ZIP)" });
    await expect(botao).toBeVisible();
    const [dl] = await Promise.all([page.waitForEvent("download"), botao.click()]);
    expect(dl.suggestedFilename()).toMatch(new RegExp(`^${raizNome}-\\d{4}-\\d{2}-\\d{2}\\.zip$`));
  });

  test("T25g – ZIP grande (~96 MB) é entregue por streaming e confere por sha256", async ({ request }) => {
    const pasta = await criarPasta(request, A.admin, `GRANDE-${suf}`);
    const admin = await tokenCache(request, A.admin);
    const base = await gerarPdf(["grande", suf]);
    const esperados = new Map<string, number>();
    for (let i = 0; i < 4; i++) {
      const pdf = Buffer.concat([base, Buffer.from("\n%"), randomBytes(23 * 1024 * 1024)]); // lixo após %%EOF: incompressível
      await criarDocumentoApi(request, admin, { titulo: `Volume ${i} ${suf}`, pasta_id: pasta, pdf });
      esperados.set(sha(pdf), pdf.length);
    }
    const r = await baixar(request, A.admin, pasta);
    expect(r.status()).toBe(200);
    const corpo = await r.body();
    expect(corpo.length).toBeGreaterThan(90 * 1024 * 1024);
    const zip = await JSZip.loadAsync(corpo);
    const pdfs = Object.keys(zip.files).filter((n) => n.endsWith(".pdf"));
    expect(pdfs).toHaveLength(4);
    for (const n of pdfs) {
      const b = await zip.files[n].async("nodebuffer");
      expect(esperados.get(sha(b))).toBe(b.length);
    }
  });
});
