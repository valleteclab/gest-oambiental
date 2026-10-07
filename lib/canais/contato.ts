// Hash (HMAC-SHA256 com HASH_PEPPER) de contatos e chats: permite achar a conversa e conferir a titularidade de
// uma denúncia ("mesmo telefone/e-mail") sem guardar o valor em claro. Não reversível.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { normalizarTelefone } from "./telefone";

const hmac = (v: string) => createHmac("sha256", process.env.HASH_PEPPER ?? "").update(v).digest("hex");

export const ehEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

/** Normaliza telefone (E.164 canônico) ou e-mail (minúsculas). null se não for nenhum dos dois. */
export function normalizarContato(v: string | null | undefined): { tipo: "telefone" | "email"; valor: string } | null {
  if (!v) return null;
  const t = v.trim();
  if (ehEmail(t)) return { tipo: "email", valor: t.toLowerCase() };
  const tel = normalizarTelefone(t);
  return tel ? { tipo: "telefone", valor: tel } : null;
}

/** Hash do contato do cidadão (telefone ou e-mail). Mesmo telefone com/sem 9º dígito → mesmo hash. */
export function hashContato(v: string | null | undefined): string | null {
  const n = normalizarContato(v);
  return n ? hmac(`${n.tipo}:${n.valor}`) : null;
}

/** Hash do identificador do chat no provedor, por canal. */
export const hashChat = (canalId: string, chatId: string) => hmac(`chat:${canalId}:${chatId}`);

/** Comparação em tempo constante (segredos de webhook). */
export function iguaisSeguro(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const gerarSegredo = (bytes = 24) => randomBytes(bytes).toString("base64url");
