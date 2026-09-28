// Execução avulsa da sincronização do monitoramento por satélite (docs/monitoramento.md):
//   npm run monitoramento:sync                 → todos os municípios ativos com código IBGE real
//   npm run monitoramento:sync -- RDN          → um município (sigla ou código IBGE)
// O agendamento diário fica no worker (jobs/worker.ts, fila "monitoramento-sync").
// Em ambiente com proxy de saída obrigatório: NODE_USE_ENV_PROXY=1.
import path from "node:path";

try {
  process.loadEnvFile(path.resolve(__dirname, "../.env"));
} catch {
  /* variáveis já no ambiente */
}

async function main() {
  const { sincronizarMunicipio, sincronizarTodos } = await import("../lib/monitoramento/sync");
  const { prisma } = await import("../lib/db");
  const alvo = process.argv[2];
  if (alvo) {
    const m = await prisma.municipio.findFirst({ where: { OR: [{ sigla: alvo.toUpperCase() }, { codigo_ibge: alvo }] }, select: { id: true } });
    if (!m) throw new Error(`Município ${alvo} não encontrado.`);
    console.log(JSON.stringify(await sincronizarMunicipio(m.id, { origem: "cli" }), null, 2));
  } else {
    console.log(JSON.stringify(await sincronizarTodos({ origem: "cli" }), null, 2));
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
