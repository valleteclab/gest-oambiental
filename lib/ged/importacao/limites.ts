// Limites da importação em lote (proteção contra zip-bomb e abuso). Valores-padrão; os testes passam limites menores.
// Importável também pelo navegador (só constantes/tipos): a tela usa os mesmos números para avisar antes de enviar.
export type LimitesZip = {
  /** Tamanho máximo do ZIP enviado (lido do disco, nunca inteiro em memória). Cabe em INTEGER do banco (2^31-1). */
  maxZipBytes: number;
  /** Entradas no diretório central (arquivos + pastas + lixo). */
  maxEntradas: number;
  /** Arquivos de conteúdo (exclui pastas e lixo do sistema). Vale para o lote inteiro (inclui ZIPs aninhados). */
  maxArquivos: number;
  /** Pastas distintas que o ZIP faria criar. */
  maxPastas: number;
  /** Níveis de pasta (sem contar o arquivo). */
  maxProfundidade: number;
  /** Soma dos tamanhos descompactados DECLARADOS dos arquivos de conteúdo (por ZIP, inclusive os aninhados). */
  maxTotalDescompactado: number;
  /** Tamanho descompactado máximo de um arquivo (o mesmo limite de upload do GED, 25 MB). */
  maxArquivoBytes: number;
  /** Razão máxima descompactado/comprimido (só vale para arquivos acima de 1 MiB). */
  maxRazaoCompressao: number;
  /** Tamanho máximo de um ZIP aninhado (extraído para disco temporário). */
  maxZipAninhadoBytes: number;
  /** Quantos ZIPs podem estar um dentro do outro (ZIP > ZIP > ZIP = 2). */
  maxAninhamento: number;
};

export const LIMITES_PADRAO: LimitesZip = {
  maxZipBytes: 2_000_000_000,
  maxEntradas: 40_000,
  maxArquivos: 20_000,
  maxPastas: 5_000,
  maxProfundidade: 12,
  maxTotalDescompactado: 6 * 1024 * 1024 * 1024,
  maxArquivoBytes: 25 * 1024 * 1024,
  maxRazaoCompressao: 250,
  maxZipAninhadoBytes: 512 * 1024 * 1024,
  maxAninhamento: 2,
};

/** Tamanho de cada parte do envio de ZIP grande (cabe com folga no limite de corpo dos proxies). */
export const TAMANHO_PARTE_ZIP = 8 * 1024 * 1024;
/** Maior corpo aceito numa única parte. */
export const MAX_PARTE_ZIP = 16 * 1024 * 1024;
/** Maior ZIP aceito pelo envio simples (multipart, em memória); acima disso, só em partes. */
export const MAX_ZIP_SIMPLES = 64 * 1024 * 1024;
/** Lote criado e nunca finalizado é descartado depois deste prazo. */
export const PRAZO_LOTE_ABANDONADO_MS = 3 * 24 * 3600 * 1000;

/** Tamanho máximo de um segmento de nome de pasta (igual a zNomePasta). */
export const MAX_NOME_PASTA = 120;
