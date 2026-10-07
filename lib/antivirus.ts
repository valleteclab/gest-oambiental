// Antivírus opcional nos uploads (SPEC 9.3) – ClamAV (clamd) pelo protocolo INSTREAM via TCP, sem dependências.
//   CLAMAV_HOST         host do clamd (sem valor → verificação desligada, comportamento anterior)
//   CLAMAV_PORT         porta TCP (padrão 3310)
//   CLAMAV_OBRIGATORIO  "true" → clamd inacessível RECUSA o upload; padrão false → registra aviso e aceita
//   CLAMAV_TIMEOUT_MS   tempo máximo da verificação (padrão 30000)
// Protocolo: "zINSTREAM\0", blocos [tamanho uint32 big-endian][dados], bloco de tamanho 0 encerra;
// resposta "stream: OK" | "stream: <assinatura> FOUND" | "<mensagem> ERROR" (terminada em \0).
import net from "node:net";
import { ErroApi } from "./http";

export type ResultadoClamd = { limpo: true } | { limpo: false; assinatura: string };
export type ConfigAntivirus = { host: string; port: number; obrigatorio: boolean; timeoutMs: number };

const BLOCO = 64 * 1024;

export function configAntivirus(env: NodeJS.ProcessEnv = process.env): ConfigAntivirus | null {
  const host = env.CLAMAV_HOST?.trim();
  if (!host) return null;
  const port = Number(env.CLAMAV_PORT) || 3310;
  const timeoutMs = Number(env.CLAMAV_TIMEOUT_MS) || 30_000;
  return { host, port, obrigatorio: env.CLAMAV_OBRIGATORIO === "true", timeoutMs };
}

/** Interpreta a resposta do clamd. Lança erro para respostas de erro/inesperadas. */
export function interpretarRespostaClamd(resposta: string): ResultadoClamd {
  const r = resposta.replace(/\0/g, "").trim();
  const corpo = r.replace(/^(stream|\S+):\s*/, "");
  if (corpo === "OK") return { limpo: true };
  const m = corpo.match(/^(.+?)\s+FOUND$/);
  if (m) return { limpo: false, assinatura: m[1].trim() };
  throw new Error(`clamd: resposta inesperada: ${r.slice(0, 200) || "(vazia)"}`);
}

/** Envia o buffer ao clamd (INSTREAM) e devolve o resultado. Lança erro se não conectar, expirar ou o clamd responder ERROR. */
export function escanearClamd(dados: Buffer, cfg: Pick<ConfigAntivirus, "host" | "port" | "timeoutMs">): Promise<ResultadoClamd> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    let terminado = false;
    const fim = (erro: Error | null, valor?: ResultadoClamd) => {
      if (terminado) return;
      terminado = true;
      sock.destroy();
      if (erro) reject(erro);
      else resolve(valor!);
    };
    const sock = net.createConnection({ host: cfg.host, port: cfg.port });
    sock.setTimeout(cfg.timeoutMs, () => fim(new Error(`clamd: tempo esgotado (${cfg.timeoutMs} ms)`)));
    sock.on("error", (e) => fim(new Error(`clamd: ${e.message}`)));
    sock.on("data", (d) => {
      partes.push(d);
      if (d.includes(0)) {
        try {
          fim(null, interpretarRespostaClamd(Buffer.concat(partes).toString("utf8")));
        } catch (e) {
          fim(e as Error);
        }
      }
    });
    sock.on("end", () => {
      try {
        fim(null, interpretarRespostaClamd(Buffer.concat(partes).toString("utf8")));
      } catch (e) {
        fim(e as Error);
      }
    });
    sock.on("connect", () => {
      sock.write("zINSTREAM\0");
      for (let i = 0; i < dados.length; i += BLOCO) {
        const bloco = dados.subarray(i, i + BLOCO);
        const tam = Buffer.alloc(4);
        tam.writeUInt32BE(bloco.length);
        sock.write(tam);
        sock.write(bloco);
      }
      sock.write(Buffer.alloc(4)); // tamanho 0 = fim do stream
    });
  });
}

export type ContextoUpload = { nome: string; contexto: string; usuario_id?: string | null; entidade_id?: string | null };

/**
 * Verifica o arquivo enviado pelo usuário. Sem CLAMAV_HOST não faz nada.
 * Ameaça → registra UPLOAD_BLOQUEADO_ANTIVIRUS (auditoria) e lança 422 ARQUIVO_INFECTADO.
 * clamd indisponível → CLAMAV_OBRIGATORIO=true: 503 ANTIVIRUS_INDISPONIVEL; senão aviso no log e aceita.
 */
export async function exigirArquivoLimpo(dados: Buffer, ctx: ContextoUpload, cfg: ConfigAntivirus | null = configAntivirus()): Promise<void> {
  if (!cfg) return;
  let r: ResultadoClamd;
  try {
    r = await escanearClamd(dados, cfg);
  } catch (e) {
    if (cfg.obrigatorio) {
      console.error(`[antivirus] verificação indisponível (${ctx.contexto}): ${(e as Error).message}`);
      throw new ErroApi(503, "ANTIVIRUS_INDISPONIVEL", "Não foi possível verificar o arquivo no antivírus. Tente novamente em alguns minutos.");
    }
    console.warn(`[antivirus] verificação indisponível – arquivo aceito sem verificação (${ctx.contexto}): ${(e as Error).message}`);
    return;
  }
  if (r.limpo) return;
  console.warn(`[antivirus] upload bloqueado (${ctx.contexto}, ${ctx.nome}): ${r.assinatura}`);
  try {
    const { auditar } = await import("./audit");
    await auditar({
      usuario_id: ctx.usuario_id ?? null,
      acao: "UPLOAD_BLOQUEADO_ANTIVIRUS",
      entidade: "upload",
      entidade_id: ctx.entidade_id ?? null,
      depois: { nome: ctx.nome, contexto: ctx.contexto, assinatura: r.assinatura, tamanho: dados.length },
    });
  } catch (e) {
    console.warn(`[antivirus] falha ao auditar bloqueio: ${(e as Error).message}`);
  }
  throw new ErroApi(422, "ARQUIVO_INFECTADO", `Arquivo recusado: ameaça detectada (${r.assinatura})`, { assinatura: r.assinatura });
}
