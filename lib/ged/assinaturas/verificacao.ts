// Verificação PÚBLICA de documento selado (/verificar/[codigo]) – sem login.
// Única consulta entre clientes: resolverCodigoVerificador (lib/ged/db.ts) → { documento_id, organizacao_id }; o restante
// usa gedDb(organizacao_id). Só são devolvidos dados do documento do código (nunca outros documentos nem outro cliente):
// nome do cliente, número, data de selagem, situação, signatários com nome ABREVIADO, método, horário, cadeia de hashes e
// hashes do arquivo. O TÍTULO só sai se a sensibilidade for PUBLICO. Sem comentários, justificativas, IP ou e-mail.
import "server-only";
import { createHash } from "node:crypto";
import { verificarAssinaturaPdf, type VerificacaoPdf } from "@/lib/assinatura/assinar";
import { abreviarNome } from "@/lib/crypto";
import { gedDb, resolverCodigoVerificador } from "../db";
import { lerArquivoGed } from "../storage";
import { verificarCadeia, type ResultadoCadeia } from "./cadeia";
import { normalizarCodigoGed } from "./regras";

export type SituacaoVerificacao = "VALIDO" | "INCONSISTENTE";

export type VerificacaoPublica = {
  codigo: string;
  situacao: SituacaoVerificacao;
  organizacao: string;
  numero: string;
  titulo: string | null;
  selado_em: Date | null;
  status_documento: string;
  sha256_final: string | null;
  sha256_alvo: string;
  assinantes: { ordem: number; nome: string; metodo: string | null; assinado_em: Date | null; hash_cadeia: string | null }[];
  cadeia: { ok: boolean; elos: number; ultimo_hash: string | null; mensagens: string[] };
  /** Arquivo selado guardado no servidor confere com sha256_final? null = não foi possível ler. */
  arquivo_integro: boolean | null;
  /** Assinatura PAdES do selo (null = selo sem certificado: eletrônica avançada). */
  pades: Pick<VerificacaoPdf, "assinado" | "integro" | "assinaturaValida" | "cobreArquivo" | "signatario" | "subFilter"> | null;
  /** Há erro na verificação do PAdES (assinatura presente mas inválida)? */
  pades_ok: boolean;
};

const MEMO_MS = 5 * 60_000;
const memo = new Map<string, { em: number; v: { arquivo_integro: boolean | null; pades: VerificacaoPublica["pades"] } }>();

/** Verifica o arquivo selado (hash + PAdES). Versão selada é imutável: memoriza por alguns minutos (a verificação lê o arquivo inteiro). */
async function verificarArquivoSelado(orgId: string, versaoId: string, storageKey: string, sha256Final: string | null) {
  const k = `${orgId}:${versaoId}`;
  const hit = memo.get(k);
  if (hit && Date.now() - hit.em < MEMO_MS) return hit.v;
  let v: { arquivo_integro: boolean | null; pades: VerificacaoPublica["pades"] };
  try {
    const buf = await lerArquivoGed(orgId, storageKey);
    const r = verificarAssinaturaPdf(buf);
    v = {
      arquivo_integro: sha256Final ? createHash("sha256").update(buf).digest("hex") === sha256Final : null,
      pades: r.assinado ? { assinado: true, integro: r.integro, assinaturaValida: r.assinaturaValida, cobreArquivo: r.cobreArquivo, signatario: r.signatario, subFilter: r.subFilter } : null,
    };
  } catch {
    v = { arquivo_integro: null, pades: null };
  }
  if (memo.size > 200) memo.clear();
  memo.set(k, { em: Date.now(), v });
  return v;
}

/** `null` = código inexistente/inválido OU documento ainda não selado (resposta idêntica: sem pistas para enumeração). */
export async function verificarPublico(codigoBruto: string): Promise<VerificacaoPublica | null> {
  const codigo = normalizarCodigoGed(codigoBruto);
  if (!codigo) return null;
  const alvo = await resolverCodigoVerificador(codigo);
  if (!alvo) return null;
  const db = gedDb(alvo.organizacao_id);
  const doc = await db.gedDocumento.findUnique({ where: { id: alvo.documento_id }, select: { id: true, numero: true, titulo: true, sensibilidade: true, status: true, sha256_final: true } });
  if (!doc) return null;
  const sol = await db.gedSolicitacaoAssinatura.findFirst({
    where: { documento_id: doc.id, status: "CONCLUIDA", versao_selo_id: { not: null } },
    orderBy: { concluida_em: "desc" },
    include: { assinantes: true },
  });
  if (!sol?.versao_selo_id) return null;
  const [org, selo, usuarios] = await Promise.all([
    db.organizacao.findUnique({ where: { id: alvo.organizacao_id }, select: { nome: true } }),
    db.gedVersaoDocumento.findUnique({ where: { id: sol.versao_selo_id }, select: { id: true, storage_key: true, sha256: true } }),
    db.usuario.findMany({ where: { id: { in: sol.assinantes.map((a) => a.usuario_id) }, organizacao_id: alvo.organizacao_id }, select: { id: true, nome: true } }),
  ]);
  if (!org || !selo) return null;
  const nomes = new Map(usuarios.map((u) => [u.id, u.nome]));

  const cadeia: ResultadoCadeia = verificarCadeia(
    sol.sha256_alvo,
    sol.assinantes.map((a) => ({ assinante_id: a.id, usuario_id: a.usuario_id, hash_documento: a.hash_documento ?? "", assinado_em: a.assinado_em, metodo: a.metodo ?? "", ordem: a.ordem, status: a.status, hash_cadeia: a.hash_cadeia })),
  );
  const cadeiaCompleta = cadeia.ok && cadeia.elos === sol.assinantes.length && sol.assinantes.every((a) => a.status === "ASSINADO");
  const { arquivo_integro, pades } = await verificarArquivoSelado(alvo.organizacao_id, selo.id, selo.storage_key, doc.sha256_final);
  const hashRegistrado = !!doc.sha256_final && doc.sha256_final === selo.sha256;
  const pades_ok = pades ? pades.integro && pades.assinaturaValida && pades.cobreArquivo : true;
  const consistente = cadeiaCompleta && hashRegistrado && arquivo_integro !== false && pades_ok;

  return {
    codigo,
    situacao: consistente ? "VALIDO" : "INCONSISTENTE",
    organizacao: org.nome,
    numero: doc.numero,
    titulo: doc.sensibilidade === "PUBLICO" ? doc.titulo : null,
    selado_em: sol.concluida_em,
    status_documento: doc.status,
    sha256_final: doc.sha256_final,
    sha256_alvo: sol.sha256_alvo,
    assinantes: [...sol.assinantes]
      .sort((a, b) => a.ordem - b.ordem)
      .map((a) => ({ ordem: a.ordem, nome: abreviarNome(nomes.get(a.usuario_id) ?? "Signatário"), metodo: a.metodo, assinado_em: a.assinado_em, hash_cadeia: a.hash_cadeia })),
    cadeia: { ok: cadeiaCompleta, elos: cadeia.elos, ultimo_hash: cadeia.ultimo_hash, mensagens: cadeia.erros.map((e) => e.mensagem) },
    arquivo_integro,
    pades,
    pades_ok,
  };
}
