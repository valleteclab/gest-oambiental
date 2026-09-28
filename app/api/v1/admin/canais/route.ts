import { NextResponse } from "next/server";
import { naoAutenticado, proibido, rota } from "@/lib/http";
import { getUsuario } from "@/lib/auth";
import { podeConfigurar } from "@/lib/admin/guard";
import { criarCanal, listarCanais } from "@/lib/agente/canais-admin";

export const dynamic = "force-dynamic";

async function admin() {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  if (!podeConfigurar(u)) throw proibido();
  return u;
}

// GET /api/v1/admin/canais – canais da organização (com URL e segredo do webhook)
export const GET = rota(async () => NextResponse.json({ itens: await listarCanais(await admin()) }));

// POST /api/v1/admin/canais {tipo, nome, municipio_id?, publicos, segredos}
export const POST = rota(async (req: Request) => {
  const u = await admin();
  const c = await criarCanal(u, await req.json());
  const item = (await listarCanais(u)).find((x) => x.id === c.id);
  return NextResponse.json(item, { status: 201 });
});
