// Apoio dos E2E do GED (t18/t20) que precisam do BANCO (não roda como spec): `npx tsx tests/e2e/t20-banco.ts <comando> …`
//   processar            envia as comunicações PENDENTES de todos os clientes (o que o worker `ged-notificar` faria) → {processadas}
//   comunicacoes <doc>   linhas de ged_comunicacao do documento (id da linha) com o e-mail enviado (assunto/corpo) → [{…}]
//   codigo-optin <usuarioId>  código de confirmação do WhatsApp pendente do usuário
//   imutavel             tenta UPDATE em ged_tramite e ged_comentario → mensagens de erro do banco
// Última linha da saída: `__JSON__{…}`. Usa a DATABASE_URL do ambiente; "server-only" apontado para o stub do pacote.
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
  /* ambiente */
}

const saida = (o: unknown) => console.log(`__JSON__${JSON.stringify(o)}`);

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    if (cmd === "processar") {
      const { processarComunicacao } = await import("../../lib/ged/notificar/enviar");
      const pend = await prisma.gedComunicacao.findMany({ where: { status: "PENDENTE" }, select: { id: true, organizacao_id: true }, orderBy: { created_at: "asc" }, take: 500 });
      const res: Record<string, number> = {};
      for (const p of pend) {
        const r = await processarComunicacao(p.organizacao_id, p.id);
        res[r] = (res[r] ?? 0) + 1;
      }
      saida({ processadas: pend.length, resultado: res });
    } else if (cmd === "comunicacoes") {
      const linhas = await prisma.gedComunicacao.findMany({ where: { documento_id: args[0] }, orderBy: { created_at: "asc" } });
      const out = [];
      for (const l of linhas) {
        const e = l.email_enviado_id ? await prisma.emailEnviado.findUnique({ where: { id: l.email_enviado_id } }) : null;
        out.push({ id: l.id, evento: l.evento, canal: l.canal, status: l.status, usuario_id: l.usuario_id, enviado_em: l.enviado_em, destinatario_mascarado: l.destinatario_mascarado, assunto: l.assunto, erro: l.erro, email: e && { para: e.para, assunto: e.assunto, corpo: e.corpo } });
      }
      saida(out);
    } else if (cmd === "codigo-optin") {
      // Código de 6 dígitos do opt-in do WhatsApp: é derivado (HMAC) do estado pendente guardado cifrado – não há outra forma de lê-lo em modo simulado.
      const { decifrar } = await import("../../lib/crypto");
      const { chaveOptinDoServidor, codigoOptin, lerPendente } = await import("../../lib/ged/notificar/regras");
      const m = await prisma.gedMembro.findFirst({ where: { usuario_id: args[0] } });
      const pend = m ? lerPendente(decifrar(m.telefone_cifrado)) : null;
      saida({ codigo: m && pend ? codigoOptin(chaveOptinDoServidor(), pend.cid, args[0], pend.tel) : null });
    } else if (cmd === "imutavel") {
      const tenta = async (sql: string) => {
        try {
          await prisma.$executeRawUnsafe(sql);
          return null;
        } catch (e) {
          return (e as Error).message.replace(/\s+/g, " ").slice(0, 200);
        }
      };
      saida({
        tramite: await tenta("UPDATE ged_tramite SET despacho = 'adulterado' WHERE id = (SELECT id FROM ged_tramite LIMIT 1)"),
        comentario: await tenta("UPDATE ged_comentario SET texto = 'adulterado' WHERE id = (SELECT id FROM ged_comentario LIMIT 1)"),
      });
    } else throw new Error(`comando desconhecido: ${cmd}`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
