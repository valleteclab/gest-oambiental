import { z } from "zod";
import { PoligonoGeoJsonSchema } from "@/lib/geo/validar";
import { mascararCpfCnpj, somenteDigitos, validarCNPJ, validarCPF } from "@/lib/crypto";

// Schemas zod compartilhados por API (/api/v1) e Server Actions dos cadastros (SPEC 5.2).

export const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"] as const;

/** "" → null (campos opcionais vindos de formulário). */
const vazioNulo = <T extends z.ZodType>(t: T) => z.preprocess((v) => (v === "" ? null : v), t.optional().nullable());

const textoOpc = z
  .string()
  .trim()
  .max(500)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

export const EnderecoSchema = z
  .object({
    logradouro: textoOpc,
    numero: textoOpc,
    complemento: textoOpc,
    bairro: textoOpc,
    cidade: textoOpc,
    uf: z
      .string()
      .trim()
      .toUpperCase()
      .optional()
      .nullable()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || (UFS as readonly string[]).includes(v), "UF inválida."),
    cep: z
      .string()
      .optional()
      .nullable()
      .transform((v) => (v ? somenteDigitos(v) : null))
      .refine((v) => v === null || v.length === 8, "CEP deve ter 8 dígitos."),
  })
  .partial();

export type Endereco = z.infer<typeof EnderecoSchema>;

export function formatarEndereco(e: unknown): string {
  if (!e || typeof e !== "object") return "—";
  const x = e as Record<string, string | null | undefined>;
  if (!x.logradouro && !x.bairro && !x.cidade && !x.cep) return "—";
  const cep = x.cep && x.cep.length === 8 ? `${x.cep.slice(0, 5)}-${x.cep.slice(5)}` : x.cep;
  const linha1 = [x.logradouro, x.numero].filter(Boolean).join(", ");
  const partes = [linha1 + (x.complemento ? ` – ${x.complemento}` : ""), x.bairro, [x.cidade, x.uf].filter(Boolean).join("/"), cep ? `CEP ${cep}` : null].filter(Boolean);
  return partes.length ? partes.join(" · ") : "—";
}

/** Valida CPF (PF) ou CNPJ (PJ) conforme o tipo. Retorna mensagem de erro ou null. */
export function erroDocumento(tipo: "PF" | "PJ", doc: string): string | null {
  const d = somenteDigitos(doc);
  if (tipo === "PF") return d.length !== 11 ? "CPF deve ter 11 dígitos." : validarCPF(d) ? null : "CPF inválido (dígito verificador não confere).";
  return d.length !== 14 ? "CNPJ deve ter 14 dígitos." : validarCNPJ(d) ? null : "CNPJ inválido (dígito verificador não confere).";
}

export { mascararCpfCnpj };

const emailOpc = z
  .string()
  .trim()
  .toLowerCase()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || z.email().safeParse(v).success, "E-mail inválido.");

export const PessoaSchema = z
  .object({
    tipo: z.enum(["PF", "PJ"]),
    cpf_cnpj: z.string().trim().min(1, "Informe o CPF/CNPJ."),
    nome: z.string().trim().min(3, "Informe o nome (mín. 3 caracteres).").max(200),
    nome_fantasia: textoOpc,
    email: emailOpc,
    telefone: textoOpc,
    endereco: EnderecoSchema.optional().nullable(),
    municipio_id: vazioNulo(z.uuid("Município inválido.")),
  })
  .superRefine((v, ctx) => {
    const erro = erroDocumento(v.tipo, v.cpf_cnpj);
    if (erro) ctx.addIssue({ code: "custom", path: ["cpf_cnpj"], message: erro });
  });
export type PessoaEntrada = z.infer<typeof PessoaSchema>;

export const ResponsavelSchema = z.object({
  pessoa_id: z.uuid("Selecione a pessoa."),
  formacao: z.string().trim().min(2, "Informe a formação.").max(200),
  conselho: z.string().trim().min(2, "Informe o conselho (CREA, CRBio…).").max(50),
  registro_conselho: z.string().trim().min(1, "Informe o nº de registro.").max(50),
  uf_conselho: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => (UFS as readonly string[]).includes(v), "UF inválida."),
});
export type ResponsavelEntrada = z.infer<typeof ResponsavelSchema>;

const numOpc = (min: number, max: number, msg: string) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .nullable()
    .transform((v, ctx) => {
      if (v === null || v === undefined || v === "") return null;
      const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
      if (!Number.isFinite(n) || n < min || n > max) {
        ctx.addIssue({ code: "custom", message: msg });
        return z.NEVER;
      }
      return n;
    });

// Polygon/MultiPolygon validado (anéis fechados, coordenadas no intervalo, ≤ 300 KB) – lib/geo/validar.ts.
// Feature/FeatureCollection são aceitos e convertidos para a geometria.
export const PoligonoSchema = PoligonoGeoJsonSchema;

export const EmpreendimentoSchema = z.object({
  municipio_id: z.uuid("Selecione o município."),
  requerente_id: z.uuid("Selecione o requerente."),
  nome: z.string().trim().min(3, "Informe o nome do empreendimento.").max(200),
  endereco: EnderecoSchema.optional().nullable(),
  latitude: numOpc(-90, 90, "Latitude inválida."),
  longitude: numOpc(-180, 180, "Longitude inválida."),
  poligono_geojson: PoligonoSchema,
  tipologia_id: z.uuid("Selecione a tipologia."),
  grandeza_porte: numOpc(0, 1e12, "Grandeza inválida."),
  porte: vazioNulo(z.enum(["MICRO", "PEQUENO", "MEDIO", "GRANDE", "EXCEPCIONAL"])),
  porte_justificativa: textoOpc,
  area_m2: numOpc(0, 1e12, "Área inválida."),
  numero_car: textoOpc,
  status: z.enum(["ATIVO", "INATIVO"]).optional(),
  rt_id: vazioNulo(z.uuid("Responsável técnico inválido.")),
});
export type EmpreendimentoEntrada = z.infer<typeof EmpreendimentoSchema>;

/** Converte FormData com chaves "endereco.logradouro" em objeto aninhado. */
export function formParaObjeto(form: FormData): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of form.entries()) {
    if (typeof v !== "string") continue;
    if (k.startsWith("$ACTION")) continue;
    const [a, b] = k.split(".");
    if (b) {
      o[a] = { ...((o[a] as Record<string, unknown>) ?? {}), [b]: v };
    } else o[k] = v;
  }
  return o;
}

/** Primeira mensagem legível de um ZodError por campo. */
export function errosPorCampo(e: z.ZodError): Record<string, string> {
  const r: Record<string, string> = {};
  for (const i of e.issues) {
    const k = i.path.join(".") || "_";
    r[k] ??= i.message;
  }
  return r;
}
