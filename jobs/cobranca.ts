// Execução avulsa da sincronização das cobranças de taxas (docs/cobranca.md):
//   npm run cobranca:sync            → todas as cobranças em aberto
//   npm run cobranca:sync -- RDN     → um município (sigla)
// O agendamento diário fica no worker (jobs/worker.ts, fila "cobranca-sync").
import path from "node:path";

try {
  process.loadEnvFile(path.resolve(__dirname, "../.env"));
} catch {
  /* variáveis já no ambiente */
}

async function main() {
  const { sincronizarPendentes } = await import("../lib/cobranca/servico");
  const { prisma } = await import("../lib/db");
  const alvo = process.argv[2];
  let municipio_id: string | undefined;
  if (alvo) {
    const m = await prisma.municipio.findUnique({ where: { sigla: alvo.toUpperCase() }, select: { id: true } });
    if (!m) throw new Error(`Município ${alvo} não encontrado.`);
    municipio_id = m.id;
  }
  console.log(JSON.stringify(await sincronizarPendentes({ municipio_id }), null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
