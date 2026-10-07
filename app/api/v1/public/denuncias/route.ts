import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ErroApi, invalido, rota } from "@/lib/http";
import { DenunciaPublicaSchema } from "@/lib/fiscalizacao/schemas";
import { criarDenunciaPublica } from "@/lib/fiscalizacao/servico";
import { excedeuLimite, TAMANHO_MAX_CORPO, TEMPO_MINIMO_MS } from "@/lib/fiscalizacao/antiabuso";
import { ROTULO_STATUS_DENUNCIA } from "@/lib/fiscalizacao/regras";

// POST /api/v1/public/denuncias – denúncia pelo portal (sem login). Anti-abuso: honeypot, tempo mínimo, tamanho, limite por IP.
export const POST = rota(async (req: Request) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  const texto = await req.text();
  if (texto.length > TAMANHO_MAX_CORPO) throw new ErroApi(413, "MUITO_GRANDE", "Conteúdo excede o tamanho máximo permitido.");
  let corpo: unknown;
  try {
    corpo = JSON.parse(texto);
  } catch {
    throw invalido("JSON inválido.");
  }
  const d = DenunciaPublicaSchema.parse(corpo);
  if (d.tempo_ms !== undefined && d.tempo_ms < TEMPO_MINIMO_MS) throw invalido("Envio muito rápido. Revise os dados e tente novamente.");
  if (excedeuLimite(`den:${ip}`)) throw new ErroApi(429, "LIMITE_EXCEDIDO", "Muitas denúncias enviadas deste endereço. Tente novamente mais tarde.");
  const r = await criarDenunciaPublica(d);
  return NextResponse.json({ protocolo: r.protocolo, mensagem: "Denúncia registrada. Guarde o número de protocolo para acompanhamento." }, { status: 201 });
});

// GET /api/v1/public/denuncias?protocolo=DEN-ITB-001/2026 – situação (somente status, sem dados pessoais)
export const GET = rota(async (req: Request) => {
  const protocolo = new URL(req.url).searchParams.get("protocolo")?.trim().toUpperCase();
  if (!protocolo || protocolo.length > 40) throw invalido("Informe o protocolo.");
  const d = await prisma.denuncia.findUnique({ where: { protocolo, municipio: { organizacao: { status: "ATIVO" } } }, select: { protocolo: true, status: true, created_at: true, municipio: { select: { nome: true } } } });
  if (!d) throw new ErroApi(404, "NAO_ENCONTRADO", "Protocolo não encontrado.");
  return NextResponse.json({ protocolo: d.protocolo, status: d.status, status_rotulo: ROTULO_STATUS_DENUNCIA[d.status], municipio: d.municipio.nome, registrada_em: d.created_at });
});
