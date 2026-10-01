// Schemas zod do módulo de Fiscalização (servidor e testes – usa lib/crypto para validar CPF/CNPJ).
import { z } from "zod";
import { validarCpfCnpj, somenteDigitos } from "../crypto";

// ───────────── Schemas (zod) ─────────────
const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);
const textoOpc = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

export const DenunciaPublicaSchema = z
  .object({
    municipio_id: z.string().uuid("Selecione o município."),
    descricao: z.string().trim().min(20, "Descreva a situação com pelo menos 20 caracteres.").max(5000, "Descrição muito longa (máx. 5000)."),
    endereco: z.string().trim().min(5, "Informe o endereço ou ponto de referência.").max(300),
    latitude: lat.optional().nullable(),
    longitude: lng.optional().nullable(),
    anonima: z.boolean().default(true),
    denunciante_nome: textoOpc(150),
    contato: textoOpc(150),
    /** honeypot – deve vir vazio */
    website: z.string().max(0, "Envio rejeitado.").optional().default(""),
    /** ms desde a renderização do formulário (anti-robô) */
    tempo_ms: z.number().int().optional(),
  })
  .superRefine((d, ctx) => {
    if (!d.anonima && !d.denunciante_nome) ctx.addIssue({ code: "custom", path: ["denunciante_nome"], message: "Informe seu nome ou marque a denúncia como anônima." });
    if ((d.latitude == null) !== (d.longitude == null)) ctx.addIssue({ code: "custom", path: ["latitude"], message: "Coordenadas incompletas." });
  });
export type DenunciaPublicaInput = z.infer<typeof DenunciaPublicaSchema>;

export const DenunciaInternaSchema = z
  .object({
    municipio_id: z.string().uuid("Selecione o município."),
    canal: z.enum(["PRESENCIAL", "TELEFONE", "OUTRO", "PORTAL"]),
    descricao: z.string().trim().min(5, "Descreva a denúncia.").max(5000),
    endereco: z.string().trim().max(300).optional().nullable(),
    latitude: lat.optional().nullable(),
    longitude: lng.optional().nullable(),
    anonima: z.boolean().default(true),
    denunciante_nome: textoOpc(150),
    contato: textoOpc(150),
  })
  .superRefine((d, ctx) => {
    if ((d.latitude == null) !== (d.longitude == null)) ctx.addIssue({ code: "custom", path: ["latitude"], message: "Coordenadas incompletas." });
  });

export const StatusDenunciaSchema = z.object({
  status: z.enum(["EM_APURACAO", "CONCLUIDA", "ARQUIVADA"]),
  despacho: z.string().trim().min(5, "Informe o despacho (mín. 5 caracteres).").max(3000),
});

export const MembroEquipeSchema = z.object({ usuario_id: z.string().uuid().nullable().optional(), nome: z.string().trim().min(1).max(150) });

export const FiscalizacaoSchema = z
  .object({
    municipio_id: z.string().uuid().optional().nullable(),
    denuncia_id: z.string().uuid().optional().nullable(),
    processo_id: z.string().uuid().optional().nullable(),
    empreendimento_id: z.string().uuid().optional().nullable(),
    data_hora: z.coerce.date().refine((d) => d.getTime() <= Date.now() + 10 * 60000, "Data/hora no futuro."),
    latitude: lat,
    longitude: lng,
    precisao_m: z.coerce.number().min(0).max(100000).optional().nullable(),
    equipe: z.array(MembroEquipeSchema).max(20).default([]),
    relato: z.string().trim().min(10, "Descreva o relato (mín. 10 caracteres).").max(20000),
    constatacao: z.enum(["IRREGULAR", "REGULAR", "INCONCLUSIVA"]),
    fotos_meta: z.array(z.object({ latitude: lat.nullable().optional(), longitude: lng.nullable().optional() })).optional(),
  });
export type FiscalizacaoInput = z.infer<typeof FiscalizacaoSchema>;

export const PessoaRapidaSchema = z.object({
  tipo: z.enum(["PF", "PJ"]),
  cpf_cnpj: z.string().refine(validarCpfCnpj, "CPF/CNPJ inválido."),
  nome: z.string().trim().min(3, "Informe o nome.").max(200),
  telefone: textoOpc(40),
  email: z.string().trim().email("E-mail inválido.").max(150).optional().nullable().or(z.literal("").transform(() => null)),
  logradouro: textoOpc(200),
}).superRefine((d, ctx) => {
  const n = somenteDigitos(d.cpf_cnpj).length;
  if (d.tipo === "PF" && n !== 11) ctx.addIssue({ code: "custom", path: ["cpf_cnpj"], message: "Pessoa física exige CPF." });
  if (d.tipo === "PJ" && n !== 14) ctx.addIssue({ code: "custom", path: ["cpf_cnpj"], message: "Pessoa jurídica exige CNPJ." });
});
export type PessoaRapidaInput = z.infer<typeof PessoaRapidaSchema>;

const PessoaRef = z.object({ pessoa_id: z.string().uuid().optional().nullable(), nova_pessoa: PessoaRapidaSchema.optional().nullable() }).refine((d) => !!d.pessoa_id || !!d.nova_pessoa, { message: "Selecione ou cadastre o autuado/notificado.", path: ["pessoa_id"] });

export const AutoInfracaoSchema = z
  .object({
    fiscalizacao_id: z.string().uuid(),
    autuado: PessoaRef,
    enquadramento_legal: z.string().trim().min(5, "Informe o enquadramento legal.").max(2000),
    descricao_infracao: z.string().trim().min(10, "Descreva a infração (mín. 10 caracteres).").max(10000),
    penalidade: z.enum(["ADVERTENCIA", "MULTA", "EMBARGO", "INTERDICAO", "OUTRA"]),
    valor_multa: z.coerce.number().min(0).max(1_000_000_000).optional().nullable(),
    prazo_defesa_dias: z.coerce.number().int().min(1).max(365).default(20),
  })
  .superRefine((d, ctx) => {
    if (d.penalidade === "MULTA" && !(d.valor_multa && d.valor_multa > 0)) ctx.addIssue({ code: "custom", path: ["valor_multa"], message: "Informe o valor da multa." });
  });
export type AutoInfracaoInput = z.infer<typeof AutoInfracaoSchema>;

export const NotificacaoSchema = z.object({
  fiscalizacao_id: z.string().uuid().optional().nullable(),
  processo_id: z.string().uuid().optional().nullable(),
  notificado: PessoaRef,
  exigencia: z.string().trim().min(10, "Descreva a exigência (mín. 10 caracteres).").max(10000),
  prazo_dias: z.coerce.number().int().min(1).max(365),
}).refine((d) => !!d.fiscalizacao_id || !!d.processo_id, { message: "Vincule a uma fiscalização ou processo.", path: ["fiscalizacao_id"] });
export type NotificacaoInput = z.infer<typeof NotificacaoSchema>;
