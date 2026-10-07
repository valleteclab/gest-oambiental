import { NextResponse } from "next/server";
import { rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { definirHerancaPasta } from "@/lib/ged/acl";
import { lerEntradaExclusao, respostaInicio } from "@/lib/ged/exclusao/http";
import { iniciarExclusao } from "@/lib/ged/exclusao/servico";
import { arquivarPasta, atualizarPasta, restaurarPasta } from "@/lib/ged/pastas";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/v1/ged/pastas/:id – { nome?, sensibilidade_padrao?, parent_id? (null = raiz), herda_acl?, arquivada? }
export const PATCH = rota(async (req: Request, { params }: Ctx) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  const c = (await req.json().catch(() => ({}))) as { nome?: string; sensibilidade_padrao?: never; parent_id?: string | null; herda_acl?: boolean; arquivada?: boolean };
  if (c.arquivada === true) await arquivarPasta(ctx, id);
  else if (c.arquivada === false) await restaurarPasta(ctx, id);
  if (c.nome !== undefined || c.sensibilidade_padrao !== undefined || c.parent_id !== undefined) {
    await atualizarPasta(ctx, id, { nome: c.nome, sensibilidade_padrao: c.sensibilidade_padrao, parent_id: c.parent_id });
  }
  if (typeof c.herda_acl === "boolean") await definirHerancaPasta(ctx, id, c.herda_acl);
  return NextResponse.json({ ok: true });
});

// DELETE /api/v1/ged/pastas/:id – arquiva a pasta (precisa estar vazia).
// DELETE /api/v1/ged/pastas/:id?excluir=true  { confirmacao: "<nome da pasta>", apenas_possiveis? } – EXCLUI a pasta, as subpastas e os
// documentos (definitivo; tudo-ou-nada). Equivale a POST /pastas/:id/excluir (pré-visualização: GET /pastas/:id/excluir).
export const DELETE = rota(async (req: Request, { params }: Ctx) => {
  const ctx = await ctxGedApi();
  const { id } = await params;
  if (new URL(req.url).searchParams.get("excluir") === "true") return respostaInicio(await iniciarExclusao(ctx, { tipo: "PASTA", id }, await lerEntradaExclusao(req)));
  await arquivarPasta(ctx, id);
  return NextResponse.json({ ok: true });
});
