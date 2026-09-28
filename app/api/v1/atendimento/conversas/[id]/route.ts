import { NextResponse } from "next/server";
import { z } from "zod";
import { naoEncontrado, rota } from "@/lib/http";
import { ehUuid, usuarioApi } from "@/lib/fiscalizacao/api";
import { assumirAtendimento, criarDenunciaManual, devolverParaIa, encerrarConversa, obterConversaAtendimento, responderComoAtendente } from "@/lib/agente/atendimento";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// GET /api/v1/atendimento/conversas/{id} – conversa com mensagens (escopo por município)
export const GET = rota(async (_req: Request, { params }: Ctx) => {
  const u = await usuarioApi("denuncia");
  const { id } = await params;
  if (!ehUuid(id)) throw naoEncontrado();
  const c = await obterConversaAtendimento(u, id);
  return NextResponse.json({
    id: c.id, estado: c.estado, canal: c.canal, municipio: c.municipio, denuncia: c.denuncia, nome: c.nome, contato: c.contato, ia_pausada_ate: c.ia_pausada_ate,
    dados: c.dados, pode_atender: c.podeAtender,
    mensagens: c.mensagens.map((m) => ({ id: m.id, direcao: m.direcao, autor: m.autor, tipo: m.tipo, texto: m.texto, botoes: m.botoes, status_envio: m.status_envio, erro: m.erro, tem_midia: !!m.midia_key, latitude: m.latitude, longitude: m.longitude, created_at: m.created_at })),
  });
});

const Acao = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("assumir") }),
  z.object({ acao: z.literal("devolver") }),
  z.object({ acao: z.literal("encerrar") }),
  z.object({ acao: z.literal("responder"), texto: z.string().trim().min(1, "Digite a mensagem.").max(4000) }),
  z.object({ acao: z.literal("criar_denuncia"), descricao: z.string().trim().max(5000).optional().nullable(), endereco: z.string().trim().max(300).optional().nullable(), municipio_id: z.string().uuid().optional().nullable() }),
]);

// POST /api/v1/atendimento/conversas/{id} {acao: assumir|devolver|encerrar|responder|criar_denuncia}
export const POST = rota(async (req: Request, { params }: Ctx) => {
  const u = await usuarioApi("denuncia");
  const { id } = await params;
  if (!ehUuid(id)) throw naoEncontrado();
  const a = Acao.parse(await req.json());
  switch (a.acao) {
    case "assumir": await assumirAtendimento(u, id); break;
    case "devolver": await devolverParaIa(u, id); break;
    case "encerrar": await encerrarConversa(u, id); break;
    case "responder": {
      const m = await responderComoAtendente(u, id, a.texto);
      return NextResponse.json({ ok: true, mensagem: { id: m?.id, status_envio: m?.status_envio, erro: m?.erro } });
    }
    case "criar_denuncia": {
      const d = await criarDenunciaManual(u, id, a);
      return NextResponse.json({ ok: true, denuncia: { id: d.id, protocolo: d.protocolo } }, { status: 201 });
    }
  }
  return NextResponse.json({ ok: true });
});
