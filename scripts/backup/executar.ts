// CLI do backup real (mesma implementação do worker – lib/backup/executar.ts).
// Uso: npx tsx scripts/backup/executar.ts backup|restore-test
//   (ou ./scripts/backup/pg_dump.sh / ./scripts/backup/restore-test.sh). Sai com código 1 em falha.
import Module from "node:module";
import path from "node:path";

{
  const M = Module as unknown as { _resolveFilename: (req: string, ...rest: unknown[]) => string };
  const original = M._resolveFilename;
  M._resolveFilename = function (req: string, ...rest: unknown[]) {
    if (req === "server-only") return path.resolve(__dirname, "../../node_modules/server-only/empty.js");
    return original.call(this, req, ...rest);
  };
}
try {
  process.loadEnvFile(path.resolve(__dirname, "../../.env"));
} catch {
  /* variáveis já no ambiente */
}

async function main() {
  const acao = process.argv[2];
  if (acao !== "backup" && acao !== "restore-test") throw new Error("uso: executar.ts backup|restore-test");
  const { executarBackup, executarTesteRestauracao } = await import("../../lib/backup/executar");
  const { prisma } = await import("../../lib/db");
  const r = acao === "backup" ? await executarBackup({ origem: "CLI" }) : await executarTesteRestauracao({ origem: "CLI" });
  const reg = r.registro_id ? await prisma.backupRegistro.findUnique({ where: { id: r.registro_id } }) : null;
  console.log(JSON.stringify({ ...r, registro: reg && { ...reg, tamanho: reg.tamanho?.toString() } }, null, 2));
  await prisma.$disconnect();
  if (r.status !== "ok") process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
