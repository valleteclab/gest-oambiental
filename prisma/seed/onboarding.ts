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
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { PrismaClient, type GedPapel, type GedSensibilidade, type ModuloPlataforma, type Papel } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { z } from "zod";
import { aplicarCatalogo } from "./catalogo";
import { gerarSenhaTemporaria } from "../../lib/admin/senha";
import { calcularCaminhos, type CaminhosPasta } from "../../lib/ged/pastas-caminho";

try {
  process.loadEnvFile(path.resolve(__dirname, "../../.env"));
} catch {
  /* variáveis já no ambiente */
}

const SENHA_DEMO_PADRAO = "Demo@2026licencia";
const PAPEIS_ORG: Papel[] = ["ADMIN", "TEC_CONSORCIO", "SEMA_INEMA"];

const Sigla3 = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "sigla do município: 3 letras");
const PAPEIS_LICENCIAMENTO = ["ADMIN", "TEC_CONSORCIO", "TEC_MUNICIPAL", "GESTOR_MUNICIPAL", "FISCAL", "SEMA_INEMA"] as const;
export const PAPEIS_GED = ["GED_ADMIN", "GED_GESTOR", "GED_USUARIO", "GED_LEITOR", "GED_AUDITOR"] as const;
const SENSIBILIDADES = ["PUBLICO", "RESTRITO", "SIGILOSO"] as const;
const MODULOS = ["LICENCIAMENTO", "GED"] as const;
const PROFUNDIDADE_MAX_PASTAS = 8;

const SiglaSetor = z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,12}$/, "sigla do setor: 2 a 12 letras/números");
const UsuarioGed = z.object({
  email: z.string().trim().toLowerCase().email(),
  nome: z.string().trim().min(3),
  cargo: z.string().trim().nullish(),
  papel_ged: z.enum(PAPEIS_GED),
  /** Siglas dos setores (string) ou { sigla, chefe }. */
  setores: z.array(z.union([SiglaSetor, z.object({ sigla: SiglaSetor, chefe: z.boolean().default(false) })])).default([]),
});
const BlocoGed = z.object({
  config: z
    .object({
      cota_bytes: z.number().int().positive().nullish(),
      ia_habilitada: z.boolean().optional(),
      assinatura_prazo_dias: z.number().int().min(1).max(365).optional(),
      lembrete_dias: z.array(z.number().int().min(0).max(60)).max(10).optional(),
      retencao_acesso_log_dias: z.number().int().min(30).max(3650).optional(),
    })
    .default({}),
  setores: z.array(z.object({ nome: z.string().trim().min(2), sigla: SiglaSetor })).default([]),
  tipos_documento: z.array(z.string().trim().min(2).max(80)).default([]),
  marcadores: z.array(z.object({ nome: z.string().trim().min(2).max(60), cor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "cor: #RRGGBB").optional() })).default([]),
  /** Caminhos como "Documentação da licitação/Editais". Pastas intermediárias são criadas automaticamente. */
  pastas: z.array(z.object({ caminho: z.string().trim().min(1), herda_acl: z.boolean().optional(), sensibilidade_padrao: z.enum(SENSIBILIDADES).optional() })).default([]),
  usuarios: z.array(UsuarioGed).default([]),
});

export const ClienteSchema = z
  .object({
    modulos: z.array(z.enum(MODULOS)).min(1, "modulos: informe ao menos um módulo").default(["LICENCIAMENTO"]),
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
      .default([]),
    usuarios: z
      .array(
        z.object({
          email: z.string().trim().toLowerCase().email(),
          nome: z.string().trim().min(3),
          cargo: z.string().trim().nullish(),
          papeis: z.array(z.object({ papel: z.enum(PAPEIS_LICENCIAMENTO), municipio: Sigla3.optional() })).default([]),
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
    ged: BlocoGed.optional(),
  })
  .superRefine((c, ctx) => {
    const erro = (message: string, p: (string | number)[] = []) => ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: p });
    const licenc = c.modulos.includes("LICENCIAMENTO");
    const ged = c.modulos.includes("GED");
    if (licenc) {
      if (c.municipios.length < 1) erro("o módulo LICENCIAMENTO exige ao menos 1 município/órgão", ["municipios"]);
      c.usuarios.forEach((u, i) => u.papeis.length < 1 && erro(`${u.email}: informe ao menos 1 papel (ou use ged.usuarios para usuários só-GED)`, ["usuarios", i, "papeis"]));
    } else {
      if (c.municipios.length) erro("cliente sem o módulo LICENCIAMENTO não tem municípios", ["municipios"]);
      if (c.usuarios.length) erro("cliente sem o módulo LICENCIAMENTO não tem usuários de licenciamento – use ged.usuarios", ["usuarios"]);
      if (c.catalogo.tipologias.length || c.catalogo.documentos.length) erro("catálogo de licenciamento exige o módulo LICENCIAMENTO", ["catalogo"]);
    }
    if (c.ged && !ged) erro('o bloco "ged" exige "GED" em modulos', ["ged"]);
    if (!c.ged) return;
    const siglas = new Set<string>();
    c.ged.setores.forEach((s, i) => {
      if (siglas.has(s.sigla)) erro(`setor duplicado: ${s.sigla}`, ["ged", "setores", i]);
      siglas.add(s.sigla);
    });
    const emails = new Set<string>();
    c.ged.usuarios.forEach((u, i) => {
      if (emails.has(u.email)) erro(`usuário GED duplicado: ${u.email}`, ["ged", "usuarios", i]);
      emails.add(u.email);
      for (const st of u.setores) {
        const sg = typeof st === "string" ? st : st.sigla;
        if (!siglas.has(sg)) erro(`${u.email}: setor ${sg} não está em ged.setores`, ["ged", "usuarios", i, "setores"]);
      }
    });
    try {
      expandirPastas(c.ged.pastas);
    } catch (e) {
      erro((e as Error).message, ["ged", "pastas"]);
    }
    const nomes = (l: string[], r: string, rotulo: string) => {
      const vistos = new Set<string>();
      l.forEach((n, i) => {
        if (vistos.has(n.toLowerCase())) erro(`${rotulo} duplicado: ${n}`, ["ged", r, i]);
        vistos.add(n.toLowerCase());
      });
    };
    nomes(c.ged.tipos_documento, "tipos_documento", "tipo de documento");
    nomes(c.ged.marcadores.map((m) => m.nome), "marcadores", "marcador");
  });
export type ClienteOnboarding = z.infer<typeof ClienteSchema>;
const Cliente = ClienteSchema;

// ───────────── Pastas: expansão de caminhos (pura) ─────────────

export type PastaPlano = { caminho: string; nome: string; pai: string | null; herda_acl: boolean; sensibilidade_padrao: GedSensibilidade };

/**
 * Expande caminhos ("A/B/C") em um plano ordenado pai → filho: cria as pastas intermediárias que faltam
 * (herda_acl=true; sensibilidade = a do pai, raiz = RESTRITO). Sensibilidade não informada herda a do pai.
 * Erros (mensagem em pt-BR): segmento vazio, profundidade > 8, nome > 120, duplicidade (sem diferenciar maiúsculas).
 */
export function expandirPastas(entradas: { caminho: string; herda_acl?: boolean; sensibilidade_padrao?: GedSensibilidade }[]): PastaPlano[] {
  const explicitas = new Map<string, { herda_acl?: boolean; sensibilidade_padrao?: GedSensibilidade }>();
  const ordem: string[][] = [];
  const visto = new Set<string>();
  for (const e of entradas) {
    const partes = e.caminho.split("/").map((x) => x.trim());
    if (partes.some((x) => x === "")) throw new Error(`pasta "${e.caminho}": segmento vazio (use "A/B/C", sem barras no início/fim ou duplas)`);
    if (partes.length > PROFUNDIDADE_MAX_PASTAS) throw new Error(`pasta "${e.caminho}": profundidade máxima de ${PROFUNDIDADE_MAX_PASTAS} níveis`);
    if (partes.some((x) => x.length > 120 || x.includes("\\"))) throw new Error(`pasta "${e.caminho}": nome inválido (até 120 caracteres, sem barra invertida)`);
    const chave = partes.join("/").toLowerCase();
    if (explicitas.has(chave)) throw new Error(`pasta duplicada: ${e.caminho}`);
    explicitas.set(chave, { herda_acl: e.herda_acl, sensibilidade_padrao: e.sensibilidade_padrao });
    for (let n = 1; n <= partes.length; n++) {
      const sub = partes.slice(0, n);
      const k = sub.join("/").toLowerCase();
      if (!visto.has(k)) {
        visto.add(k);
        ordem.push(sub);
      }
    }
  }
  // pai antes do filho, mantendo a ordem de aparição entre irmãos
  const ordenadas = ordem.map((p, i) => ({ p, i })).sort((a, b) => a.p.length - b.p.length || a.i - b.i);
  const plano = new Map<string, PastaPlano>();
  for (const { p } of ordenadas) {
    const caminho = p.join("/");
    const chave = caminho.toLowerCase();
    const paiChave = p.length > 1 ? p.slice(0, -1).join("/").toLowerCase() : null;
    const pai = paiChave ? plano.get(paiChave)! : null;
    const ex = explicitas.get(chave);
    plano.set(chave, {
      caminho,
      nome: p[p.length - 1],
      pai: pai ? pai.caminho : null,
      herda_acl: ex?.herda_acl ?? true,
      sensibilidade_padrao: ex?.sensibilidade_padrao ?? pai?.sensibilidade_padrao ?? "RESTRITO",
    });
  }
  return [...plano.values()];
}

/** Módulos efetivos após o onboarding: união (com --atualizar) ou os do JSON (organização nova). Ordem estável. */
export function unirModulos(existentes: ModuloPlataforma[], novos: ModuloPlataforma[]): ModuloPlataforma[] {
  const set = new Set<ModuloPlataforma>([...existentes, ...novos]);
  return MODULOS.filter((m) => set.has(m));
}

/** Itens do onboarding GED que referem setores: normaliza string | { sigla, chefe }. */
export const setorDeUsuario = (s: string | { sigla: string; chefe?: boolean }) => (typeof s === "string" ? { sigla: s, chefe: false } : { sigla: s.sigla, chefe: !!s.chefe });


/** Resolve "riachao-das-neves" → prisma/seed/clientes/riachao-das-neves.json (ou aceita um caminho de arquivo). */
export function arquivoCliente(arg: string): string {
  const candidatos = [arg, path.resolve(process.cwd(), arg), path.resolve(__dirname, "clientes", arg.endsWith(".json") ? arg : `${arg}.json`)];
  const achado = candidatos.find((c) => existsSync(c) && c.endsWith(".json"));
  if (!achado) throw new Error(`Arquivo do cliente não encontrado: ${arg} (procure em prisma/seed/clientes/).`);
  return achado;
}

export type OpcoesOnboarding = { demo?: boolean; atualizar?: boolean; redefinirSenhas?: boolean; senha?: string | null };
export type SenhaEmitida = { email: string; senha: string };
export type ResultadoGed = {
  setores: Record<string, string>;
  pastas: Record<string, string>;
  tipos: Record<string, string>;
  marcadores: Record<string, string>;
  usuarios: Record<string, string>;
  criados: { setores: number; tipos: number; marcadores: number; pastas: number; membros: number };
};

/** Aborta se algum e-mail pertence a OUTRA organização ou é de requerente (conta global). `orgId` null = organização ainda não existe. */
export async function conferirEmails(prisma: PrismaClient, orgId: string | null, emails: string[]) {
  for (const email of new Set(emails)) {
    const reg = await prisma.usuario.findUnique({ where: { email } });
    if (!reg) continue;
    if (reg.organizacao_id && reg.organizacao_id !== orgId) throw new Error(`Usuário ${email} já pertence a outra organização – abortado.`);
    if (!reg.organizacao_id && (reg.pessoa_id || (await prisma.usuarioPapel.findFirst({ where: { usuario_id: reg.id, papel: "REQUERENTE" } })))) {
      throw new Error(`Usuário ${email} é requerente (conta global) – não pode ser vinculado a uma organização; use outro e-mail. Abortado.`);
    }
  }
}

/**
 * Cria/atualiza o usuário (chave: e-mail) vinculado à organização. Aborta se o e-mail pertence a OUTRA organização
 * ou é de um requerente (sem organização, com cadastro de pessoa ou papel REQUERENTE). Devolve a senha emitida (ou null).
 */
async function garantirUsuario(
  prisma: PrismaClient,
  orgId: string,
  u: { email: string; nome: string; cargo?: string | null },
  opts: OpcoesOnboarding,
  senhaFixa: string | null,
): Promise<{ reg: { id: string }; senha: string | null; criado: boolean }> {
  let reg = await prisma.usuario.findUnique({ where: { email: u.email } });
  if (reg && reg.organizacao_id && reg.organizacao_id !== orgId) throw new Error(`Usuário ${u.email} já pertence a outra organização – abortado.`);
  if (reg && !reg.organizacao_id) {
    const req = reg.pessoa_id || (await prisma.usuarioPapel.findFirst({ where: { usuario_id: reg.id, papel: "REQUERENTE" } }));
    if (req) throw new Error(`Usuário ${u.email} é requerente (conta global) – não pode ser vinculado a uma organização; use outro e-mail. Abortado.`);
  }
  let senha: string | null = null;
  if (!reg) {
    senha = senhaFixa ?? gerarSenhaTemporaria();
    reg = await prisma.usuario.create({
      data: { email: u.email, nome: u.nome, cargo: u.cargo ?? null, organizacao_id: orgId, senha_hash: await hashSenha(senha), trocar_senha: !opts.demo },
    });
    return { reg, senha, criado: true };
  }
  const data: { organizacao_id: string; senha_hash?: string; trocar_senha?: boolean; falhas_login?: number; bloqueado_ate?: null } = { organizacao_id: orgId };
  if (opts.redefinirSenhas) {
    senha = senhaFixa ?? gerarSenhaTemporaria();
    Object.assign(data, { senha_hash: await hashSenha(senha), trocar_senha: !opts.demo, falhas_login: 0, bloqueado_ate: null });
  }
  reg = await prisma.usuario.update({ where: { id: reg.id }, data });
  return { reg, senha, criado: false };
}

export async function onboarding(prisma: PrismaClient, cliente: ClienteOnboarding, opts: OpcoesOnboarding = {}) {
  const log = (...a: unknown[]) => console.log("[onboard]", ...a);
  const c = cliente;
  const temLicenciamento = c.modulos.includes("LICENCIAMENTO");
  const temGed = c.modulos.includes("GED");

  // ── Organização ──
  let org = await prisma.organizacao.findFirst({ where: { sigla: c.organizacao.sigla } });
  // Pré-checagem de TODOS os e-mails antes de gravar qualquer coisa (aborta sem criar nada pela metade).
  await conferirEmails(prisma, org?.id ?? null, [...c.usuarios.map((u) => u.email), ...(c.ged?.usuarios.map((u) => u.email) ?? [])]);
  const dadosOrg = { nome: c.organizacao.nome, sigla: c.organizacao.sigla, cnpj: c.organizacao.cnpj ?? null, logo_url: c.organizacao.logo_url ?? null };
  if (!org) {
    org = await prisma.organizacao.create({ data: { ...dadosOrg, modulos: unirModulos([], c.modulos) } });
    log(`organização criada: ${org.nome} (${org.sigla}) – módulos: ${org.modulos.join(", ")}`);
  } else {
    const faltando = c.modulos.filter((m) => !org!.modulos.includes(m));
    if (faltando.length && !opts.atualizar) {
      throw new Error(`Organização ${org.sigla} já existe sem o(s) módulo(s) ${faltando.join(", ")} – execute com --atualizar para habilitá-lo(s). Abortado.`);
    }
    if (opts.atualizar) {
      org = await prisma.organizacao.update({ where: { id: org.id }, data: { ...dadosOrg, modulos: unirModulos(org.modulos, c.modulos) } });
      log(`organização atualizada: ${org.nome} – módulos: ${org.modulos.join(", ")}`);
    } else log(`organização já existe: ${org.nome} (${org.sigla})`);
  }

  // ── Municípios / órgãos (só LICENCIAMENTO) ──
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

  // ── Catálogo (só LICENCIAMENTO) ──
  let cat: Awaited<ReturnType<typeof aplicarCatalogo>> | null = null;
  if (temLicenciamento) {
    cat = await aplicarCatalogo(prisma, org.id, { tipologias: c.catalogo.tipologias, documentos: c.catalogo.documentos });
    // Sempre idempotente: em organização EXISTENTE (com ou sem --atualizar) acrescenta apenas os itens do catálogo-base
    // que faltam (ex.: novos tipos de ato das demandas urbanas APC/ASE/ACS) – nunca altera o que o órgão editou.
    log(`catálogo: +${cat.tipos_ato} tipos de ato, +${cat.documentos} documentos exigidos, +${cat.tipologias} tipologias, +${cat.checklists} checklists, +${cat.prazos} prazos, +${cat.feriados} feriados nacionais${cat.checklist ? ", checklist padrão" : ""}`);
  } else log("módulo LICENCIAMENTO não contratado: catálogo, municípios e dados de licenciamento não foram criados.");

  // ── Usuários iniciais ──
  const senhaFixa = opts.senha ?? (opts.demo ? SENHA_DEMO_PADRAO : null);
  const senhas: SenhaEmitida[] = [];
  const usuarioId: Record<string, string> = {};
  for (const u of c.usuarios) {
    for (const p of u.papeis) {
      if (PAPEIS_ORG.includes(p.papel) && p.municipio) throw new Error(`${u.email}: o papel ${p.papel} tem escopo de organização – não informe município.`);
      if (!PAPEIS_ORG.includes(p.papel) && (!p.municipio || !municipio[p.municipio])) throw new Error(`${u.email}: o papel ${p.papel} exige um município deste cliente (${Object.keys(municipio).join(", ")}).`);
    }
    const { reg, senha } = await garantirUsuario(prisma, org.id, u, opts, senhaFixa);
    usuarioId[u.email] = reg.id;
    for (const p of u.papeis) {
      const municipio_id = p.municipio ? municipio[p.municipio] : null;
      if (!(await prisma.usuarioPapel.findFirst({ where: { usuario_id: reg.id, papel: p.papel, municipio_id } }))) {
        await prisma.usuarioPapel.create({ data: { usuario_id: reg.id, papel: p.papel, municipio_id } });
      }
    }
    if (senha) senhas.push({ email: u.email, senha });
  }

  // ── GED ──
  let ged: ResultadoGed | null = null;
  if (temGed) ged = await onboardingGed(prisma, org.id, c.ged, usuarioId, senhas, opts, senhaFixa, log);

  await prisma.logAuditoria.create({
    data: {
      usuario_id: null, acao: "ONBOARDING", entidade: "organizacao", entidade_id: org.id, organizacao_id: org.id,
      depois: {
        sigla: org.sigla, modulos: org.modulos, municipios: Object.keys(municipio), usuarios: c.usuarios.map((u) => u.email), catalogo: cat, demo: !!opts.demo,
        ged: ged && { ...ged.criados, usuarios: Object.keys(ged.usuarios) },
      },
    },
  });
  return { organizacao: org, municipios: municipio, senhas, catalogo: cat, ged };
}

/** Bloco GED do onboarding: config, setores, tipos, marcadores, pastas, usuários/membros. Idempotente; nunca apaga. */
async function onboardingGed(
  prisma: PrismaClient,
  orgId: string,
  bloco: ClienteOnboarding["ged"],
  usuarioId: Record<string, string>,
  senhas: SenhaEmitida[],
  opts: OpcoesOnboarding,
  senhaFixa: string | null,
  log: (...a: unknown[]) => void,
): Promise<ResultadoGed> {
  const g = bloco ?? { config: {}, setores: [], tipos_documento: [], marcadores: [], pastas: [], usuarios: [] };
  const r: ResultadoGed = { setores: {}, pastas: {}, tipos: {}, marcadores: {}, usuarios: {}, criados: { setores: 0, tipos: 0, marcadores: 0, pastas: 0, membros: 0 } };

  // Config (1 por cliente)
  const cfg = g.config;
  const dadosCfg = {
    cota_bytes: cfg.cota_bytes ?? null,
    ...(cfg.ia_habilitada !== undefined && { ia_habilitada: cfg.ia_habilitada }),
    ...(cfg.assinatura_prazo_dias !== undefined && { assinatura_prazo_dias: cfg.assinatura_prazo_dias }),
    ...(cfg.lembrete_dias !== undefined && { lembrete_dias: cfg.lembrete_dias }),
    ...(cfg.retencao_acesso_log_dias !== undefined && { retencao_acesso_log_dias: cfg.retencao_acesso_log_dias }),
  };
  const cfgExistente = await prisma.gedConfig.findUnique({ where: { organizacao_id: orgId } });
  if (!cfgExistente) {
    await prisma.gedConfig.create({ data: { organizacao_id: orgId, ...dadosCfg } });
    log("GED: configuração criada");
  } else if (opts.atualizar) {
    await prisma.gedConfig.update({ where: { id: cfgExistente.id }, data: dadosCfg });
    log("GED: configuração atualizada");
  }

  // Setores (chave: sigla)
  for (const s of g.setores) {
    const ex = await prisma.gedSetor.findUnique({ where: { organizacao_id_sigla: { organizacao_id: orgId, sigla: s.sigla } } });
    if (ex) {
      if (opts.atualizar && ex.nome !== s.nome) await prisma.gedSetor.update({ where: { id: ex.id }, data: { nome: s.nome } });
      r.setores[s.sigla] = ex.id;
    } else {
      r.setores[s.sigla] = (await prisma.gedSetor.create({ data: { organizacao_id: orgId, nome: s.nome, sigla: s.sigla } })).id;
      r.criados.setores++;
    }
  }

  // Tipos de documento e marcadores (chave: nome, sem diferenciar maiúsculas)
  for (const nome of g.tipos_documento) {
    const ex = await prisma.gedTipoDocumento.findFirst({ where: { organizacao_id: orgId, nome: { equals: nome, mode: "insensitive" } } });
    if (ex) r.tipos[nome] = ex.id;
    else {
      r.tipos[nome] = (await prisma.gedTipoDocumento.create({ data: { organizacao_id: orgId, nome } })).id;
      r.criados.tipos++;
    }
  }
  for (const m of g.marcadores) {
    const ex = await prisma.gedMarcador.findFirst({ where: { organizacao_id: orgId, nome: { equals: m.nome, mode: "insensitive" } } });
    if (ex) {
      if (opts.atualizar && m.cor && ex.cor !== m.cor) await prisma.gedMarcador.update({ where: { id: ex.id }, data: { cor: m.cor } });
      r.marcadores[m.nome] = ex.id;
    } else {
      r.marcadores[m.nome] = (await prisma.gedMarcador.create({ data: { organizacao_id: orgId, nome: m.nome, ...(m.cor && { cor: m.cor }) } })).id;
      r.criados.marcadores++;
    }
  }

  // Pastas (chave: caminho). Caminhos materializados via calcularCaminhos (lib/ged/pastas-caminho.ts).
  const caminhos = new Map<string, { id: string } & CaminhosPasta>();
  for (const p of expandirPastas(g.pastas)) {
    const pai = p.pai ? caminhos.get(p.pai.toLowerCase())! : null;
    const ex = await prisma.gedPasta.findFirst({
      where: { organizacao_id: orgId, parent_id: pai?.id ?? null, nome: { equals: p.nome, mode: "insensitive" }, excluido_em: null },
    });
    if (ex) {
      if (opts.atualizar && ex.sensibilidade_padrao !== p.sensibilidade_padrao) await prisma.gedPasta.update({ where: { id: ex.id }, data: { sensibilidade_padrao: p.sensibilidade_padrao } });
      if (ex.herda_acl !== p.herda_acl) log(`GED: pasta "${p.caminho}" já existe com herda_acl=${ex.herda_acl}; alteração de herança deve ser feita na tela de pastas (recalcula permissões).`);
      caminhos.set(p.caminho.toLowerCase(), { id: ex.id, caminho_ids: ex.caminho_ids, caminho_heranca: ex.caminho_heranca, caminho_nome: ex.caminho_nome });
      r.pastas[p.caminho] = ex.id;
    } else {
      const id = randomUUID();
      const cam = calcularCaminhos({ id, nome: p.nome, herda_acl: p.herda_acl }, pai);
      await prisma.gedPasta.create({
        data: { id, organizacao_id: orgId, parent_id: pai?.id ?? null, nome: p.nome, herda_acl: p.herda_acl, sensibilidade_padrao: p.sensibilidade_padrao, ...cam },
      });
      caminhos.set(p.caminho.toLowerCase(), { id, ...cam });
      r.pastas[p.caminho] = id;
      r.criados.pastas++;
    }
  }

  // Usuários GED (Usuario da organização + GedMembro + setores). Quem já está em `usuarios` (licenciamento) só ganha o membro.
  for (const u of g.usuarios) {
    let uid = usuarioId[u.email];
    if (!uid) {
      const { reg, senha } = await garantirUsuario(prisma, orgId, u, opts, senhaFixa);
      uid = reg.id;
      if (senha) senhas.push({ email: u.email, senha });
    }
    r.usuarios[u.email] = uid;
    const papel: GedPapel = u.papel_ged;
    const mem = await prisma.gedMembro.findUnique({ where: { organizacao_id_usuario_id: { organizacao_id: orgId, usuario_id: uid } } });
    if (!mem) {
      await prisma.gedMembro.create({ data: { organizacao_id: orgId, usuario_id: uid, papel } });
      r.criados.membros++;
    } else if (opts.atualizar && (mem.papel !== papel || !mem.ativo)) {
      await prisma.gedMembro.update({ where: { id: mem.id }, data: { papel, ativo: true } });
    }
    for (const st of u.setores.map(setorDeUsuario)) {
      const setor_id = r.setores[st.sigla];
      const sm = await prisma.gedSetorMembro.findUnique({ where: { setor_id_usuario_id: { setor_id, usuario_id: uid } } });
      if (!sm) await prisma.gedSetorMembro.create({ data: { organizacao_id: orgId, setor_id, usuario_id: uid, chefe: st.chefe } });
      else if (opts.atualizar && sm.chefe !== st.chefe) await prisma.gedSetorMembro.update({ where: { id: sm.id }, data: { chefe: st.chefe } });
    }
  }
  const c = r.criados;
  log(`GED: +${c.setores} setores, +${c.tipos} tipos, +${c.marcadores} marcadores, +${c.pastas} pastas, +${c.membros} membros`);
  return r;
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
