import { naoEncontrado, rota } from "@/lib/http";
import { ehUuid, usuarioApi } from "@/lib/fiscalizacao/api";
import { midiaDaMensagem } from "@/lib/agente/atendimento";

export const dynamic = "force-dynamic";

// GET /api/v1/atendimento/midia/{mensagemId} – foto/áudio/PDF recebido no canal (escopo da conversa)
export const GET = rota(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const u = await usuarioApi("denuncia");
  const { id } = await params;
  if (!ehUuid(id)) throw naoEncontrado();
  const m = await midiaDaMensagem(u, id);
  return new Response(new Uint8Array(m.dados), { headers: { "Content-Type": m.mime, "Content-Length": String(m.dados.length), "Cache-Control": "private, max-age=3600", "Content-Disposition": "inline" } });
});
