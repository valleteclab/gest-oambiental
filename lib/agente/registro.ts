// Montagem dos campos da denúncia a partir dos dados coletados (pura).
import type { CanalDenuncia, TipoCanal } from "@prisma/client";
import { rotuloTipo, type DadosColetados } from "./tipos";

export function canalDaDenuncia(tipo: TipoCanal): Extract<CanalDenuncia, "WHATSAPP" | "CHAT_SITE" | "EMAIL"> {
  if (tipo === "WEBCHAT") return "CHAT_SITE";
  if (tipo === "EMAIL") return "EMAIL";
  return "WHATSAPP";
}

const ORIGEM: Record<TipoCanal, string> = {
  WHATSAPP_EVOLUTION: "WhatsApp",
  WHATSAPP_ZAPI: "WhatsApp",
  WHATSAPP_CHATWOOT: "WhatsApp",
  WEBCHAT: "chat do site",
  EMAIL: "e-mail",
};

export function textoDenuncia(d: DadosColetados, tipo: TipoCanal): { descricao: string; endereco: string | null } {
  const partes = [`[${rotuloTipo(d.tipo_ocorrencia)}] ${d.descricao?.trim() ?? ""}`.trim()];
  const obsFotos = (d.fotos ?? []).map((f) => f.descricao_ia).filter(Boolean);
  if (obsFotos.length) partes.push(`Observado nas fotos (análise automática): ${obsFotos.join(" | ")}`);
  partes.push(`Registrada pelo ${ORIGEM[tipo]} (atendimento automatizado).`);
  const temGps = d.latitude != null && d.longitude != null;
  const endereco = [d.endereco?.trim() || (temGps ? "Localização enviada pelo cidadão (GPS)" : null), d.referencia ? `Ref.: ${d.referencia.trim()}` : null].filter(Boolean).join(" – ");
  return { descricao: partes.join("\n\n"), endereco: endereco || null };
}

/** Dados mínimos para registrar (usado também pelo "Criar denúncia manualmente"). */
export function faltandoParaRegistro(d: DadosColetados, municipioId: string | null): string[] {
  const f: string[] = [];
  if (!municipioId && !d.municipio_id) f.push("município");
  if (!d.descricao || d.descricao.trim().length < 5) f.push("descrição");
  if ((d.latitude == null || d.longitude == null) && !d.endereco) f.push("local");
  return f;
}
