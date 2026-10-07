// Regras PURAS do painel do operador da plataforma (/plataforma): validação de slug/sigla/IBGE, máquina de status do
// cliente, elegibilidade de operador, senhas/convites e padrões de onboarding. Sem Next, sem banco – testadas em
// tests/unit/plataforma.test.ts. Modelo de ameaça: docs/plataforma.md.
import { createHash, randomBytes, randomInt } from "node:crypto";
import { z } from "zod";
import { gerarSenhaTemporaria } from "../admin/senha";

// ───────────── Slug público ─────────────

export const RE_SLUG = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;
/** Endereços que colidem com rotas/áreas da aplicação (ou induzem a erro): nunca podem ser slug de cliente. */
export const SLUGS_RESERVADOS: readonly string[] = [
  "admin", "administrador", "api", "app", "assets", "auth", "cadastro", "compartilhado", "configuracoes", "consulta", "dashboard",
  "definir-senha", "denuncia", "docs", "ged", "health", "licencas", "login", "logout", "meus-processos", "novo-requerimento", "orgao",
  "plataforma", "privacidade", "protocolo", "public", "publico", "sair", "servicos", "static", "suporte", "termos", "trocar-orgao",
  "trocar-senha", "validar", "verificar", "webhooks", "www",
];

export function normalizarSlug(v: string): string {
  return v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

/** Mensagem de erro do slug (null = válido). Espera o slug já normalizado. */
export function erroSlug(slug: string): string | null {
  if (!RE_SLUG.test(slug)) return "Endereço público: 3 a 60 caracteres, só letras minúsculas, números e hífen (sem hífen nas pontas).";
  if (SLUGS_RESERVADOS.includes(slug)) return "Este endereço é reservado. Escolha outro.";
  return null;
}

// ───────────── Sigla da organização e dos municípios, IBGE, UF ─────────────

export const RE_SIGLA_ORG = /^[A-Z0-9][A-Z0-9-]{1,19}$/;
export const normalizarSiglaOrg = (v: string) => v.trim().toUpperCase().replace(/\s+/g, "-");
export function erroSiglaOrg(sigla: string): string | null {
  return RE_SIGLA_ORG.test(sigla) ? null : "Sigla: 2 a 20 caracteres, só letras maiúsculas, números e hífen.";
}

export const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"] as const;
export const RE_IBGE = /^\d{7}$/;
export const erroIbge = (v: string) => (RE_IBGE.test(v) ? null : "Código IBGE: 7 dígitos.");

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Sigla de 3 letras do município (única no sistema) a partir do nome: primeiras letras das palavras significativas,
 * depois consoantes, depois variações; `usadas` são as siglas já existentes (maiúsculas). Lança erro se esgotar.
 */
export function derivarSiglaMunicipio(nome: string, usadas: Iterable<string>): string {
  const em = new Set([...usadas].map((s) => s.toUpperCase()));
  const limpo = semAcento(nome).toUpperCase().replace(/[^A-Z\s]/g, " ");
  const palavras = limpo.split(/\s+/).filter((p) => p && !["DE", "DA", "DO", "DAS", "DOS", "E"].includes(p));
  const letras = palavras.join("").split("");
  const candidatos: string[] = [];
  if (palavras.length >= 3) candidatos.push(palavras.slice(0, 3).map((p) => p[0]).join(""));
  if (letras.length >= 3) candidatos.push(letras.slice(0, 3).join(""));
  const consoantes = letras.filter((c) => !"AEIOU".includes(c));
  if (consoantes.length >= 3) candidatos.push(consoantes.slice(0, 3).join(""));
  if (palavras.length >= 2 && palavras[0].length >= 2) candidatos.push(palavras[0].slice(0, 2) + palavras[1][0]);
  for (const c of candidatos) if (/^[A-Z]{3}$/.test(c) && !em.has(c)) return c;
  const base = (candidatos[0] ?? "XXX").slice(0, 2).padEnd(2, "X");
  for (const l of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") if (!em.has(base + l)) return base + l;
  for (let i = 0; i < 2000; i++) {
    const c = Array.from({ length: 3 }, () => String.fromCharCode(65 + randomInt(26))).join("");
    if (!em.has(c)) return c;
  }
  throw new Error("Não foi possível derivar uma sigla de município livre.");
}

// ───────────── Status do cliente (máquina de estados) ─────────────

export type StatusCliente = "ATIVO" | "SUSPENSO";
export type AcaoStatus = "suspender" | "reativar";

/** Próximo status ou erro (pt-BR) quando a transição não é permitida. Não existe "excluir": só suspender/reativar. */
export function transicaoStatus(atual: StatusCliente, acao: AcaoStatus): { ok: true; proximo: StatusCliente } | { ok: false; erro: string } {
  if (acao === "suspender") return atual === "ATIVO" ? { ok: true, proximo: "SUSPENSO" } : { ok: false, erro: "O cliente já está suspenso." };
  if (acao === "reativar") return atual === "SUSPENSO" ? { ok: true, proximo: "ATIVO" } : { ok: false, erro: "O cliente não está suspenso." };
  return { ok: false, erro: "Ação inválida." };
}

/** Confirmação digitada: o operador precisa digitar a sigla do cliente (sem diferenciar maiúsculas/espaços nas pontas). */
export const confirmacaoConfere = (digitado: string, sigla: string) => digitado.trim().toUpperCase() === sigla.trim().toUpperCase() && sigla.trim() !== "";

// ───────────── Módulos ─────────────

export const MODULOS_VALIDOS = ["LICENCIAMENTO", "GED"] as const;
export type Modulo = (typeof MODULOS_VALIDOS)[number];
export const ROTULO_MODULO: Record<Modulo, string> = { LICENCIAMENTO: "Licenciamento ambiental", GED: "Gestão de Documentos" };

/** Normaliza/valida a lista de módulos (ordem estável, sem repetição, ao menos um). */
export function validarModulos(entrada: readonly string[]): { ok: true; modulos: Modulo[] } | { ok: false; erro: string } {
  const set = new Set(entrada);
  for (const m of set) if (!(MODULOS_VALIDOS as readonly string[]).includes(m)) return { ok: false, erro: `Módulo desconhecido: ${m}.` };
  const modulos = MODULOS_VALIDOS.filter((m) => set.has(m));
  return modulos.length ? { ok: true, modulos } : { ok: false, erro: "Selecione ao menos um módulo." };
}

// ───────────── Elegibilidade de operador ─────────────

export type CandidatoOperador = {
  ativo: boolean;
  organizacao_id: string | null;
  pessoa_id: string | null;
  papeis: number;
  ged_membros: number;
};

/**
 * Um usuário só pode ser (e só continua sendo) operador se NÃO tiver organização, papéis, cadastro de pessoa ou
 * participação no GED: assim nunca é confundido com requerente nem com membro de cliente. null = elegível.
 */
export function motivoInelegivelOperador(c: CandidatoOperador): string | null {
  if (!c.ativo) return "usuário inativo";
  if (c.organizacao_id) return "usuário pertence a uma organização (cliente)";
  if (c.pessoa_id) return "usuário tem cadastro de pessoa (é requerente)";
  if (c.papeis > 0) return "usuário tem papéis no sistema";
  if (c.ged_membros > 0) return "usuário é membro do módulo GED";
  return null;
}

/** Lista de e-mails do bootstrap (PLATAFORMA_OPERADORES): separados por vírgula/ponto e vírgula/espaço; inválidos são ignorados. */
export function parseOperadoresEnv(valor: string | undefined | null): string[] {
  const vistos = new Set<string>();
  for (const bruto of (valor ?? "").split(/[,;\s]+/)) {
    const e = bruto.trim().toLowerCase();
    if (e && z.string().email().safeParse(e).success) vistos.add(e);
  }
  return [...vistos];
}

// ───────────── Senhas e convites ─────────────

/** Senha temporária do operador para o administrador do cliente: 16 caracteres (mínimo da política: 10). */
export const gerarSenhaAdminCliente = () => gerarSenhaTemporaria(16);

/** Validade do convite de definição de senha. */
export const VALIDADE_CONVITE_HORAS = 72;

/** Token de convite: 256 bits aleatórios (base64url); só o SHA-256 vai para o banco. */
export function gerarTokenConvite(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashTokenConvite(token) };
}
export const hashTokenConvite = (token: string) => createHash("sha256").update(token).digest("hex");
export const RE_TOKEN_CONVITE = /^[A-Za-z0-9_-]{43}$/;

/** O convite ainda pode ser usado? */
export function conviteUtilizavel(c: { usado_em: Date | null; expira_em: Date }, agora = new Date()): boolean {
  return !c.usado_em && c.expira_em.getTime() > agora.getTime();
}

// ───────────── Padrões de onboarding pelo painel ─────────────

export const SETORES_GED_PADRAO = [
  { nome: "Administração", sigla: "ADM" },
  { nome: "Protocolo", sigla: "PROT" },
  { nome: "Jurídico", sigla: "JUR" },
] as const;
export const TIPOS_DOCUMENTO_GED_PADRAO = ["Ofício", "Memorando", "Ata", "Contrato", "Parecer", "Relatório", "Requerimento", "Despacho", "Portaria", "Declaração"] as const;
/** Cota padrão de armazenamento do GED por cliente (editável depois). */
export const COTA_GED_PADRAO_GB = 10;

// ───────────── Entrada do formulário (zod) ─────────────

const textoOpcional = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);

export const MunicipioNovoSchema = z.object({
  nome: z.string().trim().min(2, "Informe o nome do órgão/município.").max(120),
  uf: z.string().trim().toUpperCase().refine((u) => (UFS as readonly string[]).includes(u), "UF inválida."),
  codigo_ibge: z.string().trim().refine((v) => RE_IBGE.test(v), "Código IBGE: 7 dígitos."),
});

export const NovoClienteSchema = z
  .object({
    nome: z.string().trim().min(3, "Informe o nome do cliente.").max(160),
    sigla: z.string().transform(normalizarSiglaOrg).refine((s) => !erroSiglaOrg(s), "Sigla: 2 a 20 caracteres, só letras maiúsculas, números e hífen."),
    cnpj: z
      .string()
      .optional()
      .nullable()
      .transform((v) => (v ?? "").replace(/\D/g, ""))
      .refine((v) => v === "" || v.length === 14, "CNPJ: 14 dígitos.")
      .transform((v) => v || null),
    slug: z
      .string()
      .optional()
      .nullable()
      .transform((v) => (v ? normalizarSlug(v) : null))
      .superRefine((v, ctx) => {
        const e = v ? erroSlug(v) : null;
        if (e) ctx.addIssue({ code: "custom", message: e });
      }),
    modulos: z.array(z.string()).transform((m, ctx) => {
      const r = validarModulos(m);
      if (!r.ok) {
        ctx.addIssue({ code: "custom", message: r.erro });
        return z.NEVER;
      }
      return r.modulos;
    }),
    municipios: z.array(MunicipioNovoSchema).default([]),
    admin_nome: z.string().trim().min(3, "Informe o nome do administrador.").max(120),
    admin_email: z.string().trim().toLowerCase().email("E-mail do administrador inválido."),
    admin_whatsapp: textoOpcional(30),
    cota_gb: z.coerce.number().int().min(1).max(100000).default(COTA_GED_PADRAO_GB),
    entrega: z.enum(["SENHA", "CONVITE", "AMBOS"]).default("SENHA"),
  })
  .superRefine((c, ctx) => {
    if (c.modulos.includes("LICENCIAMENTO") && c.municipios.length < 1) ctx.addIssue({ code: "custom", path: ["municipios"], message: "O módulo de licenciamento exige ao menos um órgão/município." });
    if (!c.modulos.includes("LICENCIAMENTO") && c.municipios.length) ctx.addIssue({ code: "custom", path: ["municipios"], message: "Órgãos/municípios só existem com o módulo de licenciamento." });
    const ibges = new Set<string>();
    c.municipios.forEach((m, i) => {
      if (ibges.has(m.codigo_ibge)) ctx.addIssue({ code: "custom", path: ["municipios", i, "codigo_ibge"], message: "Código IBGE repetido." });
      ibges.add(m.codigo_ibge);
    });
  });
export type NovoCliente = z.infer<typeof NovoClienteSchema>;

export const EdicaoClienteSchema = z.object({
  nome: z.string().trim().min(3, "Informe o nome do cliente.").max(160),
  cnpj: NovoClienteSchema.shape.cnpj,
  slug: NovoClienteSchema.shape.slug,
});
export type EdicaoCliente = z.infer<typeof EdicaoClienteSchema>;

/** Monta o JSON do onboarding compartilhado (lib/plataforma/onboarding.ts) a partir do formulário do operador. */
export function montarClienteOnboarding(c: NovoCliente, siglasMunicipiosUsadas: Iterable<string> = []) {
  const licenc = c.modulos.includes("LICENCIAMENTO");
  const ged = c.modulos.includes("GED");
  const usadas = new Set([...siglasMunicipiosUsadas].map((s) => s.toUpperCase()));
  const municipios = c.municipios.map((m) => {
    const sigla = derivarSiglaMunicipio(m.nome, usadas);
    usadas.add(sigla);
    return { nome: m.nome, sigla, codigo_ibge: m.codigo_ibge, uf: m.uf, orgao_ambiental_nome: `Órgão Ambiental de ${m.nome}` };
  });
  return {
    modulos: c.modulos,
    organizacao: { nome: c.nome, sigla: c.sigla, cnpj: c.cnpj },
    municipios,
    usuarios: licenc ? [{ email: c.admin_email, nome: c.admin_nome, papeis: [{ papel: "ADMIN" as const }] }] : [],
    ...(ged
      ? {
          ged: {
            config: { cota_bytes: c.cota_gb * 1024 ** 3 },
            setores: SETORES_GED_PADRAO.map((s) => ({ ...s })),
            tipos_documento: [...TIPOS_DOCUMENTO_GED_PADRAO],
            usuarios: [{ email: c.admin_email, nome: c.admin_nome, papel_ged: "GED_ADMIN" as const, setores: [{ sigla: "ADM", chefe: true }] }],
          },
        }
      : {}),
  };
}
