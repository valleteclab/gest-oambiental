// Limpeza do CONTEÚDO do GED de UM cliente (organização) – para zerar ambientes de teste/demonstração. docs/ged.md §15.
//
//   npm run ged:limpar -- <sigla|id>                                  # DRY-RUN (padrão): só imprime contagens e arquivos
//   npm run ged:limpar -- <sigla|id> --executar --confirmar=<SIGLA>   # apaga de verdade
//
// O que apaga: arquivos do storage sob ged/{organizacao_id}/ e as linhas dos documentos/protocolos/importações/assinaturas… DESSA
// organização (TABELAS_APAGADAS, filhos antes dos pais). O que preserva: membros, setores, configuração (GedConfig), tipos de
// documento, assuntos de protocolo, preferências, canais, certificado digital, usuários, o licenciamento e TODOS os outros clientes.
// O log_auditoria NUNCA é apagado: a limpeza grava nele um evento-resumo (GED_LIMPEZA_ORGANIZACAO).
//
// Como contorna as travas de imutabilidade (tramitação, comentários, versões seladas, assinantes decididos, protocolo e andamento):
//   método "replica" (padrão): `SET LOCAL session_replication_role = 'replica'` dentro de UMA transação. É local à transação/sessão
//     (não afeta outras conexões nem fica no banco), exige superusuário (ou privilégio SET no parâmetro, PG ≥ 15) e desliga os
//     triggers de usuário e as FKs – por isso a ordem de TABELAS_APAGADAS e o teste de FKs; cada DELETE leva `organizacao_id = $1`.
//   método "triggers" (fallback automático, usuário sem privilégio de replica mas dono das tabelas): `ALTER TABLE … DISABLE TRIGGER`
//     só dos triggers de DELETE (as travas de imutabilidade) das tabelas apagadas, na mesma transação. DDL é transacional: qualquer
//     erro desfaz tudo; em contrapartida o ALTER TABLE segura lock exclusivo nessas tabelas até o COMMIT (use fora do horário de pico).
// Depois dos DELETEs a transação confere que nada da organização sobrou nas tabelas apagadas (senão faz ROLLBACK).
// Ordem: banco primeiro (transação), storage depois – uma falha no meio deixa, no pior caso, arquivos órfãos (rode de novo), nunca
// registros apontando para arquivos inexistentes.
import path from "node:path";
import { rm } from "node:fs/promises";
import { PrismaClient, type Prisma } from "@prisma/client";
import { registrarAuditoria } from "@/lib/audit";
import { driverStorage, listarArquivosRecursivo, removerArquivo } from "@/lib/storage";
import {
  MSG_MANTER_DEMO,
  TABELAS_APAGADAS,
  TABELAS_PRESERVADAS,
  chaveDaOrg,
  confirmacaoValida,
  ehUuid,
  fmtBytes,
  interpretarArgs,
  prefixoStorageOrg,
  sqlApagar,
  sqlContar,
  validarSqlLimpeza,
} from "./plano-limpeza";

export type MetodoLimpeza = "replica" | "triggers";
export type OpcoesLimpeza = {
  prisma: PrismaClient;
  alvo: string;
  executar: boolean;
  confirmar: string | null;
  manterDemo?: boolean;
  /** Força o método (testes); por padrão detecta: replica se permitido, senão triggers. */
  metodo?: MetodoLimpeza;
  /** Quem executou (vai no log de auditoria). */
  origem?: string;
  log?: (linha: string) => void;
};
export type ResultadoLimpeza = {
  organizacao: { id: string; sigla: string; nome: string };
  executado: boolean;
  metodo: MetodoLimpeza;
  apagar: Record<string, number>;
  preservar: Record<string, number>;
  arquivos: { quantidade: number; bytes: number; removidos: number; falhas: number };
};

type Cli = Prisma.TransactionClient | PrismaClient;

async function contar(cli: Cli, tabela: string, orgId: string): Promise<number> {
  const r = await cli.$queryRawUnsafe<{ n: number }[]>(validarSqlLimpeza(sqlContar(tabela)), orgId);
  return Number(r[0]?.n ?? 0);
}

async function resolverOrganizacao(prisma: PrismaClient, alvo: string) {
  const sel = { id: true, sigla: true, nome: true, modulos: true } as const;
  const orgs = ehUuid(alvo)
    ? await prisma.organizacao.findMany({ where: { id: alvo.toLowerCase() }, select: sel })
    : await prisma.organizacao.findMany({ where: { sigla: { equals: alvo, mode: "insensitive" } }, select: sel });
  if (orgs.length === 0) throw new Error(`Organização não encontrada: "${alvo}". Nada foi alterado.`);
  if (orgs.length > 1) throw new Error(`A sigla "${alvo}" corresponde a ${orgs.length} organizações; use o id (uuid). Nada foi alterado.`);
  const org = orgs[0];
  if (!org.modulos.includes("GED")) throw new Error(`A organização ${org.sigla} não tem o módulo GED habilitado. Nada foi alterado.`);
  return org;
}

/** replica se o usuário do banco pode (superusuário, ou PG ≥ 15 com privilégio SET); senão triggers. */
async function detectarMetodo(prisma: PrismaClient): Promise<MetodoLimpeza> {
  const su = await prisma.$queryRawUnsafe<{ s: string }[]>("SELECT current_setting('is_superuser') AS s");
  if (su[0]?.s === "on") return "replica";
  try {
    const r = await prisma.$queryRawUnsafe<{ ok: boolean }[]>("SELECT has_parameter_privilege(current_user, 'session_replication_role', 'SET') AS ok");
    if (r[0]?.ok) return "replica";
  } catch {
    /* PG < 15: função inexistente */
  }
  return "triggers";
}

/** Triggers de DELETE (travas de imutabilidade) das tabelas apagadas, descobertos no catálogo. */
async function triggersDeDelete(tx: Cli): Promise<{ tabela: string; nome: string }[]> {
  const tabelas = TABELAS_APAGADAS.map((t) => t.tabela);
  const r = await tx.$queryRawUnsafe<{ tabela: string; nome: string }[]>(
    `SELECT c.relname AS tabela, t.tgname AS nome FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND (t.tgtype & 8) <> 0 AND c.relnamespace = current_schema()::regnamespace AND c.relname = ANY($1::text[])`,
    tabelas,
  );
  for (const x of r) if (!/^[a-z0-9_]+$/.test(x.nome) || !tabelas.includes(x.tabela)) throw new Error(`Trigger inesperado: ${x.tabela}.${x.nome}`);
  return r;
}

export async function limparOrganizacao(o: OpcoesLimpeza): Promise<ResultadoLimpeza> {
  const log = o.log ?? ((l: string) => console.log(l));
  if (o.manterDemo) throw new Error(MSG_MANTER_DEMO);
  const org = await resolverOrganizacao(o.prisma, o.alvo);
  if (o.executar && !confirmacaoValida(org.sigla, o.confirmar)) {
    throw new Error(`Confirmação ausente ou incorreta: para executar passe --confirmar=${org.sigla} (a sigla exata da organização). Nada foi alterado.`);
  }
  const metodo = o.metodo ?? (await detectarMetodo(o.prisma));
  const prefixo = prefixoStorageOrg(org.id);

  log(`Organização: ${org.nome} (${org.sigla}) – id ${org.id}`);
  log(`Modo: ${o.executar ? "EXECUÇÃO (APAGA DE VERDADE)" : "DRY-RUN (nada será alterado)"} · método de contorno das travas: ${metodo}`);

  const apagar: Record<string, number> = {};
  const preservar: Record<string, number> = {};
  for (const t of TABELAS_APAGADAS) apagar[t.tabela] = await contar(o.prisma, t.tabela, org.id);
  for (const t of TABELAS_PRESERVADAS) preservar[t.tabela] = await contar(o.prisma, t.tabela, org.id);
  const arquivos = await listarArquivosRecursivo(prefixo);
  for (const a of arquivos) if (!chaveDaOrg(org.id, a.key)) throw new Error(`Listagem de storage devolveu chave fora do cliente: ${a.key}. Abortado.`);
  const bytes = arquivos.reduce((s, a) => s + a.tamanho, 0);

  log(`\nTabelas que serão ${o.executar ? "APAGADAS" : "apagadas (dry-run)"} (organizacao_id = ${org.id}):`);
  for (const t of TABELAS_APAGADAS) log(`  ${t.tabela.padEnd(32)} ${String(apagar[t.tabela]).padStart(8)}`);
  log("Tabelas PRESERVADAS:");
  for (const t of TABELAS_PRESERVADAS) log(`  ${t.tabela.padEnd(32)} ${String(preservar[t.tabela]).padStart(8)}`);
  log(`Storage (${driverStorage()}) ${prefixo}…: ${arquivos.length} arquivo(s), ${fmtBytes(bytes)}`);
  const totalLinhas = Object.values(apagar).reduce((s, n) => s + n, 0);
  log(`Total: ${totalLinhas} linha(s) e ${arquivos.length} arquivo(s).`);

  const resultado: ResultadoLimpeza = { organizacao: { id: org.id, sigla: org.sigla, nome: org.nome }, executado: false, metodo, apagar, preservar, arquivos: { quantidade: arquivos.length, bytes, removidos: 0, falhas: 0 } };
  if (!o.executar) {
    log(`\nDRY-RUN concluído. Para apagar: npm run ged:limpar -- ${org.sigla} --executar --confirmar=${org.sigla}`);
    return resultado;
  }

  // ── Banco: UMA transação; todo DELETE filtrado por organizacao_id ──
  const apagados: Record<string, number> = {};
  await o.prisma.$transaction(
    async (tx) => {
      if (metodo === "replica") {
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        const r = await tx.$queryRawUnsafe<{ v: string }[]>("SELECT current_setting('session_replication_role') AS v");
        if (r[0]?.v !== "replica") throw new Error("Não foi possível ativar session_replication_role=replica; abortado (ROLLBACK).");
      } else {
        const gatilhos = await triggersDeDelete(tx);
        if (gatilhos.length === 0) throw new Error("Nenhum trigger de DELETE encontrado nas tabelas do GED (catálogo inesperado); abortado.");
        for (const g of gatilhos) await tx.$executeRawUnsafe(`ALTER TABLE "${g.tabela}" DISABLE TRIGGER "${g.nome}"`);
      }
      for (const t of TABELAS_APAGADAS) apagados[t.tabela] = Number(await tx.$executeRawUnsafe(validarSqlLimpeza(sqlApagar(t.tabela)), org.id));
      for (const t of TABELAS_APAGADAS) {
        const sobra = await contar(tx, t.tabela, org.id);
        if (sobra > 0) throw new Error(`Sobraram ${sobra} linha(s) em ${t.tabela} (inserção concorrente?); ROLLBACK.`);
      }
      // O log de auditoria é preservado; o evento-resumo entra na mesma transação.
      await registrarAuditoria(
        {
          usuario_id: null,
          organizacao_id: org.id,
          acao: "GED_LIMPEZA_ORGANIZACAO",
          entidade: "Organizacao",
          entidade_id: org.id,
          antes: { linhas: apagar, arquivos: { quantidade: arquivos.length, bytes } },
          depois: { apagadas: apagados, preservadas: preservar, metodo, sigla: org.sigla, origem: o.origem ?? process.env.USER ?? "cli" },
          user_agent: "scripts/ged/limpar-organizacao.ts",
        },
        tx,
      );
    },
    { timeout: 600_000, maxWait: 30_000 },
  );
  resultado.executado = true;
  log(`\nBanco: ${Object.values(apagados).reduce((s, n) => s + n, 0)} linha(s) apagadas (transação confirmada).`);

  // ── Storage (depois do COMMIT) ──
  let removidos = 0;
  let falhas = 0;
  for (const a of arquivos) {
    try {
      await removerArquivo(a.key);
      removidos++;
    } catch (e) {
      falhas++;
      log(`  AVISO: falha ao remover ${a.key}: ${(e as Error).message}`);
    }
  }
  if (driverStorage() === "local" && falhas === 0) {
    const raiz = path.resolve(process.env.STORAGE_LOCAL_DIR ?? "./storage");
    const dir = path.resolve(raiz, prefixo.replace(/\/+$/, ""));
    if (dir.startsWith(raiz + path.sep) && (await listarArquivosRecursivo(prefixo)).length === 0) await rm(dir, { recursive: true, force: true });
  }
  resultado.arquivos.removidos = removidos;
  resultado.arquivos.falhas = falhas;
  log(`Storage: ${removidos} arquivo(s) removido(s), ${falhas} falha(s).`);
  await registrarAuditoria({ usuario_id: null, organizacao_id: org.id, acao: "GED_LIMPEZA_ARQUIVOS", entidade: "Organizacao", entidade_id: org.id, depois: { prefixo, removidos, falhas, bytes }, user_agent: "scripts/ged/limpar-organizacao.ts" }, o.prisma);
  if (falhas > 0) throw new Error(`${falhas} arquivo(s) não removido(s); rode o comando de novo para repetir só o storage.`);
  log("Limpeza concluída.");
  return resultado;
}

async function main() {
  try {
    process.loadEnvFile(path.resolve(__dirname, "../../.env"));
  } catch {
    /* variáveis já no ambiente */
  }
  let args;
  try {
    args = interpretarArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`Erro: ${(e as Error).message}`);
    process.exit(2);
  }
  const prisma = new PrismaClient();
  try {
    await limparOrganizacao({ prisma, alvo: args.alvo, executar: args.executar, confirmar: args.confirmar, manterDemo: args.manterDemo, origem: process.env.GED_LIMPAR_ORIGEM });
  } catch (e) {
    console.error(`\nERRO: ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) void main();
