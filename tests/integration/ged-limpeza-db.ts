// Verificação com BANCO REAL da limpeza do GED por cliente (scripts/ged/limpar-organizacao.ts, docs/ged.md §15).
// Não faz parte do `npm test`. Rode contra um banco DESCARTÁVEL e um diretório de storage DESCARTÁVEL:
//
//   createdb licenciagov_gedtest_limpeza
//   export DATABASE_URL='postgresql://postgres:postgres@localhost:5432/licenciagov_gedtest_limpeza?schema=public'
//   npx prisma migrate deploy
//   GED_DB_CHECK=1 STORAGE_LOCAL_DIR=/tmp/gedtest-storage npx tsx --conditions=react-server tests/integration/ged-limpeza-db.ts
//
// Usa o seed ged-demo (VAC e AAC, com PDFs, versões seladas, trâmites, assinaturas, protocolos…), limpa VAC e prova que AAC ficou intacta
// (linhas e arquivos), que VAC ficou vazia salvo membros/setores/configuração/tipos, que o log de auditoria foi preservado, e repete o
// ciclo (re-seed + limpeza) com o método de contorno "triggers". Sai com código 1 se algo falhar.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { limparOrganizacao } from "../../scripts/ged/limpar-organizacao";
import { TABELAS_APAGADAS, TABELAS_PRESERVADAS } from "../../scripts/ged/plano-limpeza";
import { listarArquivosRecursivo } from "../../lib/storage";

const url = process.env.DATABASE_URL ?? "";
if (process.env.GED_DB_CHECK !== "1" || !/gedtest/.test(url) || !process.env.STORAGE_LOCAL_DIR || !/gedtest/.test(process.env.STORAGE_LOCAL_DIR)) {
  console.error("Defina GED_DB_CHECK=1, use um banco com 'gedtest' no nome e STORAGE_LOCAL_DIR com 'gedtest' no caminho.");
  process.exit(2);
}
process.env.STORAGE_DRIVER = "local";
process.env.CHROMIUM_PATH ||= "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const prisma = new PrismaClient();
let falhas = 0;
let total = 0;
const ok = (c: unknown, msg: string) => {
  total++;
  if (!c) {
    falhas++;
    console.error(`  FALHOU: ${msg}`);
  }
};
const lanca = async (fn: () => Promise<unknown>, msg: string, re: RegExp) => {
  total++;
  try {
    await fn();
    falhas++;
    console.error(`  FALHOU (não lançou): ${msg}`);
  } catch (e) {
    if (!re.test((e as Error).message)) {
      falhas++;
      console.error(`  FALHOU (mensagem inesperada): ${msg} -> ${(e as Error).message}`);
    }
  }
};
const mudo = () => {};

function semear() {
  const r = spawnSync("npx", ["tsx", "--conditions=react-server", path.resolve("prisma/seed/ged-demo.ts")], { stdio: "inherit", env: process.env });
  if (r.status !== 0) throw new Error("seed ged-demo falhou");
}

async function contagens(orgId: string) {
  const out: Record<string, number> = {};
  for (const t of [...TABELAS_APAGADAS, ...TABELAS_PRESERVADAS]) {
    const r = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${t.tabela}" WHERE "organizacao_id" = $1::uuid`, orgId);
    out[t.tabela] = r[0].n;
  }
  return out;
}
const arquivos = async (orgId: string) => (await listarArquivosRecursivo(`ged/${orgId}/`)).map((a) => `${a.key}:${a.tamanho}`).sort();
const globais = async () => ({
  org: await prisma.organizacao.count(),
  usuarios: await prisma.usuario.count(),
  municipios: await prisma.municipio.count(),
  processos: await prisma.processo.count(),
});
const somaApagadas = (c: Record<string, number>) => TABELAS_APAGADAS.reduce((s, t) => s + c[t.tabela], 0);

async function ciclo(rotulo: string, metodo: "replica" | "triggers") {
  console.log(`\n── ${rotulo} (método ${metodo}) ──`);
  const vac = await prisma.organizacao.findFirstOrThrow({ where: { sigla: "VAC" } });
  const aac = await prisma.organizacao.findFirstOrThrow({ where: { sigla: "AAC" } });
  const antesV = await contagens(vac.id);
  const antesA = await contagens(aac.id);
  const arqV = await arquivos(vac.id);
  const arqA = await arquivos(aac.id);
  const glob = await globais();
  const logsAntes = await prisma.logAuditoria.count();
  const logsVac = await prisma.logAuditoria.count({ where: { organizacao_id: vac.id } });
  ok(somaApagadas(antesV) > 50, `VAC deveria ter dados do seed (tem ${somaApagadas(antesV)})`);
  ok(antesV.ged_tramite > 0 && antesV.ged_comentario > 0 && antesV.ged_protocolo > 0 && antesV.ged_assinante > 0, "VAC tem trâmite, comentário, protocolo e assinante (tabelas imutáveis)");
  ok(arqV.length > 3 && arqA.length > 3, "ambas têm arquivos no storage");
  console.log(`  VAC: ${somaApagadas(antesV)} linhas apagáveis, ${arqV.length} arquivos; AAC: ${somaApagadas(antesA)} linhas, ${arqA.length} arquivos`);

  // dry-run não altera nada
  const dry = await limparOrganizacao({ prisma, alvo: "vac", executar: false, confirmar: null, metodo, log: mudo });
  ok(!dry.executado && dry.apagar.ged_documento === antesV.ged_documento, "dry-run reporta contagens");
  ok(JSON.stringify(await contagens(vac.id)) === JSON.stringify(antesV) && (await arquivos(vac.id)).length === arqV.length, "dry-run não altera VAC");

  // proteções
  await lanca(() => limparOrganizacao({ prisma, alvo: "VAC", executar: true, confirmar: null, metodo, log: mudo }), "executar sem --confirmar", /Confirmação/);
  await lanca(() => limparOrganizacao({ prisma, alvo: "VAC", executar: true, confirmar: "AAC", metodo, log: mudo }), "confirmar com sigla errada", /Confirmação/);
  await lanca(() => limparOrganizacao({ prisma, alvo: "VAC", executar: true, confirmar: "VAC", manterDemo: true, metodo, log: mudo }), "--manter-demo", /manter-demo/);
  await lanca(() => limparOrganizacao({ prisma, alvo: "NAOEXISTE", executar: false, confirmar: null, metodo, log: mudo }), "organização inexistente", /não encontrada/);
  const semGed = await prisma.organizacao.create({ data: { nome: "Org sem GED (gedtest)", sigla: `SG${Date.now() % 100000}`, modulos: ["LICENCIAMENTO"] } });
  await lanca(() => limparOrganizacao({ prisma, alvo: semGed.id, executar: false, confirmar: null, metodo, log: mudo }), "organização sem módulo GED", /módulo GED/);
  ok(JSON.stringify(await contagens(vac.id)) === JSON.stringify(antesV), "tentativas recusadas não alteraram nada");

  // execução
  const r = await limparOrganizacao({ prisma, alvo: "VAC", executar: true, confirmar: "VAC", metodo, origem: "teste-integracao", log: mudo });
  ok(r.executado && r.arquivos.removidos === arqV.length && r.arquivos.falhas === 0, "executou e removeu todos os arquivos");
  const depoisV = await contagens(vac.id);
  const depoisA = await contagens(aac.id);
  for (const t of TABELAS_APAGADAS) ok(depoisV[t.tabela] === 0, `VAC.${t.tabela} deveria estar vazia (${depoisV[t.tabela]})`);
  for (const t of TABELAS_PRESERVADAS) ok(depoisV[t.tabela] === antesV[t.tabela], `VAC.${t.tabela} preservada (${antesV[t.tabela]} -> ${depoisV[t.tabela]})`);
  ok(depoisV.ged_membro > 0 && depoisV.ged_setor > 0 && depoisV.ged_config === 1, "VAC mantém membros, setores e configuração");
  ok(JSON.stringify(depoisA) === JSON.stringify(antesA), "AAC com contagens idênticas em todas as tabelas Ged*");
  const arqVDepois = await arquivos(vac.id);
  ok(arqVDepois.length === 0, "storage de VAC vazio");
  ok(JSON.stringify(await arquivos(aac.id)) === JSON.stringify(arqA), "storage de AAC idêntico (mesmos arquivos e tamanhos)");
  ok(JSON.stringify(await globais()) === JSON.stringify({ ...glob, org: glob.org + 1 }), "licenciamento/usuários/organizações intactos");
  ok((await prisma.logAuditoria.count({ where: { organizacao_id: vac.id } })) >= logsVac + 2, "log_auditoria preservado + eventos da limpeza");
  ok((await prisma.logAuditoria.count()) >= logsAntes + 2, "nenhum log apagado");
  const ev = await prisma.logAuditoria.findFirst({ where: { acao: "GED_LIMPEZA_ORGANIZACAO", organizacao_id: vac.id }, orderBy: { created_at: "desc" } });
  ok(ev && (ev.depois as { sigla?: string; metodo?: string })?.sigla === "VAC" && (ev.depois as { metodo?: string }).metodo === metodo, "evento-resumo gravado com contagens");
  ok(!existsSync(path.resolve(process.env.STORAGE_LOCAL_DIR!, "ged", vac.id)), "diretório de storage de VAC removido");
  // nenhuma FK pendurada nas preservadas
  const orfas = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ged_protocolo_assunto a WHERE a.organizacao_id = $1::uuid AND a.tipo_documento_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ged_tipo_documento t WHERE t.id = a.tipo_documento_id)`, vac.id);
  ok(orfas[0].n === 0, "sem referências órfãs nas tabelas preservadas");
  // dry-run depois: tudo zerado
  const dry2 = await limparOrganizacao({ prisma, alvo: vac.id, executar: false, confirmar: null, metodo, log: mudo });
  ok(Object.values(dry2.apagar).every((n) => n === 0) && dry2.arquivos.quantidade === 0, "dry-run posterior zerado");
  // idempotente
  await limparOrganizacao({ prisma, alvo: "VAC", executar: true, confirmar: "VAC", metodo, log: mudo });
  ok(JSON.stringify(await contagens(aac.id)) === JSON.stringify(antesA), "segunda execução (vazia) segue sem tocar AAC");
}

async function main() {
  semear();
  await ciclo("Ciclo 1", "replica");
  semear(); // recria os dados de VAC (idempotente por título) – prova o aviso do seed
  await ciclo("Ciclo 2 (após re-seed)", "triggers");
  console.log(`\n${total - falhas}/${total} verificações OK`);
  await prisma.$disconnect();
  process.exit(falhas ? 1 : 0);
}
void main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
