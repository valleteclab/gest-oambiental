import { NextResponse } from "next/server";
import { z } from "zod";
import { getUsuario } from "@/lib/auth";
import { invalido, naoAutenticado, rota } from "@/lib/http";
import { cobrancaParaApi } from "@/lib/cobranca/consultas";
import { baixaManual, cancelarCobranca, isentar, reenviarCobranca, simularPagamento, tentarNovamente } from "@/lib/cobranca/servico";

export const dynamic = "force-dynamic";

const Motivo = z.object({ motivo: z.string().trim().min(5, "Informe o motivo (mín. 5 caracteres).").max(1000) });
const Baixa = Motivo.extend({
  forma: z.enum(["MANUAL", "DAM", "PIX", "TRANSFERENCIA", "DINHEIRO"]).optional().default("MANUAL"),
  pago_em: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  valor_pago: z.coerce.number().positive().max(10_000_000).optional().nullable(),
});

/**
 * POST /api/v1/cobrancas/{id}/{acao} – baixa (JSON {motivo, forma?, pago_em?, valor_pago?}; comprovante só pela tela),
 * isentar {motivo}, cancelar {motivo}, tentar-novamente, reenviar, simular-pagamento (homologação).
 * Permissão revalidada no serviço (ADMIN/GESTOR_MUNICIPAL do município; simulação também pelo requerente titular).
 */
export const POST = rota(async (req: Request, { params }: { params: Promise<{ id: string; acao: string }> }) => {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  const { id, acao } = await params;
  const corpo = await req.json().catch(() => ({}));
  switch (acao) {
    case "baixa": {
      const b = Baixa.parse(corpo);
      const c = await baixaManual(id, u, { motivo: b.motivo, forma: b.forma, pago_em: b.pago_em ? new Date(`${b.pago_em}T12:00:00Z`) : null, valor_pago: b.valor_pago ?? null });
      return NextResponse.json(cobrancaParaApi(c));
    }
    case "isentar":
      return NextResponse.json(cobrancaParaApi(await isentar(id, u, Motivo.parse(corpo).motivo)));
    case "cancelar":
      return NextResponse.json(cobrancaParaApi(await cancelarCobranca(id, u, Motivo.parse(corpo).motivo)));
    case "tentar-novamente":
      return NextResponse.json(cobrancaParaApi(await tentarNovamente(id, u)));
    case "reenviar":
      return NextResponse.json({ destinatarios: await reenviarCobranca(id, u) });
    case "simular-pagamento":
      return NextResponse.json(cobrancaParaApi(await simularPagamento(id, u)));
    default:
      throw invalido(`Ação desconhecida: ${acao}.`);
  }
});
