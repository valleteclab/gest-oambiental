// Ponto único de acesso ao banco para o módulo GED (docs/ged-design.md §1 – "choke point").
//
// Somente este arquivo (e lib/ged/busca.ts, para SQL cru) pode importar "@/lib/db" dentro de lib/ged/**,
// app/(ged)/**, app/api/v1/ged/**, components/ged/** e jobs/ged* (garantido por tests/unit/ged-fontes.test.ts).
//
// `gedDb(organizacaoId)` devolve o Prisma Client estendido: em TODO modelo `Ged*`, injeta `organizacao_id`
//   - em leituras/updateMany/deleteMany/count/aggregate/groupBy (AND no where);
//   - no where único de findUnique/update/delete/upsert (registro de outro cliente => "não encontrado");
//   - no `data` de create/createMany/createManyAndReturn (valor divergente => erro).
// Modelos que não são `Ged*` (Usuario, Organizacao, LogAuditoria…) passam sem alteração.
//
// Convenções para quem usa:
//   - escrita em `Ged*` usa o formato "unchecked" (ids escalares: `documento_id`, `pasta_id`…), nunca
//     `organizacao: { connect }` (o escopo injeta `organizacao_id` escalar; misturar os dois formatos o Prisma recusa);
//   - relações aninhadas (`include`/`select` de relação, create aninhado) NÃO são reescritas: a garantia nelas vem
//     das FKs + triggers `ged_mesmo_tenant()` do banco (defesa em profundidade);
//   - registro de outro cliente => `null` na leitura; em update/delete => `NaoEncontradoGed` (404 pela `rota()`);
//   - transações: `ctx.db.$transaction(async (tx) => …)` mantém o escopo em `tx` (verificado em ged-db); `gedTransacao()` é o atalho.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ErroApi } from "@/lib/http";

// ───────────── Erros ─────────────

/** Registro inexistente OU de outro cliente (tenant). `rota()` (lib/http.ts) devolve 404; páginas usam `notFound()`. */
export class NaoEncontradoGed extends ErroApi {
  constructor(msg = "Registro não encontrado.") {
    super(404, "NAO_ENCONTRADO", msg);
  }
}
export const naoEncontrado = (msg?: string) => new NaoEncontradoGed(msg);

/** Tentativa de gravar/alterar a organização de uma linha (bug de programação ou ataque) – 403. */
export class TenantDivergenteGed extends ErroApi {
  constructor(msg = "organizacao_id divergente do escopo da sessão.") {
    super(403, "PROIBIDO", msg);
  }
}

/** Garante valor presente (null/undefined => 404). */
export function exigirEncontrado<T>(valor: T | null | undefined, msg?: string): T {
  if (valor === null || valor === undefined) throw naoEncontrado(msg);
  return valor;
}

// ───────────── Lógica pura de escopo ─────────────

type Args = Record<string, unknown>;
const CAMPO = "organizacao_id";
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Operações cujo `where` aceita filtro livre: o escopo entra como AND. */
const OPS_WHERE_LIVRE = new Set(["findMany", "findFirst", "findFirstOrThrow", "count", "aggregate", "groupBy", "updateMany", "updateManyAndReturn", "deleteMany"]);
/** Operações com `where` único (UniqueInput): o escopo entra como campo extra no mesmo objeto. */
const OPS_WHERE_UNICO = new Set(["findUnique", "findUniqueOrThrow", "update", "delete", "upsert"]);
const OPS_CRIAR = new Set(["create"]);
const OPS_CRIAR_MUITOS = new Set(["createMany", "createManyAndReturn"]);
const OPS_ATUALIZA = new Set(["update", "updateMany", "updateManyAndReturn", "upsert"]);

const ehObjeto = (v: unknown): v is Args => typeof v === "object" && v !== null && !Array.isArray(v);

/** Valor escalar atribuído a `organizacao_id` em `data` (string direta ou `{ set }`); undefined se ausente. */
function valorOrg(data: Args): unknown {
  if (!(CAMPO in data)) return undefined;
  const v = data[CAMPO];
  if (ehObjeto(v)) return "set" in v ? v.set : v;
  return v;
}

function exigirOrgIgual(data: Args, org: string) {
  const v = valorOrg(data);
  if (v !== undefined && v !== org) throw new TenantDivergenteGed();
}

function escoparCriacao(data: unknown, org: string): Args {
  if (!ehObjeto(data)) throw new Error("GED: data inválido em create.");
  if ("organizacao" in data) throw new TenantDivergenteGed("GED: use organizacao_id (escalar) em vez de organizacao: { connect }.");
  exigirOrgIgual(data, org);
  return { ...data, [CAMPO]: org };
}

function escoparWhereLivre(where: unknown, org: string): Args {
  if (where === undefined || where === null) return { [CAMPO]: org };
  // AND preserva OR/NOT/aninhamento do chamador: nada que ele escreva consegue "sair" do escopo.
  return { AND: [where, { [CAMPO]: org }] };
}

function escoparWhereUnico(where: unknown, org: string): Args {
  if (!ehObjeto(where)) throw new Error("GED: where único ausente.");
  if (CAMPO in where && where[CAMPO] !== org) throw new TenantDivergenteGed();
  return { ...where, [CAMPO]: org };
}

/**
 * Aplica o escopo de organização aos argumentos de uma operação de modelo `Ged*`. PURA (sem banco).
 * Operação desconhecida => erro (negar por padrão). Devolve novos args; não altera o objeto recebido.
 */
export function injetarEscopo(operacao: string, args: unknown, organizacaoId: string): Args {
  if (!RE_UUID.test(organizacaoId)) throw new Error("GED: organizacaoId inválido.");
  const a: Args = ehObjeto(args) ? { ...args } : {};
  const org = organizacaoId;

  if (OPS_WHERE_LIVRE.has(operacao)) a.where = escoparWhereLivre(a.where, org);
  else if (OPS_WHERE_UNICO.has(operacao)) a.where = escoparWhereUnico(a.where, org);
  else if (!OPS_CRIAR.has(operacao) && !OPS_CRIAR_MUITOS.has(operacao)) throw new Error(`GED: operação não suportada no escopo: ${operacao}`);

  if (OPS_CRIAR.has(operacao)) a.data = escoparCriacao(a.data, org);
  if (OPS_CRIAR_MUITOS.has(operacao)) {
    a.data = Array.isArray(a.data) ? a.data.map((d) => escoparCriacao(d, org)) : escoparCriacao(a.data, org);
  }
  if (operacao === "upsert") {
    a.create = escoparCriacao(a.create, org);
    if (ehObjeto(a.update)) exigirOrgIgual(a.update, org);
  } else if (OPS_ATUALIZA.has(operacao)) {
    if (ehObjeto(a.data)) exigirOrgIgual(a.data, org);
  }
  return a;
}

// ───────────── Cliente estendido ─────────────

const OPS_P2025 = new Set(["update", "delete", "findUniqueOrThrow", "findFirstOrThrow"]);

function criarGedDb(organizacaoId: string) {
  if (!RE_UUID.test(organizacaoId)) throw new Error("GED: organizacaoId inválido.");
  return prisma.$extends({
    name: "ged-tenant",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model.startsWith("Ged")) return query(args);
          const escopados = injetarEscopo(operation, args, organizacaoId);
          if (!OPS_P2025.has(operation)) return query(escopados);
          try {
            return await query(escopados);
          } catch (e) {
            // P2025 = "registro não encontrado" (inclui o de outro cliente, que o escopo esconde) => 404.
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") throw naoEncontrado();
            throw e;
          }
        },
      },
    },
  });
}

/** Cliente Prisma restrito à organização (tenant). Crie um por requisição (barato) ou use `ctx.db`. */
export type GedDb = ReturnType<typeof criarGedDb>;
/** Cliente transacional escopado (parâmetro de `db.$transaction(async (tx) => …)` / `gedTransacao`). */
export type GedTx = Omit<GedDb, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;

export function gedDb(organizacaoId: string): GedDb {
  return criarGedDb(organizacaoId);
}

/**
 * Transação interativa com o escopo garantido em `tx`.
 * (O cliente estendido já propaga as extensões para `tx`; este atalho existe para tornar a intenção explícita.)
 */
export function gedTransacao<T>(
  organizacaoId: string,
  fn: (tx: GedTx) => Promise<T>,
  opcoes?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel },
): Promise<T> {
  return gedDb(organizacaoId).$transaction((tx) => fn(tx as unknown as GedTx), opcoes);
}


// ───────────── SQL cru permitido neste arquivo ─────────────

/**
 * Próximo valor de uma sequência do cliente (GedSequencia), dentro da transação do chamador.
 * O UPDATE … RETURNING trava a linha até o commit: chamadas concorrentes se enfileiram (sem repetir nem pular número;
 * se a transação for desfeita, o número volta). Uso: lib/ged/numeracao.ts.
 */
export async function proximoValorSequencia(tx: GedTx, organizacaoId: string, tipo: string, ano: number): Promise<number> {
  if (!RE_UUID.test(organizacaoId)) throw new Error("GED: organizacaoId inválido.");
  await tx.$executeRaw`
    INSERT INTO ged_sequencia (id, organizacao_id, tipo, ano, ultimo, updated_at)
    VALUES (gen_random_uuid(), ${organizacaoId}::uuid, ${tipo}, ${ano}, 0, now())
    ON CONFLICT (organizacao_id, tipo, ano) DO NOTHING`;
  const linhas = await tx.$queryRaw<{ ultimo: number }[]>`
    UPDATE ged_sequencia SET ultimo = ultimo + 1, updated_at = now()
    WHERE organizacao_id = ${organizacaoId}::uuid AND tipo = ${tipo} AND ano = ${ano}
    RETURNING ultimo`;
  if (!linhas[0]) throw new Error("GED: sequência não encontrada.");
  return linhas[0].ultimo;
}

// ───────────── Consultas entre clientes permitidas neste arquivo (frente D – assinaturas) ─────────────
// Únicas leituras sem escopo de organização do GED. Devolvem SOMENTE ids; todo o resto passa por gedDb(organizacao_id).

/**
 * Resolve um código verificador PÚBLICO (/verificar/{codigo}) em { documento_id, organizacao_id }. Aceita apenas o formato
 * XXXX-XXXX-XXXX (alfabeto sem 0/O/1/I); qualquer outra entrada devolve null sem consultar o banco.
 */
export async function resolverCodigoVerificador(codigo: string): Promise<{ documento_id: string; organizacao_id: string } | null> {
  if (typeof codigo !== "string" || !/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/.test(codigo)) return null;
  const d = await prisma.gedDocumento.findUnique({ where: { codigo_verificador: codigo }, select: { id: true, organizacao_id: true } });
  return d ? { documento_id: d.id, organizacao_id: d.organizacao_id } : null;
}

/** Job de lembretes/expiração: solicitações ABERTAS de todos os clientes (somente ids). Use gedDb(organizacao_id) para o restante. */
export async function solicitacoesAbertasEntreClientes(limite = 5000): Promise<{ id: string; organizacao_id: string }[]> {
  return prisma.gedSolicitacaoAssinatura.findMany({ where: { status: "ABERTA" }, select: { id: true, organizacao_id: true }, orderBy: { prazo_em: "asc" }, take: limite });
}

// ───────────── Varreduras entre clientes (SOMENTE jobs; devolvem apenas ids) ─────────────
// Jobs não têm sessão/tenant. Estas duas funções descobrem QUAIS clientes têm trabalho e devolvem só `(id, organizacao_id)`;
// quem chama processa cada linha com `gedDb(organizacao_id)` (jobs/ged-notificar.ts). Nunca devolvem conteúdo.

/** Comunicações PENDENTES (outbox) de todos os clientes, mais antigas primeiro; `atualizadasAntesDe` pula as mexidas há pouco (reserva/backoff). */
export async function comunicacoesPendentesEntreClientes(opc: { limite?: number; atualizadasAntesDe?: Date } = {}): Promise<{ id: string; organizacao_id: string }[]> {
  const limite = Math.min(Math.max(opc.limite ?? 50, 1), 500);
  return prisma.gedComunicacao.findMany({
    where: { status: "PENDENTE", ...(opc.atualizadasAntesDe ? { updated_at: { lte: opc.atualizadasAntesDe } } : {}) },
    select: { id: true, organizacao_id: true },
    orderBy: { created_at: "asc" },
    take: limite,
  });
}

/** Ids das organizações com o módulo GED ativo (rotinas diárias por cliente, ex.: retenção do log de acesso). */
export async function organizacoesGedAtivas(): Promise<string[]> {
  return (await prisma.organizacao.findMany({ where: { modulos: { has: "GED" } }, select: { id: true } })).map((o) => o.id);
}

// ───────────── Consultas entre clientes do PROTOCOLO PÚBLICO (somente ids) ─────────────
// O portal do cidadão (/protocolo/{slug}) e a verificação do comprovante (/verificar/protocolo/{codigo}) não têm sessão:
// o endereço público é que identifica o cliente. Estas funções só devolvem ids; todo o restante passa por gedDb(organizacao_id).

const RE_SLUG_PORTAL = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;

/** Resolve o slug público do portal de protocolo em UMA organização com o módulo GED. Slug fora do formato → null sem consultar o banco. */
export async function resolverSlugPortal(slug: string): Promise<{ organizacao_id: string } | null> {
  if (typeof slug !== "string" || !RE_SLUG_PORTAL.test(slug)) return null;
  const o = await prisma.organizacao.findFirst({ where: { slug_publico: slug, modulos: { has: "GED" } }, select: { id: true } });
  return o ? { organizacao_id: o.id } : null;
}

/** O slug já pertence a outra organização? (validação ao configurar o portal) */
export async function slugPortalEmUso(slug: string, exceto: string): Promise<boolean> {
  const o = await prisma.organizacao.findFirst({ where: { slug_publico: slug, id: { not: exceto } }, select: { id: true } });
  return !!o;
}

/** Resolve o código de verificação do comprovante (QR) em { protocolo_id, organizacao_id }. Formato XXXX-XXXX-XXXX. */
export async function resolverCodigoVerificacaoProtocolo(codigo: string): Promise<{ protocolo_id: string; organizacao_id: string } | null> {
  if (typeof codigo !== "string" || !/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/.test(codigo)) return null;
  const p = await prisma.gedProtocolo.findUnique({ where: { codigo_verificacao: codigo }, select: { id: true, organizacao_id: true } });
  return p ? { protocolo_id: p.id, organizacao_id: p.organizacao_id } : null;
}
