// Contrato das abas da página do documento (criado pela frente C porque a B ainda não o havia criado; a frente B é a dona).
import type { GedAcao, GedSensibilidade, GedStatusDocumento } from "@prisma/client";
import type { CtxGed } from "@/lib/ged/escopo";

export type PropsAbaGed = {
  ctx: CtxGed;
  documento: {
    id: string;
    titulo: string;
    numero: string;
    status: GedStatusDocumento;
    sensibilidade: GedSensibilidade;
    versao_atual_id: string | null;
    acoes: GedAcao[];
  };
};
