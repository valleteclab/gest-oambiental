// Execução do `ocrmypdf` (processo externo) para o OCR do GED. Binário configurável por GED_OCR_BIN (padrão `ocrmypdf`);
// sem o binário a execução devolve INDISPONIVEL (o upload nunca quebra). Sem shell: `spawn` com argumentos em lista.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { classificarSaidaOcr, ehImagemOcr, type SaidaOcr } from "./decisao";

export const binarioOcr = (env: Record<string, string | undefined> = process.env) => (env.GED_OCR_BIN || "ocrmypdf").trim();
export const timeoutOcrMs = (env: Record<string, string | undefined> = process.env) => (Number(env.GED_OCR_TIMEOUT_MS) > 0 ? Number(env.GED_OCR_TIMEOUT_MS) : 15 * 60_000);

/** Argumentos do ocrmypdf: `-l por --skip-text --jobs 2` (+ saída PDF comum, sem conversão PDF/A) – PURA. */
export function argumentosOcr(e: { entrada: string; saida: string; imagem?: boolean; idioma?: string; jobs?: number }): string[] {
  const args = ["-l", e.idioma || "por", "--skip-text", "--jobs", String(e.jobs ?? 2), "--output-type", "pdf", "--quiet"];
  if (e.imagem) args.push("--image-dpi", "300"); // imagem sem DPI nos metadados
  args.push(e.entrada, e.saida);
  return args;
}

type ResultadoProcesso = { codigo: number | null; sinal: string | null; erroSpawn: string | null; tempoEsgotado: boolean; stdout: string; stderr: string };

function rodar(bin: string, args: string[], timeoutMs: number, env?: NodeJS.ProcessEnv): Promise<ResultadoProcesso> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let tempoEsgotado = false;
    let terminou = false;
    const fim = (r: Omit<ResultadoProcesso, "stdout" | "stderr" | "tempoEsgotado">) => {
      if (terminou) return;
      terminou = true;
      clearTimeout(t);
      resolve({ ...r, tempoEsgotado, stdout, stderr });
    };
    let filho: ReturnType<typeof spawn>;
    try {
      filho = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], env: env ?? process.env });
    } catch (e) {
      resolve({ codigo: null, sinal: null, erroSpawn: e instanceof Error ? `${(e as NodeJS.ErrnoException).code ?? ""} ${e.message}` : String(e), tempoEsgotado: false, stdout, stderr });
      return;
    }
    const t = setTimeout(() => {
      tempoEsgotado = true;
      filho.kill("SIGKILL");
    }, timeoutMs);
    t.unref?.();
    filho.stdout?.on("data", (d: Buffer) => (stdout = (stdout + d.toString()).slice(-4000)));
    filho.stderr?.on("data", (d: Buffer) => (stderr = (stderr + d.toString()).slice(-4000)));
    filho.on("error", (e: NodeJS.ErrnoException) => fim({ codigo: null, sinal: null, erroSpawn: `${e.code ?? ""} ${e.message}` }));
    filho.on("close", (codigo, sinal) => fim({ codigo, sinal, erroSpawn: null }));
  });
}

let cacheDisponivel: { bin: string; ate: number; ok: boolean } | null = null;

/** O ocrmypdf responde a `--version`? (cache de 60 s; `forcar` ignora o cache) */
export async function ocrDisponivel(opc: { forcar?: boolean } = {}): Promise<boolean> {
  const bin = binarioOcr();
  if (!opc.forcar && cacheDisponivel && cacheDisponivel.bin === bin && cacheDisponivel.ate > Date.now()) return cacheDisponivel.ok;
  const r = await rodar(bin, ["--version"], 15_000);
  const ok = r.erroSpawn === null && !r.tempoEsgotado && r.codigo === 0;
  cacheDisponivel = { bin, ate: Date.now() + 60_000, ok };
  return ok;
}
export const _limparCacheOcr = () => {
  cacheDisponivel = null;
};

export type ResultadoOcr = { saida: SaidaOcr; arquivo: Buffer | null };

/** Roda o OCR sobre `entrada` (PDF ou imagem) em diretório temporário; devolve o PDF pesquisável quando OK. Nunca lança. */
export async function executarOcr(entrada: Buffer, mime: string, opc: { timeoutMs?: number; idioma?: string; jobs?: number } = {}): Promise<ResultadoOcr> {
  const dir = await mkdtemp(path.join(tmpdir(), "ged-ocr-"));
  try {
    const imagem = ehImagemOcr(mime);
    const arqEntrada = path.join(dir, `${randomUUID()}.${imagem ? "img" : "pdf"}`);
    const arqSaida = path.join(dir, `${randomUUID()}.pdf`);
    await writeFile(arqEntrada, entrada);
    const args = argumentosOcr({ entrada: arqEntrada, saida: arqSaida, imagem, idioma: opc.idioma ?? process.env.GED_OCR_IDIOMA, jobs: opc.jobs ?? (Number(process.env.GED_OCR_JOBS) > 0 ? Number(process.env.GED_OCR_JOBS) : 2) });
    // Tesseract usa OpenMP: 1 thread por job (o paralelismo vem do --jobs), senão satura a CPU do worker.
    const r = await rodar(binarioOcr(), args, opc.timeoutMs ?? timeoutOcrMs(), { ...process.env, OMP_THREAD_LIMIT: "1" });
    const saida = classificarSaidaOcr({ codigo: r.codigo, sinal: r.sinal, erroSpawn: r.erroSpawn, tempoEsgotado: r.tempoEsgotado, stderr: r.stderr });
    if (saida.tipo !== "OK") return { saida, arquivo: null };
    try {
      const arquivo = await readFile(arqSaida);
      if (arquivo.length === 0) return { saida: { tipo: "FALHA", detalhe: "saída vazia" }, arquivo: null };
      return { saida, arquivo };
    } catch {
      return { saida: { tipo: "FALHA", detalhe: "saída ausente" }, arquivo: null };
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
