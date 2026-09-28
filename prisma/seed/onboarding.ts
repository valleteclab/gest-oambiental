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
// Nunca apaga nada. Um município/usuário que já pertença a OUTRA organização aborta o onboarding.
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { PrismaClient, type Papel } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { z } from "zod";
import { aplicarCatalogo } from "./catalogo";
import { gerarSenhaTemporaria } from "../../lib/admin/senha";

try {
  process.loadEnvFile(path.resolve(__dirname, "../../.env"));
} catch {
  /* variáveis já no ambiente */
}

const SENHA_DEMO_PADRAO = "Demo@2026licencia";
const PAPEIS_ORG: Papel[] = ["ADMIN", "TEC_CONSORCIO", "SEMA_INEMA"];

const Sigla3 = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "sigla do município: 3 letras");
const Cliente = z.object({
  organizacao: z.object({
    nome: z.string().trim().min(3),
    sigla: z.string().trim().min(2).max(20),
    cnpj: z.string().trim().nullish(),
    logo_url: z.string().trim().nullish(),
  }),
  municipios: z
    .array(
      z.object({
        nome: z.string().trim().min(2),
        sigla: Sigla3,
        codigo_ibge: z.string().regex(/^\d{7}$/, "código IBGE: 7 dígitos"),
        uf: z.string().length(2).optional(),
        orgao_ambiental_nome: z.string().trim().min(3),
        endereco: z.string().trim().nullish(),
        email: z.string().trim().email().nullish(),
        telefone: z.string().trim().nullish(),
        lat: z.number().min(-90).max(90).nullish(),
        lng: z.number().min(-180).max(180).nullish(),
        brasao_url: z.string().trim().nullish(),
      }),
    )
    .min(1),
  usuarios: z
    .array(
      z.object({
        email: z.string().trim().toLowerCase().email(),
        nome: z.string().trim().min(3),
        cargo: z.string().trim().nullish(),
        papeis: z.array(z.object({ papel: z.enum(["ADMIN", "TEC_CONSORCIO", "TEC_MUNICIPAL", "GESTOR_MUNICIPAL", "FISCAL", "SEMA_INEMA"]), municipio: Sigla3.optional() })).min(1),
      }),
    )
    .default([]),
  catalogo: z
    .object({
      tipologias: z
        .array(z.object({ codigo: z.string().min(1), divisao: z.string().min(1), descricao: z.string().min(3), unidade: z.string().min(1), pp: z.enum(["BAIXO", "MEDIO", "ALTO"]), faixas: z.array(z.number().positive()).length(4) }))
        .default([]),
      documentos: z
        .array(z.object({ tipo_ato: z.string().min(1), tipologia: z.string().nullish(), nome: z.string().min(3), obrigatorio: z.boolean().optional(), formatos: z.string().optional() }))
        .default([]),
    })
    .default({ tipologias: [], documentos: [] }),
});
export type ClienteOnboarding = z.infer<typeof Cliente>;

/** Resolve "riachao-das-neves" → prisma/seed/clientes/riachao-das-neves.json (ou aceita um caminho de arquivo). */
export function arquivoCliente(arg: string): string {
  const candidatos = [arg, path.resolve(process.cwd(), arg), path.resolve(__dirname, "clientes", arg.endsWith(".json") ? arg : `${arg}.json`)];
  const achado = candidatos.find((c) => existsSync(c) && c.endsWith(".json"));
  if (!achado) throw new Error(`Arquivo do cliente não encontrado: ${arg} (procure em prisma/seed/clientes/).`);
  return achado;
}

export async function onboarding(prisma: PrismaClient, cliente: ClienteOnboarding, opts: { demo?: boolean; atualizar?: boolean; redefinirSenhas?: boolean; senha?: string | null } = {}) {
  const log = (...a: unknown[]) => console.log("[onboard]", ...a);
  const c = cliente;

  // ── Organização ──
  let org = await prisma.organizacao.findFirst({ where: { sigla: c.organizacao.sigla } });
  const dadosOrg = { nome: c.organizacao.nome, sigla: c.organizacao.sigla, cnpj: c.organizacao.cnpj ?? null, logo_url: c.organizacao.logo_url ?? null };
  if (!org) {
    org = await prisma.organizacao.create({ data: dadosOrg });
    log(`organização criada: ${org.nome} (${org.sigla})`);
  } else if (opts.atualizar) {
    org = await prisma.organizacao.update({ where: { id: org.id }, data: dadosOrg });
    log(`organização atualizada: ${org.nome}`);
  } else log(`organização já existe: ${org.nome} (${org.sigla})`);

  // ── Municípios / órgãos ──
  const municipio: Record<string, string> = {};
  for (const m of c.municipios) {
    const dados = {
      nome: m.nome, sigla: m.sigla, orgao_ambiental_nome: m.orgao_ambiental_nome, brasao_url: m.brasao_url ?? null,
      endereco: m.endereco ?? null, email: m.email ?? null, telefone: m.telefone ?? null, latitude: m.lat ?? null, longitude: m.lng ?? null,
    };
    const existente = await prisma.municipio.findUnique({ where: { codigo_ibge: m.codigo_ibge } });
    if (existente && existente.organizacao_id !== org.id) throw new Error(`Município ${m.nome} (IBGE ${m.codigo_ibge}) já pertence a outra organização – abortado.`);
    const siglaEmUso = await prisma.municipio.findUnique({ where: { sigla: m.sigla } });
    if (siglaEmUso && siglaEmUso.codigo_ibge !== m.codigo_ibge) throw new Error(`Sigla ${m.sigla} já usada por ${siglaEmUso.nome} – escolha outra sigla.`);
    let reg;
    if (!existente) {
      reg = await prisma.municipio.create({ data: { ...dados, codigo_ibge: m.codigo_ibge, organizacao_id: org.id } });
      log(`município criado: ${reg.nome} (${reg.sigla}, IBGE ${reg.codigo_ibge})`);
    } else if (opts.atualizar) {
      reg = await prisma.municipio.update({ where: { id: existente.id }, data: dados });
      log(`município atualizado: ${reg.nome}`);
    } else {
      reg = existente;
      log(`município já existe: ${reg.nome} (${reg.sigla})`);
    }
    municipio[m.sigla] = reg.id;
  }

  // ── Catálogo ──
  const cat = await aplicarCatalogo(prisma, org.id, { tipologias: c.catalogo.tipologias, documentos: c.catalogo.documentos });
  // Sempre idempotente: em organização EXISTENTE (com ou sem --atualizar) acrescenta apenas os itens do catálogo-base
  // que faltam (ex.: novos tipos de ato das demandas urbanas APC/ASE/ACS) – nunca altera o que o órgão editou.
  log(`catálogo: +${cat.tipos_ato} tipos de ato, +${cat.documentos} documentos exigidos, +${cat.tipologias} tipologias, +${cat.checklists} checklists, +${cat.prazos} prazos, +${cat.feriados} feriados nacionais${cat.checklist ? ", checklist padrão" : ""}`);

  // ── Usuários iniciais ──
  const senhaFixa = opts.senha ?? (opts.demo ? SENHA_DEMO_PADRAO : null);
  const senhas: { email: string; senha: string }[] = [];
  for (const u of c.usuarios) {
    for (const p of u.papeis) {
      if (PAPEIS_ORG.includes(p.papel) && p.municipio) throw new Error(`${u.email}: o papel ${p.papel} tem escopo de organização – não informe município.`);
      if (!PAPEIS_ORG.includes(p.papel) && (!p.municipio || !municipio[p.municipio])) throw new Error(`${u.email}: o papel ${p.papel} exige um município deste cliente (${Object.keys(municipio).join(", ")}).`);
    }
    let reg = await prisma.usuario.findUnique({ where: { email: u.email } });
    if (reg && reg.organizacao_id && reg.organizacao_id !== org.id) throw new Error(`Usuário ${u.email} já pertence a outra organização – abortado.`);
    let senha: string | null = null;
    if (!reg) {
      senha = senhaFixa ?? gerarSenhaTemporaria();
      reg = await prisma.usuario.create({
        data: { email: u.email, nome: u.nome, cargo: u.cargo ?? null, organizacao_id: org.id, senha_hash: await hashSenha(senha), trocar_senha: !opts.demo },
      });
    } else {
      const data: { organizacao_id: string; senha_hash?: string; trocar_senha?: boolean; falhas_login?: number; bloqueado_ate?: null } = { organizacao_id: org.id };
      if (opts.redefinirSenhas) {
        senha = senhaFixa ?? gerarSenhaTemporaria();
        Object.assign(data, { senha_hash: await hashSenha(senha), trocar_senha: !opts.demo, falhas_login: 0, bloqueado_ate: null });
      }
      reg = await prisma.usuario.update({ where: { id: reg.id }, data });
    }
    for (const p of u.papeis) {
      const municipio_id = p.municipio ? municipio[p.municipio] : null;
      if (!(await prisma.usuarioPapel.findFirst({ where: { usuario_id: reg.id, papel: p.papel, municipio_id } }))) {
        await prisma.usuarioPapel.create({ data: { usuario_id: reg.id, papel: p.papel, municipio_id } });
      }
    }
    if (senha) senhas.push({ email: u.email, senha });
  }

  await prisma.logAuditoria.create({
    data: {
      usuario_id: null, acao: "ONBOARDING", entidade: "organizacao", entidade_id: org.id,
      depois: { sigla: org.sigla, municipios: Object.keys(municipio), usuarios: c.usuarios.map((u) => u.email), catalogo: cat, demo: !!opts.demo },
    },
  });
  return { organizacao: org, municipios: municipio, senhas, catalogo: cat };
}

/** Mesmos parâmetros de lib/auth.ts hashSenha (argon2id). */
function hashSenha(senha: string) {
  return hash(senha, { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

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
    console.log(`Órgãos: ${Object.keys(r.municipios).join(", ")}  ·  arquivo: ${path.relative(process.cwd(), arquivo)}`);
    if (r.senhas.length) {
      console.log(args.includes("--demo") ? "\nUsuários (demonstração – sem troca obrigatória):" : "\nSENHAS TEMPORÁRIAS (exibidas UMA única vez – entregue por canal seguro; troca obrigatória no 1º acesso):");
      for (const s of r.senhas) console.log(`  ${s.email.padEnd(40)} ${s.senha}`);
    } else console.log("\nNenhum usuário novo (senhas existentes preservadas; use --redefinir-senhas para gerar novas).");
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error("[onboard] falhou:", e instanceof z.ZodError ? JSON.stringify(e.issues, null, 2) : e);
    process.exit(1);
  });
}
