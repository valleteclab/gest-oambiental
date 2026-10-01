import type { PotencialPoluidor } from "@prisma/client";
import { textoParaFaixas, type FaixaPorte } from "@/lib/cadastros/porte";

// Importação de tipologias por CSV (separador ";"):
// codigo;divisao;descricao;unidade_porte;potencial_poluidor;faixas
// A1.1;Agropecuária;Avicultura;nº de cabeças;MEDIO;MICRO:50000|PEQUENO:200000|MEDIO:500000|GRANDE:1000000|EXCEPCIONAL

export type LinhaTipologia = { codigo: string; divisao: string; descricao: string; unidade_porte: string; potencial_poluidor: PotencialPoluidor; faixas_porte: FaixaPorte[] };
export type ResultadoCsv = { linhas: LinhaTipologia[]; erros: { linha: number; mensagem: string }[] };

const PP: Record<string, PotencialPoluidor> = { BAIXO: "BAIXO", MEDIO: "MEDIO", "MÉDIO": "MEDIO", ALTO: "ALTO" };

/** Divide uma linha CSV com ";" respeitando aspas duplas. */
function dividir(linha: string): string[] {
  const out: string[] = [];
  let cur = "";
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const ch = linha[i];
    if (ch === '"') {
      if (aspas && linha[i + 1] === '"') {
        cur += '"';
        i++;
      } else aspas = !aspas;
    } else if (ch === ";" && !aspas) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseTipologiasCsv(texto: string): ResultadoCsv {
  const linhas: LinhaTipologia[] = [];
  const erros: ResultadoCsv["erros"] = [];
  const brutas = texto.replace(/^﻿/, "").split(/\r?\n/);
  const vistos = new Set<string>();
  brutas.forEach((bruta, i) => {
    const n = i + 1;
    if (!bruta.trim()) return;
    const c = dividir(bruta);
    if (n === 1 && c[0]?.toLowerCase() === "codigo") return; // cabeçalho
    if (c.length < 6) {
      erros.push({ linha: n, mensagem: `Esperadas 6 colunas separadas por ";", encontradas ${c.length}.` });
      return;
    }
    const [codigo, divisao, descricao, unidade_porte, pp, faixas] = c;
    if (!codigo || !divisao || !descricao || !unidade_porte) {
      erros.push({ linha: n, mensagem: "Código, divisão, descrição e unidade de porte são obrigatórios." });
      return;
    }
    const potencial = PP[pp.toUpperCase()];
    if (!potencial) {
      erros.push({ linha: n, mensagem: `Potencial poluidor inválido: "${pp}" (use BAIXO, MEDIO ou ALTO).` });
      return;
    }
    if (vistos.has(codigo)) {
      erros.push({ linha: n, mensagem: `Código repetido no arquivo: ${codigo}.` });
      return;
    }
    try {
      linhas.push({ codigo, divisao, descricao, unidade_porte, potencial_poluidor: potencial, faixas_porte: textoParaFaixas(faixas) });
      vistos.add(codigo);
    } catch (e) {
      erros.push({ linha: n, mensagem: (e as Error).message });
    }
  });
  return { linhas, erros };
}
