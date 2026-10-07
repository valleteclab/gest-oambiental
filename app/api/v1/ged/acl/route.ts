import { NextResponse } from "next/server";
import { invalido, rota } from "@/lib/http";
import { concederAcl, listarAcl } from "@/lib/ged/acl";
import { ctxGedApi } from "@/lib/ged/escopo";
import { zUuid } from "@/lib/ged/tipos";

export const dynamic = "force-dynamic";

// GET /api/v1/ged/acl?documento_id=…  |  ?pasta_id=…   → { itens } (exige ADMINISTRAR no recurso)
export const GET = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  const q = new URL(req.url).searchParams;
  const documento = q.get("documento_id");
  const pasta = q.get("pasta_id");
  if (!!documento === !!pasta) throw invalido("Informe documento_id ou pasta_id.");
  const alvo = documento ? ({ tipo: "documento", id: zUuid.parse(documento) } as const) : ({ tipo: "pasta", id: zUuid.parse(pasta) } as const);
  return NextResponse.json({ itens: await listarAcl(ctx, alvo) });
});

// POST /api/v1/ged/acl  { alvo: {tipo:"documento"|"pasta", id}, principal: {tipo:"USUARIO"|"SETOR", id}, acoes: [...], expira_em? }
export const POST = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  const corpo = await req.json().catch(() => { throw invalido("Corpo JSON inválido."); });
  const r = await concederAcl(ctx, corpo);
  return NextResponse.json(r, { status: r.criada ? 201 : 200 });
});
