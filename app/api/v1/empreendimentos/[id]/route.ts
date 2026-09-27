import { NextResponse } from "next/server";
import { naoEncontrado, proibido, rota } from "@/lib/http";
import { isInterno } from "@/lib/rbac";
import { corpoJson, usuarioApi } from "@/lib/cadastros/api";
import { atualizarEmpreendimento, fichaEmpreendimento, obterEmpreendimentoBasico } from "@/lib/cadastros/empreendimentos";

type Ctx = { params: Promise<{ id: string }> };

/** Ficha do empreendimento: requerente (mascarado), RTs, processos, licenças vinculadas e fiscalizações. */
export const GET = rota(async (_req: Request, { params }: Ctx) => {
  const u = await usuarioApi();
  const { id } = await params;
  const b = await obterEmpreendimentoBasico(u, id);
  if (b === null) throw naoEncontrado();
  if (b === "PROIBIDO") throw proibido();
  const f = await fichaEmpreendimento(id);
  if (!f) throw naoEncontrado();
  const { requerente, processos, fiscalizacoes, ...resto } = f;
  return NextResponse.json({
    ...resto,
    requerente: { id: requerente.id, tipo: requerente.tipo, nome: requerente.nome, cpf_cnpj_mascara: requerente.cpf_cnpj_mascara },
    processos: processos.map((p) => ({ id: p.id, numero: p.numero, status: isInterno(u) ? p.status : p.status, tipo_ato: p.tipo_ato, data_protocolo: p.data_protocolo })),
    fiscalizacoes: isInterno(u) ? fiscalizacoes : [],
  });
});

export const PATCH = rota(async (req: Request, { params }: Ctx) => {
  const u = await usuarioApi();
  const e = await atualizarEmpreendimento(u, (await params).id, await corpoJson(req));
  return NextResponse.json(e);
});
