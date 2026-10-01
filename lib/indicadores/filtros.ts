import { z } from "zod";
import { podeVerMunicipio, type UsuarioSessao } from "@/lib/rbac";
import type { FiltrosIndicadores } from "./calcular";

// Leitura dos filtros globais (?municipio=&de=&ate=&tipo_ato=&tecnico=) – usado por páginas e rotas.

const uuid = z.string().uuid().optional().catch(undefined);
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined);

const Esquema = z.object({ municipio: uuid, de: dia, ate: dia, tipo_ato: uuid, tecnico: uuid });

type Fonte = URLSearchParams | Record<string, string | string[] | undefined>;

export function lerFiltros(fonte: Fonte): FiltrosIndicadores {
  const get = (k: string) => {
    if (fonte instanceof URLSearchParams) return fonte.get(k) || undefined;
    const v = fonte[k];
    return (Array.isArray(v) ? v[0] : v) || undefined;
  };
  const f = Esquema.parse({ municipio: get("municipio"), de: get("de"), ate: get("ate"), tipo_ato: get("tipo_ato"), tecnico: get("tecnico") });
  let { de, ate } = f;
  if (de && ate && de > ate) [de, ate] = [ate, de];
  return { municipio_id: f.municipio ?? null, de: de ?? null, ate: ate ?? null, tipo_ato_id: f.tipo_ato ?? null, tecnico_id: f.tecnico ?? null };
}

/** Município pedido fora do escopo do usuário → acesso negado (403). */
export function municipioPermitido(u: UsuarioSessao, f: FiltrosIndicadores): boolean {
  return !f.municipio_id || podeVerMunicipio(u, f.municipio_id);
}

/** Query string dos filtros (para links e downloads). */
export function queryFiltros(f: FiltrosIndicadores, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  if (f.municipio_id) p.set("municipio", f.municipio_id);
  if (f.de) p.set("de", f.de);
  if (f.ate) p.set("ate", f.ate);
  if (f.tipo_ato_id) p.set("tipo_ato", f.tipo_ato_id);
  if (f.tecnico_id) p.set("tecnico", f.tecnico_id);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}
