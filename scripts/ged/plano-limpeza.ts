// Plano PURO (sem banco/storage) da limpeza do conteúdo do GED de UM cliente – ver scripts/ged/limpar-organizacao.ts e
// docs/ged.md §15. Tudo que decide "o que apagar, em que ordem e com que filtro" fica aqui para ser testado sem banco.
//
// Regras de segurança (guardadas por tests/unit/ged-limpeza.test.ts):
//   - TODA instrução SQL gerada filtra por "organizacao_id" = $1 (validarSqlLimpeza recusa qualquer outra forma);
//   - só tabelas das listas abaixo são tocadas; tabela Ged* nova sem entrada em UMA das listas faz o teste falhar;
//   - a ordem apaga filhos antes dos pais (o teste confere contra as FKs do schema.prisma);
//   - tabelas preservadas não podem ter FK para tabela apagada (senão ficariam órfãs: em replica as FKs não são checadas).

export type TabelaGed = { modelo: string; tabela: string };

/** Conteúdo do cliente: apagado em ESTA ordem (filhos antes dos pais). */
export const TABELAS_APAGADAS: readonly TabelaGed[] = [
  { modelo: "GedExclusao", tabela: "ged_exclusao" },
  { modelo: "GedImportacaoItem", tabela: "ged_importacao_item" },
  { modelo: "GedImportacao", tabela: "ged_importacao" },
  { modelo: "GedProtocoloDocumento", tabela: "ged_protocolo_documento" },
  { modelo: "GedProtocoloEvento", tabela: "ged_protocolo_evento" },
  { modelo: "GedComunicacao", tabela: "ged_comunicacao" },
  { modelo: "GedProtocolo", tabela: "ged_protocolo" },
  { modelo: "GedAssinante", tabela: "ged_assinante" },
  { modelo: "GedSolicitacaoAssinatura", tabela: "ged_solicitacao_assinatura" },
  { modelo: "GedDeteccaoDadoPessoal", tabela: "ged_deteccao_dado_pessoal" },
  { modelo: "GedConteudoTexto", tabela: "ged_conteudo_texto" },
  { modelo: "GedDocumentoMarcador", tabela: "ged_documento_marcador" },
  { modelo: "GedAcl", tabela: "ged_acl" },
  { modelo: "GedTramite", tabela: "ged_tramite" },
  { modelo: "GedComentario", tabela: "ged_comentario" },
  { modelo: "GedAcessoLog", tabela: "ged_acesso_log" },
  { modelo: "GedVersaoDocumento", tabela: "ged_versao_documento" },
  { modelo: "GedDocumento", tabela: "ged_documento" },
  { modelo: "GedMarcador", tabela: "ged_marcador" },
  { modelo: "GedPasta", tabela: "ged_pasta" },
  { modelo: "GedSequencia", tabela: "ged_sequencia" }, // contadores de numeração: o próximo documento volta a ser 000001
];

/** Configuração/cadastro do cliente: NUNCA tocada (o cliente continua utilizável). */
export const TABELAS_PRESERVADAS: readonly TabelaGed[] = [
  { modelo: "GedConfig", tabela: "ged_config" },
  { modelo: "GedMembro", tabela: "ged_membro" },
  { modelo: "GedSetor", tabela: "ged_setor" },
  { modelo: "GedSetorMembro", tabela: "ged_setor_membro" },
  { modelo: "GedTipoDocumento", tabela: "ged_tipo_documento" },
  { modelo: "GedPreferenciaNotificacao", tabela: "ged_preferencia_notificacao" },
  { modelo: "GedProtocoloAssunto", tabela: "ged_protocolo_assunto" },
];

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ehUuid = (v: string) => RE_UUID.test(v);

const TODAS = new Set([...TABELAS_APAGADAS, ...TABELAS_PRESERVADAS].map((t) => t.tabela));

function exigirTabela(tabela: string) {
  if (!TODAS.has(tabela)) throw new Error(`Tabela fora do plano de limpeza: ${tabela}`);
}

/** SELECT de contagem, sempre restrito à organização ($1). */
export function sqlContar(tabela: string): string {
  exigirTabela(tabela);
  return `SELECT count(*)::int AS n FROM "${tabela}" WHERE "organizacao_id" = $1::uuid`;
}

/** DELETE, sempre restrito à organização ($1). Só aceita tabelas de TABELAS_APAGADAS. */
export function sqlApagar(tabela: string): string {
  if (!TABELAS_APAGADAS.some((t) => t.tabela === tabela)) throw new Error(`Tabela não apagável pela limpeza: ${tabela}`);
  return `DELETE FROM "${tabela}" WHERE "organizacao_id" = $1::uuid`;
}

const RE_SQL_OK = /^(?:DELETE FROM|SELECT count\(\*\)::int AS n FROM) "(ged_[a-z_]+)" WHERE "organizacao_id" = \$1::uuid$/;

/** Última barreira antes de executar: recusa SQL que não tenha exatamente o formato filtrado por organização. */
export function validarSqlLimpeza(sql: string): string {
  const m = RE_SQL_OK.exec(sql);
  if (!m || !TODAS.has(m[1])) throw new Error(`SQL de limpeza recusado (sem filtro por organização ou fora do plano): ${sql}`);
  return sql;
}

/** Prefixo de storage do cliente, com barra final (evita casar outro cliente por prefixo parcial). */
export function prefixoStorageOrg(organizacaoId: string): string {
  if (!ehUuid(organizacaoId)) throw new Error("organizacaoId inválido.");
  return `ged/${organizacaoId.toLowerCase()}/`;
}

/** A chave pertence ao prefixo do cliente (sem `..`, `\`, `//` nem caracteres de controle)? */
export function chaveDaOrg(organizacaoId: string, key: string): boolean {
  const p = prefixoStorageOrg(organizacaoId);
  return key.startsWith(p) && key.length > p.length && !key.includes("..") && !key.includes("\\") && !key.slice(p.length).includes("//") && !/[\u0000-\u001f]/.test(key);
}

// ───────────── Linha de comando ─────────────

export type ArgsLimpeza = { alvo: string; executar: boolean; confirmar: string | null; manterDemo: boolean };

export function interpretarArgs(argv: string[]): ArgsLimpeza {
  let alvo: string | null = null;
  let executar = false;
  let confirmar: string | null = null;
  let manterDemo = false;
  for (const a of argv) {
    if (a === "--executar") executar = true;
    else if (a === "--manter-demo") manterDemo = true;
    else if (a.startsWith("--confirmar=")) confirmar = a.slice("--confirmar=".length);
    else if (a.startsWith("--")) throw new Error(`Opção desconhecida: ${a}`);
    else if (alvo === null) alvo = a.trim();
    else throw new Error(`Informe uma única organização (recebido também: ${a}).`);
  }
  if (!alvo) throw new Error("Informe a sigla ou o id da organização: npm run ged:limpar -- <sigla|id> [--executar --confirmar=SIGLA]");
  if (alvo.includes(",")) throw new Error("Informe UMA organização por execução (sem vírgulas).");
  return { alvo, executar, confirmar, manterDemo };
}

/** `--manter-demo` não é suportado: os dados do seed não têm marca confiável (ver docs/ged.md §15). */
export const MSG_MANTER_DEMO =
  "--manter-demo não é suportado: os documentos do seed ged-demo não carregam marca confiável (mesma numeração {SIGLA}-DOC-… e mesmos criadores " +
  "de documentos reais; o seed os reconhece só pelo título). Para voltar à massa de demonstração, limpe tudo e rode `npm run seed:ged-demo` (idempotente).";

/** Confirmação obrigatória para executar: `--confirmar` precisa ser exatamente a sigla da organização. */
export function confirmacaoValida(sigla: string, confirmar: string | null): boolean {
  return confirmar !== null && confirmar === sigla;
}

export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
