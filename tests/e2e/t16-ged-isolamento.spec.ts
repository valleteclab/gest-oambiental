import { test, expect, type APIRequestContext } from "@playwright/test";
import { USUARIOS, SENHA_DEMO } from "./helpers";
import { MOTIVO_SEM_IDS, USUARIOS_GED, auth, carregarIdsGed, itensDe, loginGed, marcasDe, semVazamento, tokenGed, type ChaveTenant, type IdsGed } from "./ged-helpers";

// T16 – Isolamento entre clientes (tenants) do módulo GED (docs/ged-design.md §1). Seed: `E2E_GED_IDS=1 npm run seed:ged-demo`
// (VAC = Câmara Municipal de Vale das Acácias (DEMO), AAC = Autarquia de Águas do Cerrado (DEMO); documentos de MESMO título nos dois).
// O usuário de um cliente tenta, por ID direto, página/arquivo/versão/comentário/trâmite/ACL/assinatura/log do OUTRO: sempre 404.
// Somente leitura (exceto UM POST de comentário, que também deve ser recusado): roda nos dois projetos.
//
// DEPENDÊNCIAS entre frentes (o que ainda não existir devolve 404 do Next – a asserção "B→A = 404" é vacuamente verdadeira até lá,
// mas fica pronta; as asserções POSITIVAS estão marcadas):
//   B (documentos/busca/pastas) .. /ged/documentos, /ged/documentos/[id], filtros da lista, busca por conteúdo (positivo: PASSO 3)
//   C (editor/trâmite/comentários) /ged/editor/[id], /api/v1/ged/tramite/[id], /api/v1/ged/comentarios
//   D (assinaturas) ............... /ged/assinaturas/[id], /api/v1/ged/assinaturas/** (solicitar/assinar/recusar/otp)
//   E (logs/admin) ................ /ged/logs, /api/v1/ged/logs, /ged/admin/exportacao
//   Orquestrador .................. /dashboard e /processos redirecionam usuário só-GED para /ged (layout interno)

// next dev compila cada rota na 1ª visita: folga de tempo (em CI com build o teste leva poucos segundos).
test.describe.configure({ timeout: 180_000 });

const IDS = carregarIdsGed();
test.skip(!IDS, MOTIVO_SEM_IDS);
const ids = IDS as IdsGed;

const OUTRO: Record<ChaveTenant, ChaveTenant> = { A: "B", B: "A" };
const dono = { A: USUARIOS_GED.A.servidor1, B: USUARIOS_GED.B.servidor } as const;
const admin = { A: USUARIOS_GED.A.admin, B: USUARIOS_GED.B.admin } as const;

const tokens = new Map<string, string>();
async function token(request: APIRequestContext, email: string) {
  if (!tokens.has(email)) tokens.set(email, await tokenGed(request, email));
  return tokens.get(email)!;
}

test.describe("T16 – por ID direto, um cliente nunca alcança o outro (API)", () => {
  for (const origem of ["B", "A"] as const) {
    const alvo = OUTRO[origem];
    test(`T16a – ${origem} → ${alvo}: documento, arquivo, versão, comentários, trâmite e ACL = 404`, async ({ request }) => {
      for (const quem of [dono[origem], admin[origem]]) {
        const h = auth(await token(request, quem));
        for (const [chave, d] of Object.entries(ids[alvo].documentos)) {
          const rotulo = `${quem} → ${alvo}/${chave}`;
          for (const url of [
            `/api/v1/ged/documentos/${d.id}`,
            `/api/v1/ged/documentos/${d.id}/arquivo`,
            `/api/v1/ged/documentos/${d.id}/arquivo?versao=${d.versao_id}`,
            `/api/v1/ged/documentos/${d.id}/arquivo?versao=${d.versao_id}&inline=1`,
            `/api/v1/ged/comentarios?documento_id=${d.id}`,
            `/api/v1/ged/tramite/${d.id}`,
            `/api/v1/ged/acl?documento_id=${d.id}`,
          ]) {
            const r = await request.get(url, { headers: h });
            expect(r.status(), `${rotulo}: GET ${url}`).toBe(404);
          }
        }
        for (const [caminho, pastaId] of Object.entries(ids[alvo].pastas)) {
          const r = await request.get(`/api/v1/ged/acl?pasta_id=${pastaId}`, { headers: h });
          expect(r.status(), `${quem} → ${alvo}/pasta ${caminho}`).toBe(404);
        }
      }
    });

    test(`T16b – ${origem} → ${alvo}: versão de outro cliente com documento do próprio cliente = 404; escritas recusadas`, async ({ request }) => {
      const h = auth(await token(request, dono[origem]));
      const meus = Object.values(ids[origem].documentos);
      const alheios = Object.values(ids[alvo].documentos);
      // documento MEU + versão DELE
      const r1 = await request.get(`/api/v1/ged/documentos/${meus[0].id}/arquivo?versao=${alheios[0].versao_id}`, { headers: h });
      expect(r1.status()).toBe(404);
      // escrita: comentar em documento do outro cliente (também 404 e nada é gravado)
      const r2 = await request.post("/api/v1/ged/comentarios", { headers: h, data: { documento_id: alheios[0].id, texto: "Tentativa de comentário entre clientes (E2E T16)" } });
      expect(r2.status()).toBe(404);
      // pasta: PATCH em pasta do outro cliente. `herda_acl: true` força a busca da pasta e é inofensivo se algo vazar
      // (a primeira pasta de cada cliente do seed já herda ACL). Um PATCH `{}` seria um no-op que responde 200 sem consultar nada.
      const pasta = ids[alvo].pastas["Documentação da licitação"];
      const r3 = await request.patch(`/api/v1/ged/pastas/${pasta}`, { headers: h, data: { herda_acl: true } });
      expect(r3.status()).toBe(404);
      // ações de trâmite em documento do outro cliente
      const r4 = await request.post(`/api/v1/ged/tramite/${alheios[0].id}`, { headers: h, data: { acao: "CIENCIA" } });
      expect(r4.status()).toBe(404);
    });

    test(`T16c – ${origem} → ${alvo}: solicitações de assinatura e logs (rotas das frentes D/E; 404 até existirem e depois)`, async ({ request }) => {
      const h = auth(await token(request, admin[origem]));
      for (const [chave, s] of Object.entries(ids[alvo].solicitacoes)) {
        for (const url of [
          `/api/v1/ged/assinaturas/${s.id}`,
          `/api/v1/ged/assinaturas/${s.id}/assinar`,
          `/api/v1/ged/assinaturas/${s.id}/recusar`,
        ]) {
          const r = await request.get(url, { headers: h });
          // GET em rota só-POST devolve 404/405; nunca 200 com dados do outro cliente
          expect([404, 405], `${origem}→${alvo} ${url}`).toContain(r.status());
        }
        // lista filtrada por documento do outro cliente (rota de listagem da frente D): vazia, sem nenhuma marca do outro cliente
        const lista = await request.get(`/api/v1/ged/assinaturas?documento_id=${ids[alvo].documentos[chave].id}`, { headers: h });
        expect([200, 404, 405, 422], `${origem}→${alvo} lista de assinaturas`).toContain(lista.status());
        if (lista.status() === 200) {
          semVazamento(await lista.text(), marcasDe(ids[alvo]), `${origem}: /api/v1/ged/assinaturas?documento_id=…`);
          expect(itensDe(await lista.json())).toHaveLength(0);
        }
        for (const a of s.assinantes) {
          const r = await request.post(`/api/v1/ged/assinaturas/${s.id}/assinar`, { headers: h, data: { assinante_id: a.id } });
          expect([404, 405, 422], `POST assinar ${s.id}`).toContain(r.status());
        }
      }
      // logs do próprio cliente: sem nenhuma marca do outro (se a rota existir – frente E)
      for (const url of ["/api/v1/ged/logs", "/api/v1/ged/logs?tipo=acesso", "/api/v1/ged/logs?tipo=comunicacao", `/api/v1/ged/logs?documento_id=${Object.values(ids[alvo].documentos)[0].id}`]) {
        const r = await request.get(url, { headers: h });
        expect([200, 403, 404, 422], url).toContain(r.status());
        if (r.status() === 200) semVazamento(await r.text(), marcasDe(ids[alvo]), `${origem}: ${url}`);
      }
    });
  }
});

test.describe("T16 – listas e busca só mostram o próprio cliente", () => {
  test("T16d – documentos de MESMO título: a lista de cada cliente só traz os do próprio cliente", async ({ request }) => {
    for (const t of ["A", "B"] as const) {
      const h = auth(await token(request, admin[t]));
      for (const titulo of ["Contrato 001/2026", "Ofício 12/2026"]) {
        const r = await request.get(`/api/v1/ged/documentos?titulo=${encodeURIComponent(titulo)}&size=100`, { headers: h });
        expect(r.status()).toBe(200);
        const itens = itensDe(await r.json());
        expect(itens.length, `${t}: "${titulo}" deve existir uma vez`).toBe(1);
        expect(itens[0].id).toBe(Object.values(ids[t].documentos).find((d) => d.titulo === titulo)!.id);
        expect(String(itens[0].numero)).toMatch(new RegExp(`^${ids[t].sigla}-DOC-`));
      }
      const todos = await request.get("/api/v1/ged/documentos?size=100", { headers: h });
      expect(todos.status()).toBe(200);
      semVazamento(await todos.text(), marcasDe(ids[OUTRO[t]]), `lista completa de ${t}`);
    }
  });

  test("T16e – busca por conteúdo: palavra que só existe em A não retorna nada em B (e vice-versa); controle positivo no próprio cliente", async ({ request }) => {
    const buscas: { q: string; so: ChaveTenant }[] = [
      { q: "iluminação pública", so: "A" },
      { q: "aquisição de medicamentos", so: "A" },
      { q: "adutora", so: "B" },
    ];
    for (const { q, so } of buscas) {
      const sem = OUTRO[so];
      const hSem = auth(await token(request, admin[sem]));
      const r = await request.get(`/api/v1/ged/busca?q=${encodeURIComponent(q)}`, { headers: hSem });
      expect(r.status(), `busca "${q}" por ${sem}`).toBe(200);
      const corpo = await r.json();
      expect(itensDe(corpo), `"${q}" não existe em ${sem}`).toHaveLength(0);
      expect(corpo.total ?? 0).toBe(0);
      semVazamento(JSON.stringify(corpo), marcasDe(ids[so]), `busca "${q}" por ${sem}`);

      // controle positivo (depende da frente B – busca/extração): o dono encontra, com trecho
      const hCom = auth(await token(request, admin[so]));
      const ok = await request.get(`/api/v1/ged/busca?q=${encodeURIComponent(q)}`, { headers: hCom });
      expect(ok.status()).toBe(200);
      const achados = itensDe(await ok.json());
      expect(achados.length, `"${q}" deve ser encontrada em ${so}`).toBeGreaterThan(0);
      for (const a of achados) expect(String(a.numero)).toMatch(new RegExp(`^${ids[so].sigla}-DOC-`));
    }
  });
});

test.describe("T16 – páginas (UI) por ID direto", () => {
  for (const origem of ["B", "A"] as const) {
    test(`T16f – ${origem}: abrir por URL página de documento/editor/assinatura de ${OUTRO[origem]} = 404`, async ({ page }) => {
      await loginGed(page, dono[origem]);
      await expect(page).toHaveURL(/\/ged/);
      const alvo = OUTRO[origem];
      const urls: string[] = [];
      for (const d of Object.values(ids[alvo].documentos)) urls.push(`/ged/documentos/${d.id}`, `/ged/editor/${d.id}`, `/ged/documentos/${d.id}/arquivo`);
      for (const s of Object.values(ids[alvo].solicitacoes)) urls.push(`/ged/assinaturas/${s.id}`);
      for (const p of Object.values(ids[alvo].pastas).slice(0, 4)) urls.push(`/ged/pastas/${p}`, `/ged/pastas?pasta=${p}`);
      for (const u of urls) {
        // `next dev` às vezes aborta a 1ª navegação enquanto compila a rota (recarga do HMR): repete uma vez.
        const resp = await page.goto(u).catch(() => page.goto(u));
        // Em algumas navegações o Playwright não devolve o objeto de resposta: então vale o conteúdo da página de erro do Next.
        if (resp) expect(resp.status(), `${origem}: ${u}`).toBe(404);
        else {
          await page.waitForLoadState("load");
          await expect(page.getByText(/could not be found|não encontrad/i).first(), `${origem}: ${u}`).toBeVisible({ timeout: 30_000 });
        }
        for (const d of Object.values(ids[alvo].documentos)) await expect(page.getByText(d.numero)).toHaveCount(0);
      }
    });
  }

  test("T16g – cada usuário vê no cabeçalho só o próprio cliente; /ged não mostra números do outro", async ({ page }) => {
    await loginGed(page, admin.B); // o administrador enxerga todos os documentos não sigilosos do próprio cliente
    await page.goto("/ged");
    await expect(page.getByTestId("ged-organizacao")).toContainText("Autarquia de Águas do Cerrado");
    await expect(page.getByText("Câmara Municipal de Vale das Acácias")).toHaveCount(0);
    await expect(page.getByText(/VAC-DOC-/)).toHaveCount(0);
    // lista de documentos (frente B): somente documentos de AAC
    const resp = await page.goto("/ged/documentos");
    if (resp?.status() === 200) {
      await expect(page.getByText(/VAC-DOC-/)).toHaveCount(0);
      await expect(page.getByText("Contrato 001/2026").first()).toBeVisible();
      await page.goto(`/ged/documentos?q=${encodeURIComponent("iluminação pública")}`);
      await expect(page.getByText(/VAC-DOC-/)).toHaveCount(0);
    }
  });
});

test.describe("T16 – quem pode entrar no GED (e onde cai)", () => {
  test("T16h – não autenticado: páginas redirecionam para o login e a API devolve 401", async ({ page, request }) => {
    await page.goto("/ged");
    await expect(page).toHaveURL(/\/login/);
    await page.goto(`/ged/documentos/${Object.values(ids.A.documentos)[0].id}`);
    await expect(page).toHaveURL(/\/login/);
    for (const url of ["/api/v1/ged/documentos", `/api/v1/ged/documentos/${Object.values(ids.A.documentos)[0].id}/arquivo`, "/api/v1/ged/busca?q=teste"]) {
      const r = await request.get(url);
      expect(r.status(), url).toBe(401);
    }
  });

  test("T16i – usuário SÓ-GED: /dashboard e /processos redirecionam para /ged", async ({ page }) => {
    // Depende do layout das telas internas (orquestrador): usuário sem papel de licenciamento não pode ver o painel interno.
    await loginGed(page, dono.B);
    await expect(page).toHaveURL(/\/ged/);
    for (const rota of ["/dashboard", "/processos"]) {
      await page.goto(rota);
      await expect(page, `GED-only em ${rota}`).toHaveURL(/\/ged/);
      await expect(page.getByText(/Dashboard|Painel de processos/i)).toHaveCount(0);
    }
  });

  test("T16j – usuário de LICENCIAMENTO sem membro GED: /ged = 403 e API GED = 403", async ({ page, request }) => {
    // Precisa do dataset de licenciamento no mesmo banco (seed:demo). Sem ele, o login falha e o teste se pula.
    const probe = await request.post("/api/v1/auth/login", { data: { email: USUARIOS.tecnicoPrincipal, senha: SENHA_DEMO, orgao: "LOR" } });
    test.skip(!probe.ok(), "Dataset de licenciamento (seed:demo) não carregado neste ambiente.");
    const tk = (await probe.json()).access_token as string;
    for (const url of ["/api/v1/ged/documentos", `/api/v1/ged/documentos/${Object.values(ids.A.documentos)[0].id}`, "/api/v1/ged/busca?q=contrato"]) {
      const r = await request.get(url, { headers: auth(tk) });
      expect([403, 404], url).toContain(r.status());
      expect(r.status(), url).not.toBe(200);
    }
    // UI
    await page.goto("/login");
    await page.getByLabel("Órgão").selectOption("LOR").catch(() => undefined);
    await page.getByLabel("E-mail").fill(USUARIOS.tecnicoPrincipal);
    await page.getByLabel("Senha").fill(SENHA_DEMO);
    await page.getByRole("button", { name: /entrar/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
    const resp = await page.goto("/ged");
    expect(resp?.status()).toBe(403);
    const resp2 = await page.goto(`/ged/documentos/${Object.values(ids.A.documentos)[0].id}`);
    expect([403, 404]).toContain(resp2?.status());
  });
});

test.describe("T16 – protocolo (docs/ged.md §14): protocolo de um cliente é inacessível ao outro", () => {
  for (const origem of ["B", "A"] as const) {
    const alvo = OUTRO[origem];
    test(`T16k – ${origem} → ${alvo}: ficha, comprovante, ações e lista (API) = 404 / sem vazamento`, async ({ request }) => {
      const protocolos = Object.values(ids[alvo].protocolos ?? {});
      test.skip(protocolos.length === 0, "Seed sem protocolos: rode  E2E_GED_IDS=1 npm run seed:ged-demo  de novo.");
      for (const quem of [dono[origem], admin[origem]]) {
        const h = auth(await token(request, quem));
        for (const p of protocolos) {
          const rotulo = `${quem} → ${alvo}/${p.numero}`;
          expect((await request.get(`/api/v1/ged/protocolos/${p.id}`, { headers: h })).status(), `${rotulo}: ficha`).toBe(404);
          expect((await request.get(`/api/v1/ged/protocolos/${p.id}/comprovante`, { headers: h })).status(), `${rotulo}: comprovante`).toBe(404);
          expect((await request.post(`/api/v1/ged/protocolos/${p.id}/comprovante`, { headers: h })).status(), `${rotulo}: emitir comprovante`).toBe(404);
          for (const acao of ["ARQUIVAR", "ANALISAR"]) {
            expect((await request.post(`/api/v1/ged/protocolos/${p.id}`, { headers: h, data: { acao } })).status(), `${rotulo}: ${acao}`).toBe(404);
          }
        }
        // lista (e busca por assunto/número/código do outro cliente): nenhuma marca do outro cliente
        for (const url of ["/api/v1/ged/protocolos?size=100", ...protocolos.slice(0, 3).map((p) => `/api/v1/ged/protocolos?q=${encodeURIComponent(p.numero)}`)]) {
          const r = await request.get(url, { headers: h });
          expect(r.status(), url).toBe(200);
          const corpo = await r.text();
          semVazamento(corpo, marcasDe(ids[alvo]), `${quem}: ${url}`);
          for (const p of protocolos) {
            expect(corpo, `${url}: código de consulta de ${alvo}`).not.toContain(p.codigo_consulta);
            expect(corpo, `${url}: assunto de ${alvo}`).not.toContain(Object.entries(ids[alvo].protocolos ?? {}).find(([, v]) => v.id === p.id)![0]);
          }
        }
      }
    });

    test(`T16l – ${origem}: abrir por URL a ficha de protocolo de ${alvo} = 404`, async ({ page }) => {
      const protocolos = Object.values(ids[alvo].protocolos ?? {});
      test.skip(protocolos.length === 0, "Seed sem protocolos.");
      await loginGed(page, dono[origem]);
      for (const p of protocolos) {
        const resp = await page.goto(`/ged/protocolo/${p.id}`).catch(() => page.goto(`/ged/protocolo/${p.id}`));
        if (resp) expect(resp.status(), `${origem}: /ged/protocolo/${p.id}`).toBe(404);
        await expect(page.getByText(p.codigo_consulta)).toHaveCount(0);
      }
      // o livro do próprio cliente não traz assunto do outro
      await page.goto("/ged/protocolo");
      for (const assunto of Object.keys(ids[alvo].protocolos ?? {})) await expect(page.getByText(assunto, { exact: true })).toHaveCount(0);
    });
  }
});
