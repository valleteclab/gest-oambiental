import { test, expect, type APIRequestContext } from "@playwright/test";
import JSZip from "jszip";
import { USUARIOS_GED, aguardarHidratacao, auth, carregarIdsGed, gerarPdf, irPara, itensDe, loginGed, MOTIVO_SEM_IDS, sufixoUnico, tokenCache } from "./ged-helpers";

// T21 – GED fase 2: importação em lote de ZIP (v2: pela tela o ZIP sobe em partes de 8 MB; a API multipart simples continua valendo até 64 MB) (estrutura de pastas do ZIP vira árvore de pastas do GED).
// Dados: seed `E2E_GED_IDS=1 npm run seed:ged-demo` (clientes fictícios VAC/AAC). ZIPs gerados em memória; cada execução usa sufixo único.
// Sem worker no ar, a API processa o lote em segundo plano no próprio servidor (mesmo caminho do upload de PDF).
test.beforeEach(() => {
  test.skip(test.info().project.name !== "desktop-chromium", "Altera dados – executado apenas no projeto desktop.");
});
const IDS = carregarIdsGed();
test.skip(!IDS, MOTIVO_SEM_IDS);
const A = USUARIOS_GED.A;
const B = USUARIOS_GED.B;
test.describe.configure({ timeout: 180_000 });

type Lote = { id: string; status: string; total_arquivos: number; importados: number; duplicados: number; ignorados: number; com_erro: number; pastas_criadas: number; ocultos: number; itens: { caminho: string; status: string; motivo: string | null; documento_id: string | null }[] };

async function montarZip(suf: string) {
  const raiz = `Cliente T21 ${suf}`;
  const pdf = async (t: string) => gerarPdf([`Importação T21 ${suf}`, t]);
  const igual = await pdf("conteudo repetido");
  const z = new JSZip();
  z.file(`${raiz}/Licitação/Edital de Pregão.pdf`, await pdf("edital"));
  z.file(`${raiz}/Pagamentos/2026/Nota_Fiscal_001.pdf`, igual);
  z.file(`${raiz}/Pagamentos/2026/Nota Fiscal 001 (cópia).pdf`, igual); // duplicado dentro do próprio ZIP
  z.file(`${raiz}/Controle interno/Relatório mensal.pdf`, await pdf("relatorio"));
  z.file(`${raiz}/Controle interno/planilha.xlsx`, Buffer.from("PK-nao-importa"));
  z.file(`${raiz}/Controle interno/falso.pdf`, Buffer.from("isto não é um PDF"));
  z.file(`__MACOSX/${raiz}/._Edital de Pregão.pdf`, Buffer.from("lixo"));
  z.file(`${raiz}/Thumbs.db`, Buffer.from("lixo"));
  z.file(`${raiz}/.DS_Store`, Buffer.from("lixo"));
  z.file(`../escape-${suf}.pdf`, await pdf("zip-slip")); // tentativa de sair da pasta
  const buffer = await z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { raiz, buffer };
}

async function enviarZip(request: APIRequestContext, email: string, buffer: Buffer, extra: Record<string, string> = {}) {
  return request.post("/api/v1/ged/importacoes", { headers: auth(await tokenCache(request, email)), multipart: { arquivo: { name: "lote-mensal.zip", mimeType: "application/zip", buffer }, ...extra } });
}

async function aguardarLote(request: APIRequestContext, email: string, id: string): Promise<Lote> {
  let lote!: Lote;
  await expect
    .poll(async () => {
      const r = await request.get(`/api/v1/ged/importacoes/${id}?size=200`, { headers: auth(await tokenCache(request, email)) });
      lote = (await r.json()) as Lote;
      return lote.status;
    }, { timeout: 120_000, intervals: [500, 1000, 2000] })
    .toMatch(/^(CONCLUIDA|CONCLUIDA_COM_ERROS|FALHOU)$/);
  return lote;
}

test("T21a – o gestor importa um ZIP pela tela: pastas criadas, duplicados, lixo e zip-slip tratados; reenvio só duplica", async ({ page, request }) => {
  const suf = sufixoUnico();
  const { raiz, buffer } = await montarZip(suf);

  await loginGed(page, A.admin);
  await irPara(page, "/ged/importar");
  await expect(page.getByRole("heading", { name: "Importar pasta ou ZIP" })).toBeVisible();
  await aguardarHidratacao(page);
  await page.getByRole("tab", { name: "Enviar ZIP" }).click(); // v2: a aba "Enviar pasta" é a padrão
  await page.locator("#arquivo-zip").setInputFiles({ name: `lote-${suf}.zip`, mimeType: "application/zip", buffer });
  await page.locator("#tipo_id").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Importar ZIP" }).click();
  await expect(page).toHaveURL(/\/ged\/importar\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  const id = page.url().split("/").pop()!;

  // Acompanhamento: a página se atualiza sozinha até concluir
  await expect(page.getByText("Concluída com erros")).toBeVisible({ timeout: 120_000 });
  const lote = await aguardarLote(request, A.admin, id);
  // importados: edital, NF-001, relatório = 3; duplicado: cópia da NF; ignorado: planilha; erros: falso.pdf e o zip-slip
  expect({ i: lote.importados, d: lote.duplicados, ig: lote.ignorados, e: lote.com_erro, p: lote.pastas_criadas, oc: lote.ocultos }).toEqual({ i: 3, d: 1, ig: 1, e: 2, p: 5, oc: 3 });
  await expect(page.getByTestId("contador-importados")).toHaveText("3");
  await expect(page.getByTestId("contador-pastas")).toHaveText("5");
  const por = Object.fromEntries(lote.itens.map((i) => [i.caminho, i]));
  // as duas NFs têm o mesmo conteúdo: a primeira (ordem do caminho) é importada, a outra é relatada como duplicada
  expect([por[`${raiz}/Pagamentos/2026/Nota Fiscal 001 (cópia).pdf`]?.status, por[`${raiz}/Pagamentos/2026/Nota_Fiscal_001.pdf`]?.status].sort()).toEqual(["DUPLICADO", "IMPORTADO"]);
  expect(por[`${raiz}/Controle interno/planilha.xlsx`]?.status).toBe("IGNORADO");
  expect(por[`${raiz}/Controle interno/falso.pdf`]?.status).toBe("ERRO");
  expect(Object.values(por).filter((i) => i.status === "ERRO").map((i) => i.motivo).join(" | ")).toMatch(/\.\./);
  expect(lote.itens.some((i) => /Thumbs|DS_Store|MACOSX/.test(i.caminho))).toBe(false);
  await expect(page.getByTestId("tabela-itens-importacao")).toContainText("Edital de Pregão.pdf");
  const csv = await request.get(`/api/v1/ged/importacoes/${id}?formato=csv`, { headers: auth(await tokenCache(request, A.admin)) });
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain("Relatório mensal.pdf");

  // A árvore do ZIP virou pastas do GED e os documentos estão nelas
  const tok = auth(await tokenCache(request, A.admin));
  const pastas = itensDe(await (await request.get("/api/v1/ged/pastas", { headers: tok })).json()) as { id: string; caminho_nome: string }[];
  const nomes = pastas.map((p) => p.caminho_nome);
  for (const c of [raiz, `${raiz}/Licitação`, `${raiz}/Pagamentos`, `${raiz}/Pagamentos/2026`, `${raiz}/Controle interno`]) expect(nomes, c).toContain(c);
  const pastaEdital = pastas.find((p) => p.caminho_nome === `${raiz}/Licitação`)!;
  const docs = itensDe(await (await request.get(`/api/v1/ged/documentos?pasta=${pastaEdital.id}`, { headers: tok })).json()) as { titulo: string; sensibilidade?: string }[];
  expect(docs.map((d) => d.titulo)).toContain("Edital de Pregão");
  const nf = itensDe(await (await request.get(`/api/v1/ged/documentos?titulo=${encodeURIComponent("Nota Fiscal 001")}`, { headers: tok })).json());
  expect(nf.length).toBeGreaterThanOrEqual(1);

  // Reenvio da mesma cópia mensal: nada novo, tudo duplicado (e nenhuma pasta nova)
  const r2 = await enviarZip(request, A.gestor, buffer);
  expect(r2.status()).toBe(201);
  const lote2 = await aguardarLote(request, A.gestor, (await r2.json()).id);
  expect({ i: lote2.importados, d: lote2.duplicados, p: lote2.pastas_criadas }).toEqual({ i: 0, d: 4, p: 0 });
});

test("T21b – outro cliente não vê o lote, não deduplica contra ele e quem não é admin/gestor é recusado", async ({ request }) => {
  const suf = sufixoUnico();
  const { raiz, buffer } = await montarZip(suf);
  const rA = await enviarZip(request, A.admin, buffer);
  expect(rA.status()).toBe(201);
  const idA = (await rA.json()).id as string;
  await aguardarLote(request, A.admin, idA);

  // Cliente B: lote de A é 404 (nunca 403/200) e não aparece na listagem; pastas/documentos de A não vazam
  const tokB = auth(await tokenCache(request, B.admin));
  expect((await request.get(`/api/v1/ged/importacoes/${idA}`, { headers: tokB })).status()).toBe(404);
  expect((await request.get(`/api/v1/ged/importacoes/${idA}?formato=csv`, { headers: tokB })).status()).toBe(404);
  const listaB = await (await request.get("/api/v1/ged/importacoes?size=100", { headers: tokB })).json();
  expect(JSON.stringify(listaB)).not.toContain(idA);
  const pastasB = JSON.stringify(await (await request.get("/api/v1/ged/pastas", { headers: tokB })).json());
  expect(pastasB).not.toContain(raiz);
  const docsB = JSON.stringify(await (await request.get(`/api/v1/ged/documentos?titulo=${encodeURIComponent("Edital de Pregão")}`, { headers: tokB })).json());
  expect(docsB).not.toContain(raiz);

  // O mesmo ZIP em B importa tudo (deduplicação é por organização): os 3 PDFs válidos viram documentos de B
  const rB = await enviarZip(request, B.admin, buffer);
  expect(rB.status()).toBe(201);
  const loteB = await aguardarLote(request, B.admin, (await rB.json()).id);
  expect({ i: loteB.importados, d: loteB.duplicados }).toEqual({ i: 3, d: 1 });
  // e A continua sem ver nada de B
  const listaA = JSON.stringify(await (await request.get("/api/v1/ged/importacoes?size=100", { headers: auth(await tokenCache(request, A.admin)) })).json());
  expect(listaA).not.toContain(loteB.id);

  // Papéis: servidor (GED_USUARIO), vereador (leitor) e auditor não importam nem listam
  for (const email of [A.servidor1, A.vereador, A.auditor]) {
    const tok = auth(await tokenCache(request, email));
    expect((await enviarZip(request, email, buffer)).status(), `POST ${email}`).toBe(403);
    expect((await request.get("/api/v1/ged/importacoes", { headers: tok })).status(), `GET ${email}`).toBe(403);
  }
  // Gestor não vê lote enviado por outra pessoa (relatório com caminhos que ele talvez não alcance)
  expect((await request.get(`/api/v1/ged/importacoes/${idA}`, { headers: auth(await tokenCache(request, A.gestor)) })).status()).toBe(404);
});

test("T21c – ZIP inválido, sem PDFs ou com pasta de outro cliente é recusado na hora (422)", async ({ request }) => {
  const naoZip = await enviarZip(request, A.admin, Buffer.from("isto não é um zip"));
  expect(naoZip.status()).toBe(422);
  const semPdf = new JSZip();
  semPdf.file("a/planilha.xlsx", "x");
  semPdf.file("__MACOSX/a/._x.pdf", "x");
  const r = await enviarZip(request, A.admin, await semPdf.generateAsync({ type: "nodebuffer" }));
  expect(r.status()).toBe(422);
  expect((await r.json()).message).toMatch(/nenhum PDF/);
  const naoZipNome = await request.post("/api/v1/ged/importacoes", { headers: auth(await tokenCache(request, A.admin)), multipart: { arquivo: { name: "x.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") } } });
  expect(naoZipNome.status()).toBe(422);
  // pasta de destino de outro cliente não existe para A
  const z = new JSZip();
  z.file("x.pdf", await gerarPdf(["destino de outro cliente"]));
  const idPastaB = IDS!.B.pastas[Object.keys(IDS!.B.pastas)[0]];
  const rd = await enviarZip(request, A.admin, await z.generateAsync({ type: "nodebuffer" }), { pasta_id: idPastaB });
  expect([403, 404, 422]).toContain(rd.status());
});
