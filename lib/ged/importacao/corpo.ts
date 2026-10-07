// Leitura de corpo de requisição com teto (sem confiar em Content-Length): aborta ao passar do limite, sem acumular tudo.
import "server-only";
import { ErroApi } from "@/lib/http";

export async function lerCorpoLimitado(req: Request, max: number): Promise<Buffer> {
  const declarado = Number(req.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declarado) && declarado > max) throw new ErroApi(413, "CORPO_GRANDE", `O envio excede ${Math.round(max / 1048576)} MB.`);
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const partes: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new ErroApi(413, "CORPO_GRANDE", `O envio excede ${Math.round(max / 1048576)} MB.`);
    }
    partes.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  return Buffer.concat(partes, total);
}

/** Content-Length declarado (NaN quando ausente). */
export const tamanhoDeclarado = (req: Request) => Number(req.headers.get("content-length") ?? NaN);
