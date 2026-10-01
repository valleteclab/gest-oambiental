import { NextResponse } from "next/server";
import { z } from "zod";
import { getUsuario } from "@/lib/auth";
import { naoAutenticado, paginacao, proibido, rota } from "@/lib/http";
import { can, isInterno } from "@/lib/rbac";
import { cobrancaParaApi, listarCobrancas } from "@/lib/cobranca/consultas";
import { gerarCobrancaManual } from "@/lib/cobranca/servico";
import { UUID_RE } from "@/lib/processo/consultas";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/cobrancas?municipio=&status=&fase=&de=&ate=&q=&processo=&page=&size= – cobranças de taxas no escopo
 * (servidor: municípios do escopo; requerente: seus processos). Inclui totais (arrecadado/pendente/vencido/isento).
 */
export const GET = rota(async (req: Request) => {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  if (isInterno(u) && !can(u, "ver", "cobranca")) throw proibido();
  const url = new URL(req.url);
  const pg = paginacao(url);
  const s = url.searchParams;
  const { total, itens, totais } = await listarCobrancas(u, { municipio: s.get("municipio"), status: s.get("status"), fase: s.get("fase"), de: s.get("de"), ate: s.get("ate"), q: s.get("q"), processo: s.get("processo") }, pg);
  return NextResponse.json({ page: pg.page, size: pg.size, total, totais: isInterno(u) ? totais : undefined, items: itens.map((c) => cobrancaParaApi(c)) });
});

const Gerar = z.object({
  processo_id: z.string().regex(UUID_RE, "Processo inválido."),
  fase: z.enum(["UNICA", "ANALISE", "VISTORIA", "EMISSAO"]),
  valor: z.coerce.number().positive().max(10_000_000).optional().nullable(),
  descricao: z.string().trim().max(500).optional().nullable(),
});

/** POST /api/v1/cobrancas {processo_id, fase, valor?, descricao?} – gera cobrança manual (ADMIN/GESTOR_MUNICIPAL). */
export const POST = rota(async (req: Request) => {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  const b = Gerar.parse(await req.json().catch(() => ({})));
  const c = await gerarCobrancaManual(b.processo_id, b.fase, u, { valor: b.valor ?? null, descricao: b.descricao ?? null });
  return NextResponse.json(cobrancaParaApi(c), { status: 201 });
});
