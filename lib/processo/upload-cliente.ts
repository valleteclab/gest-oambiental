// Upload de anexos a partir do navegador (sem dependências de servidor).
// Local: multipart direto; S3: URL pré-assinada (PUT) + confirmação (SHA-256 calculado no servidor).

export type MetaUpload = { tipo?: "DOCUMENTO_EXIGIDO" | "RESPOSTA_PENDENCIA" | "OUTRO"; documento_exigido_id?: string | null; pendencia_id?: string | null };
export type AnexoEnviado = { id: string; nome_arquivo: string; tamanho: number; sha256: string; url: string };

export const LIMITE_MB = 25;
export const ACCEPT_PADRAO = ".pdf,.jpg,.jpeg,.png,.dwg,.kml,.kmz,.zip";

async function erroDe(r: Response) {
  const j = await r.json().catch(() => null);
  return new Error(j?.message ?? `Falha no envio (HTTP ${r.status}).`);
}

export async function enviarAnexo(processoId: string, arquivo: File, meta: MetaUpload = {}): Promise<AnexoEnviado> {
  if (arquivo.size > LIMITE_MB * 1024 * 1024) throw new Error(`"${arquivo.name}" excede o limite de ${LIMITE_MB} MB.`);
  const base = `/api/v1/processos/${processoId}/anexos`;
  const pedido = await fetch(base, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nome: arquivo.name, mime: arquivo.type || null, tamanho: arquivo.size, ...meta }),
  });
  if (!pedido.ok) throw await erroDe(pedido);
  const plano = (await pedido.json()) as { modo: "multipart" } | { modo: "s3"; url: string; storage_key: string; mime: string };

  if (plano.modo === "s3") {
    const put = await fetch(plano.url, { method: "PUT", headers: { "Content-Type": plano.mime }, body: arquivo });
    if (!put.ok) throw new Error(`Falha no envio para o armazenamento (HTTP ${put.status}).`);
    const conf = await fetch(`${base}/confirmar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storage_key: plano.storage_key, nome: arquivo.name, mime: plano.mime, ...meta }),
    });
    if (!conf.ok) throw await erroDe(conf);
    return conf.json();
  }

  const fd = new FormData();
  fd.set("arquivo", arquivo);
  if (meta.tipo) fd.set("tipo", meta.tipo);
  if (meta.documento_exigido_id) fd.set("documento_exigido_id", meta.documento_exigido_id);
  if (meta.pendencia_id) fd.set("pendencia_id", meta.pendencia_id);
  const r = await fetch(base, { method: "POST", body: fd });
  if (!r.ok) throw await erroDe(r);
  return r.json();
}

export function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}
