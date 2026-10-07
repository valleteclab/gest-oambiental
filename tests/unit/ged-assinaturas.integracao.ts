// Verificação de INTEGRAÇÃO do fluxo de assinatura (banco real + storage local + Chromium). NÃO é um teste vitest
// (o nome não termina em .test.ts) – rode contra um banco DESCARTÁVEL (linhas imutáveis não podem ser apagadas):
//
//   PGPASSWORD=postgres psql -h localhost -U postgres -c "CREATE DATABASE licenciagov_ged_d"
//   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/licenciagov_ged_d npx prisma migrate deploy
//   DATABASE_URL=… STORAGE_LOCAL_DIR=/tmp/ged-d-storage npx tsx tests/unit/ged-assinaturas.integracao.ts
//
// Fictício: tenants "gedtest-d-*". Certificado A1 de TESTE (sem valor legal) gerado em memória.
import Module from "node:module";
import path from "node:path";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { PDFDocument } from "pdf-lib";

// "server-only" lança fora do Next: usa o stub do pacote (como jobs/worker.ts). NÃO use --conditions=react-server aqui
// (quebra next/navigation, importado por lib/ged/escopo.ts).
{
  const M = Module as unknown as { _resolveFilename: (req: string, ...rest: unknown[]) => string };
  const original = M._resolveFilename;
  M._resolveFilename = function (req: string, ...rest: unknown[]) {
    if (req === "server-only") return path.resolve(__dirname, "../../node_modules/server-only/empty.js");
    return original.call(this, req, ...rest);
  };
}
try { process.loadEnvFile(path.resolve(__dirname, "../../.env")); } catch { /* ambiente */ }
if (!/licenciagov_ged_d/.test(process.env.DATABASE_URL ?? "") && process.env.GED_D_FORCAR !== "1") {
  console.error("Recusado: use um banco descartável (DATABASE_URL com licenciagov_ged_d)."); process.exit(2);
}
process.env.CANAIS_ENVIO_SIMULADO = "true";

const prisma = new PrismaClient();
let falhas = 0;
let total = 0;
const ok = (cond: unknown, msg: string) => { total++; if (!cond) { falhas++; console.log("  FALHOU:", msg); } else console.log("  ok:", msg); };
const erroDe = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as { status?: number; code?: string; message: string }; } };
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function pdf(paginas: number) {
  const d = await PDFDocument.create();
  for (let i = 0; i < paginas; i++) d.addPage([595, 842]).drawText(`Pagina ${i + 1} do contrato ficticio`, { x: 60, y: 760 });
  return Buffer.from(await d.save());
}

async function main() {
  const { hashSenha } = await import("@/lib/auth");
  const { cifrar } = await import("@/lib/crypto");
  const { gerarPfxTeste } = await import("@/lib/assinatura/teste");
  const { lerCertificado } = await import("@/lib/assinatura/certificado");
  const { verificarAssinaturaPdf } = await import("@/lib/assinatura/assinar");
  const { sessaoPorId } = await import("@/lib/sessao");
  const { ctxGedDeUsuario } = await import("@/lib/ged/escopo");
  const { gedDb, resolverCodigoVerificador, solicitacoesAbertasEntreClientes } = await import("@/lib/ged/db");
  const { criarVersao } = await import("@/lib/ged/documentos/versoes");
  const { proximoNumeroDocumentoGed } = await import("@/lib/ged/numeracao");
  const { lerArquivoGed } = await import("@/lib/ged/storage");
  const S = await import("@/lib/ged/assinaturas/servico");
  const { selarDocumento } = await import("@/lib/ged/assinaturas/selo");
  const { cancelarSolicitacoesAbertas } = await import("@/lib/ged/assinaturas/cancelamento");
  const { processarSolicitacao, varrerAssinaturas } = await import("@/lib/ged/assinaturas/lembretes");
  const { verificarPublico } = await import("@/lib/ged/assinaturas/verificacao");
  const { painelAssinaturas, solicitacoesDoDocumento, contarAguardandoMinhaAssinatura } = await import("@/lib/ged/assinaturas/consultas");
  const { verificarCadeia } = await import("@/lib/ged/assinaturas/cadeia");
  const { _zerarLimites } = await import("@/lib/limite-login");

  const SENHA = "Demo@2026licencia";
  const senhaHash = await hashSenha(SENHA);
  const meta = { ip: "203.0.113.7", user_agent: "integracao-ged-d" };
  const sufixo = Date.now().toString(36).toUpperCase().slice(-5);

  // ───────────── fixtures ─────────────
  async function criarOrg(nome: string, sigla: string) {
    return prisma.organizacao.create({ data: { nome, sigla, modulos: ["GED"] } });
  }
  async function criarUsuario(orgId: string, nome: string, papel: "GED_ADMIN" | "GED_GESTOR" | "GED_USUARIO" | "GED_LEITOR" | "GED_AUDITOR", tag: string) {
    const u = await prisma.usuario.create({ data: { nome, email: `gedtest-d-${tag}-${sufixo}@licenciagov.demo`.toLowerCase(), senha_hash: senhaHash, trocar_senha: false, organizacao_id: orgId, cargo: `Cargo ${tag}` } });
    await prisma.gedMembro.create({ data: { organizacao_id: orgId, usuario_id: u.id, papel } });
    return u;
  }
  const ctxDe = async (id: string) => { const s = await sessaoPorId(id); const r = await ctxGedDeUsuario(s!); if (!r.ok) throw new Error("sem ctx " + r.motivo); return r.ctx; };

  const orgA = await criarOrg(`Camara Municipal de Vale das Acacias (DEMO) ${sufixo}`, `VA${sufixo.slice(0, 3)}`);
  const orgB = await criarOrg(`Autarquia de Aguas do Cerrado (DEMO) ${sufixo}`, `AC${sufixo.slice(0, 3)}`);
  await prisma.gedConfig.create({ data: { organizacao_id: orgA.id, assinatura_prazo_dias: 7 } });
  await prisma.gedConfig.create({ data: { organizacao_id: orgB.id } });
  const autor = await criarUsuario(orgA.id, "Ana Beatriz Autora Souza", "GED_USUARIO", "autor");
  const s1 = await criarUsuario(orgA.id, "Bruno Carvalho Servidor", "GED_USUARIO", "s1");
  const s2 = await criarUsuario(orgA.id, "Carla Dias Leitora", "GED_LEITOR", "s2");
  const s3 = await criarUsuario(orgA.id, "Daniel Esteves Gestor", "GED_GESTOR", "s3");
  const auditor = await criarUsuario(orgA.id, "Elisa Auditora", "GED_AUDITOR", "aud");
  const leitor = await criarUsuario(orgA.id, "Fabio Leitor Sem Acesso", "GED_LEITOR", "leitor");
  const userB = await criarUsuario(orgB.id, "Gustavo Outro Cliente", "GED_USUARIO", "b1");
  const ctxAutor = await ctxDe(autor.id);
  const ctxS1 = await ctxDe(s1.id), ctxS2 = await ctxDe(s2.id), ctxS3 = await ctxDe(s3.id);
  const ctxLeitor = await ctxDe(leitor.id);
  const ctxB = await ctxDe(userB.id);

  async function novoDocumento(ctx: Awaited<ReturnType<typeof ctxDe>>, titulo: string, paginas = 3, sens: "PUBLICO" | "RESTRITO" | "SIGILOSO" = "RESTRITO") {
    return ctx.db.$transaction(async (tx) => {
      const numero = await proximoNumeroDocumentoGed(tx, ctx.organizacao_id);
      const d = await tx.gedDocumento.create({ data: { numero, titulo, criado_por_id: ctx.usuario.id, status: "PUBLICADO", sensibilidade: sens } as never, select: { id: true, numero: true } });
      const v = await criarVersao(tx, ctx, { documento_id: d.id, origem: "UPLOAD", arquivo: await pdf(paginas), nome_arquivo: "contrato.pdf", mime: "application/pdf" });
      return { ...d, versao: v };
    });
  }
  const sel = (ctx: Awaited<ReturnType<typeof ctxDe>>, id: string) => ctx.db.gedDocumento.findUnique({ where: { id } });

  // certificado A1 de TESTE do órgão (org A); org B sem certificado
  const pfxSenha = "teste-pfx-ged-d";
  const pfx = gerarPfxTeste({ nome: "CAMARA DEMO TESTE", documento: "99999999000191", senha: pfxSenha });
  const lido = lerCertificado(pfx, pfxSenha);
  const cert = await prisma.certificadoDigital.create({
    data: { organizacao_id: orgA.id, titular: "ORGAO", municipio_id: null, pfx_cifrado: cifrar(pfx.toString("base64")), senha_cifrada: cifrar(pfxSenha), nome_titular: lido.cn, emissor: lido.emissor, serial: lido.serial, thumbprint_sha1: lido.thumbprint_sha1, valido_de: lido.valido_de, valido_ate: lido.valido_ate, icp_brasil: false },
  });

  // ───────────── 1. PARALELO + selo PAdES ─────────────
  console.log("\n[1] fluxo PARALELO com certificado de teste");
  const d1 = await novoDocumento(ctxAutor, "Contrato de servicos graficos", 3, "RESTRITO");
  const eLeitor = await erroDe(S.solicitarAssinatura(ctxLeitor, { documento_id: d1.id, signatarios: [s1.id], modo: "PARALELO" }));
  ok(eLeitor?.status === 403, `GED_LEITOR não pode solicitar (status ${eLeitor?.status})`);
  const eB = await erroDe(S.solicitarAssinatura(ctxB, { documento_id: d1.id, signatarios: [userB.id], modo: "PARALELO" }));
  ok(eB?.status === 404, `outro tenant → 404 (status ${eB?.status})`);
  const eAud = await erroDe(S.solicitarAssinatura(ctxAutor, { documento_id: d1.id, signatarios: [auditor.id], modo: "PARALELO" }));
  ok(eAud?.status === 422, "auditor não pode ser signatário (422)");
  const eOutro = await erroDe(S.solicitarAssinatura(ctxAutor, { documento_id: d1.id, signatarios: [userB.id], modo: "PARALELO" }));
  ok(eOutro?.status === 422, "usuário de outro tenant não pode ser signatário (422)");
  const cand = await S.candidatosSignatarios(ctxAutor, "bruno");
  ok(cand.length === 1 && cand[0].id === s1.id, "busca de signatários por nome (só do tenant, sem auditor)");
  ok(!(await S.candidatosSignatarios(ctxAutor)).some((c) => c.id === userB.id || c.id === auditor.id), "candidatos não incluem outro tenant nem auditor");

  const { id: sol1 } = await S.solicitarAssinatura(ctxAutor, { documento_id: d1.id, signatarios: [s1.id, s2.id], modo: "PARALELO", mensagem: "Favor assinar até sexta." });
  const sol1db = await ctxAutor.db.gedSolicitacaoAssinatura.findUnique({ where: { id: sol1 }, include: { assinantes: true } });
  ok(sol1db?.sha256_alvo === d1.versao.sha256 && sol1db?.status === "ABERTA", "solicitação ABERTA com sha256_alvo da versão");
  ok(sol1db!.assinantes.every((a) => a.status === "PENDENTE"), "paralelo: todos PENDENTE");
  ok((await sel(ctxAutor, d1.id))?.status === "EM_ASSINATURA", "documento EM_ASSINATURA");
  const dias = (sol1db!.prazo_em.getTime() - Date.now()) / 86400000;
  ok(dias > 6.5 && dias < 8.1, `prazo padrão da config (7 dias): ${dias.toFixed(2)}`);
  const eDup = await erroDe(S.solicitarAssinatura(ctxAutor, { documento_id: d1.id, signatarios: [s3.id], modo: "PARALELO" }));
  ok(eDup?.status === 409, "só uma solicitação aberta por documento (409)");
  ok((await ctxAutor.db.gedComentario.count({ where: { solicitacao_id: sol1, contexto: "ASSINATURA" } })) === 1, "mensagem virou comentário (contexto ASSINATURA)");
  ok((await contarAguardandoMinhaAssinatura(ctxS1)) === 1, "contador 'aguardando minha assinatura' = 1");
  ok((await painelAssinaturas(ctxS1, { aba: "aguardando" })).total === 1, "painel: aguardando (signatário)");
  ok((await painelAssinaturas(ctxAutor, { aba: "enviadas" })).total === 1, "painel: enviadas (autor)");
  ok((await painelAssinaturas(ctxLeitor, { aba: "enviadas" })).total === 0 && (await painelAssinaturas(ctxB, { aba: "aguardando" })).total === 0, "painel: sem vazamento");

  // comentários antes de assinar
  await S.comentarAssinatura(ctxS1, { solicitacao_id: sol1, texto: "Tenho uma duvida na pagina 2." });
  ok((await ctxAutor.db.gedComentario.count({ where: { solicitacao_id: sol1 } })) === 2, "signatário comenta no contexto da assinatura");
  ok((await erroDe(S.comentarAssinatura(ctxLeitor, { solicitacao_id: sol1, texto: "intruso" })))?.status === 404, "quem não vê o documento não comenta");

  // senha errada x6 → bloqueio
  _zerarLimites();
  let e = await erroDe(S.assinar(ctxS1, { solicitacao_id: sol1, senha: "errada", consentimento: true }, meta));
  ok(e?.status === 401 && /4 tentativa/.test(e.message), `senha errada: 401 com tentativas restantes (${e?.message})`);
  for (let i = 0; i < 4; i++) await erroDe(S.assinar(ctxS1, { solicitacao_id: sol1, senha: "errada", consentimento: true }, meta));
  e = await erroDe(S.assinar(ctxS1, { solicitacao_id: sol1, senha: SENHA, consentimento: true }, meta));
  ok(e?.status === 429, "após 5 falhas: bloqueio 429 mesmo com a senha certa");
  _zerarLimites();
  ok((await erroDe(S.assinar(ctxS1, { solicitacao_id: sol1, senha: SENHA, consentimento: false }, meta))) !== null, "sem consentimento não assina");
  ok((await erroDe(S.assinar(ctxLeitor, { solicitacao_id: sol1, senha: SENHA, consentimento: true }, meta)))?.status === 404, "não-signatário sem VER: 404");
  ok((await erroDe(S.assinar(ctxB, { solicitacao_id: sol1, senha: SENHA, consentimento: true }, meta)))?.status === 404, "outro tenant: 404");
  ok((await erroDe(S.assinar(ctxAutor, { solicitacao_id: sol1, senha: SENHA, consentimento: true }, meta)))?.status === 403, "autor não signatário: 403");

  // assinaturas concorrentes: s1 duas vezes ao mesmo tempo + s2
  const rs = await Promise.allSettled([
    S.assinar(ctxS1, { solicitacao_id: sol1, senha: SENHA, consentimento: true }, meta),
    S.assinar(ctxS1, { solicitacao_id: sol1, senha: SENHA, consentimento: true }, meta),
    S.assinar(ctxS2, { solicitacao_id: sol1, senha: SENHA, consentimento: true }, { ip: "198.51.100.9", user_agent: "outro" }),
  ]);
  const okS1 = rs.slice(0, 2).filter((r) => r.status === "fulfilled").length;
  ok(okS1 === 1, `assinatura dupla simultânea do mesmo usuário: exatamente 1 sucesso (${okS1})`);
  const rej = rs.slice(0, 2).find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
  ok((rej?.reason as { status?: number })?.status === 409, "a segunda tentativa falha com 409");
  ok(rs[2].status === "fulfilled", "s2 assina em paralelo");
  const concl = rs.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof S.assinar>>>).value).find((v) => v.concluida);
  ok(!!concl?.selo && !concl.selo.ja_selado, "a última assinatura selou o documento");
  const d1f = await sel(ctxAutor, d1.id);
  ok(d1f?.status === "ASSINADO" && !!d1f.codigo_verificador && /^[2-9A-HJ-NP-Z]{4}(-[2-9A-HJ-NP-Z]{4}){2}$/.test(d1f.codigo_verificador!), `documento ASSINADO com código ${d1f?.codigo_verificador}`);
  const versoes = await ctxAutor.db.gedVersaoDocumento.findMany({ where: { documento_id: d1.id }, orderBy: { n: "asc" } });
  ok(versoes.length === 2 && versoes[1].origem === "SELO" && versoes[1].selada && versoes[1].derivada_de_id === d1.versao.id, "versão SELO selada derivada do original");
  ok(d1f?.versao_atual_id === versoes[1].id && d1f?.sha256_final === versoes[1].sha256, "sha256_final = hash do arquivo selado");
  const selado = await lerArquivoGed(orgA.id, versoes[1].storage_key);
  ok(sha(selado) === d1f?.sha256_final, "arquivo no storage confere com sha256_final");
  const docSel = await PDFDocument.load(selado);
  ok(docSel.getPageCount() === 4 + 0 || docSel.getPageCount() >= 4, `selado tem ${docSel.getPageCount()} páginas (3 + folha)`);
  const ver = verificarAssinaturaPdf(selado);
  ok(ver.assinado && ver.integro && ver.assinaturaValida && ver.cobreArquivo && ver.subFilter === "ETSI.CAdES.detached", `PAdES do selo válido (${ver.signatario})`);
  await writeFile("/tmp/claude-0/-home-user-gest-oambiental/bdc8a172-6679-50bb-8b85-8bcd977ba5f2/scratchpad/selado-paralelo.pdf", selado);
  const asn = await ctxAutor.db.gedAssinante.findMany({ where: { solicitacao_id: sol1 }, orderBy: { assinado_em: "asc" } });
  ok(asn.every((a) => a.status === "ASSINADO" && a.metodo === "ELETRONICA_AVANCADA" && a.reautenticacao === "SENHA" && a.hash_documento === d1.versao.sha256 && !!a.ip && !!a.user_agent), "evidências gravadas (ip, UA, método, reautenticação, hash)");
  const cadeia = verificarCadeia(d1.versao.sha256, asn.map((a) => ({ assinante_id: a.id, usuario_id: a.usuario_id, hash_documento: a.hash_documento ?? "", assinado_em: a.assinado_em, metodo: a.metodo ?? "", ordem: a.ordem, status: a.status, hash_cadeia: a.hash_cadeia })));
  ok(cadeia.ok && cadeia.elos === 2, "cadeia de hashes recalculada confere");
  ok((await ctxAutor.db.gedSolicitacaoAssinatura.findUnique({ where: { id: sol1 } }))?.status === "CONCLUIDA", "solicitação CONCLUIDA");
  ok((await prisma.logAuditoria.count({ where: { organizacao_id: orgA.id, acao: { in: ["GED_ASSINATURA_ASSINADA", "GED_DOCUMENTO_SELADO", "GED_ASSINATURA_SOLICITADA"] } } })) >= 4, "LogAuditoria registrou solicitar/assinar/selar");

  // idempotência do selo
  const again = await selarDocumento(ctxAutor, sol1);
  ok(again.ja_selado && again.sha256_final === d1f?.sha256_final, "selarDocumento de novo → já selado, mesmo hash");
  ok((await ctxAutor.db.gedVersaoDocumento.count({ where: { documento_id: d1.id } })) === 2, "sem versão duplicada");
  ok(again.com_certificado, "selo reporta PAdES");

  // imutabilidade
  ok((await erroDe(prisma.gedVersaoDocumento.update({ where: { id: versoes[1].id }, data: { nome_arquivo: "x.pdf" } }))) !== null, "versão selada é imutável (trigger)");
  ok((await erroDe(prisma.gedVersaoDocumento.delete({ where: { id: versoes[1].id } }))) !== null, "versão não pode ser excluída");
  ok((await erroDe(prisma.gedAssinante.update({ where: { id: asn[0].id }, data: { hash_cadeia: "x" } }))) !== null, "assinatura registrada é imutável (trigger)");
  ok([403, 409].includes((await erroDe(S.solicitarAssinatura(ctxAutor, { documento_id: d1.id, signatarios: [s3.id], modo: "PARALELO" })))?.status ?? 0), "documento ASSINADO não aceita nova solicitação (403/409)");
  ok((await erroDe(ctxAutor.db.$transaction(async (tx) => criarVersao(tx, ctxAutor, { documento_id: d1.id, origem: "UPLOAD", arquivo: await pdf(1), nome_arquivo: "x.pdf", mime: "application/pdf" }))))?.status === 422, "versão comum em documento selado é recusada");

  // verificação pública
  console.log("\n[2] verificação pública");
  const cod = d1f!.codigo_verificador!;
  const alvo = await resolverCodigoVerificador(cod);
  ok(alvo?.documento_id === d1.id && alvo.organizacao_id === orgA.id, "resolverCodigoVerificador devolve só ids do documento");
  ok((await resolverCodigoVerificador("AAAA-AAAA-AAAA")) === null && (await resolverCodigoVerificador("x' OR 1=1 --")) === null, "código inexistente/malformado → null");
  let pub = await verificarPublico(cod);
  ok(pub?.situacao === "VALIDO", `situação VALIDO (${pub?.situacao})`);
  ok(pub?.organizacao === orgA.nome && pub.numero === d1.numero, "mostra cliente e número");
  ok(pub?.titulo === null, "título OCULTO quando RESTRITO");
  ok(pub?.assinantes.length === 2 && pub.assinantes.some((a) => a.nome === "Bruno C. S.") && !JSON.stringify(pub).includes("Carvalho"), "nomes abreviados (sem nome completo)");
  ok(pub?.cadeia.ok && pub.cadeia.elos === 2 && pub.arquivo_integro === true && pub.pades?.assinaturaValida === true && pub.pades_ok, "cadeia, arquivo e PAdES verificados no servidor");
  ok(!JSON.stringify(pub).match(/203\.0\.113|integracao-ged-d|Favor assinar|duvida/), "sem IP, UA ou comentários na resposta pública");
  ok((await verificarPublico(cod.toLowerCase().replace(/-/g, " ")))?.codigo === cod, "aceita código em minúsculas/sem hífens");
  ok((await verificarPublico("ZZZZ-ZZZZ-ZZZZ")) === null, "código desconhecido → null (not found genérico)");
  await prisma.gedDocumento.update({ where: { id: d1.id }, data: { sensibilidade: "PUBLICO" } });
  pub = await verificarPublico(cod);
  ok(pub?.titulo === "Contrato de servicos graficos", "título EXPOSTO quando PUBLICO");
  await prisma.gedDocumento.update({ where: { id: d1.id }, data: { sensibilidade: "RESTRITO" } });

  // adulteração do arquivo selado no storage → INCONSISTENTE
  const dir = process.env.STORAGE_LOCAL_DIR!;
  const caminho = path.resolve(dir, versoes[1].storage_key);
  const bytes = await readFile(caminho);
  const trocado = Buffer.from(bytes); trocado[trocado.length - 2000] ^= 0xff;
  await writeFile(caminho, trocado);
  await writeFile(caminho, bytes); // restaura (a verificação é memorizada; a adulteração é testada em [6] com outro documento)

  // ───────────── 3. SEQUENCIAL sem certificado (org B) ─────────────
  console.log("\n[3] fluxo SEQUENCIAL sem certificado (org B) e isolamento");
  const b2 = await criarUsuario(orgB.id, "Helena Segundo Signatario", "GED_USUARIO", "b2");
  const ctxB2 = await ctxDe(b2.id);
  const dB = await novoDocumento(ctxB, "Contrato de servicos graficos", 2, "PUBLICO"); // título parecido ao do tenant A
  const { id: solB } = await S.solicitarAssinatura(ctxB, { documento_id: dB.id, signatarios: [b2.id, userB.id], modo: "SEQUENCIAL", prazo_dias: 3 });
  const rowsB = await ctxB.db.gedAssinante.findMany({ where: { solicitacao_id: solB }, orderBy: { ordem: "asc" } });
  ok(rowsB[0].status === "PENDENTE" && rowsB[1].status === "AGUARDANDO", "sequencial: 1º PENDENTE, 2º AGUARDANDO");
  let eT = await erroDe(S.assinar(ctxB, { solicitacao_id: solB, senha: SENHA, consentimento: true }, meta)); // userB é o 2º
  ok(eT?.status === 409 && /vez/.test(eT.message), `fora da vez: 409 (${eT?.message})`);
  const rB1 = await S.assinar(ctxB2, { solicitacao_id: solB, senha: SENHA, consentimento: true }, meta);
  ok(!rB1.concluida, "1º assinou; ainda não concluída");
  ok((await ctxB.db.gedAssinante.findUnique({ where: { id: rowsB[1].id } }))?.status === "PENDENTE", "2º virou PENDENTE");
  const rB2 = await S.assinar(ctxB, { solicitacao_id: solB, senha: SENHA, consentimento: true }, meta);
  ok(rB2.concluida && !!rB2.selo && !rB2.selo.com_certificado, "selo sem certificado (eletrônica avançada)");
  const dBf = await sel(ctxB, dB.id);
  const selB = await lerArquivoGed(orgB.id, (await ctxB.db.gedVersaoDocumento.findFirst({ where: { documento_id: dB.id, origem: "SELO" } }))!.storage_key);
  ok(!verificarAssinaturaPdf(selB).assinado, "sem PAdES quando não há certificado");
  const pubB = await verificarPublico(dBf!.codigo_verificador!);
  ok(pubB?.situacao === "VALIDO" && pubB.pades === null && pubB.titulo === "Contrato de servicos graficos" && pubB.organizacao === orgB.nome, "público B: válido, sem PAdES, título (PUBLICO) e só dados de B");
  ok(!JSON.stringify(pubB).includes(orgA.nome) && !JSON.stringify(pubB).includes(d1.numero), "nada do tenant A na resposta de B");
  ok((await verificarPublico(cod))?.organizacao === orgA.nome, "código de A devolve só A");
  ok(dBf!.codigo_verificador !== d1f!.codigo_verificador, "códigos distintos");
  await writeFile("/tmp/claude-0/-home-user-gest-oambiental/bdc8a172-6679-50bb-8b85-8bcd977ba5f2/scratchpad/selado-sequencial-sem-cert.pdf", selB);

  // ───────────── 4. Recusa ─────────────
  console.log("\n[4] recusa");
  const d4 = await novoDocumento(ctxAutor, "Termo de cessao", 2);
  const { id: sol4 } = await S.solicitarAssinatura(ctxAutor, { documento_id: d4.id, signatarios: [s1.id, s2.id], modo: "PARALELO" });
  ok((await erroDe(S.recusar(ctxS1, { solicitacao_id: sol4, justificativa: "curta" }, meta))) !== null, "justificativa < 10 caracteres rejeitada");
  await S.recusar(ctxS1, { solicitacao_id: sol4, justificativa: "Valor divergente do contrato original." }, meta);
  const s4 = await ctxAutor.db.gedSolicitacaoAssinatura.findUnique({ where: { id: sol4 }, include: { assinantes: true } });
  ok(s4?.status === "RECUSADA", "solicitação RECUSADA (também no paralelo)");
  ok(s4?.assinantes.find((a) => a.usuario_id === s1.id)?.status === "RECUSADO" && s4.assinantes.find((a) => a.usuario_id === s1.id)?.justificativa_recusa === "Valor divergente do contrato original.", "linha RECUSADO com justificativa");
  ok((await sel(ctxAutor, d4.id))?.status === "RECUSADO", "documento RECUSADO");
  ok((await ctxAutor.db.gedComentario.count({ where: { solicitacao_id: sol4, contexto: "RECUSA" } })) === 1, "comentário contexto RECUSA");
  ok((await prisma.logAuditoria.count({ where: { entidade_id: s4!.assinantes.find((a) => a.usuario_id === s1.id)!.id, acao: "GED_ASSINATURA_RECUSADA" } })) === 1, "LogAuditoria da recusa");
  ok((await erroDe(S.assinar(ctxS2, { solicitacao_id: sol4, senha: SENHA, consentimento: true }, meta)))?.status === 403, "ninguém mais assina solicitação recusada (403)");
  ok((await painelAssinaturas(ctxAutor, { aba: "recusadas" })).total === 1, "painel: recusadas");
  const reabre = await S.solicitarAssinatura(ctxAutor, { documento_id: d4.id, signatarios: [s3.id], modo: "SEQUENCIAL" });
  ok(!!reabre.id && (await sel(ctxAutor, d4.id))?.status === "EM_ASSINATURA", "após recusa pode abrir nova solicitação");
  ok((await solicitacoesDoDocumento(ctxAutor, d4.id)).length === 2, "histórico com 2 solicitações");

  // ───────────── 5. Cancelar / gancho ─────────────
  console.log("\n[5] cancelamento (gancho para B/C)");
  ok((await erroDe(S.cancelarSolicitacao(ctxS3, { solicitacao_id: reabre.id })))?.status === 403, "signatário não cancela");
  await ctxAutor.db.$transaction(async (tx) => {
    const n = await cancelarSolicitacoesAbertas(tx, ctxAutor, d4.id, "Documento editado (nova versão).");
    ok(n === 1, "cancelarSolicitacoesAbertas cancelou 1");
    ok((await cancelarSolicitacoesAbertas(tx, ctxAutor, d4.id, "x")) === 0, "idempotente (0 na segunda)");
  });
  ok((await ctxAutor.db.gedSolicitacaoAssinatura.findUnique({ where: { id: reabre.id } }))?.status === "CANCELADA" && (await sel(ctxAutor, d4.id))?.status === "PUBLICADO", "CANCELADA e documento volta a PUBLICADO");
  ok([403, 404].includes((await erroDe(S.assinar(ctxS3, { solicitacao_id: reabre.id, senha: SENHA, consentimento: true }, meta)))?.status ?? 0), "signatário de solicitação cancelada não assina (perde o acesso)");
  const { id: sol5 } = await S.solicitarAssinatura(ctxAutor, { documento_id: d4.id, signatarios: [s3.id], modo: "PARALELO" });
  await S.cancelarSolicitacao(ctxAutor, { solicitacao_id: sol5, motivo: "teste" });
  ok((await ctxAutor.db.gedSolicitacaoAssinatura.findUnique({ where: { id: sol5 } }))?.status === "CANCELADA", "autor cancela pela API de serviço");

  // ───────────── 6. Adulteração do arquivo antes de assinar ─────────────
  console.log("\n[6] arquivo alterado após a solicitação");
  const d6 = await novoDocumento(ctxAutor, "Ata de reuniao", 2);
  const { id: sol6 } = await S.solicitarAssinatura(ctxAutor, { documento_id: d6.id, signatarios: [s1.id], modo: "PARALELO" });
  const v6 = (await ctxAutor.db.gedVersaoDocumento.findFirst({ where: { documento_id: d6.id } }))!;
  const f6 = path.resolve(dir, v6.storage_key);
  const orig6 = await readFile(f6);
  const adulterado = Buffer.from(orig6); adulterado[adulterado.length - 30] ^= 0x01;
  await writeFile(f6, adulterado);
  eT = await erroDe(S.assinar(ctxS1, { solicitacao_id: sol6, senha: SENHA, consentimento: true }, meta));
  ok(eT?.code === "INTEGRIDADE", `assinar aborta com INTEGRIDADE (${eT?.code})`);
  ok((await ctxAutor.db.gedAssinante.findFirst({ where: { solicitacao_id: sol6 } }))?.status === "PENDENTE", "linha continua PENDENTE (nada gravado)");
  ok((await prisma.logAuditoria.count({ where: { entidade_id: sol6, acao: "GED_ASSINATURA_ABORTADA_INTEGRIDADE" } })) === 1, "tentativa abortada auditada");
  await writeFile(f6, orig6);
  const r6 = await S.assinar(ctxS1, { solicitacao_id: sol6, senha: SENHA, consentimento: true }, meta);
  ok(r6.concluida && !!r6.selo, "arquivo restaurado: assina e sela");

  // selo adulterado no storage → verificação pública acusa
  const v6s = (await ctxAutor.db.gedVersaoDocumento.findFirst({ where: { documento_id: d6.id, origem: "SELO" } }))!;
  const f6s = path.resolve(dir, v6s.storage_key);
  const o6s = await readFile(f6s);
  const t6s = Buffer.from(o6s); t6s[1200] ^= 0xff;
  await writeFile(f6s, t6s);
  const cod6 = (await sel(ctxAutor, d6.id))!.codigo_verificador!;
  const pub6 = await verificarPublico(cod6);
  ok(pub6?.situacao === "INCONSISTENTE" && pub6.arquivo_integro === false, "arquivo selado adulterado ⇒ INCONSISTENTE");
  await writeFile(f6s, o6s);

  // ───────────── 7. Selo pendente + reconciliação pelo job ─────────────
  console.log("\n[7] falha no selo e reconciliação pelo job");
  const d7 = await novoDocumento(ctxAutor, "Convenio de cooperacao", 2);
  const { id: sol7 } = await S.solicitarAssinatura(ctxAutor, { documento_id: d7.id, signatarios: [s2.id], modo: "PARALELO" });
  const pfxOriginal = cert.pfx_cifrado;
  await prisma.certificadoDigital.update({ where: { id: cert.id }, data: { pfx_cifrado: "lixo-invalido" } });
  const r7 = await S.assinar(ctxS2, { solicitacao_id: sol7, senha: SENHA, consentimento: true }, meta);
  ok(r7.concluida && r7.selo === null && !!r7.aviso_selo, "certificado quebrado: assinatura registrada, selo pendente com aviso");
  ok((await ctxAutor.db.gedSolicitacaoAssinatura.findUnique({ where: { id: sol7 } }))?.status === "ABERTA" && (await sel(ctxAutor, d7.id))?.status === "EM_ASSINATURA", "solicitação segue ABERTA (sem versão SELO)");
  ok((await ctxAutor.db.gedVersaoDocumento.count({ where: { documento_id: d7.id } })) === 1, "nenhuma versão parcial criada");
  ok((await solicitacoesDoDocumento(ctxAutor, d7.id))[0].selo_pendente, "UI recebe selo_pendente=true");
  ok((await erroDe(processarSolicitacao(orgA.id, sol7))) !== null, "job com certificado quebrado falha (será repetido), sem criar versão");
  await prisma.certificadoDigital.update({ where: { id: cert.id }, data: { pfx_cifrado: pfxOriginal } });
  ok((await processarSolicitacao(orgA.id, sol7)) === "selada", "job conclui o selo após corrigir o certificado");
  ok((await sel(ctxAutor, d7.id))?.status === "ASSINADO" && (await ctxAutor.db.gedVersaoDocumento.count({ where: { documento_id: d7.id } })) === 2, "documento ASSINADO com 1 versão SELO (sem duplicar)");
  ok((await Promise.allSettled([selarDocumento(ctxAutor, sol7), selarDocumento(ctxAutor, sol7)])).every((r) => r.status === "fulfilled") && (await ctxAutor.db.gedVersaoDocumento.count({ where: { documento_id: d7.id } })) === 2, "selos concorrentes não duplicam");

  // ───────────── 8. Lembretes e expiração ─────────────
  console.log("\n[8] lembretes e expiração");
  const d8 = await novoDocumento(ctxAutor, "Oficio circular", 1);
  const { id: sol8 } = await S.solicitarAssinatura(ctxAutor, { documento_id: d8.id, signatarios: [s1.id, s2.id], modo: "SEQUENCIAL", prazo_dias: 5 });
  const sol8db = (await prisma.gedSolicitacaoAssinatura.findUnique({ where: { id: sol8 } }))!;
  // simula: faltam ~3 dias (meio-dia em Brasília de D-3)
  const prazo = sol8db.prazo_em;
  const d3 = new Date(prazo.getTime() - 3 * 86400000 - 11 * 3600000); // 12:59 BRT do D-3
  await prisma.gedSolicitacaoAssinatura.update({ where: { id: sol8 }, data: { created_at: new Date(d3.getTime() - 10 * 86400000) } }).catch(() => undefined);
  ok((await processarSolicitacao(orgA.id, sol8, d3)) === "lembrete", "D-3: lembrete enviado");
  const l1 = (await prisma.gedAssinante.findMany({ where: { solicitacao_id: sol8 }, orderBy: { ordem: "asc" } }));
  ok(!!l1[0].ultimo_lembrete_em && l1[1].ultimo_lembrete_em === null, "só o signatário PENDENTE (da vez) foi lembrado");
  ok((await processarSolicitacao(orgA.id, sol8, new Date(d3.getTime() + 3600000))) === "nada", "mesma hora seguinte: sem repetição");
  const resumo = await varrerAssinaturas(new Date(d3.getTime() + 2 * 3600000));
  ok(resumo.erros === 0 && resumo.examinadas >= 1, `varredura geral sem erros (${JSON.stringify(resumo)})`);
  ok((await solicitacoesAbertasEntreClientes()).every((s) => !!s.organizacao_id && Object.keys(s).length === 2), "helper entre clientes devolve só id + organizacao_id");
  ok((await processarSolicitacao(orgA.id, sol8, new Date(prazo.getTime() + 60_000))) === "expirada", "após o prazo: EXPIRADA");
  const x = await prisma.gedAssinante.findMany({ where: { solicitacao_id: sol8 } });
  ok(x.every((a) => a.status === "EXPIRADO") && (await sel(ctxAutor, d8.id))?.status === "PUBLICADO", "pendentes EXPIRADO e documento volta a PUBLICADO");
  ok([403, 404].includes((await erroDe(S.assinar(ctxS1, { solicitacao_id: sol8, senha: SENHA, consentimento: true }, meta)))?.status ?? 0), "não assina solicitação expirada");
  ok((await painelAssinaturas(ctxAutor, { aba: "recusadas" })).linhas.some((l) => l.id === sol8 && l.status === "EXPIRADA"), "painel mostra EXPIRADA em Recusadas/Expiradas");
  // prazo vencido mas ainda ABERTA: assinar recusa
  const d8b = await novoDocumento(ctxAutor, "Oficio atrasado", 1);
  const { id: sol8b } = await S.solicitarAssinatura(ctxAutor, { documento_id: d8b.id, signatarios: [s1.id], modo: "PARALELO" });
  await prisma.gedSolicitacaoAssinatura.update({ where: { id: sol8b }, data: { prazo_em: new Date(Date.now() - 1000) } });
  ok((await erroDe(S.assinar(ctxS1, { solicitacao_id: sol8b, senha: SENHA, consentimento: true }, meta)))?.status === 409, "prazo vencido (antes do job): 409");

  // ───────────── 9. Isolamento do helper e dos IDs ─────────────
  console.log("\n[9] isolamento");
  ok((await gedDb(orgB.id).gedSolicitacaoAssinatura.findUnique({ where: { id: sol1 } })) === null, "B não enxerga solicitação de A pelo ID");
  ok((await erroDe(S.cancelarSolicitacao(ctxB, { solicitacao_id: sol8b })))?.status === 404, "B não cancela solicitação de A (404)");
  const detalhe = await import("@/lib/ged/assinaturas/consultas");
  ok((await erroDe(detalhe.detalheSolicitacao(ctxB, sol1)))?.status === 404, "B não vê detalhe de A (404)");
  ok((await erroDe(detalhe.detalheSolicitacao(ctxLeitor, sol1)))?.status === 404, "leitor sem vínculo não vê o detalhe (404)");

  console.log(`\n${total - falhas}/${total} verificações ok`);
  await prisma.$disconnect();
  process.exit(falhas ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
