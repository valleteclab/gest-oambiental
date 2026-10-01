// Utilitários de navegador para as telas de campo (geolocalização e compressão de fotos).
// Importar apenas em componentes cliente.
import { LIMITE_FOTO, dimensoesReduzidas, manterOriginal } from "./regras";

export type Posicao = { latitude: number; longitude: number; precisao: number; em: number };

export function mensagemErroGeo(e: GeolocationPositionError | Error): string {
  if ("code" in e) {
    if (e.code === 1) return "Permissão de localização negada. Autorize o acesso à localização no navegador ou marque o ponto no mapa.";
    if (e.code === 2) return "Localização indisponível (sem sinal de GPS). Tente novamente em área aberta ou marque o ponto no mapa.";
    if (e.code === 3) return "Tempo esgotado ao obter a localização. Tente novamente.";
  }
  return e.message || "Não foi possível obter a localização.";
}

/** navigator.geolocation.getCurrentPosition com alta precisão (GPS). */
export function capturarPosicao(timeoutMs = 20000): Promise<Posicao> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Este dispositivo/navegador não oferece geolocalização. Marque o ponto no mapa."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: Number(p.coords.latitude.toFixed(6)), longitude: Number(p.coords.longitude.toFixed(6)), precisao: Math.round(p.coords.accuracy * 10) / 10, em: p.timestamp }),
      reject,
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

export type FotoProcessada = { arquivo: File; original: { nome: string; tamanho: number }; recomprimida: boolean };

async function carregarImagem(file: File): Promise<{ fonte: CanvasImageSource; largura: number; altura: number; liberar: () => void }> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { fonte: bmp, largura: bmp.width, altura: bmp.height, liberar: () => bmp.close() };
  } catch {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { fonte: img, largura: img.naturalWidth, altura: img.naturalHeight, liberar: () => URL.revokeObjectURL(url) };
  }
}

const paraBlob = (c: HTMLCanvasElement, q: number) => new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", q));

/**
 * Comprime a foto para ≤ 1,5 MB (SPEC 8). Se o original já é JPEG/PNG dentro do limite, é enviado sem alteração
 * (preserva EXIF: data, GPS, câmera). Na recompressão via canvas os metadados EXIF são perdidos – por isso a
 * vistoria grava lat/long e sha256 de cada foto no banco.
 */
export async function comprimirFoto(file: File, limite = LIMITE_FOTO): Promise<FotoProcessada> {
  const original = { nome: file.name, tamanho: file.size };
  if (manterOriginal(file.type, file.size)) return { arquivo: file, original, recomprimida: false };
  const img = await carregarImagem(file);
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    let maxLado = 2560;
    let melhor: Blob | null = null;
    for (let tentativa = 0; tentativa < 12; tentativa++) {
      const { largura, altura } = dimensoesReduzidas(img.largura, img.altura, maxLado);
      canvas.width = largura;
      canvas.height = altura;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, largura, altura);
      ctx.drawImage(img.fonte, 0, 0, largura, altura);
      for (const q of [0.85, 0.75, 0.65, 0.55]) {
        const b = await paraBlob(canvas, q);
        if (!b) continue;
        melhor = b;
        if (b.size <= limite) {
          const nome = file.name.replace(/\.[^.]*$/, "") + ".jpg";
          return { arquivo: new File([b], nome, { type: "image/jpeg", lastModified: file.lastModified }), original, recomprimida: true };
        }
      }
      maxLado = Math.round(maxLado * 0.75);
    }
    if (!melhor) throw new Error("Não foi possível processar a imagem.");
    throw new Error(`Não foi possível reduzir "${file.name}" para 1,5 MB.`);
  } finally {
    img.liberar();
  }
}

export const fmtBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Extrai a mensagem de erro no formato {code,message,details} da API. */
export async function erroDaResposta(r: Response): Promise<string> {
  try {
    const j = await r.json();
    const det = Array.isArray(j.details) ? j.details.map((d: { path?: (string | number)[]; message?: string }) => d.message).filter(Boolean) : [];
    return [j.message, ...det].filter(Boolean).join(" ");
  } catch {
    return `Erro ${r.status}.`;
  }
}
