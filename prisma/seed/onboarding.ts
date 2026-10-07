// ONBOARDING de cliente (organização/tenant) – reutilizável para qualquer novo cliente SaaS.
//
//   npm run onboard -- <cliente|arquivo.json> [--demo] [--atualizar] [--redefinir-senhas]
//   ex.: npm run onboard -- riachao-das-neves --demo        (lê prisma/seed/clientes/riachao-das-neves.json)
//
// Cria/atualiza, de forma IDEMPOTENTE:
//   - a organização (chave: sigla), os municípios/órgãos (chave: codigo_ibge) e os usuários iniciais (chave: e-mail)
//     com seus papéis – usuários internos ficam vinculados à organização (isolamento por cliente);
//   - o catálogo-base da organização (tipos de ato, documentos exigidos, tipologias, checklist, prazos e feriados
//     nacionais – prisma/seed/catalogo.ts) + tipologias/documentos extras do JSON do cliente.
// Senhas: cada usuário NOVO recebe uma senha temporária impressa UMA vez (troca obrigatória no 1º acesso).
//   --demo: senha = ONBOARD_SENHA (ou a senha demo padrão) e trocar_senha = false (apresentações).
//   ONBOARD_SENHA sem --demo: usa essa senha, mas mantém a troca obrigatória.
// --atualizar: sobrescreve dados cadastrais da organização/municípios com os do JSON (padrão: só cria o que falta,
//   preservando o que o órgão editou em /admin). --redefinir-senhas: gera nova senha para usuários já existentes.
// Atualização de catálogo: toda execução (inclusive `--atualizar` em cliente já implantado) acrescenta os itens do
//   catálogo-base que ainda faltam na organização (tipos de ato, documentos, tipologias, checklists – ex.: demandas
//   urbanas APC/ASE/ACS) sem sobrescrever os existentes.
// Nunca apaga nada. Um município/usuário que já pertença a OUTRA organização (ou seja requerente) aborta o onboarding.
//
// MÓDULOS (docs/ged-design.md §9): `modulos` (padrão ["LICENCIAMENTO"]; aceita "LICENCIAMENTO" | "GED") grava
//   Organizacao.modulos (união com os existentes só com --atualizar). Cliente SÓ-GED não tem municípios nem catálogo de
//   licenciamento. O bloco `ged` cria, de forma idempotente: config (GedConfig), setores (chave: sigla), tipos de documento
//   e marcadores (chave: nome), árvore de pastas (chave: caminho "A/B/C"; intermediárias criadas sozinhas) e usuários
//   (`ged.usuarios`: e-mail, nome, cargo, papel_ged, setores). Usuário só-GED = Usuario com organizacao_id do cliente,
//   ZERO UsuarioPapel + GedMembro. Um e-mail pode estar em `usuarios` (licenciamento) e em `ged.usuarios` (os dois módulos).
//   ex.: npm run onboard -- ged-demo-a --demo
import path from "node:path";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ClienteSchema, arquivoCliente, onboarding } from "../../lib/plataforma/onboarding";

try {
  process.loadEnvFile(path.resolve(__dirname, "../../.env"));
} catch {
  /* variáveis já no ambiente */
}

// A lógica vive em lib/plataforma/onboarding.ts (compartilhada com o painel /plataforma); reexportada aqui para os
// seeds, testes e scripts que importam deste arquivo.
export * from "../../lib/plataforma/onboarding";
const Cliente = ClienteSchema;

async function main() {
  const args = process.argv.slice(2);
  const alvo = args.find((a) => !a.startsWith("--"));
  if (!alvo) {
    console.error("Uso: npm run onboard -- <cliente|arquivo.json> [--demo] [--atualizar] [--redefinir-senhas]");
    process.exit(2);
  }
  const arquivo = arquivoCliente(alvo);
  const cliente = Cliente.parse(JSON.parse(readFileSync(arquivo, "utf8")));
  const prisma = new PrismaClient();
  try {
    const r = await onboarding(prisma, cliente, {
      demo: args.includes("--demo"),
      atualizar: args.includes("--atualizar"),
      redefinirSenhas: args.includes("--redefinir-senhas"),
      senha: process.env.ONBOARD_SENHA || null,
    });
    console.log(`\n══════════ Onboarding concluído: ${r.organizacao.nome} (${r.organizacao.sigla}) ══════════`);
    console.log(`Módulos: ${r.organizacao.modulos.join(", ")}  ·  Órgãos: ${Object.keys(r.municipios).join(", ") || "—"}  ·  arquivo: ${path.relative(process.cwd(), arquivo)}`);
    if (r.ged) console.log(`GED: ${Object.keys(r.ged.setores).length} setores, ${Object.keys(r.ged.pastas).length} pastas, ${Object.keys(r.ged.tipos).length} tipos, ${Object.keys(r.ged.marcadores).length} marcadores, ${Object.keys(r.ged.usuarios).length} usuários  ·  acesso em /ged`);
    if (r.senhas.length) {
      console.log(args.includes("--demo") ? "\nUsuários (demonstração – sem troca obrigatória):" : "\nSENHAS TEMPORÁRIAS (exibidas UMA única vez – entregue por canal seguro; troca obrigatória no 1º acesso):");
      for (const s of r.senhas) console.log(`  ${s.email.padEnd(40)} ${s.senha}`);
    } else console.log("\nNenhum usuário novo (senhas existentes preservadas; use --redefinir-senhas para gerar novas).");
  } finally {
    await prisma.$disconnect();
  }
}

if (typeof require !== "undefined" && require.main === module) {
  main().catch((e) => {
    console.error("[onboard] falhou:", e instanceof z.ZodError ? JSON.stringify(e.issues, null, 2) : e);
    process.exit(1);
  });
}
