// Importação v2 – lado do NAVEGADOR (e funções puras testáveis em Node): leitura de pasta (input webkitdirectory ou arrastar-e-soltar),
// plano/resumo antes de enviar, fila com concorrência limitada + pausa/cancelamento, retentativa com espera crescente e os motores
// de envio (pasta arquivo a arquivo; ZIP em partes). Sem node:*, sem "server-only": só importa caminhos.ts e limites.ts.
import { chaveDiretorio, ehPdf, ehZip, indicePastasPorDiretorio, MOTIVO_ZIP_DUPLICADO, normalizarCaminho, segmentoIgnorado, zipDuplicaPastaIrma } from "./caminhos";
import { LIMITES_PADRAO, TAMANHO_PARTE_ZIP, type LimitesZip } from "./limites";

// ───────────── Arquivos locais e plano ─────────────

export type ArquivoLocal = { caminho: string; tamanho: number; file?: File };

/** Lista de arquivos de um `<input webkitdirectory>` (cada File traz webkitRelativePath = "Pasta/Sub/arquivo.pdf"). */
export function arquivosDoInput(files: FileList | File[]): ArquivoLocal[] {
  return Array.from(files).map((f) => ({ caminho: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, tamanho: f.size, file: f }));
}

type EntradaFs = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (ok: (f: File) => void, erro: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (e: EntradaFs[]) => void, erro: (e: unknown) => void) => void };
};

/** Arrastar-e-soltar de pastas: percorre recursivamente (webkitGetAsEntry), preservando o caminho relativo. */
export async function arquivosDoDrop(items: DataTransferItemList): Promise<ArquivoLocal[]> {
  const raizes: EntradaFs[] = [];
  // webkitGetAsEntry precisa ser chamado de forma síncrona no evento (a lista esvazia depois)
  for (let i = 0; i < items.length; i++) {
    const e = (items[i] as DataTransferItem & { webkitGetAsEntry?: () => EntradaFs | null }).webkitGetAsEntry?.();
    if (e) raizes.push(e);
  }
  const out: ArquivoLocal[] = [];
  const visitar = async (e: EntradaFs): Promise<void> => {
    if (e.isFile && e.file) {
      const f = await new Promise<File>((ok, erro) => e.file!(ok, erro));
      out.push({ caminho: e.fullPath.replace(/^\/+/, ""), tamanho: f.size, file: f });
    } else if (e.isDirectory && e.createReader) {
      const leitor = e.createReader();
      for (;;) {
        // readEntries devolve em lotes (~100): repetir até vir vazio
        const lote = await new Promise<EntradaFs[]>((ok, erro) => leitor.readEntries(ok, erro));
        if (lote.length === 0) break;
        for (const filho of lote) await visitar(filho);
      }
    }
  };
  for (const r of raizes) await visitar(r);
  return out;
}

export type PlanoPasta = {
  /** Arquivos que serão enviados (PDF e ZIP aninhado), em ordem de caminho. */
  enviar: ArquivoLocal[];
  /** Arquivos que não serão enviados mas entram no relatório (formato, tamanho, ZIP duplicado…). */
  ignorados: { caminho: string; motivo: string }[];
  /** Lixo de sistema/ocultos (só contados). */
  ocultos: number;
  /** Nome da(s) pasta(s) de topo. */
  raizes: string[];
  resumo: {
    totalArquivos: number;
    totalBytes: number;
    pdfs: number;
    pdfsBytes: number;
    zipsAninhados: number;
    zipsDuplicados: number;
    grandesDemais: number;
    ignoradosPorTipo: Record<string, number>;
    pastas: number;
    bytesAEnviar: number;
  };
  /** Erros que impedem o envio (ex.: arquivos demais). */
  bloqueio: string | null;
};

const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * PURA. Aplica no navegador as mesmas regras do servidor para mostrar o resumo e evitar mandar o que seria descartado: lixo oculto,
 * só PDF/ZIP, 25 MB por arquivo, e a regra do ZIP duplicado (ZIP ao lado de uma pasta de mesmo nome = cópia dela → não é enviado,
 * economizando centenas de MB). O servidor refaz as verificações (nada aqui é confiável).
 */
export function montarPlanoPasta(arquivos: ArquivoLocal[], limites: LimitesZip = LIMITES_PADRAO): PlanoPasta {
  type C = { a: ArquivoLocal; caminho: string; segs: string[] };
  const cands: C[] = [];
  const ignorados: PlanoPasta["ignorados"] = [];
  let ocultos = 0;
  for (const a of arquivos) {
    const n = normalizarCaminho(a.caminho);
    if (!n.ok || n.segmentos.length === 0) {
      ignorados.push({ caminho: a.caminho.slice(0, 300), motivo: n.ok ? "Nome vazio." : n.erro });
      continue;
    }
    if (n.segmentos.some(segmentoIgnorado)) {
      ocultos++;
      continue;
    }
    cands.push({ a, caminho: n.segmentos.join("/"), segs: n.segmentos });
  }
  cands.sort((x, y) => comparar(x.caminho, y.caminho));
  const pastasPorDir = indicePastasPorDiretorio(cands.map((c) => c.segs));
  const porTipo: Record<string, number> = {};
  const enviar: ArquivoLocal[] = [];
  const pastas = new Set<string>();
  let totalBytes = 0;
  let pdfs = 0;
  let pdfsBytes = 0;
  let zips = 0;
  let zipsDup = 0;
  let grandes = 0;
  let bytesAEnviar = 0;
  for (const c of cands) {
    totalBytes += c.a.tamanho;
    for (let i = 1; i < c.segs.length; i++) pastas.add(chaveDiretorio(c.segs.slice(0, i)));
    const nome = c.segs[c.segs.length - 1];
    const ext = /\.([^./]+)$/.exec(nome)?.[1]?.toLowerCase() ?? "(sem extensão)";
    if (ehZip(nome)) {
      const dir = chaveDiretorio(c.segs.slice(0, -1));
      if (zipDuplicaPastaIrma(nome, pastasPorDir.get(dir) ?? new Set())) {
        zipsDup++;
        ignorados.push({ caminho: c.caminho, motivo: MOTIVO_ZIP_DUPLICADO });
      } else if (c.a.tamanho > limites.maxArquivoBytes) {
        grandes++;
        ignorados.push({ caminho: c.caminho, motivo: `ZIP aninhado acima de ${Math.round(limites.maxArquivoBytes / 1048576)} MB não é enviado pela pasta: use a aba "Enviar ZIP".` });
      } else {
        zips++;
        enviar.push({ ...c.a, caminho: c.caminho });
        bytesAEnviar += c.a.tamanho;
      }
    } else if (ehPdf(nome)) {
      if (c.a.tamanho > limites.maxArquivoBytes) {
        grandes++;
        ignorados.push({ caminho: c.caminho, motivo: `Arquivo excede o limite de ${Math.round(limites.maxArquivoBytes / 1048576)} MB.` });
      } else {
        pdfs++;
        pdfsBytes += c.a.tamanho;
        enviar.push({ ...c.a, caminho: c.caminho });
        bytesAEnviar += c.a.tamanho;
      }
    } else {
      porTipo[`.${ext}`] = (porTipo[`.${ext}`] ?? 0) + 1;
      ignorados.push({ caminho: c.caminho, motivo: `Extensão não permitida (.${ext}). Somente PDF.` });
    }
  }
  const raizes = [...new Set(cands.filter((c) => c.segs.length > 1).map((c) => c.segs[0]))];
  let bloqueio: string | null = null;
  if (enviar.length === 0) bloqueio = "Nenhum PDF para enviar nesta seleção (outros formatos e arquivos ocultos são ignorados).";
  else if (enviar.length > limites.maxArquivos) bloqueio = `São ${enviar.length} arquivos; o limite é ${limites.maxArquivos} por lote. Envie em lotes menores (por subpasta).`;
  else if (bytesAEnviar > limites.maxTotalDescompactado) bloqueio = `O total (${Math.round(bytesAEnviar / 1073741824)} GB) passa de ${Math.round(limites.maxTotalDescompactado / 1073741824)} GB por lote. Envie em lotes menores.`;
  else if (pastas.size > limites.maxPastas) bloqueio = `A seleção tem ${pastas.size} pastas; o limite é ${limites.maxPastas} por lote. Envie em lotes menores.`;
  return {
    enviar,
    ignorados,
    ocultos,
    raizes,
    resumo: { totalArquivos: cands.length, totalBytes, pdfs, pdfsBytes, zipsAninhados: zips, zipsDuplicados: zipsDup, grandesDemais: grandes, ignoradosPorTipo: porTipo, pastas: pastas.size, bytesAEnviar },
    bloqueio,
  };
}

export const formatarBytes = (b: number) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(2).replace(".", ",")} GB` : b >= 1048576 ? `${(b / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

// ───────────── Fila, retentativa, pausa ─────────────

export type Controle = { pausado: boolean; cancelado: boolean };
export const novoControle = (): Controle => ({ pausado: false, cancelado: false });

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Executa `fn` para cada item com no máximo `concorrencia` em paralelo; respeita pausa (não inicia novos) e cancelamento. */
export async function executarEmFila<T>(itens: T[], concorrencia: number, fn: (item: T, indice: number) => Promise<void>, controle: Controle = novoControle()): Promise<void> {
  let proximo = 0;
  const trabalhador = async () => {
    for (;;) {
      while (controle.pausado && !controle.cancelado) await dormir(150);
      if (controle.cancelado) return;
      const i = proximo++;
      if (i >= itens.length) return;
      await fn(itens[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concorrencia, itens.length || 1)) }, trabalhador));
}

/** Falha de envio; `retentavel` = vale tentar de novo (rede, 5xx, 408, 429, arquivo corrompido no caminho). */
export class ErroEnvio extends Error {
  constructor(
    message: string,
    public status: number,
    public retentavel: boolean,
    public codigo?: string,
  ) {
    super(message);
    this.name = "ErroEnvio";
  }
}

export async function comRetentativa<T>(fn: (tentativa: number) => Promise<T>, opc: { tentativas?: number; baseMs?: number; controle?: Controle; aoFalhar?: (e: ErroEnvio, tentativa: number) => void } = {}): Promise<T> {
  const max = opc.tentativas ?? 5;
  for (let t = 1; ; t++) {
    try {
      return await fn(t);
    } catch (e) {
      const erro = e instanceof ErroEnvio ? e : new ErroEnvio(e instanceof Error ? e.message : "Falha de rede.", 0, true);
      if (!erro.retentavel || t >= max || opc.controle?.cancelado) throw erro;
      opc.aoFalhar?.(erro, t);
      await dormir((opc.baseMs ?? 800) * 2 ** (t - 1) + Math.floor(Math.random() * 250));
    }
  }
}

// ───────────── HTTP (XHR: progresso de envio por requisição) ─────────────

export type RespostaHttp<T = unknown> = { status: number; corpo: T };

export function requisicao<T = unknown>(metodo: string, url: string, opc: { corpo?: Blob | ArrayBuffer | string; headers?: Record<string, string>; aoProgresso?: (enviado: number, total: number) => void; controle?: Controle } = {}): Promise<RespostaHttp<T>> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(metodo, url);
    for (const [k, v] of Object.entries(opc.headers ?? {})) xhr.setRequestHeader(k, v);
    if (opc.aoProgresso) xhr.upload.onprogress = (ev) => ev.lengthComputable && opc.aoProgresso!(ev.loaded, ev.total);
    xhr.onerror = () => reject(new ErroEnvio("Falha de rede.", 0, true));
    xhr.ontimeout = () => reject(new ErroEnvio("Tempo esgotado.", 0, true));
    xhr.onabort = () => reject(new ErroEnvio("Envio cancelado.", 0, false));
    xhr.onload = () => {
      let corpo: unknown = null;
      try {
        corpo = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        corpo = null;
      }
      resolve({ status: xhr.status, corpo: corpo as T });
    };
    if (opc.controle) {
      const vigia = setInterval(() => {
        if (opc.controle!.cancelado) xhr.abort();
      }, 200);
      xhr.addEventListener("loadend", () => clearInterval(vigia));
    }
    xhr.send(opc.corpo as XMLHttpRequestBodyInit | undefined);
  });
}

type CorpoErro = { code?: string; message?: string };

/** Converte uma resposta HTTP em sucesso ou ErroEnvio (retentável para 5xx/408/429 e arquivo corrompido). */
export function exigirOk<T>(r: RespostaHttp<T>): T {
  if (r.status >= 200 && r.status < 300) return r.corpo;
  const c = (r.corpo ?? {}) as CorpoErro;
  const retentavel = r.status >= 500 || r.status === 408 || r.status === 429 || c.code === "ARQUIVO_CORROMPIDO" || r.status === 0;
  throw new ErroEnvio(c.message ?? `Erro ${r.status} no servidor.`, r.status, retentavel, c.code);
}

export async function sha256Navegador(dados: ArrayBuffer): Promise<string | null> {
  try {
    const s = globalThis.crypto?.subtle;
    if (!s) return null;
    return [...new Uint8Array(await s.digest("SHA-256", dados))].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

// ───────────── Motores de envio ─────────────

export type Destino = { pasta_id?: string; tipo_id?: string; sensibilidade?: string; unir_pastas?: boolean };

export type ProgressoPasta = {
  fase: "preparando" | "conferindo" | "enviando" | "concluindo" | "pausado" | "pronto" | "cancelado" | "falhas";
  total: number;
  feitos: number;
  bytesTotal: number;
  bytesEnviados: number;
  jaNoServidor: number;
  emAndamento: { caminho: string; enviado: number; total: number }[];
  falhas: { caminho: string; erro: string }[];
  avisos: string[];
};

export type OpcoesEnvioPasta = {
  plano: PlanoPasta;
  destino: Destino;
  nome: string;
  loteId?: string;
  concorrencia?: number;
  controle: Controle;
  onProgresso: (p: ProgressoPasta) => void;
  onLote?: (id: string) => void;
  base?: string;
};

const chaveCaminho = (c: string) => {
  const n = normalizarCaminho(c);
  return n.ok ? n.segmentos.join("/") : c;
};

type ItemRecebido = { ordem: number; caminho: string; tamanho: number | null; sha256: string | null; status: string };

/** Envia a pasta arquivo a arquivo. Retomável: com `loteId` só envia o que o servidor ainda não tem (caminho + tamanho + sha256). */
export async function enviarPasta(o: OpcoesEnvioPasta): Promise<{ loteId: string; concluido: boolean; falhas: number }> {
  const base = o.base ?? "/api/v1/ged/importacoes";
  const json = { "Content-Type": "application/json" };
  const p: ProgressoPasta = { fase: "preparando", total: o.plano.enviar.length, feitos: 0, bytesTotal: o.plano.resumo.bytesAEnviar, bytesEnviados: 0, jaNoServidor: 0, emAndamento: [], falhas: [], avisos: [] };
  const emitir = () => o.onProgresso({ ...p, emAndamento: [...p.emAndamento], falhas: [...p.falhas], avisos: [...p.avisos] });
  emitir();

  let loteId = o.loteId;
  if (!loteId) {
    const r = exigirOk<{ id: string }>(await requisicao("POST", `${base}/pasta`, { headers: json, corpo: JSON.stringify({ nome: o.nome, total_esperado: o.plano.enviar.length, ...o.destino }) }));
    loteId = r.id;
  }
  o.onLote?.(loteId);

  // O que o servidor já tem (retomada)
  const recebidos = new Map<string, ItemRecebido>();
  for (let depois = -1; ; ) {
    const r = exigirOk<{ itens: ItemRecebido[]; proximo: number | null }>(await requisicao("GET", `${base}/${loteId}/recebidos?depois=${depois}`));
    for (const i of r.itens) recebidos.set(i.caminho, i);
    if (r.proximo === null) break;
    depois = r.proximo;
  }

  const pendentes: ArquivoLocal[] = [];
  if (recebidos.size > 0) {
    p.fase = "conferindo";
    emitir();
  }
  await executarEmFila(
    o.plano.enviar,
    4,
    async (a) => {
      const r = recebidos.get(chaveCaminho(a.caminho));
      let igual = !!r && r.tamanho === a.tamanho;
      if (igual && r!.sha256 && a.file) {
        const h = await sha256Navegador(await a.file.arrayBuffer());
        if (h && h !== r!.sha256) igual = false; // mesmo tamanho, conteúdo diferente: reenviar
      }
      if (igual) {
        p.jaNoServidor++;
        p.feitos++;
        p.bytesEnviados += a.tamanho;
      } else pendentes.push(a);
    },
    o.controle,
  );
  if (o.controle.cancelado) {
    p.fase = "cancelado";
    emitir();
    return { loteId, concluido: false, falhas: 0 };
  }

  p.fase = "enviando";
  emitir();
  await executarEmFila(
    pendentes,
    o.concorrencia ?? 4,
    async (a) => {
      if (!a.file) return;
      const andamento = { caminho: a.caminho, enviado: 0, total: a.tamanho };
      p.emAndamento.push(andamento);
      emitir();
      try {
        const dados = await a.file.arrayBuffer();
        const sha = await sha256Navegador(dados);
        let anterior = 0;
        await comRetentativa(
          async () => {
            anterior = 0;
            andamento.enviado = 0;
            const r = await requisicao("POST", `${base}/${loteId}/arquivos`, {
              corpo: dados,
              headers: { "Content-Type": "application/octet-stream", "X-Caminho": encodeURIComponent(a.caminho), ...(sha ? { "X-Sha256": sha } : {}) },
              controle: o.controle,
              aoProgresso: (env) => {
                p.bytesEnviados += env - anterior;
                anterior = env;
                andamento.enviado = env;
                emitir();
              },
            });
            exigirOk(r);
          },
          { controle: o.controle, aoFalhar: () => { p.bytesEnviados -= anterior; anterior = 0; } },
        );
        p.feitos++;
      } catch (e) {
        if (!o.controle.cancelado) p.falhas.push({ caminho: a.caminho, erro: e instanceof Error ? e.message : "Falha no envio." });
      } finally {
        p.emAndamento = p.emAndamento.filter((x) => x !== andamento);
        emitir();
      }
    },
    o.controle,
  );

  if (o.controle.cancelado) {
    p.fase = "cancelado";
    emitir();
    return { loteId, concluido: false, falhas: p.falhas.length };
  }
  if (p.falhas.length > 0) {
    p.fase = "falhas";
    emitir();
    return { loteId, concluido: false, falhas: p.falhas.length };
  }
  p.fase = "concluindo";
  emitir();
  await comRetentativa(async () => {
    exigirOk(await requisicao("POST", `${base}/${loteId}/concluir`, { headers: json, corpo: JSON.stringify({ ignorados: o.plano.ignorados.slice(0, 5000), ocultos: o.plano.ocultos }) }));
  });
  p.fase = "pronto";
  emitir();
  return { loteId, concluido: true, falhas: 0 };
}

export type ProgressoZip = {
  fase: "preparando" | "enviando" | "concluindo" | "pausado" | "pronto" | "cancelado" | "falhas";
  partesTotal: number;
  partesFeitas: number;
  bytesTotal: number;
  bytesEnviados: number;
  falhas: { parte: number; erro: string }[];
  emAndamento: number[];
};

/** Fatia um tamanho em partes {n, inicio, fim} (puro). */
export function fatiarEmPartes(tamanho: number, tamanhoParte = TAMANHO_PARTE_ZIP): { n: number; inicio: number; fim: number }[] {
  const partes: { n: number; inicio: number; fim: number }[] = [];
  for (let i = 0, n = 1; i < tamanho; i += tamanhoParte, n++) partes.push({ n, inicio: i, fim: Math.min(i + tamanhoParte, tamanho) });
  return partes;
}

export type OpcoesEnvioZip = { arquivo: File; destino: Destino; loteId?: string; concorrencia?: number; controle: Controle; onProgresso: (p: ProgressoZip) => void; onLote?: (id: string) => void; base?: string };

/** Envia um ZIP grande em partes de ~8 MB (retentativa por parte; retomável com `loteId`; só manda as partes que faltam). */
export async function enviarZipEmPartes(o: OpcoesEnvioZip): Promise<{ loteId: string; concluido: boolean; falhas: number }> {
  const base = o.base ?? "/api/v1/ged/importacoes";
  const json = { "Content-Type": "application/json" };
  const p: ProgressoZip = { fase: "preparando", partesTotal: 0, partesFeitas: 0, bytesTotal: o.arquivo.size, bytesEnviados: 0, falhas: [], emAndamento: [] };
  const emitir = () => o.onProgresso({ ...p, falhas: [...p.falhas], emAndamento: [...p.emAndamento] });
  emitir();

  let loteId = o.loteId;
  let tamanhoParte = TAMANHO_PARTE_ZIP;
  if (!loteId) {
    const r = exigirOk<{ id: string; partes_total: number; tamanho_parte: number }>(await requisicao("POST", `${base}/zip-partes`, { headers: json, corpo: JSON.stringify({ nome_arquivo: o.arquivo.name, tamanho: o.arquivo.size, ...o.destino }) }));
    loteId = r.id;
    tamanhoParte = r.tamanho_parte;
  }
  o.onLote?.(loteId);
  const estado = exigirOk<{ partes: number[]; partes_total: number; tamanho_parte: number }>(await requisicao("GET", `${base}/${loteId}/recebidos`));
  tamanhoParte = estado.tamanho_parte;
  const todas = fatiarEmPartes(o.arquivo.size, tamanhoParte);
  if (todas.length !== estado.partes_total) throw new ErroEnvio("Este arquivo não é o mesmo ZIP do lote que está sendo retomado (tamanho diferente).", 409, false);
  p.partesTotal = todas.length;
  const jaTem = new Set(estado.partes);
  const pendentes = todas.filter((x) => !jaTem.has(x.n));
  for (const x of todas) if (jaTem.has(x.n)) {
    p.partesFeitas++;
    p.bytesEnviados += x.fim - x.inicio;
  }
  p.fase = "enviando";
  emitir();
  await executarEmFila(
    pendentes,
    o.concorrencia ?? 2,
    async (parte) => {
      p.emAndamento.push(parte.n);
      emitir();
      try {
        const blob = o.arquivo.slice(parte.inicio, parte.fim);
        let anterior = 0;
        await comRetentativa(
          async () => {
            anterior = 0;
            exigirOk(
              await requisicao("PUT", `${base}/${loteId}/partes/${parte.n}`, {
                corpo: blob,
                headers: { "Content-Type": "application/octet-stream" },
                controle: o.controle,
                aoProgresso: (env) => {
                  p.bytesEnviados += env - anterior;
                  anterior = env;
                  emitir();
                },
              }),
            );
          },
          { tentativas: 6, controle: o.controle, aoFalhar: () => { p.bytesEnviados -= anterior; anterior = 0; } },
        );
        p.partesFeitas++;
      } catch (e) {
        if (!o.controle.cancelado) p.falhas.push({ parte: parte.n, erro: e instanceof Error ? e.message : "Falha no envio." });
      } finally {
        p.emAndamento = p.emAndamento.filter((x) => x !== parte.n);
        emitir();
      }
    },
    o.controle,
  );
  if (o.controle.cancelado) {
    p.fase = "cancelado";
    emitir();
    return { loteId, concluido: false, falhas: 0 };
  }
  if (p.falhas.length > 0) {
    p.fase = "falhas";
    emitir();
    return { loteId, concluido: false, falhas: p.falhas.length };
  }
  p.fase = "concluindo";
  emitir();
  exigirOk(await requisicao("POST", `${base}/${loteId}/concluir`, { headers: json, corpo: "{}" }));
  p.fase = "pronto";
  emitir();
  return { loteId, concluido: true, falhas: 0 };
}
