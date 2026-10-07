// Operador da PLATAFORMA (painel /plataforma) – única forma de criar/promover/desativar operadores (docs/plataforma.md).
//
//   npm run plataforma:operador -- <email> [--nome "Nome Completo"]     cria o usuário (senha temporária impressa UMA vez) ou
//                                                                       promove um usuário existente SEM organização/papéis
//   npm run plataforma:operador -- <email> --desativar                  desativa o operador (o usuário permanece)
//   npm run plataforma:operador -- <email> --redefinir-senha            nova senha temporária (impressa uma vez) para um operador existente
//   npm run plataforma:operador -- --listar                             lista os operadores
//   npm run plataforma:operador -- --env                                bootstrap: aplica PLATAFORMA_OPERADORES (e-mails separados
//                                                                       por vírgula); idempotente. PLATAFORMA_OPERADOR_SENHA fixa a
//                                                                       senha inicial dos usuários NOVOS (troca obrigatória no 1º acesso)
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { desativarOperador, promoverOperador, redefinirSenhaOperador } from "../../lib/plataforma/bootstrap";
import { parseOperadoresEnv } from "../../lib/plataforma/regras";

try {
  process.loadEnvFile(path.resolve(__dirname, "../../.env"));
} catch {
  /* variáveis já no ambiente */
}

const imprimir = (r: { email: string; acao: string; senha?: string }) => {
  console.log(`[plataforma] ${r.email}: ${r.acao}`);
  if (r.senha) console.log(`[plataforma]   SENHA TEMPORÁRIA (exibida uma única vez; troca obrigatória no primeiro acesso): ${r.senha}`);
};

async function main() {
  const args = process.argv.slice(2);
  const prisma = new PrismaClient();
  try {
    if (args.includes("--listar")) {
      const ops = await prisma.operadorPlataforma.findMany({ include: { usuario: { select: { email: true, nome: true, ultimo_login: true } } }, orderBy: { created_at: "asc" } });
      for (const o of ops) console.log(`${o.ativo ? "ATIVO  " : "INATIVO"} ${o.usuario.email}  (${o.usuario.nome})  origem=${o.origem}  último login=${o.usuario.ultimo_login?.toISOString() ?? "nunca"}`);
      if (!ops.length) console.log("Nenhum operador cadastrado.");
      return;
    }
    if (args.includes("--env")) {
      const emails = parseOperadoresEnv(process.env.PLATAFORMA_OPERADORES);
      if (!emails.length) {
        console.log("[plataforma] PLATAFORMA_OPERADORES vazia – nada a fazer.");
        return;
      }
      for (const email of emails) imprimir(await promoverOperador(prisma, { email, origem: "env", senha: process.env.PLATAFORMA_OPERADOR_SENHA || null }));
      return;
    }
    const email = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--nome");
    if (!email || !email.includes("@")) {
      console.error('Uso: npm run plataforma:operador -- <email> [--nome "Nome"] | <email> --desativar | <email> --redefinir-senha | --listar | --env');
      process.exit(2);
    }
    if (args.includes("--desativar")) return imprimir(await desativarOperador(prisma, email));
    if (args.includes("--redefinir-senha")) return imprimir(await redefinirSenhaOperador(prisma, email, process.env.PLATAFORMA_OPERADOR_SENHA || null));
    const i = args.indexOf("--nome");
    imprimir(await promoverOperador(prisma, { email, nome: i >= 0 ? args[i + 1] : null, origem: "cli", senha: process.env.PLATAFORMA_OPERADOR_SENHA || null }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[plataforma] falhou:", e instanceof Error ? e.message : e);
  process.exit(1);
});
