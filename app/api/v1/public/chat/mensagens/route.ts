import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ErroApi, invalido, rota } from "@/lib/http";
import { excedeuLimite } from "@/lib/fiscalizacao/antiabuso";
import { COOKIE_CHAT, encerrarWeb, mensagemWeb, mensagensWeb, municipioPublico } from "@/lib/agente/webchat";

// Chat do site (público, sem login) – POST envia (texto/botão/localização/foto), GET lê (polling), DELETE encerra.
// Sessão = token aleatório em cookie httpOnly. Anti-abuso: honeypot, limite por IP e por conversa, tamanho.

export const dynamic = "force-dynamic";
const LIMITE_FOTO = 8 * 1024 * 1024;

async function token(criar: boolean): Promise<string | null> {
  const jar = await cookies();
  const t = jar.get(COOKIE_CHAT)?.value;
  if (t && /^[\w-]{20,64}$/.test(t)) return t;
  if (!criar) return null;
  const novo = randomBytes(24).toString("base64url");
  jar.set(COOKIE_CHAT, novo, { httpOnly: true, sameSite: "lax", secure: (process.env.APP_URL ?? "").startsWith("https://"), path: "/api/v1/public/chat", maxAge: 7 * 86400 });
  return novo;
}

const num = (v: FormDataEntryValue | unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

export const POST = rota(async (req: Request) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  if (Number(req.headers.get("content-length") ?? 0) > LIMITE_FOTO + 64 * 1024) throw new ErroApi(413, "MUITO_GRANDE", "Arquivo muito grande (máx. 8 MB).");
  let campos: Record<string, unknown> = {};
  let foto: { dados: Buffer; nome: string; mime: string } | null = null;
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const f = await req.formData();
    for (const [k, v] of f.entries()) if (typeof v === "string") campos[k] = v;
    const arq = f.get("foto");
    if (arq && typeof arq !== "string" && arq.size > 0) {
      if (arq.size > LIMITE_FOTO) throw new ErroApi(413, "MUITO_GRANDE", "Foto muito grande (máx. 8 MB).");
      foto = { dados: Buffer.from(await arq.arrayBuffer()), nome: arq.name || "foto.jpg", mime: arq.type || "image/jpeg" };
    }
  } else {
    const t = await req.text();
    if (t.length > 20000) throw new ErroApi(413, "MUITO_GRANDE", "Mensagem muito grande.");
    try {
      campos = JSON.parse(t || "{}");
    } catch {
      throw invalido("JSON inválido.");
    }
  }
  if (typeof campos.website === "string" && campos.website) throw invalido("Envio rejeitado.");
  if (excedeuLimite(`chat:${ip}`, Number(process.env.CHAT_LIMITE_IP ?? 60), 10 * 60 * 1000)) throw new ErroApi(429, "LIMITE_EXCEDIDO", "Muitas mensagens deste endereço. Aguarde alguns minutos.");
  const municipio = String(campos.municipio ?? "");
  const t = (await token(true))!;
  const r = await mensagemWeb(municipio, t, {
    texto: typeof campos.texto === "string" ? campos.texto : null,
    botao: typeof campos.botao === "string" ? campos.botao : null,
    latitude: num(campos.latitude),
    longitude: num(campos.longitude),
    cliente_id: typeof campos.cliente_id === "string" ? campos.cliente_id : null,
    foto,
  });
  return NextResponse.json(r);
});

export const GET = rota(async (req: Request) => {
  const url = new URL(req.url);
  const mun = await municipioPublico(url.searchParams.get("municipio") ?? "");
  if (!mun) throw invalido("Município inválido.");
  const t = await token(false);
  if (!t) return NextResponse.json({ estado: null, mensagens: [] });
  const desde = url.searchParams.get("desde");
  const d = desde ? new Date(desde) : null;
  return NextResponse.json(await mensagensWeb(mun.id, t, d && !isNaN(d.getTime()) ? d : null));
});

export const DELETE = rota(async (req: Request) => {
  const mun = await municipioPublico(new URL(req.url).searchParams.get("municipio") ?? "");
  const t = await token(false);
  if (mun && t) await encerrarWeb(mun.id, t);
  return NextResponse.json({ ok: true });
});
