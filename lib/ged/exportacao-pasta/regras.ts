// Regras PURAS da exportação de pasta em ZIP (sem banco/IO; testadas em tests/unit/ged-exportacao-pasta.test.ts):
// nomes compatíveis com Windows, desambiguação, limites, manifesto CSV e LEIAME.
import { linhaCsv, BOM_UTF8 } from "../logs/csv";

/** Teto de arquivos por exportação (acima disso o usuário divide por subpasta). */
export const LIMITE_ARQUIVOS_ZIP = 20_000;
/** Tamanho máximo de cada segmento do caminho (pasta ou arquivo), em caracteres. */
export const MAX_SEGMENTO = 120;
/** Caminho completo dentro do ZIP: o Windows (sem prefixo longo) rejeita ~260 contando a pasta de destino; deixamos folga. */
export const MAX_CAMINHO = 200;
/** A partir de ~3,5 GB (ou de 60.000 entradas) o ZIP é gravado em ZIP64 desde o início. */
export const LIMIAR_ZIP64_BYTES = 3.5 * 1024 ** 3;

const RESERVADOS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Sanitiza UM segmento para Windows/macOS/Linux: remove `<>:"/\|?*` e controles, tira pontos/espaços finais, evita nomes
 * reservados (CON, NUL, COM1…), normaliza em NFC e limita a `max` caracteres preservando a extensão (para arquivos).
 */
export function sanitizarSegmento(nome: string, opc: { max?: number; arquivo?: boolean } = {}): string {
  const max = opc.max ?? MAX_SEGMENTO;
  let s = (nome ?? "").normalize("NFC").replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_").replace(/\s+/g, " ").trim();
  s = s.replace(/[. ]+$/, "").replace(/^\s+/, "");
  if (!s || /^\.+$/.test(s)) s = "_";
  let ext = "";
  if (opc.arquivo) {
    const m = /\.[A-Za-z0-9]{1,8}$/.exec(s);
    if (m && m.index > 0) ext = m[0];
  }
  let base = ext ? s.slice(0, s.length - ext.length) : s;
  if (RESERVADOS.test(base)) base = `_${base}`;
  const sobra = Math.max(1, max - ext.length);
  if (base.length > sobra) base = base.slice(0, sobra);
  base = base.replace(/[. ]+$/, "") || "_";
  return `${base}${ext}`;
}

/** Acrescenta " (n)" antes da extensão respeitando o máximo do segmento. */
function comSufixo(nome: string, n: number, max: number, arquivo: boolean): string {
  const m = arquivo ? /\.[A-Za-z0-9]{1,8}$/.exec(nome) : null;
  const ext = m && m.index > 0 ? m[0] : "";
  const base = ext ? nome.slice(0, nome.length - ext.length) : nome;
  const suf = ` (${n})`;
  return `${base.slice(0, Math.max(1, max - ext.length - suf.length)).replace(/[. ]+$/, "")}${suf}${ext}`;
}

/**
 * Garante nomes únicos dentro de cada diretório, ignorando maiúsculas/minúsculas (Windows/macOS). Pastas e arquivos
 * dividem o mesmo espaço de nomes. O primeiro mantém o nome; os seguintes ganham " (2)", " (3)"…
 */
export class Desambiguador {
  private usados = new Set<string>();
  constructor(private readonly max = MAX_SEGMENTO) {}

  /** Reserva `nome` em `dir` ("" = raiz do ZIP) e devolve o nome final. */
  reservar(dir: string, nome: string, arquivo = false): string {
    let final = nome;
    for (let n = 2; this.usados.has(this.chave(dir, final)); n++) final = comSufixo(nome, n, this.max, arquivo);
    this.usados.add(this.chave(dir, final));
    return final;
  }
  private chave(dir: string, nome: string) {
    return `${dir}\u0000${nome}`.toLowerCase();
  }
}

/** Reduz o nome do ARQUIVO (mantendo a extensão) para o caminho completo caber em `MAX_CAMINHO`; mínimo de 24 caracteres. */
export function ajustarAoCaminhoMaximo(dir: string, arquivo: string, maxCaminho = MAX_CAMINHO): string {
  const disponivel = maxCaminho - (dir ? dir.length + 1 : 0);
  if (arquivo.length <= disponivel) return arquivo;
  return sanitizarSegmento(arquivo, { arquivo: true, max: Math.max(24, disponivel) });
}

export type ResultadoLimite = { ok: true } | { ok: false; mensagem: string };

/** Mais de `limite` arquivos → orienta a dividir por subpasta. */
export function verificarLimiteArquivos(total: number, limite = LIMITE_ARQUIVOS_ZIP): ResultadoLimite {
  if (total <= limite) return { ok: true };
  const f = (n: number) => n.toLocaleString("pt-BR");
  return { ok: false, mensagem: `A pasta tem ${f(total)} documentos, acima do limite de ${f(limite)} por download. Baixe por subpasta (cada subpasta separadamente) para dividir a exportação.` };
}

/** ZIP64 desde o início quando o total estimado (ou o nº de entradas) pode ultrapassar os limites do ZIP clássico. */
export const precisaZip64 = (totalBytes: number, entradas: number) => totalBytes >= LIMIAR_ZIP64_BYTES || entradas >= 60_000;

/** `PASTA-AAAA-MM-DD.zip` (data de Brasília) – usa o nome da pasta sanitizado e curto. */
export function nomeArquivoZip(nomePasta: string, agora: Date = new Date()): string {
  const data = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
  const base = sanitizarSegmento(nomePasta, { max: 60 }).replace(/\s+/g, "-") || "PASTA";
  return `${base}-${data}.zip`;
}

export const dataHoraBrasilia = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "medium" }).format(d).replace(",", "");

// ───────────── Manifesto ─────────────

export const CABECALHO_MANIFESTO = [
  "caminho", "numero_documento", "titulo", "tipo", "data_documento", "situacao_documento", "situacao_assinatura",
  "versao_exportada", "sha256", "tamanho_bytes", "paginas", "dpi_ok", "situacao_exportacao",
];
export const DPI_NAO_VERIFICADO = "nao verificado";

export type LinhaManifesto = {
  caminho: string;
  numero: string;
  titulo: string;
  tipo: string;
  data_documento: string;
  situacao_documento: string;
  assinatura: string;
  versao: string;
  sha256: string;
  tamanho: number | null;
  paginas: number | null;
  /** "incluido" | "omitido: sem permissao" | "omitido: sem arquivo" | "erro: …" */
  situacao: string;
};

/** Linha de documento omitido: NUNCA leva título/número (não revela o que o usuário não pode ver); só a pasta. */
export const linhaOmitida = (pasta: string, motivo = "omitido: sem permissao"): LinhaManifesto => ({
  caminho: pasta, numero: "", titulo: "", tipo: "", data_documento: "", situacao_documento: "", assinatura: "", versao: "", sha256: "", tamanho: null, paginas: null, situacao: motivo,
});

export function montarManifesto(linhas: LinhaManifesto[]): string {
  return (
    BOM_UTF8 +
    linhaCsv(CABECALHO_MANIFESTO) +
    linhas
      .map((l) => linhaCsv([l.caminho, l.numero, l.titulo, l.tipo, l.data_documento, l.situacao_documento, l.assinatura, l.versao, l.sha256, l.tamanho, l.paginas, l.situacao === "incluido" ? DPI_NAO_VERIFICADO : "", l.situacao]))
      .join("")
  );
}

export type DadosLeiame = {
  pasta: string;
  organizacao: string;
  exportadoPor: string;
  geradoEm: Date;
  incluidos: number;
  omitidos: number;
  erros: number;
  bytes: number;
  modoVersao: "atual" | "original";
};

export function montarLeiame(d: DadosLeiame): string {
  const L = [
    "EXPORTAÇÃO DE PASTA – GESTÃO DE DOCUMENTOS",
    "",
    `Cliente: ${d.organizacao}`,
    `Pasta exportada: ${d.pasta}`,
    `Gerado em (horário de Brasília): ${dataHoraBrasilia(d.geradoEm)}`,
    `Exportado por: ${d.exportadoPor}`,
    "",
    `Documentos incluídos: ${d.incluidos}`,
    `Documentos omitidos (sem permissão, sem arquivo, pasta sem acesso ou erro de leitura): ${d.omitidos + d.erros}`,
    `Tamanho total dos arquivos: ${(d.bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`,
    "",
    "COMO LER ESTE PACOTE",
    "- A estrutura de pastas é a mesma do sistema. Nomes de arquivos são os do envio original; sem nome original, vale o número do documento.",
    "- Nomes foram adaptados ao Windows (caracteres inválidos viram \"_\", máximo de 120 caracteres por nome); nomes repetidos ganham \" (2)\", \" (3)\"…",
    "- Cada documento sai na versão " + (d.modoVersao === "original" ? "ORIGINAL (antes do OCR), exceto documentos assinados/selados, que saem sempre com o PDF selado." : "ATUAL (a vigente no sistema; se houve OCR, é a versão com texto pesquisável). Documentos assinados/selados saem com o PDF selado."),
    "- MANIFESTO.csv lista cada documento (caminho, número, título, tipo, data, sha256, tamanho, páginas, situação da assinatura) e o que foi omitido. Abra no Excel (separador ponto e vírgula).",
    "- Documentos sem permissão para o usuário que exportou aparecem no manifesto como \"omitido: sem permissao\", sem título.",
    "- Caminhos muito longos podem falhar ao extrair no Windows; extraia perto da raiz do disco (ex.: C:\\TCM).",
    "",
    "ATENÇÃO – PRESTAÇÃO DE CONTAS NO TCM-BA (SIGA / e-TCM)",
    "- O TCM-BA exige documentos em PDF digitalizado com resolução ABAIXO de 250 DPI e pastas organizadas por tipo de documento.",
    "- O sistema NÃO verifica a resolução dos arquivos: a coluna dpi_ok do manifesto traz \"nao verificado\". Confira antes de enviar e reduza a resolução dos que estiverem acima do limite.",
    "- Confira também as exigências vigentes do TCM-BA para o mês da prestação de contas.",
    "",
    "Esta exportação foi registrada na auditoria do sistema.",
    "",
  ];
  return L.join("\r\n");
}
