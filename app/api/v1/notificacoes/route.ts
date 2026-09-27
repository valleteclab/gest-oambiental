import { NextResponse } from "next/server";
import { paginacao, rota } from "@/lib/http";
import { parametro, usuarioApi } from "@/lib/fiscalizacao/api";
import { NotificacaoSchema } from "@/lib/fiscalizacao/schemas";
import { criarNotificacao, listarNotificacoes } from "@/lib/fiscalizacao/servico";

// GET /api/v1/notificacoes?municipio=&status=&page=&size=
export const GET = rota(async (req: Request) => {
  const u = await usuarioApi();
  const url = new URL(req.url);
  const pag = paginacao(url);
  const r = await listarNotificacoes(u, { municipio_id: parametro(url, "municipio"), status: parametro(url, "status") }, pag);
  return NextResponse.json({ ...r, page: pag.page, size: pag.size });
});

// POST /api/v1/notificacoes – emite notificação (NOT-{MUN}-000/ANO) vinculada a fiscalização ou processo e tenta gerar o PDF
export const POST = rota(async (req: Request) => {
  const u = await usuarioApi();
  const d = NotificacaoSchema.parse(await req.json());
  const r = await criarNotificacao(u, d);
  return NextResponse.json({ id: r.notificacao.id, numero: r.notificacao.numero, prazo_ate: r.notificacao.prazo_ate, documento_id: r.documento_id, erro_pdf: r.erro_pdf }, { status: 201 });
});
