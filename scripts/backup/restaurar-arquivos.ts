// Restaura os ARQUIVOS (uploads) do destino de backup para o storage da aplicação.
// Uso:  npm run backup:restore-arquivos -- [--prefixo ged/<organizacao_id>/] [--simular] [--sobrescrever] [--origem-dir <dir>]
//   Origem = o mesmo destino da replicação (BACKUP_ARQUIVOS_DIR | BACKUP_S3_* | backups/arquivos/ do storage); `--origem-dir`
//   força um diretório. Destino = storage da aplicação (STORAGE_DRIVER/S3_*/STORAGE_LOCAL_DIR). Por padrão NÃO sobrescreve
//   arquivos que já existem. Confere o sha256 de cada arquivo. Ordem na recuperação de desastre: banco primeiro (docs/restore.md).
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

function opcao(args: string[], nome: string): string | undefined {
  const i = args.indexOf(`--${nome}`);
  if (i >= 0) return args[i + 1];
  return args.find((a) => a.startsWith(`--${nome}=`))?.split("=").slice(1).join("=");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--ajuda") || args.includes("-h")) {
    console.log("Uso: npm run backup:restore-arquivos -- [--prefixo ged/<organizacao_id>/] [--simular] [--sobrescrever] [--origem-dir <dir>]");
    return;
  }
  const { destinoDiretorio, resolverDestino, restaurarArquivos } = await import("../../lib/backup/arquivos");
  const dir = opcao(args, "origem-dir");
  const origem = dir ? destinoDiretorio(dir) : resolverDestino();
  const prefixo = opcao(args, "prefixo");
  console.log(`Origem: ${origem.descricao}${prefixo ? `  ·  prefixo: ${prefixo}` : "  ·  todos os arquivos"}${args.includes("--simular") ? "  ·  SIMULAÇÃO" : ""}`);
  const r = await restaurarArquivos({ origem, prefixo, simular: args.includes("--simular"), sobrescrever: args.includes("--sobrescrever") });
  console.log(JSON.stringify({ ...r, erros: r.erros.slice(0, 20), erros_total: r.erros.length }, null, 2));
  if (r.erros.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
