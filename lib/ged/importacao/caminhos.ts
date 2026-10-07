// Funções PURAS de caminhos da importação (servidor E navegador): normalização anti zip-slip, lixo do sistema, união de pastas
// repetidas e a regra do ZIP duplicado. Sem node:*, sem banco – a tela de envio de pasta usa o mesmo código que o servidor.
import { MAX_NOME_PASTA } from "./limites";

export type CaminhoNormalizado = { ok: true; segmentos: string[] } | { ok: false; erro: string };

const SEGMENTO_LIXO = /^(__macosx|thumbs\.db|ehthumbs\.db|desktop\.ini|\.ds_store)$/i;

/** Segmento que faz o item inteiro ser ignorado em silêncio (lixo de sistema, oculto, temporário do Office). */
export const segmentoIgnorado = (seg: string) => seg.startsWith(".") || seg.startsWith("~$") || SEGMENTO_LIXO.test(seg);

/**
 * Normaliza o nome de uma entrada: separador `/`, sem `.`/vazios, recusa `..`, caminho absoluto, unidade (C:) e controles.
 * Cada segmento é aparado, sem pontos/espaços finais, até 120 caracteres. Resultado em NFC.
 */
export function normalizarCaminho(bruto: string): CaminhoNormalizado {
  if (/[\u0000-\u001f\u007f]/.test(bruto)) return { ok: false, erro: "Nome com caracteres de controle." };
  const n = bruto.replace(/\\/g, "/");
  if (n.startsWith("/") || /^[A-Za-z]:/.test(n)) return { ok: false, erro: "Caminho absoluto não é permitido." };
  const segs: string[] = [];
  for (const crua of n.split("/")) {
    if (crua === "" || crua === ".") continue;
    if (crua.trim() === "..") return { ok: false, erro: 'Caminho com ".." (tentativa de sair da pasta) não é permitido.' };
    const s = crua.normalize("NFC").replace(/[​-‏‪-‮⁦-⁩﻿]/g, "").trim().replace(/[. ]+$/, "").slice(0, MAX_NOME_PASTA).trim();
    if (!s) return { ok: false, erro: "Nome vazio." };
    segs.push(s);
  }
  return { ok: true, segmentos: segs };
}

/**
 * "Unir pastas repetidas": colapsa pastas consecutivas de mesmo nome (sem diferenciar maiúsculas): A/A → A, A/A/A → A.
 * Só as PASTAS entram (nunca o nome do arquivo). Desligado por padrão: a estrutura é preservada como veio.
 */
export function unirPastasRepetidas(pasta: string[]): string[] {
  const out: string[] = [];
  for (const s of pasta) {
    if (out.length > 0 && out[out.length - 1].toLowerCase() === s.toLowerCase()) continue;
    out.push(s);
  }
  return out;
}

export const ehPdf = (nome: string) => /\.pdf$/i.test(nome);
export const ehZip = (nome: string) => /\.zip$/i.test(nome);

/** Nome do ZIP sem a extensão (vira o nome da pasta quando o ZIP aninhado é expandido). */
export const nomeBaseZip = (nome: string) => nome.replace(/\.zip$/i, "").trim() || "ZIP";

/**
 * Regra do ZIP duplicado: um `.zip` é cópia da pasta irmã quando existe, no MESMO diretório, uma pasta com o nome-base do ZIP
 * (caso real: "Processos de pagamento.zip" ao lado da pasta "Processos de pagamento"). `pastasDoDiretorio` = nomes (em minúsculas)
 * das pastas que existem no diretório do ZIP.
 */
export const zipDuplicaPastaIrma = (nomeZip: string, pastasDoDiretorio: ReadonlySet<string>) => pastasDoDiretorio.has(nomeBaseZip(nomeZip).toLowerCase());

export const MOTIVO_ZIP_DUPLICADO = "ZIP duplicado da pasta irmã (o conteúdo já vem na pasta).";

/** Chave (minúscula) de um diretório para indexar "pastas por diretório". */
export const chaveDiretorio = (segs: string[]) => segs.join("/").toLowerCase();

/** Índice diretório → nomes (minúsculos) das subpastas diretas, a partir dos caminhos (arquivos) conhecidos. */
export function indicePastasPorDiretorio(caminhos: Iterable<string[]>): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const segs of caminhos) {
    for (let i = 0; i < segs.length - 1; i++) {
      const dir = chaveDiretorio(segs.slice(0, i));
      let s = m.get(dir);
      if (!s) m.set(dir, (s = new Set()));
      s.add(segs[i].toLowerCase());
    }
  }
  return m;
}
