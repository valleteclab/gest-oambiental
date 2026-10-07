// GED – lembretes e expiração das assinaturas (fila ged-assinaturas). Esqueleto: a frente responsável substitui o corpo (ver docs/ged-design.md).
import type { BossGed, CtxJobsGed } from "./ged";

export async function registrar(_boss: BossGed, _ctx: CtxJobsGed): Promise<void> {
  // implementado pela frente de trabalho correspondente
}
