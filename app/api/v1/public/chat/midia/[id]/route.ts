import { cookies } from "next/headers";
import { naoEncontrado, rota } from "@/lib/http";
import { COOKIE_CHAT, midiaWeb } from "@/lib/agente/webchat";
import { ehUuid } from "@/lib/fiscalizacao/api";

export const dynamic = "force-dynamic";

// GET /api/v1/public/chat/midia/{mensagemId} – foto enviada pelo próprio visitante (confere o cookie da sessão)
export const GET = rota(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const t = (await cookies()).get(COOKIE_CHAT)?.value;
  if (!ehUuid(id) || !t) throw naoEncontrado();
  const m = await midiaWeb(id, t);
  return new Response(new Uint8Array(m.dados), { headers: { "Content-Type": m.mime, "Cache-Control": "private, max-age=3600" } });
});
