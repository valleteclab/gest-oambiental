// Utilitários HTTP/cache para os serviços geográficos externos (somente servidor).

/** Cache LRU simples em memória, com validade (sem banco; some ao reiniciar o processo). */
export class CacheMemoria<T> {
  private mapa = new Map<string, { v: T; ate: number }>();
  constructor(private max: number, private ttlMs: number) {}
  obter(k: string): T | undefined {
    const e = this.mapa.get(k);
    if (!e) return undefined;
    if (e.ate < Date.now()) {
      this.mapa.delete(k);
      return undefined;
    }
    this.mapa.delete(k);
    this.mapa.set(k, e); // recente no fim
    return e.v;
  }
  definir(k: string, v: T) {
    this.mapa.delete(k);
    this.mapa.set(k, { v, ate: Date.now() + this.ttlMs });
    while (this.mapa.size > this.max) this.mapa.delete(this.mapa.keys().next().value as string);
  }
}

export class ErroServicoExterno extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

/** GET JSON com tempo limite; erro em status ≠ 2xx ou corpo não-JSON (GeoServer devolve XML de exceção com 200). */
export async function buscarJson<T>(url: string, timeoutMs = 10_000): Promise<T> {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: "application/json, application/geo+json;q=0.9" }, cache: "no-store" });
  if (!r.ok) throw new ErroServicoExterno(`HTTP ${r.status}`, r.status);
  const txt = await r.text();
  try {
    return JSON.parse(txt) as T;
  } catch {
    throw new ErroServicoExterno("Resposta inválida do serviço externo.");
  }
}
