import { NextResponse } from "next/server";
import { rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { criarCompartilhamento, listarCompartilhamentos } from "@/lib/ged/compartilhamento/servico";

export const dynamic = "force-dynamic";

// GET /api/v1/ged/compartilhamentos?escopo=meus|todos&status=ATIVO|EXPIRADO|REVOGADO&recurso_tipo=&recurso_id=&page=&size=
// Lista os links de quem compartilha (o Administrador pode pedir escopo=todos). Nunca devolve token nem o WhatsApp completo.
export const GET = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  const q = new URL(req.url).searchParams;
  const status = q.get("status");
  const tipo = q.get("recurso_tipo");
  const r = await listarCompartilhamentos(ctx, {
    escopo: q.get("escopo") === "todos" ? "todos" : "meus",
    status: status === "ATIVO" || status === "EXPIRADO" || status === "REVOGADO" ? status : null,
    recurso_tipo: tipo === "DOCUMENTO" || tipo === "PASTA" ? tipo : null,
    recurso_id: q.get("recurso_id"),
    page: Number(q.get("page") ?? 1) || 1,
    size: Number(q.get("size") ?? 20) || 20,
  });
  return NextResponse.json({ data: r.itens, total: r.total, page: r.page, size: r.size });
});

// POST /api/v1/ged/compartilhamentos – { recurso:{tipo:"documento"|"pasta",id}, whatsapp, destinatario_nome?, validade_dias?, pode_visualizar?, pode_baixar?,
//   pode_zip?, limite_downloads?, mensagem?, confirmar_restrito?, congelar?, notificar_primeiro_acesso?, enviar_link_whatsapp? }
// Devolve o link (token) UMA vez. SIGILOSO → 422; conteúdo RESTRITO sem confirmar_restrito → 409; sem canal de WhatsApp → 409.
export const POST = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  const corpo = await req.json().catch(() => null);
  const r = await criarCompartilhamento(ctx, corpo ?? {});
  return NextResponse.json(r, { status: 201, headers: { "Cache-Control": "no-store" } });
});
