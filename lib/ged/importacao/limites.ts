// Limites da importação em lote (proteção contra zip-bomb e abuso). Valores-padrão; os testes passam limites menores.
export type LimitesZip = {
  /** Tamanho máximo do ZIP enviado. */
  maxZipBytes: number;
  /** Entradas no diretório central (arquivos + pastas + lixo). */
  maxEntradas: number;
  /** Arquivos de conteúdo (exclui pastas e lixo do sistema). */
  maxArquivos: number;
  /** Pastas distintas que o ZIP faria criar. */
  maxPastas: number;
  /** Níveis de pasta (sem contar o arquivo). */
  maxProfundidade: number;
  /** Soma dos tamanhos descompactados DECLARADOS dos arquivos de conteúdo. */
  maxTotalDescompactado: number;
  /** Tamanho descompactado máximo de um arquivo (o mesmo limite de upload do GED, 25 MB). */
  maxArquivoBytes: number;
  /** Razão máxima descompactado/comprimido (só vale para arquivos acima de 1 MiB). */
  maxRazaoCompressao: number;
};

export const LIMITES_PADRAO: LimitesZip = {
  maxZipBytes: 300 * 1024 * 1024,
  maxEntradas: 10_000,
  maxArquivos: 3_000,
  maxPastas: 1_000,
  maxProfundidade: 10,
  maxTotalDescompactado: 2 * 1024 * 1024 * 1024,
  maxArquivoBytes: 25 * 1024 * 1024,
  maxRazaoCompressao: 250,
};

/** Tamanho máximo de um segmento de nome de pasta (igual a zNomePasta). */
export const MAX_NOME_PASTA = 120;
