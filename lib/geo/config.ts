import "server-only";
import { prisma } from "@/lib/db";
import { getOrgaoAtivo } from "@/lib/auth";
import type { UsuarioSessao } from "@/lib/rbac";
import { codigoIbgeReal, ufDoMunicipio } from "@/lib/geo/uf";

// Configuração dos mapas lida em TEMPO DE EXECUÇÃO (a imagem Docker é construída sem variáveis de ambiente):
// GOOGLE_MAPS_KEY (opcional) e MAPAS_UF_PADRAO (UF quando o código IBGE do município não é real – dados demo).

export type ConfigMapas = {
  google_maps_key: string | null;
  /** Órgão ativo (município) – centro padrão dos mapas e UF das camadas estaduais (CAR/SIGEF). */
  orgao: { id: string; nome: string; centro: [number, number] | null; codigo_ibge: string | null } | null;
  uf: string | null;
};

export function chaveGoogleMaps(): string | null {
  const k = (process.env.GOOGLE_MAPS_KEY ?? "").trim();
  return k.length > 10 ? k : null;
}

export function ufPadrao(): string {
  return (process.env.MAPAS_UF_PADRAO ?? "BA").trim().toUpperCase() || "BA";
}

export async function configMapas(u: UsuarioSessao | null): Promise<ConfigMapas> {
  if (!u) return { google_maps_key: null, orgao: null, uf: ufPadrao() };
  const ativo = await getOrgaoAtivo();
  const m = ativo ? await prisma.municipio.findUnique({ where: { id: ativo.id }, select: { id: true, nome: true, latitude: true, longitude: true, codigo_ibge: true } }) : null;
  return {
    google_maps_key: chaveGoogleMaps(),
    orgao: m
      ? {
          id: m.id, nome: m.nome,
          centro: m.latitude != null && m.longitude != null ? [Number(m.latitude), Number(m.longitude)] : null,
          codigo_ibge: codigoIbgeReal(m.codigo_ibge) ? m.codigo_ibge : null,
        }
      : null,
    uf: ufDoMunicipio(m?.codigo_ibge, ufPadrao()),
  };
}
