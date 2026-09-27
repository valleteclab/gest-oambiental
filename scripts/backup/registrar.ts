// CLI: registra uma execução de backup/restauração em backup_registro.
// Uso: npx tsx scripts/backup/registrar.ts --tipo BACKUP|RESTORE_TESTE [--tamanho N] [--destino S] [--sucesso true|false] [--observacao S]
import path from "node:path";

try {
  process.loadEnvFile(path.resolve(__dirname, "../../.env"));
} catch {
  /* sem .env – usa variáveis do ambiente */
}

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const { registrarBackup } = await import("../../lib/backup/registrar");
  const { prisma } = await import("../../lib/db");
  const tipo = (arg("tipo") ?? "BACKUP").toUpperCase();
  if (tipo !== "BACKUP" && tipo !== "RESTORE_TESTE") throw new Error("--tipo deve ser BACKUP ou RESTORE_TESTE");
  const tamanho = arg("tamanho");
  const reg = await registrarBackup({
    tipo,
    tamanho: tamanho ? BigInt(tamanho) : null,
    destino: arg("destino") ?? null,
    sucesso: (arg("sucesso") ?? "true") !== "false",
    observacao: arg("observacao") ?? null,
  });
  console.log(`backup_registro ${reg.id} (${reg.tipo}, sucesso=${reg.sucesso}) gravado.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
