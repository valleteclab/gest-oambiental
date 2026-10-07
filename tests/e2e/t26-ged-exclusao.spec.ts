import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { test, expect, type APIRequestContext, type APIResponse } from "@playwright/test";
import { USUARIOS_GED, auth, carregarIdsGed, criarDocumentoApi, gerarPdf, irPara, itensDe, loginGed, MOTIVO_SEM_IDS, submeter, sufixoUnico, tokenCache } from "./ged-helpers";

// T26 – GED: EXCLUSÃO CONTROLADA (documento, pasta com subárvore, lote de importação), docs/ged.md §17.
// Importa uma pasta por API, exclui o lote e confere que sumiu (documentos, pastas, arquivos, busca), reimporta o MESMO conteúdo
// (dedup por sha256 não pode impedir depois da exclusão), documentos com trâmite/comentário/assinatura são bloqueados com motivo,
// papéis sem permissão (403), outro cliente (404) e auditoria. Dados: `E2E_GED_IDS=1 npm run seed:ged-demo` (clientes VAC/AAC).
test.beforeEach(() => {
  test.skip(test.info().project.name !== "desktop-chromium", "Altera dados – executado apenas no projeto desktop.");
});
const IDS = carregarIdsGed();
test.skip(!IDS, MOTIVO_SEM_IDS);
const A = USUARIOS_GED.A;
const B = USUARIOS_GED.B;
test.describe.configure({ timeout: 240_000 });

const H = async (request: APIRequestContext, email: string) => auth(await tokenCache(request, email));
const pdf = (t: string) => Buffer.from(`%PDF-1.4\n% ${t}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`);
const FINAIS = /^(CONCLUIDA|CONCLUIDA_COM_ERROS|FALHOU)$/;
const suf = sufixoUnico();

type Lote = { id: string; status: string; importados: number; duplicados: number; pastas_criadas: number; conteudo_excluido_em: string | null; itens: { caminho: string; status: string; documento_id: string | null; motivo: string | null }[] };

async function importar(request: APIRequestContext, email: string, arquivos: { rel: string; dados: Buffer }[], extra: Record<string, unknown> = {}): Promise<Lote> {
  const h = await H(request, email);
  const r = await request.post("/api/v1/ged/importacoes/pasta", { headers: h, data: { nome: "Teste", total_esperado: arquivos.length, ...extra } });
  expect(r.status(), await r.text()).toBe(201);
  const id = (await r.json()).id as string;
  for (let i = 0; i < arquivos.length; i += 4) {
    const rs = await Promise.all(arquivos.slice(i, i + 4).map((a) => request.post(`/api/v1/ged/importacoes/${id}/arquivos`, { headers: { ...h, "Content-Type": "application/octet-stream", "X-Caminho": encodeURIComponent(a.rel) }, data: a.dados })));
    for (const x of rs) expect(x.status(), await x.text()).toBe(201);
  }
  expect((await request.post(`/api/v1/ged/importacoes/${id}/concluir`, { headers: h, data: {} })).status()).toBe(200);
  let lote!: Lote;
  await expect
    .poll(async () => {
      lote = (await (await request.get(`/api/v1/ged/importacoes/${id}?size=500`, { headers: h })).json()) as Lote;
      return lote.status;
    }, { timeout: 150_000, intervals: [500, 1000, 2000] })
    .toMatch(FINAIS);
  return lote;
}

const corpoErro = async (r: APIResponse) => (await r.json().catch(() => ({}))) as { code?: string; message?: string; details?: Record<string, unknown> & { bloqueados?: { numero: string | null; motivos: string[] }[]; bloqueados_total?: number } };
async function pastasDe(request: APIRequestContext, email: string): Promise<{ id: string; caminho_nome: string }[]> {
  return itensDe(await (await request.get("/api/v1/ged/pastas", { headers: await H(request, email) })).json()) as { id: string; caminho_nome: string }[];
}
const existeDoc = async (request: APIRequestContext, email: string, id: string) => (await request.get(`/api/v1/ged/documentos/${id}`, { headers: await H(request, email) })).status() === 200;
async function buscaTitulos(request: APIRequestContext, email: string, q: string) {
  return itensDe(await (await request.get(`/api/v1/ged/documentos?q=${encodeURIComponent(q)}`, { headers: await H(request, email) })).json()) as { id: string; titulo: string }[];
}
/** Arquivos que o documento ainda tem no storage local (null = storage não acessível a este teste). */
function arquivosNoStorage(docId: string): number | null {
  // O servidor pode rodar de outro diretório (standalone na CI: .next/standalone/storage); soma os candidatos.
  const dir = process.env.STORAGE_LOCAL_DIR || "./storage";
  const bases = [path.resolve(dir), path.resolve(".next/standalone", dir)].map((d) => path.join(d, "ged", IDS!.A.organizacao_id)).filter((b) => existsSync(b));
  if (!bases.length) return null;
  let n = 0;
  for (const base of bases) {
    for (const ano of readdirSync(base).filter((x) => /^\d{4}$/.test(x))) {
      const d = path.join(base, ano, docId);
      if (existsSync(d)) n += readdirSync(d).length;
    }
  }
  return n;
}

const raiz = `EXC-${suf}`;
const ARQ = [
  { rel: `${raiz}/Financeiro/Empenhos/emp-1.pdf`, dados: pdf(`emp1 ${suf}`) },
  { rel: `${raiz}/Financeiro/Empenhos/emp-2.pdf`, dados: pdf(`emp2 ${suf}`) },
  { rel: `${raiz}/Financeiro/balanco.pdf`, dados: pdf(`balanco ${suf}`) },
  { rel: `${raiz}/Contratos/contrato-1.pdf`, dados: pdf(`contrato1 ${suf}`) },
];
let lote1!: Lote;
let docsLote: string[] = [];

test.describe.serial("T26 – exclusão controlada", () => {
  test("T26a – importa uma pasta pequena (lote) e confere a árvore criada", async ({ request }) => {
    lote1 = await importar(request, A.admin, ARQ);
    expect({ i: lote1.importados, d: lote1.duplicados }).toEqual({ i: 4, d: 0 });
    expect(lote1.pastas_criadas).toBe(4); // raiz, Financeiro, Empenhos, Contratos
    const nomes = (await pastasDe(request, A.admin)).map((p) => p.caminho_nome);
    for (const c of [raiz, `${raiz}/Financeiro`, `${raiz}/Financeiro/Empenhos`, `${raiz}/Contratos`]) expect(nomes).toContain(c);
    docsLote = lote1.itens.filter((i) => i.status === "IMPORTADO").map((i) => i.documento_id!);
    expect(docsLote).toHaveLength(4);
    for (const id of docsLote) expect(await existeDoc(request, A.admin, id)).toBe(true);
    // baixar o arquivo gera um registro em ged_acesso_log, que NÃO pode ser apagado pela exclusão (conferido em T26e)
    expect((await request.get(`/api/v1/ged/documentos/${docsLote[0]}/arquivo`, { headers: await H(request, A.admin) })).status()).toBe(200);
    const antes = arquivosNoStorage(docsLote[0]);
    if (antes !== null) expect(antes).toBeGreaterThan(0);
  });

  test("T26b – sem permissão: Usuário, Leitor e Auditor recebem 403; outro cliente recebe 404; confirmação errada não apaga nada", async ({ request }) => {
    for (const email of [A.servidor1, A.vereador, A.auditor]) {
      const h = await H(request, email);
      expect((await request.get(`/api/v1/ged/importacoes/${lote1.id}/excluir`, { headers: h })).status(), `${email} GET lote`).toBe(403);
      expect((await request.post(`/api/v1/ged/importacoes/${lote1.id}/excluir`, { headers: h, data: { confirmacao: "EXCLUIR" } })).status(), `${email} POST lote`).toBe(403);
      expect((await request.delete(`/api/v1/ged/documentos/${docsLote[0]}`, { headers: h, data: { confirmacao: "EXCLUIR" } })).status(), `${email} DELETE doc`).toBe(403);
      expect((await request.get(`/api/v1/ged/exclusoes`, { headers: h })).status(), `${email} lista`).toBe(403);
    }
    // gestor de outro cliente (B): 404 em tudo, sem revelar nada
    const hb = await H(request, B.admin);
    const pastaA = (await pastasDe(request, A.admin)).find((p) => p.caminho_nome === raiz)!.id;
    for (const [m, url] of [["get", `/api/v1/ged/importacoes/${lote1.id}/excluir`], ["get", `/api/v1/ged/pastas/${pastaA}/excluir`], ["get", `/api/v1/ged/documentos/${docsLote[0]}/excluir`]] as const) {
      expect((await request[m](url, { headers: hb })).status(), url).toBe(404);
    }
    expect((await request.post(`/api/v1/ged/pastas/${pastaA}/excluir`, { headers: hb, data: { confirmacao: raiz } })).status()).toBe(404);
    expect((await request.delete(`/api/v1/ged/documentos/${docsLote[0]}`, { headers: hb, data: { confirmacao: "EXCLUIR" } })).status()).toBe(404);
    expect((await request.delete(`/api/v1/ged/importacoes/${lote1.id}?documentos=true`, { headers: hb, data: { confirmacao: "EXCLUIR" } })).status()).toBe(404);
    // confirmação ausente/errada: 422 e nada some
    const ha = await H(request, A.admin);
    expect((await request.post(`/api/v1/ged/importacoes/${lote1.id}/excluir`, { headers: ha, data: {} })).status()).toBe(422);
    expect((await request.post(`/api/v1/ged/pastas/${pastaA}/excluir`, { headers: ha, data: { confirmacao: "excluir" } })).status()).toBe(422);
    expect((await request.post(`/api/v1/ged/pastas/${pastaA}/excluir`, { headers: ha, data: { confirmacao: raiz.toLowerCase() } })).status()).toBe(422);
    for (const id of docsLote) expect(await existeDoc(request, A.admin, id)).toBe(true);
    expect((await pastasDe(request, A.admin)).map((p) => p.caminho_nome)).toContain(raiz);
  });

  test("T26c – pré-visualização do lote: documentos, versões, MB e pastas; nada é alterado", async ({ request }) => {
    const r = await request.get(`/api/v1/ged/importacoes/${lote1.id}/excluir`, { headers: await H(request, A.admin) });
    expect(r.status(), await r.text()).toBe(200);
    const { plano } = (await r.json()) as { plano: { documentos_excluiveis: number; versoes: number; bytes: number; pastas_removiveis: number; bloqueados_total: number; confirmacao_esperada: string; sincrono: boolean } };
    expect(plano).toMatchObject({ documentos_excluiveis: 4, versoes: 4, pastas_removiveis: 4, bloqueados_total: 0, confirmacao_esperada: "EXCLUIR", sincrono: true });
    expect(plano.bytes).toBeGreaterThan(0);
    for (const id of docsLote) expect(await existeDoc(request, A.admin, id)).toBe(true);
  });

  test("T26d – excluir o lote: documentos, pastas, arquivos e busca somem; relatório e auditoria permanecem", async ({ request }) => {
    const ha = await H(request, A.admin);
    const r = await request.delete(`/api/v1/ged/importacoes/${lote1.id}?documentos=true`, { headers: ha, data: { confirmacao: "EXCLUIR" } });
    expect(r.status(), await r.text()).toBe(200);
    const j = (await r.json()) as { exclusao: { id: string; status: string; documentos_excluidos: number; pastas_excluidas: number; versoes_excluidas: number; bytes_excluidos: number } };
    expect(j.exclusao).toMatchObject({ status: "CONCLUIDA", documentos_excluidos: 4, pastas_excluidas: 4, versoes_excluidas: 4 });
    expect(j.exclusao.bytes_excluidos).toBeGreaterThan(0);

    for (const id of docsLote) {
      expect(await existeDoc(request, A.admin, id), "documento sumiu").toBe(false);
      const sobra = arquivosNoStorage(id);
      if (sobra !== null) expect(sobra, "arquivos do documento removidos do storage").toBe(0);
      expect((await request.get(`/api/v1/ged/documentos/${id}/arquivo`, { headers: ha })).status()).toBe(404);
    }
    const nomes = (await pastasDe(request, A.admin)).map((p) => p.caminho_nome);
    expect(nomes.filter((n) => n === raiz || n.startsWith(`${raiz}/`))).toEqual([]);
    expect(await buscaTitulos(request, A.admin, "emp-1")).toEqual([]);

    // o relatório do lote continua, com os itens marcados como removidos e sem link para o documento
    const lote = (await (await request.get(`/api/v1/ged/importacoes/${lote1.id}?size=500`, { headers: ha })).json()) as Lote;
    expect(lote.conteudo_excluido_em).toBeTruthy();
    expect(lote.itens.filter((i) => i.status === "REMOVIDO")).toHaveLength(4);
    expect(lote.itens.every((i) => i.documento_id === null)).toBe(true);
    // acompanhamento: GET da execução
    const ex = await request.get(`/api/v1/ged/exclusoes/${j.exclusao.id}`, { headers: ha });
    expect(ex.status()).toBe(200);
    expect(await ex.json()).toMatchObject({ status: "CONCLUIDA", percentual: 100 });
    expect((await request.get(`/api/v1/ged/exclusoes/${j.exclusao.id}`, { headers: await H(request, B.admin) })).status()).toBe(404);
    // nada a excluir de novo
    expect((await request.post(`/api/v1/ged/importacoes/${lote1.id}/excluir`, { headers: ha, data: { confirmacao: "EXCLUIR" } })).status()).toBe(409);
  });

  test("T26e – auditoria: um evento por documento e por pasta, mais o resumo; logs de acesso preservados", async ({ request }) => {
    const ha = await H(request, A.admin);
    const alt = (await (await request.get("/api/v1/ged/logs?aba=alteracoes&acao=EXCLU", { headers: ha })).json()) as { itens: { acao: string; entidade: string; entidade_id: string | null; antes: { campo: string; valor: string }[]; usuario: string | null }[] };
    const excl = alt.itens.filter((i) => i.acao === "GED_DOCUMENTO_EXCLUIDO" && docsLote.includes(i.entidade_id ?? ""));
    expect(excl).toHaveLength(4);
    const campos = Object.fromEntries(excl[0].antes.map((c) => [c.campo, c.valor]));
    expect(Object.keys(campos)).toEqual(expect.arrayContaining(["numero", "titulo", "caminho", "sha256"]));
    expect(excl[0].usuario).toBeTruthy();
    expect(alt.itens.filter((i) => i.acao === "GED_PASTA_EXCLUIDA").length).toBeGreaterThanOrEqual(4);
    expect(alt.itens.some((i) => i.acao === "GED_EXCLUSAO_CONCLUIDA")).toBe(true);
    // consultar por documento excluído ainda acha o histórico (auditoria imutável)
    const porDoc = (await (await request.get(`/api/v1/ged/logs?aba=alteracoes&documento=${docsLote[0]}`, { headers: ha })).json()) as { itens: { acao: string }[] };
    expect(porDoc.itens.map((i) => i.acao)).toEqual(expect.arrayContaining(["GED_DOCUMENTO_CRIADO", "GED_DOCUMENTO_EXCLUIDO"]));
    // o log de acesso do documento NÃO foi apagado
    const ac = (await (await request.get(`/api/v1/ged/logs?aba=acessos&documento=${docsLote[0]}`, { headers: ha })).json()) as { itens: { documento_numero: string | null }[] };
    expect(ac.itens.length).toBeGreaterThan(0);
    expect(ac.itens[0].documento_numero).toMatch(/\(excluído\)$/);
  });

  test("T26f – reimportar o MESMO conteúdo funciona (dedup por sha256 não impede depois da exclusão)", async ({ request }) => {
    const l2 = await importar(request, A.admin, ARQ);
    expect({ i: l2.importados, d: l2.duplicados }).toEqual({ i: 4, d: 0 });
    const nomes = (await pastasDe(request, A.admin)).map((p) => p.caminho_nome);
    expect(nomes).toContain(`${raiz}/Financeiro/Empenhos`);
    lote1 = l2;
    docsLote = l2.itens.filter((i) => i.status === "IMPORTADO").map((i) => i.documento_id!);
  });

  test("T26g – valor jurídico NÃO se exclui: comentário, trâmite e assinatura bloqueiam com motivo; tudo-ou-nada × apenas os que podem", async ({ request }) => {
    const ha = await H(request, A.admin);
    const tk = await tokenCache(request, A.admin);
    const nome = `BLOQ-${suf}`;
    const pasta = (await (await request.post("/api/v1/ged/pastas", { headers: ha, data: { nome } })).json()).id as string;
    const livre = await criarDocumentoApi(request, tk, { titulo: `Livre ${suf}`, pasta_id: pasta, pdf: await gerarPdf(["livre", suf]) });
    const comCom = await criarDocumentoApi(request, tk, { titulo: `Com comentario ${suf}`, pasta_id: pasta, pdf: await gerarPdf(["com", suf]) });
    const comTram = await criarDocumentoApi(request, tk, { titulo: `Com tramite ${suf}`, pasta_id: pasta, pdf: await gerarPdf(["tram", suf]) });
    const comAss = await criarDocumentoApi(request, tk, { titulo: `Com assinatura ${suf}`, pasta_id: pasta, pdf: await gerarPdf(["ass", suf]) });
    expect((await request.post("/api/v1/ged/comentarios", { headers: ha, data: { documento_id: comCom.id, texto: "Registro imutável" } })).status()).toBe(201);
    expect((await request.post(`/api/v1/ged/tramite/${comTram.id}`, { headers: ha, data: { acao: "ENVIAR", destino: { tipo: "USUARIO", id: IDS!.A.usuarios[A.servidor1] }, despacho: "para análise" } })).status()).toBe(201);
    const sol = await request.post("/api/v1/ged/assinaturas", { headers: ha, data: { documento_id: comAss.id, signatarios: [IDS!.A.usuarios[A.gestor]], modo: "PARALELO", mensagem: "assinar" } });
    expect(sol.status(), await sol.text()).toBe(201);

    // documento isolado com comentário: 409 com o motivo
    const d1 = await request.delete(`/api/v1/ged/documentos/${comCom.id}`, { headers: ha, data: { confirmacao: "EXCLUIR" } });
    expect(d1.status()).toBe(409);
    const e1 = await corpoErro(d1);
    expect(e1.code).toBe("EXCLUSAO_BLOQUEADA");
    expect(e1.details?.bloqueados?.[0].motivos).toContain("COMENTARIO");
    expect(e1.message).toMatch(/valor jurídico/);
    expect(await existeDoc(request, A.admin, comCom.id)).toBe(true);

    // pasta (tudo-ou-nada): bloqueia os três, lista com número/título e NÃO apaga nem o documento livre
    const p1 = await request.post(`/api/v1/ged/pastas/${pasta}/excluir`, { headers: ha, data: { confirmacao: nome } });
    expect(p1.status()).toBe(409);
    const e2 = await corpoErro(p1);
    expect(e2.details?.bloqueados_total).toBe(3);
    const motivos = (e2.details?.bloqueados ?? []).flatMap((b) => b.motivos);
    expect(motivos).toEqual(expect.arrayContaining(["COMENTARIO", "TRAMITE", "ASSINATURA"]));
    expect((e2.details?.bloqueados ?? []).every((b) => !!b.numero)).toBe(true);
    expect(await existeDoc(request, A.admin, livre.id)).toBe(true);
    expect((await pastasDe(request, A.admin)).some((p) => p.caminho_nome === nome)).toBe(true);

    // opção explícita: apaga só o livre, mantém os 3 e a pasta que os contém
    const p2 = await request.post(`/api/v1/ged/pastas/${pasta}/excluir`, { headers: ha, data: { confirmacao: nome, apenas_possiveis: true } });
    expect(p2.status(), await p2.text()).toBe(200);
    const j2 = (await p2.json()) as { exclusao: { documentos_excluidos: number; pastas_excluidas: number; bloqueados: number } };
    expect(j2.exclusao).toMatchObject({ documentos_excluidos: 1, pastas_excluidas: 0, bloqueados: 3 });
    expect(await existeDoc(request, A.admin, livre.id)).toBe(false);
    for (const d of [comCom, comTram, comAss]) expect(await existeDoc(request, A.admin, d.id)).toBe(true);
    expect((await pastasDe(request, A.admin)).some((p) => p.caminho_nome === nome)).toBe(true);
    // e ainda assim os registros imutáveis continuam lá
    const com = (await (await request.get(`/api/v1/ged/comentarios?documento_id=${comCom.id}`, { headers: ha })).json()) as { itens: unknown[] };
    expect(com.itens).toHaveLength(1);
  });

  test("T26h – exclusão grande roda em segundo plano (job/inline) com progresso; pasta com subpastas", async ({ request }) => {
    test.setTimeout(420_000);
    const ha = await H(request, A.admin);
    const nome = `GRANDE-${suf}`;
    const arquivos = Array.from({ length: 130 }, (_, i) => ({ rel: `${nome}/sub${i % 4}/d-${String(i).padStart(3, "0")}.pdf`, dados: pdf(`g${i} ${suf}`) }));
    const lote = await importar(request, A.admin, arquivos);
    expect(lote.importados).toBe(130);
    const pasta = (await pastasDe(request, A.admin)).find((p) => p.caminho_nome === nome)!.id;
    const pre = (await (await request.get(`/api/v1/ged/pastas/${pasta}/excluir`, { headers: ha })).json()) as { plano: { documentos_excluiveis: number; pastas_removiveis: number; sincrono: boolean } };
    expect(pre.plano).toMatchObject({ documentos_excluiveis: 130, pastas_removiveis: 5, sincrono: false });
    const r = await request.delete(`/api/v1/ged/pastas/${pasta}?excluir=true`, { headers: ha, data: { confirmacao: nome } });
    expect(r.status(), await r.text()).toBe(202);
    const id = ((await r.json()) as { exclusao: { id: string } }).exclusao.id;
    // só uma exclusão por vez no cliente
    const outra = await request.post(`/api/v1/ged/pastas/${pasta}/excluir`, { headers: ha, data: { confirmacao: nome } });
    expect([409, 404]).toContain(outra.status());
    let ultimo = { status: "", percentual: 0, documentos_excluidos: 0, pastas_excluidas: 0 };
    await expect
      .poll(async () => {
        ultimo = await (await request.get(`/api/v1/ged/exclusoes/${id}`, { headers: ha })).json();
        return ultimo.status;
      }, { timeout: 300_000, intervals: [500, 1000, 2000] })
      .toBe("CONCLUIDA");
    expect(ultimo).toMatchObject({ documentos_excluidos: 130, pastas_excluidas: 5, percentual: 100 });
    expect((await pastasDe(request, A.admin)).some((p) => p.caminho_nome === nome || p.caminho_nome.startsWith(`${nome}/`))).toBe(false);
    expect(await buscaTitulos(request, A.admin, "d-001")).toEqual([]);
  });

  test("T26i – pela tela: o lote pede confirmação digitada e exclui; o documento tem o botão e o aviso de valor jurídico", async ({ page, request }) => {
    const nome = `UI-${suf}`;
    const lote = await importar(request, A.admin, [{ rel: `${nome}/Sub/ui-1.pdf`, dados: pdf(`ui1 ${suf}`) }, { rel: `${nome}/Sub/ui-2.pdf`, dados: pdf(`ui2 ${suf}`) }]);
    expect(lote.importados).toBe(2);
    const docId = lote.itens.find((i) => i.status === "IMPORTADO")!.documento_id!;
    await loginGed(page, A.admin);

    await irPara(page, `/ged/documentos/${docId}`);
    await expect(page.getByRole("heading", { name: "Excluir documento" })).toBeVisible();
    await expect(page.getByText(/não podem ser excluídos/).first()).toBeVisible();

    await irPara(page, `/ged/importar/${lote.id}`);
    await page.getByTestId("abrir-exclusao").click();
    const resumo = page.getByTestId("resumo-exclusao");
    await expect(resumo).toBeVisible();
    await expect(page.getByTestId("excluir-documentos")).toHaveText("2");
    await expect(page.getByTestId("excluir-pastas")).toHaveText("2");
    await expect(page.getByText(/não tem volta/i).first()).toBeVisible();
    const botao = page.getByTestId("confirmar-exclusao");
    await expect(botao).toBeDisabled();
    await page.getByTestId("confirmacao-exclusao").fill("excluir");
    await expect(botao).toBeDisabled();
    await page.getByTestId("confirmacao-exclusao").fill("EXCLUIR");
    await expect(botao).toBeEnabled();
    await botao.click();
    await expect(page.getByTestId("progresso-exclusao")).toContainText("Exclusão concluída", { timeout: 60_000 });
    expect(await existeDoc(request, A.admin, docId)).toBe(false);
    await irPara(page, `/ged/importar/${lote.id}`);
    await expect(page.getByText(/conteúdo deste lote foi excluído/i)).toBeVisible();
    await submeter(page, page.getByRole("link", { name: "Removidos" }), /Removido/).catch(() => undefined);
  });

  test("T26j – pasta pela tela: pede o NOME da pasta", async ({ page, request }) => {
    const nome = `PASTA-UI-${suf}`;
    const ha = await H(request, A.admin);
    const id = (await (await request.post("/api/v1/ged/pastas", { headers: ha, data: { nome } })).json()).id as string;
    await criarDocumentoApi(request, await tokenCache(request, A.admin), { titulo: `Doc pasta ui ${suf}`, pasta_id: id, pdf: await gerarPdf(["pui", suf]) });
    await loginGed(page, A.admin);
    await irPara(page, `/ged/pastas?pasta=${id}`);
    await expect(page.getByRole("link", { name: "Baixar pasta (ZIP)" })).toBeVisible();
    await page.getByTestId("abrir-exclusao").click();
    await expect(page.getByTestId("excluir-documentos")).toHaveText("1");
    await page.getByTestId("confirmacao-exclusao").fill("EXCLUIR");
    await expect(page.getByTestId("confirmar-exclusao")).toBeDisabled();
    await page.getByTestId("confirmacao-exclusao").fill(nome);
    await page.getByTestId("confirmar-exclusao").click();
    await expect(page.getByTestId("progresso-exclusao")).toContainText("Exclusão concluída", { timeout: 60_000 });
    expect((await pastasDe(request, A.admin)).some((p) => p.id === id)).toBe(false);
  });
});
