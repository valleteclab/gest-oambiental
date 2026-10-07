// Apoio do E2E t28 (painel /plataforma) que precisa do BANCO: `npx tsx tests/e2e/t28-banco.ts <comando> …`
//   operador <email> <senha>     garante um OPERADOR (via lib/plataforma/bootstrap – mesma porta da CLI) com a senha dada, sem troca obrigatória
//   ativar-portal <sigla>        liga o portal público de protocolo do GED do cliente (responsável = administrador, 1 assunto)
//   auditoria <sigla>            ações PLATAFORMA_* do cliente: [{acao, ator_email}]
//   usuario <email>              { trocar_senha, ativo, organizacao_sigla, operador }
//   emails-para <email>          assuntos/corpos dos e-mails enviados (caixa de teste) a um endereço
//   tentar-promover <email>      tenta promover um usuário a operador pela porta oficial → { ok, erro }
//   tentar-vincular-operador <email> <sigla>  tenta (SQL direto) vincular o operador a uma organização → mensagem do banco
// Última linha da saída: `__JSON__{…}`. Usa a DATABASE_URL do ambiente.
import path from "node:path";
import { hash } from "@node-rs/argon2";

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
    if (cmd === "operador") {
      const { promoverOperador } = await import("../../lib/plataforma/bootstrap");
      const [email, senha] = args;
      const r = await promoverOperador(prisma, { email, nome: "Operador E2E", origem: "cli", senha });
      await prisma.usuario.update({
        where: { email },
        data: { senha_hash: await hash(senha, { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 }), trocar_senha: false, falhas_login: 0, bloqueado_ate: null },
      });
      saida({ acao: r.acao });
    } else if (cmd === "ativar-portal") {
      const org = await prisma.organizacao.findFirstOrThrow({ where: { sigla: args[0] } });
      const admin = await prisma.gedMembro.findFirstOrThrow({ where: { organizacao_id: org.id, papel: "GED_ADMIN" } });
      const setor = await prisma.gedSetor.findFirstOrThrow({ where: { organizacao_id: org.id, sigla: "ADM" } });
      await prisma.gedConfig.update({ where: { organizacao_id: org.id }, data: { protocolo_portal_ativo: true, protocolo_responsavel_id: admin.usuario_id } });
      if (!(await prisma.gedProtocoloAssunto.count({ where: { organizacao_id: org.id } }))) {
        await prisma.gedProtocoloAssunto.create({ data: { organizacao_id: org.id, nome: "Assunto geral", destino_setor_id: setor.id } });
      }
      saida({ slug: org.slug_publico });
    } else if (cmd === "auditoria") {
      const org = await prisma.organizacao.findFirstOrThrow({ where: { sigla: args[0] } });
      const logs = await prisma.logAuditoria.findMany({ where: { organizacao_id: org.id, acao: { startsWith: "PLATAFORMA_" } }, include: { usuario: { select: { email: true } } }, orderBy: { created_at: "asc" } });
      saida(logs.map((l) => ({ acao: l.acao, ator_email: l.usuario?.email ?? null, antes: l.antes, depois: l.depois })));
    } else if (cmd === "usuario") {
      const u = await prisma.usuario.findUnique({ where: { email: args[0] }, include: { organizacao: { select: { sigla: true } }, operador: true } });
      saida(u && { trocar_senha: u.trocar_senha, ativo: u.ativo, organizacao_sigla: u.organizacao?.sigla ?? null, operador: !!u.operador });
    } else if (cmd === "emails-para") {
      const es = await prisma.emailEnviado.findMany({ where: { para: args[0] }, orderBy: { created_at: "asc" } });
      saida(es.map((e) => ({ assunto: e.assunto, corpo: e.corpo })));
    } else if (cmd === "tentar-promover") {
      const { promoverOperador } = await import("../../lib/plataforma/bootstrap");
      try {
        await promoverOperador(prisma, { email: args[0], origem: "cli" });
        saida({ ok: true });
      } catch (e) {
        saida({ ok: false, erro: (e as Error).message });
      }
    } else if (cmd === "tentar-vincular-operador") {
      const org = await prisma.organizacao.findFirstOrThrow({ where: { sigla: args[1] } });
      try {
        await prisma.usuario.update({ where: { email: args[0] }, data: { organizacao_id: org.id } });
        saida({ ok: true });
      } catch (e) {
        saida({ ok: false, erro: (e as Error).message });
      }
    } else {
      throw new Error(`Comando desconhecido: ${cmd}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
