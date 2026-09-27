import "server-only";
import { getUsuario } from "../auth";
import { invalido, naoAutenticado, proibido } from "../http";
import { can, isInterno, type Recurso } from "../rbac";
import type { FotoUpload } from "./servico";

/** Usuário interno autenticado com permissão de ver o recurso (rotas /api/v1 de fiscalização). */
export async function usuarioApi(recurso: Recurso = "fiscalizacao") {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  if (!isInterno(u) || !can(u, "ver", recurso)) throw proibido();
  return u;
}

/** Lê corpo JSON ou multipart (`dados` = JSON, `fotos` = arquivos, `fotos_meta` = JSON [{latitude,longitude}]). */
export async function lerCorpoComFotos(req: Request): Promise<{ dados: unknown; fotos: FotoUpload[] }> {
  const tipo = req.headers.get("content-type") ?? "";
  if (!tipo.includes("multipart/form-data")) return { dados: await req.json().catch(() => { throw invalido("JSON inválido."); }), fotos: [] };
  const form = await req.formData();
  let dados: unknown = {};
  const bruto = form.get("dados");
  if (typeof bruto === "string" && bruto) {
    try {
      dados = JSON.parse(bruto);
    } catch {
      throw invalido("Campo 'dados' deve ser JSON.");
    }
  }
  let meta: { latitude?: number | null; longitude?: number | null }[] = [];
  const m = form.get("fotos_meta");
  if (typeof m === "string" && m) {
    try {
      meta = JSON.parse(m);
    } catch {
      meta = [];
    }
  }
  const arquivos = form.getAll("fotos").filter((f): f is File => typeof f !== "string");
  const fotos: FotoUpload[] = [];
  for (const [i, f] of arquivos.entries()) {
    const mm = meta[i] ?? {};
    const ok = (v: unknown, lim: number) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= lim;
    fotos.push({ nome: f.name, dados: Buffer.from(await f.arrayBuffer()), latitude: ok(mm.latitude, 90) ? mm.latitude : null, longitude: ok(mm.longitude, 180) ? mm.longitude : null });
  }
  return { dados, fotos };
}

export const parametro = (url: URL, nome: string) => url.searchParams.get(nome) || null;

export function enumOuNulo<T extends string>(v: string | null, valores: readonly T[]): T | null {
  return v && (valores as readonly string[]).includes(v) ? (v as T) : null;
}

export const ehUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
