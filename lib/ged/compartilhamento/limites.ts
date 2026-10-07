// Anti-abuso das rotas PÚBLICAS do compartilhamento – janela deslizante em memória (lib/limite-login.ts; por processo: com várias
// réplicas, limite também no proxy/WAF). O limite POR LINK (reenvio de código, falhas seguidas e bloqueio progressivo) fica no
// banco (GedCompartilhamento.otp_falhas/bloqueado_ate e os OTPs) para valer entre réplicas.
//   volume ....... por IP, qualquer requisição pública (padrão 600/10 min; env COMPARTILHAMENTO_LIMITE_VOLUME)
//   token ruim ... por IP, token que não resolve (chute de link) – 30 falhas/10 min
//   envio de OTP . por IP, 10 pedidos/hora (env COMPARTILHAMENTO_LIMITE_OTP_IP)
//   código errado  por IP, bloqueio progressivo (5 → 1 min, 10 → 10 min, 20 → 1 h) dentro de 1 h
import { ErroApi } from "@/lib/http";
import { ipBloqueado, registrarFalhaIp, segundosParaLiberar } from "@/lib/limite-login";

const inteiro = (v: string | undefined, padrao: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : padrao;
};

export const MENSAGEM_MUITAS_TENTATIVAS_LINK = "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.";

const JANELA_VOLUME = 10 * 60_000;
const JANELA_HORA = 3_600_000;
const kVolume = (ip: string) => `ged-comp:vol:${ip}`;
const kToken = (ip: string) => `ged-comp:token:${ip}`;
const kOtpIp = (ip: string) => `ged-comp:otp:${ip}`;
const kFalhaIp = (ip: string) => `ged-comp:falha:${ip}`;

const limiteVolume = () => inteiro(process.env.COMPARTILHAMENTO_LIMITE_VOLUME, 600);
const limiteOtpIp = () => inteiro(process.env.COMPARTILHAMENTO_LIMITE_OTP_IP, 10);
const LIMITE_TOKEN_RUIM = 30;

const erro429 = (seg: number) => new ErroApi(429, "MUITAS_TENTATIVAS", MENSAGEM_MUITAS_TENTATIVAS_LINK, { retry_after: Math.max(seg, 1) });

/** Conta a requisição; lança 429 se o IP passou do volume ou errou muitos tokens. */
export function exigirVolumePermitido(ip: string, agora = Date.now()) {
  if (ipBloqueado(kToken(ip), agora, LIMITE_TOKEN_RUIM, JANELA_VOLUME)) throw erro429(segundosParaLiberar(kToken(ip), agora, JANELA_VOLUME));
  if (ipBloqueado(kVolume(ip), agora, limiteVolume(), JANELA_VOLUME)) throw erro429(segundosParaLiberar(kVolume(ip), agora, JANELA_VOLUME));
  registrarFalhaIp(kVolume(ip), agora, JANELA_VOLUME);
}
/** Token que não resolveu (inexistente/revogado/expirado). */
export const registrarTokenRuim = (ip: string, agora = Date.now()) => void registrarFalhaIp(kToken(ip), agora, JANELA_VOLUME);

/** Pedido de código: conta a tentativa; lança 429 acima do limite horário por IP. */
export function exigirEnvioOtpPermitido(ip: string, agora = Date.now()) {
  if (ipBloqueado(kOtpIp(ip), agora, limiteOtpIp(), JANELA_HORA)) throw erro429(segundosParaLiberar(kOtpIp(ip), agora, JANELA_HORA));
  registrarFalhaIp(kOtpIp(ip), agora, JANELA_HORA);
}

/** Espera (ms) do bloqueio progressivo por IP com `falhas` na última hora. */
export function esperaIpMs(falhas: number): number {
  if (falhas >= 20) return JANELA_HORA;
  if (falhas >= 10) return 10 * 60_000;
  if (falhas >= 5) return 60_000;
  return 0;
}

/** Lança 429 se o IP está em bloqueio progressivo por códigos errados. */
export function exigirIpSemBloqueioOtp(ip: string, agora = Date.now()) {
  for (const [max, janela] of [[20, JANELA_HORA], [10, 10 * 60_000], [5, 60_000]] as const) {
    if (ipBloqueado(kFalhaIp(ip), agora, max, janela)) throw erro429(segundosParaLiberar(kFalhaIp(ip), agora, janela));
  }
}
export const registrarCodigoErradoIp = (ip: string, agora = Date.now()) => registrarFalhaIp(kFalhaIp(ip), agora, JANELA_HORA);
