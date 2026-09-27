import { NextResponse } from "next/server";
import type { Papel } from "@prisma/client";
import { z } from "zod";
import { rota } from "@/lib/http";
import { exigirAdmin } from "@/lib/admin/guard";
import { corpoJson } from "@/lib/cadastros/api";
import { adicionarPapel, removerPapel } from "@/lib/admin/usuarios";

type Ctx = { params: Promise<{ id: string }> };

/** POST {papel, municipio_id?} */
export const POST = rota(async (req: Request, { params }: Ctx) => {
  const admin = await exigirAdmin();
  const b = z.object({ papel: z.string(), municipio_id: z.uuid().nullable().optional() }).parse(await corpoJson(req));
  const p = await adicionarPapel(admin, (await params).id, b.papel as Papel, b.municipio_id ?? null);
  return NextResponse.json(p, { status: 201 });
});

/** DELETE ?papel_id= */
export const DELETE = rota(async (req: Request, { params }: Ctx) => {
  const admin = await exigirAdmin();
  const papelId = z.uuid().parse(new URL(req.url).searchParams.get("papel_id"));
  await removerPapel(admin, (await params).id, papelId);
  return new NextResponse(null, { status: 204 });
});
