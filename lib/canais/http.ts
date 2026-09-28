// Chamadas HTTP aos provedores (timeout, erro legível). Em containers com proxy de saída use NODE_USE_ENV_PROXY=1.

export class ErroProvedor extends Error {
  constructor(message: string, public status?: number, public corpo?: string) {
    super(message);
  }
}

export async function chamarJson<T = unknown>(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; json?: unknown; body?: BodyInit; timeoutMs?: number } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", ...(opts.headers ?? {}) };
  let body = opts.body;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  }
  let r: Response;
  try {
    r = await fetch(url, { method: opts.method ?? (body ? "POST" : "GET"), headers, body, signal: AbortSignal.timeout(opts.timeoutMs ?? 15000) });
  } catch (e) {
    throw new ErroProvedor(`Falha de conexão com o provedor: ${(e as Error).message}`);
  }
  const texto = await r.text();
  if (!r.ok) throw new ErroProvedor(`Provedor respondeu HTTP ${r.status}`, r.status, texto.slice(0, 500));
  if (!texto) return {} as T;
  try {
    return JSON.parse(texto) as T;
  } catch {
    return { texto } as T;
  }
}

/** Baixa um arquivo (mídia) com limite de tamanho. */
export async function baixar(url: string, headers: Record<string, string> = {}, limite = 16 * 1024 * 1024): Promise<{ dados: Buffer; mime: string }> {
  let r: Response;
  try {
    r = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  } catch (e) {
    throw new ErroProvedor(`Falha ao baixar mídia: ${(e as Error).message}`);
  }
  if (!r.ok) throw new ErroProvedor(`Falha ao baixar mídia (HTTP ${r.status})`, r.status);
  const tam = Number(r.headers.get("content-length") ?? 0);
  if (tam > limite) throw new ErroProvedor("Mídia excede o limite.");
  const dados = Buffer.from(await r.arrayBuffer());
  if (dados.length > limite) throw new ErroProvedor("Mídia excede o limite.");
  return { dados, mime: (r.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim() };
}

export const semBarraFinal = (u: string) => u.replace(/\/+$/, "");
