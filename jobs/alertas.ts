// Execução avulsa do motor de alertas (SPEC 6.1): `npx tsx jobs/alertas.ts`
// O agendamento horário fica no worker (jobs/worker.ts, fila "alertas").
import path from "node:path";

try {
  process.loadEnvFile(path.resolve(__dirname, "../.env"));
} catch {
  /* variáveis já no ambiente */
}

async function main() {
  const { gerarAlertas } = await import("../lib/alertas/gerar");
  const { prisma } = await import("../lib/db");
  const r = await gerarAlertas();
  console.log(JSON.stringify(r, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
