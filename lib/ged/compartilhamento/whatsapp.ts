// Envio de WhatsApp do compartilhamento (OTP e link) pelo canal "somente envio" do cliente (GedConfig.canal_whatsapp_id) – o mesmo
// das notificações do GED. Envio DIRETO (não pela caixa de saída): o OTP precisa chegar na hora e o telefone do destinatário não
// é guardado na outbox. Sem ritmo de 3–8 s (é uma mensagem avulsa e urgente). Com CANAIS_ENVIO_SIMULADO=true nada é enviado.
import { envioSimulado, montarRuntime, provedor } from "@/lib/canais";
import type { GedDb } from "../db";

const TIPOS_WHATSAPP = new Set(["WHATSAPP_EVOLUTION", "WHATSAPP_ZAPI"]);

export type CanalWhatsappGed = { ok: true } | { ok: false; motivo: string };

/** O cliente tem canal de WhatsApp ativo, utilizável (Evolution/Z-API, não a API oficial com janela de 24 h)? */
export async function canalWhatsappDisponivel(db: GedDb, organizacaoId: string): Promise<CanalWhatsappGed> {
  const cfg = await db.gedConfig.findFirst({ select: { canal_whatsapp_id: true } });
  if (!cfg?.canal_whatsapp_id) return { ok: false, motivo: "Nenhum canal de WhatsApp está configurado para a organização. Peça ao administrador para configurar em Administração › Canal de WhatsApp." };
  const c = await db.canalAtendimento.findFirst({ where: { id: cfg.canal_whatsapp_id, organizacao_id: organizacaoId, ativo: true } });
  if (!c || !TIPOS_WHATSAPP.has(c.tipo)) return { ok: false, motivo: "O canal de WhatsApp da organização está inativo ou inválido. Peça ao administrador para revisar em Administração › Canal de WhatsApp." };
  return { ok: true };
}

export type ResultadoEnvioWhatsapp = { status: "ENVIADA" | "SIMULADA"; provider_message_id: string | null };

/** Envia `texto` ao `telefone` (E.164). Lança Error (mensagem sem dados pessoais) se o canal falhar. */
export async function enviarWhatsappGed(db: GedDb, organizacaoId: string, telefone: string, texto: string): Promise<ResultadoEnvioWhatsapp> {
  const cfg = await db.gedConfig.findFirst({ select: { canal_whatsapp_id: true } });
  if (!cfg?.canal_whatsapp_id) throw new Error("Nenhum canal de WhatsApp configurado.");
  const canalDb = await db.canalAtendimento.findFirst({ where: { id: cfg.canal_whatsapp_id, organizacao_id: organizacaoId, ativo: true } });
  if (!canalDb || !TIPOS_WHATSAPP.has(canalDb.tipo)) throw new Error("Canal de WhatsApp inexistente, inativo ou inválido.");
  if (envioSimulado()) {
    console.log(`[ged-compartilhamento][simulado] WhatsApp → ***${telefone.slice(-2)}: ${texto.replace(/\d{6}/g, "******").slice(0, 100)}`);
    return { status: "SIMULADA", provider_message_id: null };
  }
  const canal = montarRuntime(canalDb);
  const prov = provedor(canal.tipo);
  if (prov.oficial(canal)) throw new Error("API oficial do WhatsApp: fora da janela de 24 h é necessário template aprovado.");
  const r = await prov.sendText(canal, telefone, texto);
  return { status: "ENVIADA", provider_message_id: r.providerMessageId ?? null };
}

export const textoOtp = (orgao: string, codigo: string) => `Seu código para acessar documentos compartilhados por ${orgao}: ${codigo}. Válido por 10 minutos. Não compartilhe.`;
export const textoLink = (orgao: string, quem: string, rotulo: string, url: string) =>
  `${orgao}: ${quem} compartilhou com você "${rotulo.slice(0, 80)}". Acesse: ${url}\nAo abrir o link, você receberá um código neste WhatsApp para liberar o acesso.`;
