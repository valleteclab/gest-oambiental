// Rótulos/cores do atendimento (puro – pode ser usado em componentes cliente).
import type { AutorMensagem, EstadoConversa, TipoCanal } from "@prisma/client";

export const ROTULO_ESTADO: Record<EstadoConversa, string> = {
  INICIO: "Início",
  AGUARDANDO_LGPD: "Aguardando consentimento",
  COLETANDO: "Coletando dados",
  CONFIRMANDO: "Confirmando",
  REGISTRADA: "Denúncia registrada",
  HUMANO: "Com atendente",
  ENCERRADA: "Encerrada",
};

export const COR_ESTADO: Record<EstadoConversa, "verde" | "amarelo" | "vermelho" | "azul" | "cinza" | "roxo"> = {
  INICIO: "cinza",
  AGUARDANDO_LGPD: "amarelo",
  COLETANDO: "azul",
  CONFIRMANDO: "azul",
  REGISTRADA: "verde",
  HUMANO: "roxo",
  ENCERRADA: "cinza",
};

export const ROTULO_CANAL_CURTO: Record<TipoCanal, string> = {
  WHATSAPP_EVOLUTION: "WhatsApp",
  WHATSAPP_ZAPI: "WhatsApp",
  WHATSAPP_CHATWOOT: "WhatsApp (oficial)",
  WEBCHAT: "Chat do site",
  EMAIL: "E-mail",
};

export const ROTULO_AUTOR: Record<AutorMensagem, string> = { CIDADAO: "Cidadão", IA: "Assistente (IA)", ATENDENTE: "Atendente", SISTEMA: "Sistema" };
