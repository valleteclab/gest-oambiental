import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { getUsuario } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { emitirDocumento } from "@/lib/documentos";
import { naoAutenticado, paginacao, proibido, rota } from "@/lib/http";
import { can, isInterno, podeVerMunicipio, whereMunicipio } from "@/lib/rbac";

const TIPOS = ["LICENCA", "AUTORIZACAO", "CERTIDAO", "AUTO_INFRACAO", "NOTIFICACAO", "PARECER", "OFICIO", "RECIBO"] as const;

const Corpo = z.object({
  tipo: z.enum(TIPOS),
  municipio_id: z.string().uuid(),
  processo_id: z.string().uuid().nullish(),
  fiscalizacao_id: z.string().uuid().nullish(),
  titular_id: z.string().uuid().nullish(),
  sigla_ato: z.string().min(1).max(20).nullish(),
  numero: z.string().min(1).max(60).nullish(),
  validade_ate: z.coerce.date().nullish(),
  dados: z.record(z.string(), z.unknown()).default({}),
});

/** GET /api/v1/documentos?tipo=&status=&municipio=&de=&ate=&page=&size= – documentos emitidos no escopo do usuário. */
export const GET = rota(async (req: Request) => {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  if (!isInterno(u) || !can(u, "ver", "documento")) throw proibido();
  const url = new URL(req.url);
  const { page, size, skip, take } = paginacao(url);
  const q = url.searchParams;
  const where: Prisma.DocumentoOficialWhereInput = {
    ...whereMunicipio(u, q.get("municipio")),
    ...(q.get("tipo") && (TIPOS as readonly string[]).includes(q.get("tipo")!) ? { tipo: q.get("tipo") as (typeof TIPOS)[number] } : {}),
    ...(["VALIDO", "CANCELADO", "SUBSTITUIDO"].includes(q.get("status") ?? "") ? { status: q.get("status") as "VALIDO" } : {}),
    ...(q.get("processo_id") ? { processo_id: q.get("processo_id")! } : {}),
    ...(q.get("de") || q.get("ate")
      ? { emitido_em: { ...(q.get("de") ? { gte: new Date(`${q.get("de")}T00:00:00-03:00`) } : {}), ...(q.get("ate") ? { lte: new Date(`${q.get("ate")}T23:59:59-03:00`) } : {}) } }
      : {}),
  };
  const [total, itens] = await Promise.all([
    prisma.documentoOficial.count({ where }),
    prisma.documentoOficial.findMany({ where, orderBy: { emitido_em: "desc" }, skip, take, omit: { dados: true } }),
  ]);
  return NextResponse.json({ page, size, total, itens });
});

/** POST /api/v1/documentos – emissão genérica (integrações). */
export const POST = rota(async (req: Request) => {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  const c = Corpo.parse(await req.json());
  if (!isInterno(u) || !podeVerMunicipio(u, c.municipio_id) || !can(u, "emitir_documento", "documento", c.municipio_id)) throw proibido("Sem permissão para emitir documentos neste município.");
  if (c.processo_id) {
    const p = await prisma.processo.findUnique({ where: { id: c.processo_id }, select: { municipio_id: true } });
    if (!p || p.municipio_id !== c.municipio_id) throw proibido("Processo fora do município informado.");
  }
  const doc = await emitirDocumento({ ...c, usuario: u });
  return NextResponse.json(doc, { status: 201 });
});
