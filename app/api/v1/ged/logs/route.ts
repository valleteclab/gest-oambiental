import { NextResponse } from "next/server";
import { rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { csvDosLogs, listarAcessos, listarAlteracoes, listarComunicacoes } from "@/lib/ged/logs/consulta";
import { lerFiltros } from "@/lib/ged/logs/filtros";

export const dynamic = "force-dynamic";

// GET /api/v1/ged/logs?aba=acessos|alteracoes|comunicacoes&de&ate&usuario&documento&acao&canal&status&evento&page[&formato=csv]
// GED_ADMIN/GED_AUDITOR; sempre do cliente da sessão. formato=csv devolve a visão filtrada em fluxo (auditado).
export const GET = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  const sp = new URL(req.url).searchParams;
  const f = lerFiltros(Object.fromEntries(sp.entries()));
  if (sp.get("formato") === "csv") {
    const { nome, corpo } = await csvDosLogs(ctx, f);
    return new Response(corpo, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${nome}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex" },
    });
  }
  const pagina = f.aba === "acessos" ? await listarAcessos(ctx, f) : f.aba === "alteracoes" ? await listarAlteracoes(ctx, f) : await listarComunicacoes(ctx, f);
  return NextResponse.json({ aba: f.aba, ...pagina }, { headers: { "Cache-Control": "private, no-store" } });
});
