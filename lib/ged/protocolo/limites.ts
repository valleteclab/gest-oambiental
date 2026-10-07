// Anti-abuso do portal PÚBLICO de protocolo – janela deslizante em memória, nos moldes de lib/limite-login.ts (mesmo mecanismo,
// mesma ressalva: por processo; com várias réplicas limite também no proxy/WAF).
//   envio ........ por IP (padrão 8 envios/hora; env PROTOCOLO_LIMITE_ENVIO_IP / PROTOCOLO_LIMITE_ENVIO_JANELA_MIN) e por
//                  portal (todos os IPs somados; padrão 300/hora; PROTOCOLO_LIMITE_ENVIO_PORTAL) – conta TODA tentativa, inclusive a recusada;
//   consulta ..... por IP (volume) e por IP + falhas (adivinhar número/código) e, à parte, por protocolo alvo.
import { ErroApi } from "@/lib/http";
import { ipBloqueado, registrarFalhaIp, segundosParaLiberar } from "@/lib/limite-login";

const inteiro = (v: string | undefined, padrao: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : padrao;
};
export const limiteEnvioIp = () => inteiro(process.env.PROTOCOLO_LIMITE_ENVIO_IP, 8);
export const limiteEnvioPortal = () => inteiro(process.env.PROTOCOLO_LIMITE_ENVIO_PORTAL, 300);
export const janelaEnvioMs = () => inteiro(process.env.PROTOCOLO_LIMITE_ENVIO_JANELA_MIN, 60) * 60_000;

export const MENSAGEM_MUITOS_ENVIOS = "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.";

const kIp = (ip: string) => `ged-protocolo:envio:ip:${ip}`;
const kPortal = (org: string) => `ged-protocolo:envio:org:${org}`;

/** true = pode enviar (e a tentativa já é contabilizada). false = limite estourado. */
export function permitirEnvioPortal(ip: string, organizacaoId: string, agora = Date.now(), cfg: { ip?: number; portal?: number; janela?: number } = {}): boolean {
  const janela = cfg.janela ?? janelaEnvioMs();
  const maxIp = cfg.ip ?? limiteEnvioIp();
  const maxPortal = cfg.portal ?? limiteEnvioPortal();
  if (ipBloqueado(kIp(ip), agora, maxIp, janela) || ipBloqueado(kPortal(organizacaoId), agora, maxPortal, janela)) return false;
  registrarFalhaIp(kIp(ip), agora, janela);
  registrarFalhaIp(kPortal(organizacaoId), agora, janela);
  return true;
}

export const segundosParaNovoEnvio = (ip: string, agora = Date.now()) => segundosParaLiberar(kIp(ip), agora, janelaEnvioMs());

export function exigirEnvioPermitido(ip: string, organizacaoId: string) {
  if (!permitirEnvioPortal(ip, organizacaoId)) throw new ErroApi(429, "MUITAS_TENTATIVAS", MENSAGEM_MUITOS_ENVIOS, { retry_after: Math.max(segundosParaNovoEnvio(ip), 1) });
}

// ───────────── Consulta pública ─────────────
const CONSULTA_JANELA_MS = 10 * 60_000;
const CONSULTA_MAX_REQ = 120;
const CONSULTA_MAX_FALHAS_IP = 10;
const CONSULTA_MAX_FALHAS_ALVO = 8;

const kReq = (ip: string) => `ged-protocolo:consulta:req:${ip}`;
const kFalhaIp = (ip: string) => `ged-protocolo:consulta:falha:${ip}`;
const kFalhaAlvo = (org: string, numero: string) => `ged-protocolo:consulta:alvo:${org}:${numero}`;

/** true = pode consultar. Conta todo pedido (volume); bloqueia IP com muitas falhas e protocolo-alvo com muitas falhas. */
export function permitirConsultaProtocolo(ip: string, organizacaoId: string, numero: string | null, agora = Date.now()): boolean {
  if (ipBloqueado(kReq(ip), agora, CONSULTA_MAX_REQ, CONSULTA_JANELA_MS) || ipBloqueado(kFalhaIp(ip), agora, CONSULTA_MAX_FALHAS_IP, CONSULTA_JANELA_MS)) return false;
  if (numero && ipBloqueado(kFalhaAlvo(organizacaoId, numero), agora, CONSULTA_MAX_FALHAS_ALVO, CONSULTA_JANELA_MS)) return false;
  registrarFalhaIp(kReq(ip), agora, CONSULTA_JANELA_MS);
  return true;
}

/** Número/código que não casaram: conta contra o IP e contra o protocolo-alvo (contra chute distribuído). */
export function registrarConsultaSemResultado(ip: string, organizacaoId: string, numero: string | null, agora = Date.now()) {
  registrarFalhaIp(kFalhaIp(ip), agora, CONSULTA_JANELA_MS);
  if (numero) registrarFalhaIp(kFalhaAlvo(organizacaoId, numero), agora, CONSULTA_JANELA_MS);
}

export function exigirConsultaPermitida(ip: string, organizacaoId: string, numero: string | null) {
  if (!permitirConsultaProtocolo(ip, organizacaoId, numero)) throw new ErroApi(429, "MUITAS_TENTATIVAS", MENSAGEM_MUITOS_ENVIOS);
}
