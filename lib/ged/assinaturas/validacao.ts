// Entradas (zod) do fluxo de assinatura – compartilhadas por Server Actions e rotas de API.
import { z } from "zod";
import { zUuid } from "../tipos";
import { MAX_PRAZO_DIAS, MAX_SIGNATARIOS, MIN_JUSTIFICATIVA, MIN_PRAZO_DIAS } from "./regras";

const textoOpcional = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

export const zSolicitarAssinatura = z.object({
  documento_id: zUuid,
  /** Ids dos signatários NA ORDEM de assinatura (no modo paralelo a ordem só organiza a exibição). */
  signatarios: z
    .array(zUuid)
    .min(1, "Escolha ao menos um signatário.")
    .max(MAX_SIGNATARIOS, `No máximo ${MAX_SIGNATARIOS} signatários.`)
    .refine((l) => new Set(l).size === l.length, "Há signatários repetidos."),
  modo: z.enum(["SEQUENCIAL", "PARALELO"]),
  prazo_dias: z.coerce.number().int().min(MIN_PRAZO_DIAS, `Prazo mínimo de ${MIN_PRAZO_DIAS} dia.`).max(MAX_PRAZO_DIAS, `Prazo máximo de ${MAX_PRAZO_DIAS} dias.`).optional(),
  mensagem: textoOpcional(1000),
});
export type EntradaSolicitar = z.infer<typeof zSolicitarAssinatura>;

export const zAssinar = z.object({
  solicitacao_id: zUuid,
  senha: z.string().min(1, "Informe sua senha.").max(200),
  consentimento: z.literal(true, { message: "Confirme a declaração de assinatura." }),
});
export type EntradaAssinar = z.infer<typeof zAssinar>;

export const zRecusar = z.object({
  solicitacao_id: zUuid,
  justificativa: z.string().trim().min(MIN_JUSTIFICATIVA, `Explique o motivo da recusa (mínimo ${MIN_JUSTIFICATIVA} caracteres).`).max(2000),
});
export type EntradaRecusar = z.infer<typeof zRecusar>;

export const zCancelar = z.object({ solicitacao_id: zUuid, motivo: textoOpcional(500) });

export const zComentarAssinatura = z.object({
  solicitacao_id: zUuid,
  texto: z.string().trim().min(1, "Escreva o comentário.").max(2000),
});

/** Metadados da requisição guardados como evidência. */
export type MetaRequisicao = { ip: string | null; user_agent: string | null };
