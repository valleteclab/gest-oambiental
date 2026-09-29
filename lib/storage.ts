import "server-only";
import { mkdir, readFile, writeFile, stat, unlink, readdir } from "node:fs/promises";
import path from "node:path";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { exigirArquivoLimpo, type ContextoUpload } from "./antivirus";

// Storage S3-compatível (AWS S3 / R2 / MinIO) ou disco local em dev. Chave: {municipio}/{contexto}/{id}/{arquivo}
const driver = () => process.env.STORAGE_DRIVER ?? "local";
const dirLocal = () => path.resolve(process.env.STORAGE_LOCAL_DIR ?? "./storage");

let s3: S3Client | null = null;
let s3Publico: S3Client | null = null;
const novoCliente = (endpoint?: string) =>
  new S3Client({
    // Variável vazia (referência não resolvida) também cai no padrão
    region: process.env.S3_REGION || (endpoint ? "auto" : "sa-east-1"),
    endpoint: endpoint || undefined,
    // MinIO exige path-style; Railway Buckets/R2 usam virtual-hosted (S3_FORCE_PATH_STYLE=false)
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE ? process.env.S3_FORCE_PATH_STYLE === "true" : !!endpoint,
  });
function cliente() {
  s3 ??= novoCliente(process.env.S3_ENDPOINT);
  return s3;
}
/** Cliente para URLs pré-assinadas acessadas pelo navegador (ex.: MinIO atrás de outro host no docker-compose). */
function clientePublico() {
  if (!process.env.S3_PUBLIC_ENDPOINT) return cliente();
  s3Publico ??= novoCliente(process.env.S3_PUBLIC_ENDPOINT);
  return s3Publico;
}
const bucket = () => process.env.S3_BUCKET ?? "licenciagov";

function caminhoSeguro(key: string) {
  const p = path.resolve(dirLocal(), key);
  if (!p.startsWith(dirLocal() + path.sep)) throw new Error("storage_key inválida");
  return p;
}

export async function salvarArquivo(key: string, dados: Buffer, mime = "application/octet-stream") {
  if (driver() === "s3") {
    await cliente().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: dados, ContentType: mime }));
    return;
  }
  const p = caminhoSeguro(key);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, dados);
}

/**
 * Grava um arquivo ENVIADO POR USUÁRIO/CIDADÃO (anexos, fotos, comprovantes, mídia dos canais): passa antes
 * pelo antivírus opcional (lib/antivirus.ts – CLAMAV_HOST). Arquivos gerados pelo sistema usam salvarArquivo().
 */
export async function salvarUpload(key: string, dados: Buffer, mime: string, ctx: ContextoUpload) {
  await exigirArquivoLimpo(dados, ctx);
  await salvarArquivo(key, dados, mime);
}

export async function lerArquivo(key: string): Promise<Buffer> {
  if (driver() === "s3") {
    const r = await cliente().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  return readFile(caminhoSeguro(key));
}

export async function removerArquivo(key: string) {
  if (driver() === "s3") await cliente().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
  else await unlink(caminhoSeguro(key)).catch(() => {});
}

/** Chaves sob um prefixo de "diretório" (ex.: "backups/"). Não recursivo no modo local. */
export async function listarArquivos(prefixo: string): Promise<string[]> {
  if (driver() === "s3") {
    const chaves: string[] = [];
    let token: string | undefined;
    do {
      const r = await cliente().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefixo, ContinuationToken: token }));
      for (const o of r.Contents ?? []) if (o.Key) chaves.push(o.Key);
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return chaves;
  }
  const dir = caminhoSeguro(prefixo.replace(/\/+$/, ""));
  const nomes = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return nomes.filter((n) => n.isFile()).map((n) => `${prefixo.replace(/\/+$/, "")}/${n.name}`);
}

/** Driver de storage em uso ("local" | "s3"). */
export const driverStorage = () => driver();

/** URL pré-assinada de upload (S3). Em modo local retorna null e o upload vai pela rota multipart. */
export async function urlUploadPreAssinada(key: string, mime: string): Promise<string | null> {
  if (driver() !== "s3") return null;
  return getSignedUrl(clientePublico(), new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: mime }), { expiresIn: 600 });
}

export async function storageSaudavel(): Promise<boolean> {
  try {
    if (driver() === "s3") await cliente().send(new HeadBucketCommand({ Bucket: bucket() }));
    else {
      await mkdir(dirLocal(), { recursive: true });
      await stat(dirLocal());
    }
    return true;
  } catch {
    return false;
  }
}

// Upload: whitelist de tipos e limite 25 MB (SPEC 9.3)
export const LIMITE_UPLOAD = 25 * 1024 * 1024;
export const EXTENSOES_PERMITIDAS = ["pdf", "jpg", "jpeg", "png", "dwg", "kml", "kmz", "zip"];

export function validarUpload(nome: string, tamanho: number): string | null {
  const ext = nome.split(".").pop()?.toLowerCase() ?? "";
  if (!EXTENSOES_PERMITIDAS.includes(ext)) return `Tipo de arquivo não permitido (.${ext}). Permitidos: ${EXTENSOES_PERMITIDAS.join(", ")}.`;
  if (tamanho > LIMITE_UPLOAD) return "Arquivo excede o limite de 25 MB.";
  return null;
}

export const nomeSeguro = (nome: string) => nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
