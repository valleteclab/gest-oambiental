import { Badge } from "@/components/ui";
import type { GedStatusAssinante } from "@prisma/client";
import { fmtDataHoraBrasilia } from "@/lib/ged/assinaturas/regras";

const COR: Record<GedStatusAssinante, "verde" | "amarelo" | "vermelho" | "cinza"> = {
  ASSINADO: "verde",
  PENDENTE: "amarelo",
  AGUARDANDO: "cinza",
  RECUSADO: "vermelho",
  EXPIRADO: "cinza",
};
const ROTULO: Record<GedStatusAssinante, string> = {
  ASSINADO: "assinou",
  PENDENTE: "pendente",
  AGUARDANDO: "aguarda a vez",
  RECUSADO: "recusou",
  EXPIRADO: "expirou",
};

/** Chip "Nome · assinou 07/10/2026 14:30" (texto + cor: o estado nunca depende só da cor). */
export function ChipAssinante({ nome, status, quando }: { nome?: string; status: GedStatusAssinante; quando?: Date | null }) {
  return (
    <Badge cor={COR[status]}>
      {nome && <><span className="max-w-[16rem] truncate" title={nome}>{nome}</span><span aria-hidden="true">·</span></>}
      <span>{ROTULO[status]}{quando ? ` ${fmtDataHoraBrasilia(quando)}` : ""}</span>
    </Badge>
  );
}
