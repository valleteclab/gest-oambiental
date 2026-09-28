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
  // Isolamento: o ADMIN de um cliente só dispara o motor para os municípios da sua organização.
  const resumo = await gerarAlertas(new Date(), { organizacao_id: u.organizacao_id });
  await auditar({ usuario_id: u.id, acao: "ALERTAS_GERAR", entidade: "alerta", entidade_id: null, depois: resumo });
  return NextResponse.json(resumo);
});
