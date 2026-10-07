import { createHash } from "node:crypto";
import { test, expect, type APIRequestContext, type PlaywrightWorkerArgs } from "@playwright/test";
import JSZip from "jszip";
import {
  USUARIOS_GED, aceitarDialogos, aguardarHidratacao, auth, bancoCmd, carregarIdsGed, criarDocumentoApi, gerarPdf, irPara, loginGed, marcasDe, MOTIVO_SEM_IDS, semVazamento, sufixoUnico, temBanco, tokenCache,
} from "./ged-helpers";

// T27 – GED: compartilhamento externo de pasta/documento por LINK PÚBLICO protegido por OTP no WhatsApp (docs/ged.md §18).
// Cobre: criar por API e pela UI; abrir sem código não mostra arquivo; código errado/limite/bloqueio; código certo → sessão (cookie httpOnly com escopo
// de caminho, presa ao navegador); visualizar inline sem cache; baixar com limite; ZIP de pasta só com o conjunto permitido; SIGILOSO/dados pessoais
// recusados; RESTRITO exige confirmação; congelar a lista; revogar derruba a sessão aberta; link vencido/revogado/excluído = o MESMO 404; papéis sem
// permissão; isolamento entre clientes; rate limit; auditoria sem dado pessoal completo.
// Precisa: `E2E_GED_IDS=1 npm run seed:ged-demo` (clientes VAC/AAC; VAC já tem o canal de WhatsApp fictício), DATABASE_URL e DATA_KEY no ambiente do teste
// (lê o código do OTP em tests/e2e/t20-banco.ts) e o SERVIDOR com CANAIS_ENVIO_SIMULADO=true (nada é enviado de verdade; o código fica cifrado só em ensaio).
test.beforeEach(() => {
  test.skip(test.info().project.name !== "desktop-chromium", "Altera dados – executado apenas no projeto desktop.");
});
const IDS = carregarIdsGed();
test.skip(!IDS, MOTIVO_SEM_IDS);
test.skip(!temBanco(), "Sem DATABASE_URL: o teste lê o código do OTP direto do banco.");
test.skip(process.env.CANAIS_ENVIO_SIMULADO !== "true", "Só em modo simulado (CANAIS_ENVIO_SIMULADO=true no servidor e no teste): não envia WhatsApp real.");
test.describe.configure({ timeout: 240_000 });

const A = USUARIOS_GED.A;
const B = USUARIOS_GED.B;
const WHATSAPP = "(75) 99999-8888";
const WHATSAPP_E164 = "5575999998888";
const suf = sufixoUnico();
const API = "/api/v1/publico/compartilhado";
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const H = async (request: APIRequestContext, email: string) => auth(await tokenCache(request, email));

type Criado = { id: string; token: string; url: string; caminho: string; destinatario_mascarado: string; link_whatsapp: string; expira_em: string; status: string };
async function criarLink(request: APIRequestContext, email: string, corpo: Record<string, unknown>, esperado = 201): Promise<Criado> {
  const r = await request.post("/api/v1/ged/compartilhamentos", { headers: await H(request, email), data: { whatsapp: WHATSAPP, ...corpo } });
  expect(r.status(), await r.text()).toBe(esperado);
  return (await r.json()) as Criado;
}
async function tentarLink(request: APIRequestContext, email: string, corpo: Record<string, unknown>) {
  const r = await request.post("/api/v1/ged/compartilhamentos", { headers: await H(request, email), data: { whatsapp: WHATSAPP, ...corpo } });
  return { status: r.status(), corpo: (await r.json().catch(() => ({}))) as { code?: string; message?: string; details?: { campo?: string } } };
}

/** Cliente HTTP do DESTINATÁRIO (sem login, cookie jar próprio, IP e navegador de ensaio). */
async function destinatario(playwright: PlaywrightWorkerArgs["playwright"], baseURL: string | undefined, ip: string, ua = "Mozilla/5.0 (E2E T27 Chrome/124)") {
  return playwright.request.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": ip, "user-agent": ua } });
}
async function pedirCodigo(pub: APIRequestContext, token: string, linkId: string): Promise<string> {
  const r = await pub.post(`${API}/${token}/otp`, { data: {} });
  expect(r.status(), await r.text()).toBe(200);
  const { codigo } = bancoCmd<{ codigo: string | null }>("codigo-compartilhamento", linkId);
  expect(codigo, "código de ensaio (CANAIS_ENVIO_SIMULADO)").toMatch(/^\d{6}$/);
  return codigo!;
}
async function entrar(pub: APIRequestContext, token: string, linkId: string) {
  bancoCmd("recuar-otp", linkId); // vence o intervalo de 60 s entre envios (sem esperar) quando o link já recebeu um código
  const codigo = await pedirCodigo(pub, token, linkId);
  const v = await pub.post(`${API}/${token}/validar`, { data: { codigo } });
  expect(v.status(), await v.text()).toBe(200);
  return v;
}

// dados compartilhados entre os testes (serial)
let pastaId = "";
let subId = "";
const doc: Record<string, { id: string; titulo: string; pdf: Buffer }> = {};
let linkDoc: Criado;
let linkPasta: Criado;

test.describe.serial("T27 – compartilhamento externo por link + OTP no WhatsApp", () => {
  test("T27a – prepara a árvore (pasta, subpasta, públicos, restrito, sigiloso, dados pessoais) e libera VER ao servidor1", async ({ request }) => {
    const gestor = await tokenCache(request, A.gestor);
    const p = await request.post("/api/v1/ged/pastas", { headers: auth(gestor), data: { nome: `Compart-${suf}` } });
    expect(p.status(), await p.text()).toBe(201);
    pastaId = (await p.json()).id;
    const s = await request.post("/api/v1/ged/pastas", { headers: auth(gestor), data: { nome: `Sub ${suf}`, parent_id: pastaId } });
    expect(s.status(), await s.text()).toBe(201);
    subId = (await s.json()).id;
    const novo = async (chave: string, pasta: string, sensibilidade: "PUBLICO" | "RESTRITO" | "SIGILOSO") => {
      const titulo = `${chave} ${suf}`;
      const pdf = await gerarPdf([titulo, "conteudo de ensaio", suf]);
      const d = await criarDocumentoApi(request, gestor, { titulo, pasta_id: pasta, sensibilidade, pdf });
      doc[chave] = { id: d.id, titulo, pdf };
    };
    await novo("PUBLICO1", pastaId, "PUBLICO");
    await novo("RESTRITO1", pastaId, "RESTRITO");
    await novo("SUB1", subId, "RESTRITO");
    await novo("SIGILOSO1", pastaId, "SIGILOSO");
    await novo("PESSOAIS1", pastaId, "RESTRITO");
    const dp = await request.put(`/api/v1/ged/documentos/${doc.PESSOAIS1.id}/dados-pessoais`, { headers: auth(gestor), data: { contem: true } });
    expect(dp.ok(), await dp.text()).toBeTruthy();
    const acl = await request.post("/api/v1/ged/acl", { headers: auth(gestor), data: { alvo: { tipo: "pasta", id: pastaId }, principal: { tipo: "USUARIO", id: IDS!.A.usuarios[A.servidor1] }, acoes: ["VER"] } });
    expect(acl.ok(), await acl.text()).toBeTruthy();
  });

  test("T27b – regras de criação: SIGILOSO e dados pessoais recusados, RESTRITO pede confirmação, validade ≤ 30 dias, WhatsApp válido", async ({ request }) => {
    const sig = await tentarLink(request, A.gestor, { recurso: { tipo: "documento", id: doc.SIGILOSO1.id }, confirmar_restrito: true });
    expect(sig.status).toBe(422);
    expect(sig.corpo.code).toBe("SIGILOSO_NAO_COMPARTILHAVEL");
    const pes = await tentarLink(request, A.gestor, { recurso: { tipo: "documento", id: doc.PESSOAIS1.id }, confirmar_restrito: true });
    expect(pes.status).toBe(422);
    expect(pes.corpo.message ?? "").toMatch(/anonimiza/i);
    const sem = await tentarLink(request, A.gestor, { recurso: { tipo: "documento", id: doc.RESTRITO1.id } });
    expect(sem.status).toBe(409);
    expect(sem.corpo.code).toBe("CONFIRMACAO_NECESSARIA");
    expect((await tentarLink(request, A.gestor, { recurso: { tipo: "documento", id: doc.PUBLICO1.id }, validade_dias: 31 })).status).toBe(422);
    expect((await tentarLink(request, A.gestor, { recurso: { tipo: "documento", id: doc.PUBLICO1.id }, whatsapp: "123" })).status).toBe(422);
    expect((await tentarLink(request, A.gestor, { recurso: { tipo: "documento", id: doc.PUBLICO1.id }, pode_visualizar: false, pode_baixar: false })).status).toBe(422);
    expect((await tentarLink(request, A.gestor, { recurso: { tipo: "documento", id: doc.PUBLICO1.id }, pode_zip: true, pode_baixar: true })).status).toBe(422); // ZIP só de pasta
    // pasta cujo único conteúdo compartilhável seria nenhum: pasta só com sigiloso
    const vazia = await request.post("/api/v1/ged/pastas", { headers: await H(request, A.gestor), data: { nome: `SoSigilo-${suf}` } });
    const vid = (await vazia.json()).id as string;
    await criarDocumentoApi(request, await tokenCache(request, A.gestor), { titulo: `so sigilo ${suf}`, pasta_id: vid, sensibilidade: "SIGILOSO" });
    expect((await tentarLink(request, A.gestor, { recurso: { tipo: "pasta", id: vid }, confirmar_restrito: true })).corpo.code).toBe("PASTA_SEM_DOCUMENTOS");
  });

  test("T27c – cria o link do documento (token 32+ bytes exibido uma vez; telefone mascarado; nada do número na resposta nem na lista)", async ({ request }) => {
    linkDoc = await criarLink(request, A.gestor, { recurso: { tipo: "documento", id: doc.RESTRITO1.id }, confirmar_restrito: true, pode_baixar: true, limite_downloads: 2, mensagem: `Mensagem ${suf}`, destinatario_nome: "Pessoa de Ensaio" });
    expect(linkDoc.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(linkDoc.token, "base64url")).toHaveLength(32);
    expect(linkDoc.url).toContain(`/compartilhado/${linkDoc.token}`);
    expect(linkDoc.destinatario_mascarado).toBe("(75) 9****-8888");
    const dias = (new Date(linkDoc.expira_em).getTime() - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(6.9);
    expect(dias).toBeLessThan(7.1);
    // lista e detalhe nunca devolvem token nem o número completo
    const h = await H(request, A.gestor);
    const lista = await request.get("/api/v1/ged/compartilhamentos?size=100", { headers: h });
    const det = await request.get(`/api/v1/ged/compartilhamentos/${linkDoc.id}`, { headers: h });
    for (const t of [await lista.text(), await det.text()]) {
      expect(t).not.toContain(linkDoc.token);
      expect(t).not.toContain(WHATSAPP_E164);
      expect(t).not.toContain("99999");
    }
    expect(linkDoc.status).toBe("ATIVO");
    expect((await lista.json()).data.some((x: { id: string }) => x.id === linkDoc.id)).toBe(true);
    const estado = bancoCmd<{ token_hash_len: number; eventos: number }>("compartilhamento", linkDoc.id);
    expect(estado.token_hash_len).toBe(64); // só o sha256 do token fica no banco
    expect(estado.eventos).toBe(1); // LINK_CRIADO
    expect(bancoCmd<{ cifrado_ok: boolean; hash_ok: boolean; mascarado_ok: boolean }>("whatsapp-claro", linkDoc.id)).toEqual({ cifrado_ok: true, hash_ok: true, mascarado_ok: true });
  });

  test("T27d – sem o código a página mostra só órgão, quem compartilhou e título; nenhum arquivo, nenhuma rota de dados", async ({ playwright, baseURL }) => {
    const pub = await destinatario(playwright, baseURL, "198.51.100.10");
    const pg = await pub.get(`/compartilhado/${linkDoc.token}`);
    expect(pg.status()).toBe(200);
    const html = await pg.text();
    expect(html).toContain(doc.RESTRITO1.titulo);
    expect(html).toContain("Receber código no WhatsApp");
    expect(html).not.toContain(`Mensagem ${suf}`); // a mensagem só aparece depois do código
    expect(html).not.toContain(doc.PUBLICO1.titulo);
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain(WHATSAPP_E164);
    expect(html).not.toContain("99999");
    const h = pg.headers();
    expect(h["cache-control"]).toContain("no-store");
    expect(h["x-robots-tag"]).toContain("noindex");
    expect(h["referrer-policy"]).toBe("no-referrer");
    for (const rota of [`${API}/${linkDoc.token}/itens`, `${API}/${linkDoc.token}/arquivo?doc=${doc.RESTRITO1.id}&inline=1`, `${API}/${linkDoc.token}/arquivo?doc=${doc.RESTRITO1.id}`]) {
      const r = await pub.get(rota);
      expect(r.status(), rota).toBe(401);
    }
    await pub.dispose();
  });

  test("T27e – OTP: resposta genérica com final do número; reenvio < 60 s = 429; código errado conta tentativas; código certo abre a sessão; uso único", async ({ playwright, baseURL }) => {
    const pub = await destinatario(playwright, baseURL, "198.51.100.11");
    const o = await pub.post(`${API}/${linkDoc.token}/otp`, { data: {} });
    expect(o.status()).toBe(200);
    const corpo = await o.json();
    expect(corpo.mensagem).toBe("Se o link for válido, enviamos o código para o número terminado em ••88.");
    expect(JSON.stringify(corpo)).not.toContain("99999");
    expect(o.headers()["cache-control"]).toContain("no-store");
    const de = await pub.post(`${API}/${linkDoc.token}/otp`, { data: {} });
    expect(de.status()).toBe(429);
    expect((await de.json()).details.retry_after).toBeGreaterThan(0);
    const { codigo } = bancoCmd<{ codigo: string }>("codigo-compartilhamento", linkDoc.id);
    const errado = codigo === "000000" ? "111111" : "000000";
    const e1 = await pub.post(`${API}/${linkDoc.token}/validar`, { data: { codigo: errado } });
    expect(e1.status()).toBe(422);
    expect((await e1.json()).details.tentativas_restantes).toBe(4);
    expect((await pub.get(`${API}/${linkDoc.token}/itens`)).status()).toBe(401); // ainda sem sessão
    const ok = await pub.post(`${API}/${linkDoc.token}/validar`, { data: { codigo } });
    expect(ok.status(), await ok.text()).toBe(200);
    // cookie: httpOnly, SameSite, um por caminho (página e API) do link
    const cookies = ok.headersArray().filter((x) => x.name.toLowerCase() === "set-cookie").map((x) => x.value);
    expect(cookies).toHaveLength(2);
    for (const c of cookies) {
      expect(c).toMatch(/^ged_comp=[A-Za-z0-9_-]{43};/);
      expect(c).toMatch(/HttpOnly/i);
      expect(c).toMatch(/SameSite=Lax/i);
      expect(c).toMatch(/Path=\/(api\/v1\/publico\/)?compartilhad/);
    }
    expect(cookies.some((c) => c.includes(`Path=/compartilhado/${linkDoc.token}`))).toBe(true);
    expect(cookies.some((c) => c.includes(`Path=${API}/${linkDoc.token}`))).toBe(true);
    // uso único: o mesmo código não vale duas vezes
    const outro = await destinatario(playwright, baseURL, "198.51.100.12");
    expect((await outro.post(`${API}/${linkDoc.token}/validar`, { data: { codigo } })).status()).toBe(422);
    await outro.dispose();
    await pub.dispose();
  });

  test("T27f – com sessão: mensagem e documento; visualizar inline sem cache; baixar com limite de 2; outro navegador e sair derrubam a sessão", async ({ playwright, baseURL }) => {
    const pub = await destinatario(playwright, baseURL, "198.51.100.13");
    await entrar(pub, linkDoc.token, linkDoc.id);
    const it = await pub.get(`${API}/${linkDoc.token}/itens`);
    expect(it.status()).toBe(200);
    const j = await it.json();
    expect(j.documentos).toHaveLength(1);
    expect(j.documentos[0].id).toBe(doc.RESTRITO1.id);
    expect(j.mensagem).toBe(`Mensagem ${suf}`);
    expect(j.compartilhado_por).toBeTruthy();
    expect(JSON.stringify(j)).not.toMatch(/storage_key|ged\//);
    const pg = await (await pub.get(`/compartilhado/${linkDoc.token}`)).text();
    expect(pg).toContain(`Mensagem ${suf}`);
    expect(pg).toContain("Baixar");
    // visualizar (inline): PDF, sem cache, sem indexação
    const ver = await pub.get(`${API}/${linkDoc.token}/arquivo?doc=${doc.RESTRITO1.id}&inline=1`);
    expect(ver.status()).toBe(200);
    expect(ver.headers()["content-type"]).toContain("application/pdf");
    expect(ver.headers()["content-disposition"]).toMatch(/^inline/);
    expect(ver.headers()["cache-control"]).toContain("no-store");
    expect(ver.headers()["x-robots-tag"]).toContain("noindex");
    expect(sha(await ver.body())).toBe(sha(doc.RESTRITO1.pdf));
    // baixar: attachment, mesmo conteúdo, limite de 2 downloads
    for (let i = 0; i < 2; i++) {
      const b = await pub.get(`${API}/${linkDoc.token}/arquivo?doc=${doc.RESTRITO1.id}`);
      expect(b.status(), `download ${i + 1}`).toBe(200);
      expect(b.headers()["content-disposition"]).toMatch(/^attachment/);
      expect(sha(await b.body())).toBe(sha(doc.RESTRITO1.pdf));
    }
    const lim = await pub.get(`${API}/${linkDoc.token}/arquivo?doc=${doc.RESTRITO1.id}`);
    expect(lim.status()).toBe(403);
    expect((await lim.json()).code).toBe("LIMITE_DOWNLOADS");
    expect((await pub.get(`${API}/${linkDoc.token}/arquivo?doc=${doc.RESTRITO1.id}&inline=1`)).status()).toBe(200); // visualizar não gasta o limite
    // documento que NÃO está no conjunto (outro documento da mesma pasta, sigiloso, de outro cliente) = 404, mesmo sabendo o id
    for (const id of [doc.PUBLICO1.id, doc.SIGILOSO1.id, IDS!.B.documentos[Object.keys(IDS!.B.documentos)[0]].id]) {
      expect((await pub.get(`${API}/${linkDoc.token}/arquivo?doc=${id}&inline=1`)).status(), id).toBe(404);
    }
    expect((await pub.get(`${API}/${linkDoc.token}/zip`)).status()).toBe(403); // documento não tem ZIP
    // o cookie não vale em OUTRO navegador (user-agent) nem em outro link
    const cookie = (await pub.storageState()).cookies.find((c) => c.name === "ged_comp");
    expect(cookie, "cookie de sessão").toBeTruthy();
    const outroNavegador = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": "198.51.100.14", "user-agent": "OutroNavegador/1.0", cookie: `ged_comp=${cookie!.value}` } });
    expect((await outroNavegador.get(`${API}/${linkDoc.token}/itens`)).status()).toBe(401);
    await outroNavegador.dispose();
    // sair encerra a sessão no servidor
    const sai = await pub.post(`${API}/${linkDoc.token}/sair`, { data: {} });
    expect(sai.status()).toBe(200);
    const clone = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": "198.51.100.13", "user-agent": "Mozilla/5.0 (E2E T27 Chrome/124)", cookie: `ged_comp=${cookie!.value}` } });
    expect((await clone.get(`${API}/${linkDoc.token}/itens`)).status()).toBe(401);
    await clone.dispose();
    await pub.dispose();
    // e-mail ao criador no primeiro acesso (caixa de teste)
    let assuntos: string[] = [];
    for (let i = 0; i < 10 && !assuntos.some((a) => /foi acessado/.test(a)); i++) {
      assuntos = bancoCmd<{ assunto: string }[]>("emails-para", A.gestor).map((x) => x.assunto);
      if (!assuntos.some((a) => /foi acessado/.test(a))) await new Promise((r) => setTimeout(r, 500));
    }
    expect(assuntos.some((a) => /foi acessado/.test(a))).toBe(true);
  });

  test("T27g – código errado: 5 tentativas invalidam o código e bloqueiam o link e o IP; reenvio mínimo e teto de 5 envios por hora", async ({ request, playwright, baseURL }) => {
    const l = await criarLink(request, A.gestor, { recurso: { tipo: "documento", id: doc.PUBLICO1.id } });
    const pub = await destinatario(playwright, baseURL, "198.51.100.20");
    const codigo = await pedirCodigo(pub, l!.token, l!.id);
    const errado = codigo === "000000" ? "111111" : "000000";
    let ultimo = 0;
    for (let i = 0; i < 5; i++) ultimo = (await pub.post(`${API}/${l!.token}/validar`, { data: { codigo: errado } })).status();
    expect([422, 429]).toContain(ultimo);
    // o código CERTO já não funciona (invalidado pelo limite de tentativas) e o link está em bloqueio progressivo
    const certo = await pub.post(`${API}/${l!.token}/validar`, { data: { codigo } });
    expect([422, 429]).toContain(certo.status());
    expect((await pub.get(`${API}/${l!.token}/itens`)).status()).toBe(401);
    const est = bancoCmd<{ otp_falhas: number; bloqueado_ate: string | null }>("compartilhamento", l!.id);
    expect(est.otp_falhas).toBeGreaterThanOrEqual(5);
    expect(est.bloqueado_ate).toBeTruthy();
    // estando bloqueado, pedir novo código também é recusado (429), de qualquer IP
    const outroIp = await destinatario(playwright, baseURL, "198.51.100.21");
    expect((await outroIp.post(`${API}/${l!.token}/otp`, { data: {} })).status()).toBe(429);
    // desbloqueado, o teto é de 5 envios por hora e por link (o 1º já foi; "recuar-otp" vence o intervalo de 60 s)
    bancoCmd("limpar-bloqueio", l!.id);
    let status = 200;
    let motivo = "";
    for (let i = 0; i < 6 && status === 200; i++) {
      bancoCmd("recuar-otp", l!.id);
      const r = await outroIp.post(`${API}/${l!.token}/otp`, { data: {} });
      status = r.status();
      if (status === 429) motivo = (await r.json()).details?.motivo;
    }
    expect(status).toBe(429);
    expect(motivo).toBe("LIMITE_HORA");
    await outroIp.dispose();
    await pub.dispose();
  });

  test("T27h – pasta: o destinatário vê só o permitido (sem sigiloso nem dados pessoais), navega nas subpastas e baixa o ZIP só com esse conjunto", async ({ request, playwright, baseURL }) => {
    linkPasta = await criarLink(request, A.gestor, { recurso: { tipo: "pasta", id: pastaId }, confirmar_restrito: true, pode_baixar: true, pode_zip: true });
    const pub = await destinatario(playwright, baseURL, "198.51.100.30");
    await entrar(pub, linkPasta.token, linkPasta.id);
    const it = await (await pub.get(`${API}/${linkPasta.token}/itens`)).json();
    const titulos = it.documentos.map((d: { titulo: string }) => d.titulo).sort();
    expect(titulos).toEqual([doc.PUBLICO1.titulo, doc.RESTRITO1.titulo].sort());
    expect(it.subpastas.map((s: { id: string }) => s.id)).toEqual([subId]);
    const txt = JSON.stringify(it);
    expect(txt).not.toContain(doc.SIGILOSO1.titulo);
    expect(txt).not.toContain(doc.PESSOAIS1.titulo);
    const sub = await (await pub.get(`${API}/${linkPasta.token}/itens?pasta=${subId}`)).json();
    expect(sub.documentos.map((d: { id: string }) => d.id)).toEqual([doc.SUB1.id]);
    expect(sub.pasta_atual.caminho).toHaveLength(2);
    // pasta fora da subárvore (de outro cliente) = 404
    const pastaB = Object.values(IDS!.B.pastas)[0];
    expect((await pub.get(`${API}/${linkPasta.token}/itens?pasta=${pastaB}`)).status()).toBe(404);
    // sigiloso e dados pessoais: 404 mesmo conhecendo o id
    for (const d of [doc.SIGILOSO1, doc.PESSOAIS1]) expect((await pub.get(`${API}/${linkPasta.token}/arquivo?doc=${d.id}&inline=1`)).status()).toBe(404);
    // a página mostra as subpastas e o botão de ZIP
    const html = await (await pub.get(`/compartilhado/${linkPasta.token}`)).text();
    expect(html).toContain("Baixar esta pasta em ZIP");
    expect(html).not.toContain(doc.SIGILOSO1.titulo);
    // ZIP: somente o conjunto permitido; manifesto sem o sigiloso e sem linhas de "omitido"
    const z = await pub.get(`${API}/${linkPasta.token}/zip`, { timeout: 120_000 });
    expect(z.status(), await z.text().catch(() => "")).toBe(200);
    expect(z.headers()["content-type"]).toContain("application/zip");
    expect(z.headers()["cache-control"]).toContain("no-store");
    const zip = await JSZip.loadAsync(await z.body());
    const arquivos = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    expect(arquivos.filter((n) => n.endsWith(".pdf"))).toHaveLength(3);
    const conteudo = (await zip.files[arquivos.find((n) => n.endsWith("MANIFESTO.csv"))!].async("string")) + (await zip.files[arquivos.find((n) => n.endsWith("LEIAME.txt"))!].async("string")) + arquivos.join("\n");
    expect(conteudo).not.toContain(doc.SIGILOSO1.titulo);
    expect(conteudo).not.toContain(doc.PESSOAIS1.titulo);
    expect(conteudo).not.toMatch(/omitido/);
    expect(conteudo).toContain(doc.PUBLICO1.titulo);
    // ZIP da subpasta
    const zs = await pub.get(`${API}/${linkPasta.token}/zip?pasta=${subId}`, { timeout: 120_000 });
    expect(zs.status()).toBe(200);
    expect(Object.keys((await JSZip.loadAsync(await zs.body())).files).filter((n) => n.endsWith(".pdf"))).toHaveLength(1);
    // eventos registrados: ZIP e sem dados pessoais completos
    const ev = bancoCmd<{ tipo: string; ip: string | null; user_agent: string | null }[]>("eventos-compartilhamento", linkPasta.id);
    expect(ev.filter((e) => e.tipo === "BAIXOU_ZIP")).toHaveLength(2);
    for (const e of ev.filter((x) => x.ip)) expect(e.ip).toMatch(/^198\.51\.100\.0$/); // IP truncado
    for (const e of ev.filter((x) => x.user_agent)) expect(e.user_agent).not.toContain("Mozilla/5.0"); // navegador resumido
    expect(JSON.stringify(ev)).not.toContain("99999");
    // dinâmico: documento novo na pasta ENTRA no link; documento que vira sigiloso SAI
    const gestor = await tokenCache(request, A.gestor);
    const novo = await criarDocumentoApi(request, gestor, { titulo: `Novo ${suf}`, pasta_id: pastaId, sensibilidade: "PUBLICO" });
    let it2 = await (await pub.get(`${API}/${linkPasta.token}/itens`)).json();
    expect(it2.documentos.map((d: { id: string }) => d.id)).toContain(novo.id);
    const sens = await request.patch(`/api/v1/ged/documentos/${doc.PUBLICO1.id}`, { headers: auth(gestor), data: { sensibilidade: "SIGILOSO" } });
    expect(sens.ok(), await sens.text()).toBeTruthy();
    it2 = await (await pub.get(`${API}/${linkPasta.token}/itens`)).json();
    expect(it2.documentos.map((d: { id: string }) => d.id)).not.toContain(doc.PUBLICO1.id);
    expect((await pub.get(`${API}/${linkPasta.token}/arquivo?doc=${doc.PUBLICO1.id}&inline=1`)).status()).toBe(404);
    await request.patch(`/api/v1/ged/documentos/${doc.PUBLICO1.id}`, { headers: auth(gestor), data: { sensibilidade: "PUBLICO" } });
    await pub.dispose();
  });

  test("T27i – congelar a lista: documento criado depois não entra; link sem permissão de baixar/ZIP recusa (403)", async ({ request, playwright, baseURL }) => {
    const gestor = await tokenCache(request, A.gestor);
    const congelado = await criarLink(request, A.gestor, { recurso: { tipo: "pasta", id: pastaId }, confirmar_restrito: true, congelar: true });
    const depois = await criarDocumentoApi(request, gestor, { titulo: `Depois ${suf}`, pasta_id: pastaId, sensibilidade: "PUBLICO" });
    const pub = await destinatario(playwright, baseURL, "198.51.100.31");
    await entrar(pub, congelado.token, congelado.id);
    const ids = (await (await pub.get(`${API}/${congelado.token}/itens`)).json()).documentos.map((d: { id: string }) => d.id);
    expect(ids).toContain(doc.RESTRITO1.id);
    expect(ids).not.toContain(depois.id);
    expect((await pub.get(`${API}/${congelado.token}/arquivo?doc=${doc.RESTRITO1.id}`)).status()).toBe(403); // sem permissão de baixar
    expect((await pub.get(`${API}/${congelado.token}/zip`)).status()).toBe(403);
    expect((await pub.get(`${API}/${congelado.token}/arquivo?doc=${doc.RESTRITO1.id}&inline=1`)).status()).toBe(200);
    await pub.dispose();
  });

  test("T27j – revogar derruba a sessão aberta na hora; vencido, revogado e inexistente respondem IGUAL (404); quem não criou não revoga", async ({ request, playwright, baseURL }) => {
    const l = await criarLink(request, A.gestor, { recurso: { tipo: "documento", id: doc.RESTRITO1.id }, confirmar_restrito: true, pode_baixar: true });
    const pub = await destinatario(playwright, baseURL, "198.51.100.40");
    await entrar(pub, l.token, l.id);
    expect((await pub.get(`${API}/${l.token}/itens`)).status()).toBe(200);
    // outro membro do mesmo cliente (sem ser Admin) não vê nem revoga: 404
    expect((await request.post(`/api/v1/ged/compartilhamentos/${l.id}/revogar`, { headers: await H(request, A.servidor2), data: {} })).status()).toBe(404);
    expect((await request.get(`/api/v1/ged/compartilhamentos/${l.id}`, { headers: await H(request, A.servidor2) })).status()).toBe(404);
    expect((await pub.get(`${API}/${l.token}/itens`)).status()).toBe(200);
    // o Administrador revoga (DELETE); efeito imediato na sessão que já estava aberta
    const rev = await request.delete(`/api/v1/ged/compartilhamentos/${l.id}`, { headers: await H(request, A.admin), data: { motivo: "ensaio" } });
    expect(rev.status(), await rev.text()).toBe(200);
    expect((await rev.json()).status).toBe("REVOGADO");
    const aposRev = await pub.get(`${API}/${l.token}/itens`);
    const aposArq = await pub.get(`${API}/${l.token}/arquivo?doc=${doc.RESTRITO1.id}&inline=1`);
    expect(aposRev.status()).toBe(404);
    expect(aposArq.status()).toBe(404);
    expect((await pub.get(`/compartilhado/${l.token}`)).status()).toBe(404);
    expect((await pub.post(`${API}/${l.token}/otp`, { data: {} })).status()).toBe(404);
    expect(bancoCmd<{ status: string; sessoes_abertas: number }>("compartilhamento", l.id)).toMatchObject({ status: "REVOGADO", sessoes_abertas: 0 });
    expect((await request.post(`/api/v1/ged/compartilhamentos/${l.id}/revogar`, { headers: await H(request, A.gestor), data: {} })).status()).toBe(200); // idempotente

    // vencido: mesmo 404 (mesmo corpo) que um token inexistente
    const v = await criarLink(request, A.gestor, { recurso: { tipo: "documento", id: doc.RESTRITO1.id }, confirmar_restrito: true });
    bancoCmd("expirar-compartilhamento", v.id);
    const falso = "A".repeat(43);
    const respostas = [
      await pub.get(`${API}/${v.token}/itens`),
      await pub.get(`${API}/${l.token}/itens`),
      await pub.get(`${API}/${falso}/itens`),
      await pub.get(`${API}/curto/itens`),
    ];
    for (const r of respostas) expect(r.status()).toBe(404);
    const corpos = await Promise.all(respostas.map((r) => r.text()));
    expect(new Set(corpos).size).toBe(1);
    expect((await pub.get(`/compartilhado/${v.token}`)).status()).toBe(404);
    expect((await pub.get(`/compartilhado/${falso}`)).status()).toBe(404);
    // a lista do criador mostra "Expirado" (mesmo antes de o job rodar)
    const lista = await (await request.get("/api/v1/ged/compartilhamentos?status=EXPIRADO&size=100", { headers: await H(request, A.gestor) })).json();
    expect(lista.data.some((x: { id: string; status: string }) => x.id === v.id && x.status === "EXPIRADO")).toBe(true);
    await pub.dispose();
  });

  test("T27k – sessão vencida pelo teto é recusada; excluir o documento invalida o link; criador sem acesso à pasta derruba o link", async ({ request, playwright, baseURL }) => {
    const gestor = await tokenCache(request, A.gestor);
    const alvo = await criarDocumentoApi(request, gestor, { titulo: `Para excluir ${suf}`, pasta_id: pastaId, sensibilidade: "PUBLICO" });
    const l = await criarLink(request, A.gestor, { recurso: { tipo: "documento", id: alvo.id } });
    const pub = await destinatario(playwright, baseURL, "198.51.100.50");
    await entrar(pub, l.token, l.id);
    expect((await pub.get(`${API}/${l.token}/itens`)).status()).toBe(200);
    bancoCmd("expirar-sessoes", l.id);
    expect((await pub.get(`${API}/${l.token}/itens`)).status()).toBe(401);
    bancoCmd("recuar-otp", l.id); // vence o intervalo de 60 s entre envios
    await entrar(pub, l.token, l.id);
    expect((await pub.get(`${API}/${l.token}/itens`)).status()).toBe(200);
    const ex = await request.delete(`/api/v1/ged/documentos/${alvo.id}`, { headers: auth(gestor), data: { confirmacao: "EXCLUIR" } });
    expect(ex.ok(), await ex.text()).toBeTruthy();
    await expect.poll(async () => (await pub.get(`${API}/${l.token}/itens`)).status(), { timeout: 30_000 }).toBe(404);
    expect(bancoCmd<{ status: string }>("compartilhamento", l.id).status).toBe("REVOGADO");

    // Usuário (servidor1) com EDITAR na pasta compartilha; ao perder o acesso à pasta o link para de abrir
    const aclEditar = await request.post("/api/v1/ged/acl", { headers: auth(gestor), data: { alvo: { tipo: "pasta", id: pastaId }, principal: { tipo: "USUARIO", id: IDS!.A.usuarios[A.servidor1] }, acoes: ["EDITAR"] } });
    expect(aclEditar.ok(), await aclEditar.text()).toBeTruthy();
    const lp = await criarLink(request, A.servidor1, { recurso: { tipo: "pasta", id: pastaId }, confirmar_restrito: true });
    const pub2 = await destinatario(playwright, baseURL, "198.51.100.51");
    await entrar(pub2, lp.token, lp.id);
    expect((await pub2.get(`${API}/${lp.token}/itens`)).status()).toBe(200);
    const acls = await (await request.get(`/api/v1/ged/acl?pasta_id=${pastaId}`, { headers: auth(gestor) })).json();
    const doServidor = (acls.itens as { id: string; usuario_id: string | null }[]).find((x) => x.usuario_id === IDS!.A.usuarios[A.servidor1]);
    expect(doServidor).toBeTruthy();
    expect((await request.delete(`/api/v1/ged/acl/${doServidor!.id}`, { headers: auth(gestor) })).ok()).toBeTruthy();
    expect((await pub2.get(`${API}/${lp.token}/itens`)).status()).toBe(404);
    await pub.dispose();
    await pub2.dispose();
  });

  test("T27l – papéis: Leitor e Auditor 403; Usuário só compartilha o que criou/edita; sem VER = 404; Admin vê todos; GET lista dos demais é só dos próprios", async ({ request }) => {
    const corpo = { recurso: { tipo: "documento", id: doc.RESTRITO1.id }, confirmar_restrito: true };
    for (const email of [A.vereador, A.auditor]) {
      expect((await tentarLink(request, email, corpo)).status, email).toBe(403);
      expect((await request.get("/api/v1/ged/compartilhamentos", { headers: await H(request, email) })).status(), `lista ${email}`).toBe(403);
    }
    // servidor1 perdeu o EDITAR (T27k) e só tem... nada na pasta agora: não vê o documento
    expect((await tentarLink(request, A.servidor1, corpo)).status).toBe(404);
    // servidor1 com VER (somente) → 403 (precisa ser autor ou ter EDITAR)
    const gestor = await tokenCache(request, A.gestor);
    const acl = await request.post("/api/v1/ged/acl", { headers: auth(gestor), data: { alvo: { tipo: "pasta", id: pastaId }, principal: { tipo: "USUARIO", id: IDS!.A.usuarios[A.servidor1] }, acoes: ["VER"] } });
    expect(acl.ok(), await acl.text()).toBeTruthy();
    expect((await tentarLink(request, A.servidor1, corpo)).status).toBe(403);
    // servidor2 não vê o recurso: 404
    expect((await tentarLink(request, A.servidor2, corpo)).status).toBe(404);
    // servidor1 cria link do documento que ELE criou
    const meu = await criarDocumentoApi(request, await tokenCache(request, A.servidor1), { titulo: `Meu ${suf}`, sensibilidade: "PUBLICO" });
    const l = await criarLink(request, A.servidor1, { recurso: { tipo: "documento", id: meu.id } });
    // lista: servidor1 vê só os seus; admin com escopo=todos vê também os do gestor
    const dele = await (await request.get("/api/v1/ged/compartilhamentos?escopo=todos&size=100", { headers: await H(request, A.servidor1) })).json();
    expect(dele.data.every((x: { criado_por_id: string }) => x.criado_por_id === IDS!.A.usuarios[A.servidor1])).toBe(true);
    expect(dele.data.some((x: { id: string }) => x.id === l.id)).toBe(true);
    const todos = await (await request.get("/api/v1/ged/compartilhamentos?escopo=todos&size=100", { headers: await H(request, A.admin) })).json();
    expect(todos.data.some((x: { id: string }) => x.id === l.id)).toBe(true);
    expect(todos.data.some((x: { id: string }) => x.id === linkPasta.id)).toBe(true);
  });

  test("T27m – isolamento entre clientes: B não vê nem cria link de A; sem canal de WhatsApp o link não é criado; token e sessão de A não abrem nada de B nem de outro link", async ({ request, playwright, baseURL }) => {
    const hb = await H(request, B.admin);
    const docA = doc.RESTRITO1.id;
    // B tenta criar link para documento/pasta de A → 404 (nem revela que existe)
    expect((await tentarLink(request, B.admin, { recurso: { tipo: "documento", id: docA }, confirmar_restrito: true })).status).toBe(404);
    expect((await tentarLink(request, B.admin, { recurso: { tipo: "pasta", id: pastaId }, confirmar_restrito: true })).status).toBe(404);
    // B não vê link de A (detalhe/revogar = 404; lista sem vazamento)
    expect((await request.get(`/api/v1/ged/compartilhamentos/${linkPasta.id}`, { headers: hb })).status()).toBe(404);
    expect((await request.post(`/api/v1/ged/compartilhamentos/${linkPasta.id}/revogar`, { headers: hb, data: {} })).status()).toBe(404);
    expect((await request.delete(`/api/v1/ged/compartilhamentos/${linkPasta.id}`, { headers: hb })).status()).toBe(404);
    const lista = await request.get("/api/v1/ged/compartilhamentos?escopo=todos&size=100", { headers: hb });
    expect(lista.status()).toBe(200);
    const texto = await lista.text();
    semVazamento(texto, [...marcasDe(IDS!.A), linkPasta.id, linkDoc.id], "lista de compartilhamentos de B");
    // B, sem canal de WhatsApp configurado, não cria link nem do próprio documento
    const semCanal = await tentarLink(request, B.admin, { recurso: { tipo: "documento", id: IDS!.B.documentos.edital07.id }, confirmar_restrito: true });
    expect(semCanal.status).toBe(409);
    expect(semCanal.corpo.code).toBe("SEM_CANAL_WHATSAPP");
    expect(semCanal.corpo.message ?? "").toMatch(/canal de WhatsApp/i);
    // o token de A só abre dados de A; id de documento de B dentro de um link de A = 404; cookie de um link não vale em outro
    const l2 = await criarLink(request, A.gestor, { recurso: { tipo: "documento", id: doc.RESTRITO1.id }, confirmar_restrito: true });
    const pub = await destinatario(playwright, baseURL, "198.51.100.60");
    bancoCmd("recuar-otp", linkPasta.id);
    await entrar(pub, linkPasta.token, linkPasta.id);
    for (const d of Object.values(IDS!.B.documentos)) expect((await pub.get(`${API}/${linkPasta.token}/arquivo?doc=${d.id}&inline=1`)).status()).toBe(404);
    const itens = await (await pub.get(`${API}/${linkPasta.token}/itens`)).text();
    semVazamento(itens, marcasDe(IDS!.B), "itens do link de A");
    const cookie = (await pub.storageState()).cookies.find((c) => c.name === "ged_comp")!;
    const cruzado = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": "198.51.100.60", "user-agent": "Mozilla/5.0 (E2E T27 Chrome/124)", cookie: `ged_comp=${cookie.value}` } });
    expect((await cruzado.get(`${API}/${l2.token}/itens`)).status()).toBe(401); // sessão do link da pasta no link do documento
    await cruzado.dispose();
    await pub.dispose();
  });

  test("T27n – rate limit: muitos tokens inexistentes bloqueiam o IP (429); o link verdadeiro segue abrindo para outro IP", async ({ playwright, baseURL }) => {
    const pub = await destinatario(playwright, baseURL, "198.51.100.70");
    let bloqueado = 0;
    for (let i = 0; i < 40; i++) {
      const falso = createHash("sha256").update(`t27-${suf}-${i}`).digest("base64url");
      const r = await pub.get(`${API}/${falso}/itens`);
      if (r.status() === 429) bloqueado++;
      else expect(r.status()).toBe(404);
    }
    expect(bloqueado).toBeGreaterThan(0);
    const r = await pub.get(`${API}/${linkPasta.token}/itens`);
    expect(r.status()).toBe(429); // o IP bloqueado nem consegue testar o link verdadeiro
    const outro = await destinatario(playwright, baseURL, "198.51.100.71");
    expect((await outro.get(`/compartilhado/${linkPasta.token}`)).status()).toBe(200);
    await pub.dispose();
    await outro.dispose();
  });

  test("T27o – enviar o link também por WhatsApp (sem o código), eventos no detalhe e configuração (desligar o compartilhamento)", async ({ request }) => {
    const l = await criarLink(request, A.gestor, { recurso: { tipo: "documento", id: doc.RESTRITO1.id }, confirmar_restrito: true, enviar_link_whatsapp: true });
    expect(l.link_whatsapp).toBe("ENVIADO");
    const det = await (await request.get(`/api/v1/ged/compartilhamentos/${l.id}`, { headers: await H(request, A.gestor) })).json();
    const tipos = det.eventos.map((e: { tipo: string }) => e.tipo);
    expect(tipos).toContain("LINK_CRIADO");
    expect(tipos).toContain("LINK_ENVIADO_WHATSAPP");
    expect(JSON.stringify(det)).not.toContain(WHATSAPP_E164);
  });

  test("T27p – UI: Compartilhar na ficha do documento; link exibido uma vez; destinatário confirma o código, visualiza e sai; revogar na tela Compartilhamentos", async ({ page, browser, request, baseURL }) => {
    aceitarDialogos(page);
    const gestor = await tokenCache(request, A.gestor);
    const d = await criarDocumentoApi(request, gestor, { titulo: `UI ${suf}`, sensibilidade: "PUBLICO", pdf: await gerarPdf([`UI ${suf}`]) });
    await loginGed(page, A.gestor);
    await irPara(page, `/ged/documentos/${d.id}`);
    await page.getByTestId("compartilhar-documento").click();
    await aguardarHidratacao(page);
    await expect(page.getByTestId("compartilhar-rotulo")).toContainText(`UI ${suf}`);
    await page.locator("#cp-whatsapp").fill(WHATSAPP);
    await page.locator("#cp-nome").fill("Destinatário UI");
    await page.getByRole("checkbox", { name: /Baixar os arquivos/ }).check();
    await page.getByTestId("criar-link").click();
    await expect(page.getByTestId("link-criado")).toBeVisible({ timeout: 30_000 });
    const url = await page.getByTestId("link-url").inputValue();
    expect(url).toMatch(/\/compartilhado\/[A-Za-z0-9_-]{43}$/);
    const token = url.split("/").pop()!;

    // destinatário (navegador separado, sem login)
    const ctxDest = await browser.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": "198.51.100.80" } });
    const dest = await ctxDest.newPage();
    await dest.goto(`/compartilhado/${token}`);
    await expect(dest.getByTestId("comp-titulo")).toContainText(`UI ${suf}`);
    await expect(dest.getByTestId("comp-quem")).toBeVisible();
    await expect(dest.getByText("registrados")).toBeVisible(); // aviso de registro de acessos (LGPD)
    await expect(dest.locator("iframe")).toHaveCount(0);
    await expect(dest.getByRole("link", { name: "Baixar" })).toHaveCount(0);
    await aguardarHidratacao(dest);
    await dest.getByTestId("pedir-codigo").click();
    await expect(dest.getByTestId("otp-mensagem")).toContainText("••88", { timeout: 20_000 });
    const linkId = (await (await request.get("/api/v1/ged/compartilhamentos?size=5", { headers: auth(gestor) })).json()).data.find((x: { recurso_rotulo: string }) => x.recurso_rotulo === `UI ${suf}`).id as string;
    const { codigo } = bancoCmd<{ codigo: string }>("codigo-compartilhamento", linkId);
    await dest.locator("#otp-codigo").fill(codigo === "111111" ? "222222" : "111111");
    await dest.getByTestId("confirmar-codigo").click();
    await expect(dest.getByTestId("gate-erro")).toBeVisible({ timeout: 20_000 });
    await dest.locator("#otp-codigo").fill(codigo);
    await dest.getByTestId("confirmar-codigo").click();
    await expect(dest.getByTestId("comp-documentos")).toContainText(`UI ${suf}`, { timeout: 30_000 });
    await dest.getByRole("link", { name: "Visualizar" }).click();
    await expect(dest.getByTestId("comp-preview")).toBeVisible();
    await expect(dest.getByRole("link", { name: "Baixar" })).toBeVisible();
    await dest.getByTestId("sair-compartilhado").click();
    await expect(dest.getByTestId("pedir-codigo")).toBeVisible({ timeout: 20_000 });

    // quem compartilhou acompanha e revoga
    await irPara(page, "/ged/compartilhamentos");
    const linha = page.getByTestId("tabela-compartilhamentos").locator("tr", { hasText: `UI ${suf}` });
    await expect(linha).toContainText("Ativo");
    await expect(linha).toContainText("(75) 9****-8888");
    await expect(linha).not.toContainText("99999");
    await linha.getByRole("link", { name: `UI ${suf}` }).click();
    await expect(page.getByTestId("tabela-eventos")).toContainText("Código validado");
    await page.getByTestId(`revogar-${linkId}`).click();
    await expect(page.getByText("Link revogado").first()).toBeVisible({ timeout: 20_000 });
    await dest.reload();
    await expect(dest.getByText(/404|not found|não encontrad/i).first()).toBeVisible();
    await ctxDest.close();

    // Leitor não vê o item de menu nem a tela
    await page.goto("/sair");
    await loginGed(page, A.vereador);
    await page.goto("/ged");
    await expect(page.getByRole("link", { name: "Compartilhamentos" })).toHaveCount(0);
    const r = await page.goto("/ged/compartilhamentos");
    expect(r?.status()).toBe(403);
  });
});
