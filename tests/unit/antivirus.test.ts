import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import net from "node:net";
import { configAntivirus, escanearClamd, exigirArquivoLimpo, interpretarRespostaClamd } from "@/lib/antivirus";

vi.mock("@/lib/audit", () => ({ auditar: vi.fn(async () => undefined) }));

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

/** clamd falso: lê o INSTREAM (comando + blocos com tamanho) e responde como o clamd real. */
const recebidos: Buffer[] = [];
const comandos: string[] = [];
const servidor = net.createServer((sock) => {
  let buf = Buffer.alloc(0);
  let cmdLido = false;
  const dados: Buffer[] = [];
  sock.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    if (!cmdLido) {
      const fim = buf.indexOf(0);
      if (fim < 0) return;
      comandos.push(buf.subarray(0, fim).toString());
      buf = buf.subarray(fim + 1);
      cmdLido = true;
    }
    while (buf.length >= 4) {
      const tam = buf.readUInt32BE(0);
      if (tam === 0) {
        const tudo = Buffer.concat(dados);
        recebidos.push(tudo);
        const txt = tudo.toString("latin1");
        sock.end(txt.includes("EICAR-STANDARD") ? "stream: Eicar-Signature FOUND\0" : txt.startsWith("ERRO") ? "INSTREAM size limit exceeded. ERROR\0" : "stream: OK\0");
        return;
      }
      if (buf.length < 4 + tam) return;
      dados.push(buf.subarray(4, 4 + tam));
      buf = buf.subarray(4 + tam);
    }
  });
});
let porta = 0;

beforeAll(async () => {
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", () => r()));
  porta = (servidor.address() as net.AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => servidor.close(() => r())));

const cfg = (extra: Partial<{ obrigatorio: boolean; port: number }> = {}) => ({ host: "127.0.0.1", port: porta, obrigatorio: false, timeoutMs: 3000, ...extra });

describe("antivírus (clamd INSTREAM)", () => {
  it("interpreta respostas do clamd", () => {
    expect(interpretarRespostaClamd("stream: OK\0")).toEqual({ limpo: true });
    expect(interpretarRespostaClamd("stream: Win.Test.EICAR_HDB-1 FOUND\0")).toEqual({ limpo: false, assinatura: "Win.Test.EICAR_HDB-1" });
    expect(() => interpretarRespostaClamd("INSTREAM size limit exceeded. ERROR\0")).toThrow(/inesperada/);
  });

  it("config: sem CLAMAV_HOST desliga; porta padrão 3310", () => {
    expect(configAntivirus({} as NodeJS.ProcessEnv)).toBeNull();
    expect(configAntivirus({ CLAMAV_HOST: "clamav.railway.internal" } as unknown as NodeJS.ProcessEnv)).toMatchObject({ host: "clamav.railway.internal", port: 3310, obrigatorio: false });
    expect(configAntivirus({ CLAMAV_HOST: "x", CLAMAV_PORT: "3311", CLAMAV_OBRIGATORIO: "true" } as unknown as NodeJS.ProcessEnv)).toMatchObject({ port: 3311, obrigatorio: true });
  });

  it("arquivo limpo → OK (envia zINSTREAM em blocos e o conteúdo chega íntegro)", async () => {
    const grande = Buffer.alloc(200 * 1024, 7);
    expect(await escanearClamd(grande, cfg())).toEqual({ limpo: true });
    expect(comandos.at(-1)).toBe("zINSTREAM");
    expect(recebidos.at(-1)!.equals(grande)).toBe(true);
  });

  it("EICAR → FOUND com assinatura; exigirArquivoLimpo recusa com mensagem amigável", async () => {
    expect(await escanearClamd(Buffer.from(EICAR), cfg())).toEqual({ limpo: false, assinatura: "Eicar-Signature" });
    await expect(exigirArquivoLimpo(Buffer.from(EICAR), { nome: "x.pdf", contexto: "teste", usuario_id: null }, cfg())).rejects.toMatchObject({
      status: 422,
      code: "ARQUIVO_INFECTADO",
      message: "Arquivo recusado: ameaça detectada (Eicar-Signature)",
    });
    const { auditar } = await import("@/lib/audit");
    expect(auditar).toHaveBeenCalledWith(expect.objectContaining({ acao: "UPLOAD_BLOQUEADO_ANTIVIRUS", entidade: "upload" }));
  });

  it("resposta ERROR do clamd é tratada como indisponibilidade", async () => {
    await expect(escanearClamd(Buffer.from("ERRO"), cfg())).rejects.toThrow();
  });

  it("clamd inacessível: opcional aceita; obrigatório recusa com 503", async () => {
    const livre = await new Promise<number>((r) => {
      const s = net.createServer().listen(0, "127.0.0.1", () => {
        const p = (s.address() as net.AddressInfo).port;
        s.close(() => r(p));
      });
    });
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(exigirArquivoLimpo(Buffer.from("ok"), { nome: "a.pdf", contexto: "teste" }, cfg({ port: livre }))).resolves.toBeUndefined();
    await expect(exigirArquivoLimpo(Buffer.from("ok"), { nome: "a.pdf", contexto: "teste" }, cfg({ port: livre, obrigatorio: true }))).rejects.toMatchObject({ status: 503, code: "ANTIVIRUS_INDISPONIVEL" });
    aviso.mockRestore();
    erro.mockRestore();
  });

  it("sem configuração não verifica nada", async () => {
    await expect(exigirArquivoLimpo(Buffer.from(EICAR), { nome: "x", contexto: "t" }, null)).resolves.toBeUndefined();
  });
});
