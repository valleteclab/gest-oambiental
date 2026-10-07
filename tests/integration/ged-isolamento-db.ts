// Verificação com BANCO REAL do núcleo do GED (isolamento entre clientes, permissões, ACL, numeração, caminhos de pasta).
// Não faz parte do `npm test` (o unit do repo não usa banco). Rode contra um banco DESCARTÁVEL:
//
//   createdb licenciagov_gedtest && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/licenciagov_gedtest?schema=public npx prisma migrate deploy
//   GED_DB_CHECK=1 DATABASE_URL=…/licenciagov_gedtest?schema=public npx tsx tests/integration/ged-isolamento-db.ts
//
// Cria dois clientes fictícios (prefixo gedtest-) e deixa os dados no banco (auditoria é imutável). Sai com código 1 se algo falhar.
import { randomUUID } from "node:crypto";
import Module from "node:module";
import { PrismaClient, type GedAcao, type GedPapel, type GedSensibilidade, type GedStatusDocumento } from "@prisma/client";

const url = process.env.DATABASE_URL ?? "";
if (process.env.GED_DB_CHECK !== "1" || (!/gedtest/.test(url) && process.env.GED_DB_CHECK_FORCE !== "1")) {
  console.error("Defina GED_DB_CHECK=1 e use um banco com 'gedtest' no nome (ou GED_DB_CHECK_FORCE=1).");
  process.exit(2);
}

// `server-only` lança fora do bundler do Next; aqui (script Node) vira um módulo vazio.
const M = Module as unknown as { _resolveFilename: (req: string, ...r: unknown[]) => string };
const resolverOriginal = M._resolveFilename;
M._resolveFilename = function (req, ...r) {
  return req === "server-only" ? require.resolve("./vazio.cjs") : resolverOriginal.call(this, req, ...r);
};

const raw = new PrismaClient();
let falhas = 0;
let total = 0;
const ok = (cond: unknown, msg: string) => {
  total++;
  if (!cond) {
    falhas++;
    console.error(`  FALHOU: ${msg}`);
  }
};
const lanca = async (fn: () => Promise<unknown>, msg: string, regex?: RegExp) => {
  total++;
  try {
    await fn();
    falhas++;
    console.error(`  FALHOU (não lançou): ${msg}`);
  } catch (e) {
    if (regex && !regex.test(String((e as Error).message) + String((e as { code?: string }).code ?? ""))) {
      falhas++;
      console.error(`  FALHOU (erro inesperado): ${msg} -> ${(e as Error).message}`);
    }
  }
};

const ACOES: GedAcao[] = ["VER", "EDITAR", "ASSINAR", "TRAMITAR", "ADMINISTRAR", "ANONIMIZAR"];
const sufixo = randomUUID().slice(0, 6);

async function main() {
  const { gedDb, gedTransacao, NaoEncontradoGed } = await import("@/lib/ged/db");
  const { ctxGedDeUsuario } = await import("@/lib/ged/escopo");
  const { sessaoPorId } = await import("@/lib/sessao");
  const perm = await import("@/lib/ged/permissoes");
  const { concederAcl, revogarAcl, listarAcl, definirHerancaPasta } = await import("@/lib/ged/acl");
  const { proximoNumeroGed } = await import("@/lib/ged/numeracao");
  const { calcularCaminhos } = await import("@/lib/ged/pastas-caminho");

  // ── Fixtures ──
  const orgA = await raw.organizacao.create({ data: { nome: `gedtest-A-${sufixo}`, sigla: `GTA${sufixo.slice(0, 3).toUpperCase()}`, modulos: ["GED"] } });
  const orgB = await raw.organizacao.create({ data: { nome: `gedtest-B-${sufixo}`, sigla: `GTB${sufixo.slice(0, 3).toUpperCase()}`, modulos: ["GED"] } });
  const orgSemGed = await raw.organizacao.create({ data: { nome: `gedtest-L-${sufixo}`, sigla: `GTL${sufixo.slice(0, 3).toUpperCase()}`, modulos: ["LICENCIAMENTO"] } });
  const mkUser = async (org: string, rotulo: string, papel: GedPapel | null) => {
    const u = await raw.usuario.create({ data: { nome: `gedtest ${rotulo}`, email: `gedtest-${rotulo}-${sufixo}@exemplo.invalid`, senha_hash: "x", trocar_senha: false, organizacao_id: org } });
    if (papel) await raw.gedMembro.create({ data: { organizacao_id: org, usuario_id: u.id, papel } });
    return u;
  };
  const admin = await mkUser(orgA.id, "admin", "GED_ADMIN");
  const gestor = await mkUser(orgA.id, "gestor", "GED_GESTOR");
  const user1 = await mkUser(orgA.id, "user1", "GED_USUARIO");
  const user2 = await mkUser(orgA.id, "user2", "GED_USUARIO");
  const leitor = await mkUser(orgA.id, "leitor", "GED_LEITOR");
  const auditor = await mkUser(orgA.id, "auditor", "GED_AUDITOR");
  const dest = await mkUser(orgA.id, "dest", "GED_USUARIO");
  const setorUser = await mkUser(orgA.id, "setoruser", "GED_USUARIO");
  const semMembro = await mkUser(orgA.id, "semmembro", null);
  const adminB = await mkUser(orgB.id, "adminb", "GED_ADMIN");
  const user1B = await mkUser(orgB.id, "user1b", "GED_USUARIO");
  const licenc = await mkUser(orgSemGed.id, "licenc", null);
  await raw.gedMembro.create({ data: { organizacao_id: orgSemGed.id, usuario_id: licenc.id, papel: "GED_ADMIN" } }); // módulo inativo mesmo com membro

  const setor = await raw.gedSetor.create({ data: { organizacao_id: orgA.id, nome: "Setor Teste", sigla: "ST" } });
  await raw.gedSetorMembro.create({ data: { organizacao_id: orgA.id, setor_id: setor.id, usuario_id: setorUser.id } });
  const setorB = await raw.gedSetor.create({ data: { organizacao_id: orgB.id, nome: "Setor B", sigla: "SB" } });

  const ctxDe = async (u: { id: string }) => {
    const r = await ctxGedDeUsuario((await sessaoPorId(u.id))!);
    if (!r.ok) throw new Error(`sem ctx: ${r.motivo}`);
    return r.ctx;
  };
  const motivoDe = async (u: { id: string }) => {
    const r = await ctxGedDeUsuario((await sessaoPorId(u.id))!);
    return r.ok ? "OK" : r.motivo;
  };

  console.log("1) ctx e módulo");
  ok((await motivoDe(semMembro)) === "SEM_MEMBRO", "usuário sem GedMembro recusado");
  ok((await motivoDe(licenc)) === "MODULO_INATIVO", "org sem módulo GED recusada");
  ok((await motivoDe(admin)) === "OK", "admin ok");
  const cAdmin = await ctxDe(admin);
  const cGestor = await ctxDe(gestor);
  const cU1 = await ctxDe(user1);
  const cU2 = await ctxDe(user2);
  const cLeitor = await ctxDe(leitor);
  const cAud = await ctxDe(auditor);
  const cDest = await ctxDe(dest);
  const cSetor = await ctxDe(setorUser);
  const cAdminB = await ctxDe(adminB);
  const cU1B = await ctxDe(user1B);
  ok(cSetor.setor_ids.includes(setor.id), "setor_ids contém o setor ativo");

  // ── Pastas ──
  const mkPasta = async (org: string, nome: string, parent: { id: string; caminho_ids: string[]; caminho_heranca: string[]; caminho_nome: string } | null, herda = true) => {
    const id = randomUUID();
    const c = calcularCaminhos({ id, nome, herda_acl: herda }, parent);
    return raw.gedPasta.create({ data: { id, organizacao_id: org, nome, parent_id: parent?.id ?? null, herda_acl: herda, ...c } });
  };
  const R = await mkPasta(orgA.id, "Raiz", null);
  const F = await mkPasta(orgA.id, "Filha", R);
  const G = await mkPasta(orgA.id, "Isolada", R, false);
  const RB = await mkPasta(orgB.id, "Raiz B", null);
  ok(G.caminho_heranca.length === 1 && F.caminho_heranca.length === 2, "calcularCaminhos: herança cortada em herda_acl=false");

  const mkAcl = (org: string, alvo: { pasta_id?: string; documento_id?: string }, p: { usuario_id?: string; setor_id?: string }, acoes: GedAcao[], expira_em: Date | null = null, por = admin.id) =>
    raw.gedAcl.create({ data: { organizacao_id: org, ...alvo, principal_tipo: p.usuario_id ? "USUARIO" : "SETOR", ...p, acoes, expira_em, concedido_por_id: por } });
  await mkAcl(orgA.id, { pasta_id: R.id }, { usuario_id: user2.id }, ["VER", "EDITAR"]);
  await mkAcl(orgA.id, { pasta_id: R.id }, { setor_id: setor.id }, ["VER"]);
  await mkAcl(orgA.id, { pasta_id: G.id }, { usuario_id: gestor.id }, ["VER", "EDITAR", "ADMINISTRAR"]);

  const mkDoc = async (rotulo: string, o: { org?: string; pasta?: string | null; criador?: string; sens?: GedSensibilidade; status?: GedStatusDocumento; propria?: boolean; resp?: string; setorAtual?: string }) => {
    const org = o.org ?? orgA.id;
    return raw.gedDocumento.create({
      data: {
        organizacao_id: org, numero: `T-${sufixo}-${rotulo}`, titulo: `Contrato ${rotulo}`, pasta_id: o.pasta ?? null, criado_por_id: o.criador ?? user1.id,
        sensibilidade: o.sens ?? "RESTRITO", status: o.status ?? "PUBLICADO", acl_propria: o.propria ?? false, responsavel_id: o.resp ?? null, setor_atual_id: o.setorAtual ?? null,
      },
    });
  };
  const dF = await mkDoc("F", { pasta: F.id });
  const dG = await mkDoc("G", { pasta: G.id });
  const dSig = await mkDoc("SIG", { pasta: F.id, sens: "SIGILOSO" });
  const dProp = await mkDoc("PROP", { pasta: F.id, propria: true });
  const dAss = await mkDoc("ASS", { pasta: F.id, status: "ASSINADO" });
  const dExp = await mkDoc("EXP", {});
  const dLeitor = await mkDoc("LEI", {});
  const dSigAcl = await mkDoc("SIGACL", { sens: "SIGILOSO" });
  const dSigner = await mkDoc("SIGNER", { status: "EM_ASSINATURA" });
  const dTram = await mkDoc("TRAM", { resp: dest.id });
  const dTramSet = await mkDoc("TRAMSET", { setorAtual: setor.id });
  const dOutro = await mkDoc("OUTRO", { criador: user2.id });
  const dB = await mkDoc("F", { org: orgB.id, pasta: RB.id, criador: user1B.id }); // mesmo título "Contrato F" no outro cliente
  await mkAcl(orgA.id, { documento_id: dExp.id }, { usuario_id: user2.id }, ["VER"], new Date(Date.now() - 3600_000));
  await mkAcl(orgA.id, { documento_id: dLeitor.id }, { usuario_id: leitor.id }, ["EDITAR"]);
  await mkAcl(orgA.id, { documento_id: dSigAcl.id }, { usuario_id: admin.id }, ["VER"]);
  const versao = await raw.gedVersaoDocumento.create({ data: { organizacao_id: orgA.id, documento_id: dSigner.id, n: 1, origem: "UPLOAD", storage_key: "x", nome_arquivo: "a.pdf", mime: "application/pdf", tamanho: 1, sha256: "0".repeat(64), criado_por_id: user1.id } });
  const sol = await raw.gedSolicitacaoAssinatura.create({ data: { organizacao_id: orgA.id, documento_id: dSigner.id, versao_id: versao.id, sha256_alvo: "0".repeat(64), modo: "PARALELO", prazo_em: new Date(Date.now() + 86400_000), criada_por_id: user1.id } });
  await raw.gedAssinante.create({ data: { organizacao_id: orgA.id, solicitacao_id: sol.id, usuario_id: leitor.id, ordem: 1 } });
  const docsA = [dF, dG, dSig, dProp, dAss, dExp, dLeitor, dSigAcl, dSigner, dTram, dTramSet, dOutro];

  console.log("2) isolamento gedDb");
  const dbA = gedDb(orgA.id);
  const dbB = gedDb(orgB.id);
  ok((await dbA.gedDocumento.findUnique({ where: { id: dB.id } })) === null, "findUnique de doc de B por A = null");
  ok((await dbA.gedDocumento.findFirst({ where: { id: dB.id } })) === null, "findFirst");
  ok((await dbA.gedDocumento.findMany({ where: { titulo: "Contrato F" } })).every((d) => d.organizacao_id === orgA.id), "findMany só A");
  ok((await dbA.gedDocumento.count()) === docsA.length, "count só A");
  ok((await dbA.gedDocumento.findMany({ where: { OR: [{ id: dB.id }, { titulo: "Contrato F" }] } })).every((d) => d.organizacao_id === orgA.id), "OR não escapa do escopo");
  const agg = await dbA.gedDocumento.aggregate({ _count: { _all: true } });
  ok(agg._count._all === docsA.length, "aggregate escopado");
  ok((await dbA.gedDocumento.groupBy({ by: ["organizacao_id"], _count: { _all: true } })).length === 1, "groupBy só A");
  await lanca(() => dbA.gedDocumento.update({ where: { id: dB.id }, data: { titulo: "invadido" } }), "update de B por A", undefined);
  await lanca(() => dbA.gedDocumento.update({ where: { id: dB.id }, data: { titulo: "x" } }).catch((e) => { if (e instanceof NaoEncontradoGed) throw e; throw new Error("tipo errado"); }), "update de B por A é NaoEncontradoGed");
  await lanca(() => dbA.gedDocumento.delete({ where: { id: dB.id } }), "delete de B por A");
  ok((await dbA.gedDocumento.updateMany({ where: { id: dB.id }, data: { titulo: "x" } })).count === 0, "updateMany não toca B");
  ok((await dbA.gedDocumento.deleteMany({ where: { id: dB.id } })).count === 0, "deleteMany não toca B");
  ok((await raw.gedDocumento.findUnique({ where: { id: dB.id } }))?.titulo === "Contrato F", "doc de B intacto");
  await lanca(() => dbA.gedSetor.create({ data: { organizacao_id: orgB.id, nome: "x", sigla: "XX" } as never }), "create com org de B via gedDb(A)", /divergente|403/i);
  const sCriado = await dbA.gedSetor.create({ data: { nome: "Criado", sigla: "CR" } as never });
  ok(sCriado.organizacao_id === orgA.id, "create injeta organizacao_id");
  const up = await dbA.gedSetor.upsert({ where: { organizacao_id_sigla: { organizacao_id: orgA.id, sigla: "CR" } }, create: { nome: "Criado2", sigla: "CR" } as never, update: { nome: "Atualizado" } });
  ok(up.nome === "Atualizado", "upsert existente");
  // upsert com o id de B: para A "não existe" → cai no create (na org A); B nunca é alterado
  const upB = await dbA.gedSetor.upsert({ where: { id: setorB.id }, create: { nome: "i", sigla: "IN" } as never, update: { nome: "invadido" } });
  ok(upB.organizacao_id === orgA.id && upB.id !== setorB.id, "upsert por id de B cria na org A, não atualiza B");
  ok((await raw.gedSetor.findUnique({ where: { id: setorB.id } }))?.nome === "Setor B", "setor de B intacto");
  const cm = await dbA.gedSetor.createMany({ data: [{ nome: "m1", sigla: "M1" }, { nome: "m2", sigla: "M2" }] as never });
  ok(cm.count === 2, "createMany injeta");
  ok((await dbA.gedSetor.count({ where: { sigla: { in: ["M1", "M2"] } } })) === 2, "createMany gravou na org A");

  console.log("3) transação interativa mantém o escopo");
  await dbA.$transaction(async (tx) => {
    ok((await tx.gedDocumento.findUnique({ where: { id: dB.id } })) === null, "tx: findUnique B = null");
    ok((await tx.gedDocumento.count()) === docsA.length, "tx: count só A");
    const s = await tx.gedSetor.create({ data: { nome: "tx", sigla: "TX" } as never });
    ok(s.organizacao_id === orgA.id, "tx: create injeta");
    ok((await tx.gedDocumento.updateMany({ where: { id: dB.id }, data: { titulo: "y" } })).count === 0, "tx: updateMany não toca B");
  });
  await gedTransacao(orgA.id, async (tx) => {
    ok((await tx.gedDocumento.count()) === docsA.length, "gedTransacao: escopo");
  });
  // rollback desfaz
  await lanca(() => dbA.$transaction(async (tx) => { await tx.gedSetor.create({ data: { nome: "rb", sigla: "RB" } as never }); throw new Error("rollback"); }), "rollback");
  ok((await raw.gedSetor.count({ where: { sigla: "RB" } })) === 0, "rollback desfez");

  console.log("4) triggers de tenant (referência cruzada)");
  await lanca(() => raw.gedDocumento.create({ data: { organizacao_id: orgA.id, numero: `X-${sufixo}`, titulo: "x", pasta_id: RB.id, criado_por_id: user1.id } }), "doc de A com pasta de B (raw)", /23514|fora da organização/);
  await lanca(() => dbA.gedDocumento.create({ data: { numero: `Y-${sufixo}`, titulo: "y", pasta_id: RB.id, criado_por_id: user1.id } as never }), "doc de A com pasta de B (gedDb)", /23514|fora da organização/);
  await lanca(() => raw.gedAcl.create({ data: { organizacao_id: orgA.id, documento_id: dF.id, principal_tipo: "USUARIO", usuario_id: user1B.id, acoes: ["VER"], concedido_por_id: admin.id } }), "ACL de A para usuário de B", /23514|fora da organização/);
  await lanca(() => raw.gedMembro.create({ data: { organizacao_id: orgA.id, usuario_id: user1B.id, papel: "GED_LEITOR" } }), "membro de A com usuário de B", /23514|fora da organização/);

  console.log("5) permissões: podeNoDocumento == whereGedVisivel e casos esperados");
  const ctxs: [string, Awaited<ReturnType<typeof ctxDe>>][] = [["admin", cAdmin], ["gestor", cGestor], ["user1", cU1], ["user2", cU2], ["leitor", cLeitor], ["auditor", cAud], ["dest", cDest], ["setoruser", cSetor]];
  const ids = docsA.map((d) => d.id);
  const minimos = await dbA.gedDocumento.findMany({ where: { id: { in: ids } }, select: perm.SELECT_DOCUMENTO_MIN });
  const tabela = new Map<string, Map<string, GedAcao[]>>();
  for (const [nome, c] of ctxs) {
    const porDoc = await perm.acoesDosDocumentos(c, minimos);
    tabela.set(nome, porDoc);
    for (const acao of ACOES) {
      const vis = new Set((await c.db.gedDocumento.findMany({ where: { AND: [{ id: { in: ids } }, await perm.whereGedVisivel(c, acao)] }, select: { id: true } })).map((d) => d.id));
      for (const d of minimos) {
        const pode = await perm.podeNoDocumento(c, d, acao);
        if (pode !== vis.has(d.id)) ok(false, `${nome} ${acao} doc ${d.id.slice(0, 4)} (${d.status}/${d.sensibilidade}): pode=${pode} where=${vis.has(d.id)}`);
        else total++;
      }
    }
  }
  const tem = (u: string, d: { id: string }, a: GedAcao) => tabela.get(u)!.get(d.id)!.includes(a);
  ok(tem("user1", dF, "EDITAR") && tem("user1", dF, "ADMINISTRAR") === false, "criador usuário: EDITAR sim, ADMINISTRAR não (teto)");
  ok(tem("gestor", dF, "ADMINISTRAR") === false && tem("gestor", dF, "VER") === false, "gestor sem ACL em F não vê (ACL de G não herda)");
  ok(tem("user2", dF, "EDITAR") && tem("user2", dF, "VER"), "herança de pasta R->F: user2 EDITAR");
  ok(!tem("user2", dG, "VER"), "G corta herança: user2 não vê dG");
  ok(tem("gestor", dG, "ADMINISTRAR") && tem("gestor", dG, "EDITAR"), "gestor ACL de G administra dG");
  ok(!tem("user2", dSig, "VER"), "SIGILOSO desliga herança de pasta");
  ok(!tem("admin", dSig, "VER") && tem("admin", dSig, "ADMINISTRAR"), "admin não vê SIGILOSO sem ACL, mas ADMINISTRA");
  ok(tem("admin", dSigAcl, "VER"), "admin vê SIGILOSO com ACL explícita");
  ok(tem("admin", dF, "VER") && tem("admin", dF, "ADMINISTRAR") && !tem("admin", dF, "EDITAR"), "admin: VER+ADMINISTRAR em doc comum, sem EDITAR implícito");
  ok(!tem("user2", dProp, "VER"), "acl_propria não herda da pasta");
  ok(tem("user2", dAss, "VER") && !tem("user2", dAss, "EDITAR"), "ASSINADO nega EDITAR");
  ok(!tem("user2", dExp, "VER"), "ACL expirada ignorada");
  ok(tem("leitor", dLeitor, "VER") && !tem("leitor", dLeitor, "EDITAR"), "teto do leitor: ACL EDITAR vira só VER");
  ok(tem("leitor", dSigner, "ASSINAR") && tem("leitor", dSigner, "VER"), "signatário (leitor) VER+ASSINAR");
  ok(tem("dest", dTram, "TRAMITAR") && tem("dest", dTram, "VER"), "destinatário de trâmite");
  ok(tem("setoruser", dTramSet, "TRAMITAR"), "trâmite para o setor");
  ok(tem("setoruser", dF, "VER") && !tem("setoruser", dF, "EDITAR"), "ACL de pasta por setor: VER");
  ok(tabela.get("auditor")!.get(dF.id)!.length === 0 && tabela.get("auditor")!.get(dOutro.id)!.length === 0, "auditor não vê conteúdo sem ACL");
  ok(tem("user2", dOutro, "ADMINISTRAR") === false && tem("user2", dOutro, "EDITAR"), "criador user2 (usuário) EDITAR sem ADMINISTRAR");
  // outro cliente: ações vazias e exigirDocumento = 404
  ok((await perm.acoesDoDocumento(cU1, { ...(await dbB.gedDocumento.findFirstOrThrow({ where: { id: dB.id }, select: perm.SELECT_DOCUMENTO_MIN })) }))?.length === 0, "doc de outro tenant: nenhuma ação");
  await lanca(() => perm.exigirDocumento(cU1, dB.id, "VER"), "exigirDocumento de outro tenant -> 404", /não encontrado/i);
  await lanca(() => perm.exigirDocumento(cU2, dG.id, "VER"), "sem VER -> 404", /não encontrado/i);
  await lanca(() => perm.exigirDocumento(cU2, dAss.id, "EDITAR"), "VER sem EDITAR -> 403", /permissão|PROIBIDO/i);
  const pastasVisU2 = await cU2.db.gedPasta.findMany({ where: await perm.whereGedPastasVisiveis(cU2), select: { id: true } });
  ok(pastasVisU2.map((p) => p.id).sort().join() === [R.id, F.id].sort().join(), "pastas visíveis a user2: R e F (G cortada)");
  ok((await cAdmin.db.gedPasta.count({ where: await perm.whereGedPastasVisiveis(cAdmin) })) === 3, "admin vê todas as pastas do cliente (3)");

  console.log("6) serviço de ACL");
  await lanca(() => concederAcl(cU1, { alvo: { tipo: "documento", id: dF.id }, principal: { tipo: "USUARIO", id: user2.id }, acoes: ["VER"] }), "usuário (teto sem ADMINISTRAR) não concede", /permiss|encontrado/i);
  await lanca(() => concederAcl(cGestor, { alvo: { tipo: "documento", id: dG.id }, principal: { tipo: "USUARIO", id: user1B.id }, acoes: ["VER"] }), "principal de outro cliente recusado", /não encontrado|organização/i);
  await lanca(() => concederAcl(cGestor, { alvo: { tipo: "documento", id: dG.id }, principal: { tipo: "SETOR", id: setorB.id }, acoes: ["VER"] }), "setor de outro cliente recusado", /Setor não encontrado/i);
  await lanca(() => concederAcl(cGestor, { alvo: { tipo: "documento", id: dG.id }, principal: { tipo: "USUARIO", id: user2.id }, acoes: ["ASSINAR"] }), "gestor não concede além do que tem (ASSINAR)", /além/i);
  await lanca(() => concederAcl(cGestor, { alvo: { tipo: "documento", id: dB.id }, principal: { tipo: "USUARIO", id: user2.id }, acoes: ["VER"] }), "ACL em doc de outro cliente = 404", /não encontrado/i);
  await lanca(() => concederAcl(cGestor, { alvo: { tipo: "documento", id: dG.id }, principal: { tipo: "USUARIO", id: semMembro.id }, acoes: ["VER"] }), "usuário sem GedMembro recusado", /acesso ao módulo/i);
  const g1 = await concederAcl(cGestor, { alvo: { tipo: "documento", id: dG.id }, principal: { tipo: "USUARIO", id: user2.id }, acoes: ["EDITAR"], expira_em: new Date(Date.now() + 86400_000).toISOString() });
  ok(g1.criada, "gestor concedeu EDITAR em dG");
  const g2 = await concederAcl(cGestor, { alvo: { tipo: "documento", id: dG.id }, principal: { tipo: "USUARIO", id: user2.id }, acoes: ["VER", "EDITAR"] });
  ok(!g2.criada && g2.id === g1.id, "conceder de novo atualiza a mesma entrada");
  const cU2b = await ctxDe(user2);
  ok(await perm.podeNoDocumento(cU2b, (await cU2b.db.gedDocumento.findFirstOrThrow({ where: { id: dG.id }, select: perm.SELECT_DOCUMENTO_MIN })), "EDITAR"), "user2 passou a EDITAR dG");
  ok((await listarAcl(cGestor, { tipo: "documento", id: dG.id })).length === 1, "listarAcl");
  await lanca(() => listarAcl(cU2b, { tipo: "documento", id: dG.id }), "listarAcl exige ADMINISTRAR");
  await revogarAcl(cGestor, g1.id);
  ok((await raw.gedAcl.count({ where: { id: g1.id } })) === 0, "revogou");
  await lanca(() => revogarAcl(cU1B, g1.id), "revogar inexistente/outro cliente -> 404", /não encontrada/i);
  // sigiloso: admin não concede (não vê), pode revogar
  await lanca(() => concederAcl(cAdmin, { alvo: { tipo: "documento", id: dSig.id }, principal: { tipo: "USUARIO", id: user2.id }, acoes: ["VER"] }), "admin não concede em SIGILOSO que não vê", /sigiloso/i);
  const aSig = await mkAcl(orgA.id, { documento_id: dSig.id }, { usuario_id: user2.id }, ["VER"]);
  await revogarAcl(cAdmin, aSig.id);
  ok((await raw.gedAcl.count({ where: { id: aSig.id } })) === 0, "admin revoga ACL em SIGILOSO");
  const auditoria = await raw.logAuditoria.count({ where: { organizacao_id: orgA.id, acao: { startsWith: "GED_ACL_" } } });
  ok(auditoria >= 3, `auditoria com organizacao_id (${auditoria})`);

  console.log("7) herança de pasta e caminhos");
  await definirHerancaPasta(cAdmin, G.id, true);
  const G2 = await raw.gedPasta.findUniqueOrThrow({ where: { id: G.id } });
  ok(G2.herda_acl && G2.caminho_heranca.join() === [R.id, G.id].join(), "G passa a herdar de R");
  const H = await mkPasta(orgA.id, "Neta", G2);
  await definirHerancaPasta(cAdmin, G.id, false);
  const H2 = await raw.gedPasta.findUniqueOrThrow({ where: { id: H.id } });
  ok(H2.caminho_heranca.join() === [G.id, H.id].join(), "descendente recalculada ao cortar herança");

  console.log("8) numeração concorrente");
  const numeros = await Promise.all(Array.from({ length: 25 }, () => gedTransacao(orgA.id, (tx) => proximoNumeroGed(tx, orgA.id, "DOC", 2099))));
  ok(new Set(numeros).size === 25, "25 números distintos em paralelo");
  const seq = numeros.map((n) => Number(n.split("-").pop())).sort((a, b) => a - b);
  ok(seq[0] === 1 && seq[24] === 25, "sem buracos (1..25)");
  ok(numeros[0].startsWith(`${orgA.sigla}-DOC-2099-`), "formato SIGLA-DOC-ANO-NNNNNN");
  await lanca(() => gedTransacao(orgA.id, async (tx) => { await proximoNumeroGed(tx, orgA.id, "DOC", 2099); throw new Error("desfaz"); }), "tx com erro");
  ok((await gedTransacao(orgA.id, (tx) => proximoNumeroGed(tx, orgA.id, "DOC", 2099))).endsWith("000026"), "rollback devolve o número");
  ok((await gedTransacao(orgB.id, (tx) => proximoNumeroGed(tx, orgB.id, "DOC", 2099))).endsWith("000001"), "sequência independente por cliente");

  void cAdminB;
  console.log(`\n${total - falhas}/${total} verificações ok`);
  await raw.$disconnect();
  process.exit(falhas ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await raw.$disconnect();
  process.exit(1);
});
