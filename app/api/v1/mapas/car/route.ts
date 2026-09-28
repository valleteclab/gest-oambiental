import { NextResponse } from "next/server";
import { z } from "zod";
import { ErroApi, invalido, rota } from "@/lib/http";
import { usuarioApi } from "@/lib/cadastros/api";
import { configMapas } from "@/lib/geo/config";
import { consultarCarNoPonto } from "@/lib/geo/car";
import { normalizarUf } from "@/lib/geo/uf";
import { prisma } from "@/lib/db";
import { whereMunicipio } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const Q = z.object({
  lat: z.coerce.number().min(-34, "Latitude fora do Brasil.").max(6, "Latitude fora do Brasil."),
  lng: z.coerce.number().min(-74, "Longitude fora do Brasil.").max(-28, "Longitude fora do Brasil."),
  uf: z.string().optional(),
});

// GET /api/v1/mapas/car?lat=&lng=[&uf=BA] – imóvel(is) do CAR (SICAR) que contém o ponto.
// UF: parâmetro, senão a do órgão ativo (código IBGE) ou MAPAS_UF_PADRAO.
export const GET = rota(async (req: Request) => {
  const u = await usuarioApi();
  const s = new URL(req.url).searchParams;
  const p = Q.safeParse({ lat: s.get("lat"), lng: s.get("lng"), uf: s.get("uf") ?? undefined });
  if (!p.success) throw invalido(p.error.issues[0]?.message ?? "Parâmetros inválidos.", p.error.issues);
  const uf = normalizarUf(p.data.uf) ?? (await configMapas(u)).uf;
  if (!uf) throw invalido("UF não identificada para consultar o CAR.");
  try {
    const imoveis = await consultarCarNoPonto(p.data.lat, p.data.lng, uf);
    // O SICAR público não traz nome do imóvel nem proprietário (LGPD). Quando o nº do CAR já está
    // cadastrado num empreendimento do escopo do usuário, devolve o nome e o requerente do cadastro local.
    const locais = imoveis.length
      ? await prisma.empreendimento.findMany({
          where: { ...whereMunicipio(u), numero_car: { in: imoveis.map((i) => i.cod_imovel) } },
          select: { id: true, nome: true, numero_car: true, requerente: { select: { nome: true } } },
        })
      : [];
    const resposta = imoveis.map((i) => {
      const e = locais.find((l) => l.numero_car === i.cod_imovel);
      return { ...i, cadastro_local: e ? { empreendimento_id: e.id, nome: e.nome, requerente: e.requerente.nome } : null };
    });
    return NextResponse.json({ uf, lat: p.data.lat, lng: p.data.lng, imoveis: resposta }, { headers: { "Cache-Control": "private, max-age=600" } });
  } catch (e) {
    console.warn("[mapas/car] SICAR indisponível:", e instanceof Error ? e.message : e);
    throw new ErroApi(502, "SERVICO_EXTERNO", "O serviço do CAR (SICAR) não respondeu. Tente novamente em instantes.");
  }
});
