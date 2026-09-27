import { NextResponse } from "next/server";
import { getUsuario } from "@/lib/auth";
import { auditar } from "@/lib/audit";
import { naoAutenticado, proibido, rota } from "@/lib/http";
import { temPapel } from "@/lib/rbac";
import { gerarAlertas } from "@/lib/alertas/gerar";

// POST /api/v1/alertas/gerar – dispara o motor de alertas manualmente (demonstração). Somente ADMIN.
export const POST = rota(async () => {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  if (!temPapel(u, "ADMIN")) throw proibido("Somente o administrador pode disparar a geração de alertas.");
  const resumo = await gerarAlertas();
  await auditar({ usuario_id: u.id, acao: "ALERTAS_GERAR", entidade: "alerta", entidade_id: null, depois: resumo });
  return NextResponse.json(resumo);
});
