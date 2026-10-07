import { NextResponse } from "next/server";
import { consultarProcessoPublico } from "@/lib/documentos/publico";
import { invalido, naoEncontrado, rota } from "@/lib/http";

/** GET /api/v1/public/processos?numero=ITB-2026-000001[&doc=CPF/CNPJ] – consulta pública (número exato). */
export const GET = rota(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  const numero = q.get("numero");
  if (!numero) throw invalido("Informe o número do processo (parâmetro numero).");
  const p = await consultarProcessoPublico(numero, q.get("doc"));
  if (!p) throw naoEncontrado("Processo não encontrado. Confira o número (e o CPF/CNPJ, se informado).");
  return NextResponse.json(p, { headers: { "Cache-Control": "no-store" } });
});
