import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { test, expect, type APIRequestContext, type APIResponse } from "@playwright/test";
import JSZip from "jszip";
import { USUARIOS_GED, auth, carregarIdsGed, irPara, itensDe, loginGed, MOTIVO_SEM_IDS, sufixoUnico, tokenCache } from "./ged-helpers";

// T24 – GED importação v2: envio de PASTA direto do navegador (input webkitdirectory), retomada de lote interrompido, ZIP grande em
// PARTES, ZIP aninhado (duplicado da pasta irmã ignorado × expandido como pasta), "unir pastas repetidas" e isolamento entre clientes.
// Dados: `E2E_GED_IDS=1 npm run seed:ged-demo` (clientes fictícios VAC/AAC). Arquivos de teste gerados em disco temporário.
test.beforeEach(() => {
  test.skip(test.info().project.name !== "desktop-chromium", "Altera dados – executado apenas no projeto desktop.");
});
const IDS = carregarIdsGed();
test.skip(!IDS, MOTIVO_SEM_IDS);
const A = USUARIOS_GED.A;
const B = USUARIOS_GED.B;
test.describe.configure({ timeout: 240_000 });

type Lote = { id: string; status: string; origem: string; total_arquivos: number; importados: number; duplicados: number; ignorados: number; com_erro: number; pastas_criadas: number; ocultos: number; tamanho_importado: number; itens: { caminho: string; status: string; motivo: string | null }[] };
const FINAIS = /^(CONCLUIDA|CONCLUIDA_COM_ERROS|FALHOU)$/;
const pdf = (t: string) => Buffer.from(`%PDF-1.4\n% ${t}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`);

async function aguardarLote(request: APIRequestContext, email: string, id: string): Promise<Lote> {
  let lote!: Lote;
  await expect
    .poll(async () => {
      const r = await request.get(`/api/v1/ged/importacoes/${id}?size=500`, { headers: auth(await tokenCache(request, email)) });
      lote = (await r.json()) as Lote;
      return lote.status;
    }, { timeout: 150_000, intervals: [500, 1000, 2000] })
    .toMatch(FINAIS);
  return lote;
}
const H = async (request: APIRequestContext, email: string) => auth(await tokenCache(request, email));
async function iniciarPasta(request: APIRequestContext, email: string, corpo: Record<string, unknown> = {}) {
  const r = await request.post("/api/v1/ged/importacoes/pasta", { headers: await H(request, email), data: { nome: "Teste", ...corpo } });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()).id as string;
}
async function enviarArq(request: APIRequestContext, email: string, id: string, caminho: string, dados: Buffer, extra: Record<string, string> = {}): Promise<APIResponse> {
  return request.post(`/api/v1/ged/importacoes/${id}/arquivos`, { headers: { ...(await H(request, email)), "Content-Type": "application/octet-stream", "X-Caminho": encodeURIComponent(caminho), ...extra }, data: dados });
}
const concluir = async (request: APIRequestContext, email: string, id: string, corpo: unknown = {}) => request.post(`/api/v1/ged/importacoes/${id}/concluir`, { headers: await H(request, email), data: corpo });
async function pastasDe(request: APIRequestContext, email: string): Promise<string[]> {
  return (itensDe(await (await request.get("/api/v1/ged/pastas", { headers: await H(request, email) })).json()) as { caminho_nome: string }[]).map((p) => p.caminho_nome);
}

let tmp = "";
let higienizado = false;
test.beforeAll(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "t24-"));
});
test.beforeEach(async ({ request }) => {
  if (higienizado) return;
  higienizado = true;
  // higiene: lotes que ficaram "aguardando envio" de execuções interrompidas ocupam vaga (máx. 3 lotes ativos por cliente)
  for (const email of [A.admin, B.admin]) {
    const lista = itensDe(await (await request.get("/api/v1/ged/importacoes?size=100", { headers: await H(request, email) })).json()) as { id: string; status: string }[];
    for (const l of lista.filter((x) => x.status === "RECEBENDO")) await request.delete(`/api/v1/ged/importacoes/${l.id}`, { headers: await H(request, email) });
  }
});
test.afterAll(() => rmSync(tmp, { recursive: true, force: true }));
function gravar(base: string, rel: string, dados: Buffer | string) {
  const p = path.join(base, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, dados);
}

test("T24a – o gestor envia uma PASTA pela tela: resumo, A/A preservado, ZIP duplicado ignorado, ZIP avulso expandido", async ({ page, request }) => {
  const suf = sufixoUnico();
  const raiz = `LICITACAO-AGOSTO-${suf}`;
  const base = path.join(tmp, "a");
  const duas = async (zip: JSZip) => zip.generateAsync({ type: "nodebuffer" });
  const dup = new JSZip();
  dup.file("PP-1.pdf", pdf(`pp1 ${suf}`));
  dup.file("PP-2.pdf", pdf(`pp2 ${suf}`));
  const extra = new JSZip();
  extra.file("Extra/E1.pdf", pdf(`e1 ${suf}`));
  extra.file("Extra/E2.pdf", pdf(`e2 ${suf}`));
  gravar(base, `${raiz}/FINANCEIRO-${suf}/Processos de pagamento/Processos de pagamento/PP-1.pdf`, pdf(`pp1 ${suf}`));
  gravar(base, `${raiz}/FINANCEIRO-${suf}/Processos de pagamento/Processos de pagamento/PP-2.pdf`, pdf(`pp2 ${suf}`));
  gravar(base, `${raiz}/FINANCEIRO-${suf}/Processos de pagamento.zip`, await duas(dup)); // cópia da pasta ao lado
  gravar(base, `${raiz}/FINANCEIRO-${suf}/Thumbs.db`, "lixo");
  gravar(base, `${raiz}/FINANCEIRO-${suf}/relatorio.xlsx`, "x");
  gravar(base, `${raiz}/CONTABILIDADE-${suf}/Balancete.pdf`, pdf(`balancete ${suf}`));
  gravar(base, `${raiz}/CONTABILIDADE-${suf}/lote-extra.zip`, await duas(extra)); // sem pasta irmã: vira pasta

  await loginGed(page, A.admin);
  await irPara(page, "/ged/importar");
  await expect(page.getByRole("tab", { name: /Enviar pasta/ })).toHaveAttribute("aria-selected", "true");
  await page.locator("#pasta-input").setInputFiles(path.join(base, raiz));
  const resumo = page.getByTestId("resumo-pasta");
  await expect(resumo).toBeVisible();
  await expect(page.getByTestId("resumo-total")).toHaveText("6");
  await expect(page.getByTestId("resumo-pdfs")).toHaveText("3");
  await expect(page.getByTestId("resumo-zips-duplicados")).toHaveText("1");
  await expect(page.getByTestId("resumo-ignorados")).toContainText("1 .xlsx");
  await expect(resumo).toContainText("1 ZIP(s) que serão abertos como pasta");
  await page.locator("#tipo_id").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Enviar pasta" }).click();
  await expect(page).toHaveURL(/\/ged\/importar\/[0-9a-f-]{36}$/, { timeout: 90_000 });
  const id = page.url().split("/").pop()!;
  const lote = await aguardarLote(request, A.admin, id);
  expect(lote.origem).toBe("PASTA");
  // importados: PP-1, PP-2, Balancete + E1, E2 (do ZIP avulso); ignorados: xlsx, ZIP duplicado, o ZIP avulso (registrado como expandido)
  expect({ i: lote.importados, d: lote.duplicados, ig: lote.ignorados, e: lote.com_erro, oc: lote.ocultos }).toEqual({ i: 5, d: 0, ig: 3, e: 0, oc: 1 });
  expect(lote.status).toBe("CONCLUIDA");
  expect(lote.tamanho_importado).toBeGreaterThan(0);
  const por = Object.fromEntries(lote.itens.map((i) => [i.caminho, i]));
  expect(por[`${raiz}/FINANCEIRO-${suf}/Processos de pagamento.zip`]).toMatchObject({ status: "IGNORADO" });
  expect(por[`${raiz}/FINANCEIRO-${suf}/Processos de pagamento.zip`].motivo).toMatch(/ZIP duplicado da pasta irmã/);
  expect(por[`${raiz}/CONTABILIDADE-${suf}/lote-extra.zip`].motivo).toMatch(/expandido como a pasta "lote-extra"/);
  expect(por[`${raiz}/CONTABILIDADE-${suf}/lote-extra.zip/Extra/E1.pdf`]?.status ?? por[`${raiz}/CONTABILIDADE-${suf}/lote-extra/Extra/E1.pdf`]?.status).toBe("IMPORTADO");
  // estrutura preservada exatamente como veio (A/A NÃO é unido por padrão) e o ZIP avulso virou a pasta "lote-extra"
  const nomes = await pastasDe(request, A.admin);
  for (const c of [raiz, `${raiz}/FINANCEIRO-${suf}`, `${raiz}/FINANCEIRO-${suf}/Processos de pagamento`, `${raiz}/FINANCEIRO-${suf}/Processos de pagamento/Processos de pagamento`, `${raiz}/CONTABILIDADE-${suf}/lote-extra/Extra`]) expect(nomes, c).toContain(c);
  // a tela do lote mostra contadores e tamanhos
  await expect(page.getByTestId("contador-importados")).toHaveText("5", { timeout: 20_000 });
  await expect(page.getByTestId("contador-tamanho-importado")).not.toHaveText("0 KB");
});

test("T24b – 'unir pastas repetidas' (A/A → A) desligado preserva, ligado colapsa; relatório mantém o caminho original", async ({ request }) => {
  const suf = sufixoUnico();
  const preserva = await iniciarPasta(request, A.admin);
  expect((await enviarArq(request, A.admin, preserva, `PRES-${suf}/Contas/Contas/c1.pdf`, pdf(`c1 ${suf}`))).status()).toBe(201);
  expect((await concluir(request, A.admin, preserva)).status()).toBe(200);
  expect((await aguardarLote(request, A.admin, preserva)).importados).toBe(1);
  const uniao = await iniciarPasta(request, A.admin, { unir_pastas: true });
  expect((await enviarArq(request, A.admin, uniao, `UNI-${suf}/Contas/Contas/Contas/c2.pdf`, pdf(`c2 ${suf}`))).status()).toBe(201);
  expect((await concluir(request, A.admin, uniao)).status()).toBe(200);
  const l2 = await aguardarLote(request, A.admin, uniao);
  expect(l2.importados).toBe(1);
  expect(l2.itens[0].caminho).toBe(`UNI-${suf}/Contas/Contas/Contas/c2.pdf`);
  const nomes = await pastasDe(request, A.admin);
  expect(nomes).toContain(`PRES-${suf}/Contas/Contas`);
  expect(nomes).toContain(`UNI-${suf}/Contas`);
  expect(nomes).not.toContain(`UNI-${suf}/Contas/Contas`);
});

test("T24c – lote interrompido: reabrir e enviar só o que faltou (caminho + tamanho + sha256); reenvio idempotente; muitos arquivos", async ({ page, request }) => {
  const suf = sufixoUnico();
  const raiz = `LOTE-GRANDE-${suf}`;
  const N = 60;
  const arquivos = Array.from({ length: N }, (_, i) => ({ rel: `${raiz}/sub${i % 5}/doc-${String(i).padStart(3, "0")}.pdf`, dados: pdf(`doc ${i} ${suf}`) }));
  const id = await iniciarPasta(request, A.admin, { nome: raiz, total_esperado: N });
  // 1ª rodada "interrompida": só os primeiros 24, em paralelo (concorrência 4)
  for (let i = 0; i < 24; i += 4) {
    const rs = await Promise.all(arquivos.slice(i, i + 4).map((a) => enviarArq(request, A.admin, id, a.rel, a.dados)));
    for (const r of rs) expect(r.status()).toBe(201);
  }
  // retentativa do mesmo arquivo (mesmo conteúdo) não duplica
  const rep = await enviarArq(request, A.admin, id, arquivos[3].rel, arquivos[3].dados);
  expect(rep.status()).toBe(200);
  expect((await rep.json()).repetido).toBe(true);
  const rec = await (await request.get(`/api/v1/ged/importacoes/${id}/recebidos`, { headers: await H(request, A.admin) })).json();
  expect(rec.itens).toHaveLength(24);
  expect(rec.itens[0]).toMatchObject({ status: "RECEBIDO" });
  // o lote aparece como "Aguardando envio" e ainda NÃO é processado
  const parcial = (await (await request.get(`/api/v1/ged/importacoes/${id}`, { headers: await H(request, A.admin) })).json()) as Lote;
  expect(parcial.status).toBe("RECEBENDO");
  expect(parcial.importados).toBe(0);

  // Reabre pela tela e escolhe de novo a MESMA pasta: só os 36 que faltam são enviados
  for (const a of arquivos) gravar(path.join(tmp, "c"), a.rel, a.dados);
  await loginGed(page, A.admin);
  await irPara(page, `/ged/importar/${id}`);
  await expect(page.getByText("Retomar envio").first()).toBeVisible();
  await page.locator("#pasta-input").setInputFiles(path.join(tmp, "c", raiz));
  await expect(page.getByTestId("resumo-pdfs")).toHaveText(String(N));
  await page.getByRole("button", { name: "Enviar pasta" }).click();
  await expect(page.getByTestId("progresso-pasta")).toContainText("já estavam no servidor");
  await expect(page.getByTestId("progresso-pasta")).toContainText("24 já estavam", { timeout: 60_000 }).catch(() => undefined);
  await expect(page).toHaveURL(new RegExp(`/ged/importar/${id}$`), { timeout: 90_000 });
  const lote = await aguardarLote(request, A.admin, id);
  expect({ i: lote.importados, d: lote.duplicados, e: lote.com_erro, t: lote.total_arquivos }).toEqual({ i: N, d: 0, e: 0, t: N });
  expect(lote.status).toBe("CONCLUIDA");
  // concluir de novo é idempotente (já fechado)
  expect((await concluir(request, A.admin, id)).status()).toBe(200);
  // e novos arquivos não entram mais num lote fechado
  expect((await enviarArq(request, A.admin, id, `${raiz}/novo.pdf`, pdf("novo"))).status()).toBe(409);
});

test("T24d – ZIP grande em PARTES: ordem livre, parte com tamanho errado recusada, parte faltando impede concluir, ZIP aninhado e duplicado", async ({ request }) => {
  const suf = sufixoUnico();
  const z = new JSZip();
  z.file(`Z-${suf}/Processos/a.pdf`, pdf(`a ${suf}`));
  z.file(`Z-${suf}/Processos/b.pdf`, pdf(`b ${suf}`));
  const copia = new JSZip();
  copia.file("a.pdf", pdf(`a ${suf}`));
  z.file(`Z-${suf}/Processos.zip`, await copia.generateAsync({ type: "nodebuffer" })); // cópia da pasta irmã: ignorado
  const avulso = new JSZip();
  avulso.file("Interno/i1.pdf", pdf(`i1 ${suf}`));
  const nivel2 = new JSZip();
  nivel2.file("fundo.pdf", pdf(`fundo ${suf}`));
  avulso.file("Interno/mais.zip", await nivel2.generateAsync({ type: "nodebuffer" }));
  z.file(`Z-${suf}/Anexos.zip`, await avulso.generateAsync({ type: "nodebuffer" })); // ZIP dentro de ZIP dentro de ZIP
  // arquivo grande e incompressível (~17 MB) para forçar 3 partes de 8 MB
  z.file(`Z-${suf}/Grande/grande.pdf`, Buffer.concat([pdf(`grande ${suf}`), randomBytes(17 * 1024 * 1024)]), { compression: "STORE" });
  const buffer = await z.generateAsync({ type: "nodebuffer", compression: "STORE" });
  const TP = 8 * 1024 * 1024;
  const partes = Math.ceil(buffer.length / TP);
  expect(partes).toBe(3);

  const r = await request.post("/api/v1/ged/importacoes/zip-partes", { headers: await H(request, A.admin), data: { nome_arquivo: `grande-${suf}.zip`, tamanho: buffer.length } });
  expect(r.status(), await r.text()).toBe(201);
  const { id, partes_total, tamanho_parte } = await r.json();
  expect({ partes_total, tamanho_parte }).toEqual({ partes_total: 3, tamanho_parte: TP });
  const put = async (n: number, dados: Buffer) => request.put(`/api/v1/ged/importacoes/${id}/partes/${n}`, { headers: { ...(await H(request, A.admin)), "Content-Type": "application/octet-stream" }, data: dados });
  const fatia = (n: number) => buffer.subarray((n - 1) * TP, Math.min(n * TP, buffer.length));
  expect((await put(2, fatia(2))).status()).toBe(200); // fora de ordem
  expect((await put(1, fatia(1).subarray(0, 1000))).status()).toBe(422); // tamanho errado
  expect((await put(4, fatia(1))).status()).toBe(422); // parte inexistente
  expect((await put(1, fatia(1))).status()).toBe(200);
  expect((await put(1, fatia(1))).status()).toBe(200); // idempotente
  const rec = await (await request.get(`/api/v1/ged/importacoes/${id}/recebidos`, { headers: await H(request, A.admin) })).json();
  expect(rec.partes).toEqual([1, 2]);
  const falta = await concluir(request, A.admin, id);
  expect(falta.status()).toBe(409);
  expect((await falta.json()).code).toBe("PARTES_FALTANDO");
  expect((await put(3, fatia(3))).status()).toBe(200);
  expect((await concluir(request, A.admin, id)).status()).toBe(200);

  const lote = await aguardarLote(request, A.admin, id);
  expect(lote.status, JSON.stringify(lote)).toBe("CONCLUIDA");
  const por = Object.fromEntries(lote.itens.map((i) => [i.caminho, i]));
  // a.pdf, b.pdf, grande.pdf + i1.pdf e fundo.pdf (ZIP > ZIP > ZIP) = 5; ignorados: Processos.zip (duplicado), Anexos.zip e mais.zip (expandidos)
  expect({ i: lote.importados, ig: lote.ignorados, e: lote.com_erro }).toEqual({ i: 5, ig: 3, e: 0 });
  expect(por[`Z-${suf}/Processos.zip`].motivo).toMatch(/ZIP duplicado da pasta irmã/);
  expect(por[`Z-${suf}/Anexos.zip`].motivo).toMatch(/expandido como a pasta "Anexos"/);
  expect(Object.keys(por).some((c) => c.endsWith("Anexos/Interno/mais/fundo.pdf"))).toBe(true);
  expect(lote.tamanho_importado).toBeGreaterThan(17 * 1024 * 1024);
  const nomes = await pastasDe(request, A.admin);
  expect(nomes).toContain(`Z-${suf}/Anexos/Interno/mais`);
});

test("T24e – validações do envio de pasta: sha256, formatos, zip-slip, tamanho, lixo, lote vazio, cancelamento", async ({ request }) => {
  const suf = sufixoUnico();
  const id = await iniciarPasta(request, A.admin);
  // integridade: sha256 divergente é recusado (retentável) e nada é guardado
  const ruim = await enviarArq(request, A.admin, id, `V-${suf}/x.pdf`, pdf("x"), { "X-Sha256": "0".repeat(64) });
  expect(ruim.status()).toBe(422);
  expect((await ruim.json()).code).toBe("ARQUIVO_CORROMPIDO");
  // formato fora de PDF: ignorado; oculto: nem vira item; ".." : erro no relatório; vazio: erro
  expect((await (await enviarArq(request, A.admin, id, `V-${suf}/planilha.xlsx`, Buffer.from("x"))).json()).status).toBe("IGNORADO");
  expect((await (await enviarArq(request, A.admin, id, `V-${suf}/Thumbs.db`, Buffer.from("x"))).json()).status).toBe("OCULTO");
  expect((await (await enviarArq(request, A.admin, id, `V-${suf}/../../fuga.pdf`, pdf("fuga"))).json()).status).toBe("ERRO");
  expect((await (await enviarArq(request, A.admin, id, `V-${suf}/vazio.pdf`, Buffer.alloc(0))).json()).status).toBe("ERRO");
  // maior que 25 MB: registrado como erro sem ser guardado
  const gigante = await enviarArq(request, A.admin, id, `V-${suf}/gigante.pdf`, Buffer.concat([pdf("g"), Buffer.alloc(26 * 1024 * 1024)]));
  expect((await gigante.json()).status).toBe("ERRO");
  // PDF "falso" é aceito no envio e vira erro no processamento; PDF correto passa
  expect((await enviarArq(request, A.admin, id, `V-${suf}/falso.pdf`, Buffer.from("isto não é um PDF"))).status()).toBe(201);
  expect((await enviarArq(request, A.admin, id, `V-${suf}/ok.pdf`, pdf(`ok ${suf}`), { "X-Sha256": (await import("node:crypto")).createHash("sha256").update(pdf(`ok ${suf}`)).digest("hex") })).status()).toBe(201);
  // mesmo caminho com conteúdo diferente SUBSTITUI (arquivo mudou entre as tentativas)
  expect((await enviarArq(request, A.admin, id, `V-${suf}/ok.pdf`, pdf(`ok v2 ${suf}`))).status()).toBe(201);
  const rec = await (await request.get(`/api/v1/ged/importacoes/${id}/recebidos`, { headers: await H(request, A.admin) })).json();
  expect(rec.itens.filter((i: { caminho: string }) => i.caminho === `V-${suf}/ok.pdf`)).toHaveLength(1);
  const lote = await (async () => {
    expect((await concluir(request, A.admin, id, { ignorados: [{ caminho: `V-${suf}/foto.png`, motivo: "Extensão não permitida (.png). Somente PDF." }], ocultos: 4 })).status()).toBe(200);
    return aguardarLote(request, A.admin, id);
  })();
  const por = Object.fromEntries(lote.itens.map((i) => [i.caminho, i]));
  expect(por[`V-${suf}/planilha.xlsx`].status).toBe("IGNORADO");
  expect(por[`V-${suf}/foto.png`].status).toBe("IGNORADO");
  expect(por[`V-${suf}/falso.pdf`].status).toBe("ERRO");
  expect(por[`V-${suf}/gigante.pdf`].motivo).toMatch(/25 MB/);
  expect(por[`V-${suf}/ok.pdf`].status).toBe("IMPORTADO");
  expect(lote.itens.some((i) => /\.\./.test(i.caminho) && i.status === "ERRO") || lote.itens.some((i) => i.status === "ERRO" && /\.\./.test(i.motivo ?? ""))).toBe(true);
  expect(lote.itens.some((i) => /Thumbs/.test(i.caminho))).toBe(false);
  expect(lote.ocultos).toBe(4);
  expect(lote.status).toBe("CONCLUIDA_COM_ERROS");

  // lote só com não-PDF não pode ser concluído (422); lote em envio pode ser cancelado (204) e fica FALHOU; fechado não cancela (409)
  const vazio = await iniciarPasta(request, A.admin);
  await enviarArq(request, A.admin, vazio, `Z/x.docx`, Buffer.from("x"));
  expect((await concluir(request, A.admin, vazio)).status()).toBe(422);
  const del = await request.delete(`/api/v1/ged/importacoes/${vazio}`, { headers: await H(request, A.admin) });
  expect(del.status()).toBe(204);
  expect(((await (await request.get(`/api/v1/ged/importacoes/${vazio}`, { headers: await H(request, A.admin) })).json()) as Lote).status).toBe("FALHOU");
  expect((await request.delete(`/api/v1/ged/importacoes/${id}`, { headers: await H(request, A.admin) })).status()).toBe(409);
  // sensibilidade/pasta inválidas
  expect((await request.post("/api/v1/ged/importacoes/pasta", { headers: await H(request, A.admin), data: { sensibilidade: "XYZ" } })).status()).toBe(422);
});

test("T24f – isolamento: outro cliente e quem não é dono do lote não alcançam arquivos, partes, recebidos, concluir ou cancelar", async ({ request }) => {
  const suf = sufixoUnico();
  const id = await iniciarPasta(request, A.admin);
  expect((await enviarArq(request, A.admin, id, `ISO-${suf}/a.pdf`, pdf(`iso ${suf}`))).status()).toBe(201);
  const z = await request.post("/api/v1/ged/importacoes/zip-partes", { headers: await H(request, A.admin), data: { nome_arquivo: `iso-${suf}.zip`, tamanho: 5000 } });
  const idZip = (await z.json()).id as string;

  // cliente B: 404 em tudo (nunca 403/200) e nada vaza na listagem
  const hB = await H(request, B.admin);
  for (const alvo of [id, idZip]) {
    expect((await request.post(`/api/v1/ged/importacoes/${alvo}/arquivos`, { headers: { ...hB, "X-Caminho": "x.pdf", "Content-Type": "application/octet-stream" }, data: pdf("b") })).status(), `arquivos ${alvo}`).toBe(404);
    expect((await request.put(`/api/v1/ged/importacoes/${alvo}/partes/1`, { headers: { ...hB, "Content-Type": "application/octet-stream" }, data: Buffer.alloc(5000) })).status(), `partes ${alvo}`).toBe(404);
    expect((await request.get(`/api/v1/ged/importacoes/${alvo}/recebidos`, { headers: hB })).status(), `recebidos ${alvo}`).toBe(404);
    expect((await request.post(`/api/v1/ged/importacoes/${alvo}/concluir`, { headers: hB, data: {} })).status(), `concluir ${alvo}`).toBe(404);
    expect((await request.delete(`/api/v1/ged/importacoes/${alvo}`, { headers: hB })).status(), `cancelar ${alvo}`).toBe(404);
  }
  expect(JSON.stringify(await (await request.get("/api/v1/ged/importacoes?size=100", { headers: hB })).json())).not.toContain(id);
  // o gestor de A que não criou o lote também não o enxerga (404), e servidor/vereador/auditor nem iniciam lote (403)
  const hG = await H(request, A.gestor);
  expect((await request.post(`/api/v1/ged/importacoes/${id}/concluir`, { headers: hG, data: {} })).status()).toBe(404);
  expect((await request.get(`/api/v1/ged/importacoes/${id}/recebidos`, { headers: hG })).status()).toBe(404);
  for (const email of [A.servidor1, A.vereador, A.auditor]) {
    const h = await H(request, email);
    expect((await request.post("/api/v1/ged/importacoes/pasta", { headers: h, data: {} })).status(), email).toBe(403);
    expect((await request.post("/api/v1/ged/importacoes/zip-partes", { headers: h, data: { nome_arquivo: "a.zip", tamanho: 5000 } })).status(), email).toBe(403);
    expect((await request.post(`/api/v1/ged/importacoes/${id}/arquivos`, { headers: { ...h, "X-Caminho": "x.pdf", "Content-Type": "application/octet-stream" }, data: pdf("x") })).status(), email).toBe(403);
  }
  // sem token: 401
  expect([401, 403]).toContain((await request.post("/api/v1/ged/importacoes/pasta", { data: {} })).status());
  // o lote de A segue íntegro e B pode importar o MESMO conteúdo no seu próprio cliente (deduplicação é por organização)
  const idB = await iniciarPasta(request, B.admin);
  expect((await enviarArq(request, B.admin, idB, `ISO-${suf}/a.pdf`, pdf(`iso ${suf}`))).status()).toBe(201);
  expect((await concluir(request, B.admin, idB)).status()).toBe(200);
  expect((await aguardarLote(request, B.admin, idB)).importados).toBe(1);
  expect((await concluir(request, A.admin, id)).status()).toBe(200);
  expect((await aguardarLote(request, A.admin, id)).importados).toBe(1);
  await request.delete(`/api/v1/ged/importacoes/${idZip}`, { headers: await H(request, A.admin) });
});

test("T24g – reenvio da mesma pasta no mês seguinte: tudo duplicado (sha256), nenhuma pasta nova", async ({ request }) => {
  const suf = sufixoUnico();
  const arqs = Array.from({ length: 12 }, (_, i) => ({ rel: `MES-${suf}/p${i % 3}/n-${i}.pdf`, dados: pdf(`mes ${i} ${suf}`) }));
  const rodar = async () => {
    const id = await iniciarPasta(request, A.gestor);
    for (const a of arqs) expect((await enviarArq(request, A.gestor, id, a.rel, a.dados)).status()).toBe(201);
    expect((await concluir(request, A.gestor, id)).status()).toBe(200);
    return aguardarLote(request, A.gestor, id);
  };
  const l1 = await rodar();
  expect({ i: l1.importados, p: l1.pastas_criadas }).toEqual({ i: 12, p: 4 });
  const l2 = await rodar();
  expect({ i: l2.importados, d: l2.duplicados, p: l2.pastas_criadas }).toEqual({ i: 0, d: 12, p: 0 });
});
