"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { erroParaEstado } from "@/lib/admin/guard";
import { encerrarReautenticacao, ErroReautenticacao, exigirOperadorAcao, reautenticar, type Operador } from "@/lib/plataforma/operador";
import { adicionarMunicipio, atualizarCliente, criarCliente, definirModulos, reativarCliente, redefinirSenhaAdmin, suspenderCliente, type AcessoEntregue } from "@/lib/plataforma/servico";

// Server Actions do painel /plataforma. TODAS começam por exigirOperadorAcao() (operador autenticado por cookie + linha ativa em
// operador_plataforma + reautenticação recente + limite de ações) – quem não é operador recebe 404 e nada é executado.
// Validação com zod (lib/plataforma/regras.ts). Os erros viram mensagens em português; nada de segredo vai para o log.

export type EstadoPlataforma =
  | {
      ok?: boolean;
      erro?: string;
      mensagem?: string;
      campos?: Record<string, string>;
      reauth?: boolean;
      /** Credenciais entregues UMA vez ao operador (não são gravadas em claro em lugar nenhum). */
      acesso?: { senha?: string; link_convite?: string; email_enviado?: boolean; expira_em?: string };
      organizacao_id?: string;
    }
  | undefined;

const Uuid = z.uuid();
const txt = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function acessoParaEstado(a: AcessoEntregue) {
  return { senha: a.senha, link_convite: a.link_convite, email_enviado: a.email_enviado, expira_em: a.expira_em?.toISOString() };
}

async function executar(fn: (op: Operador) => Promise<Partial<NonNullable<EstadoPlataforma>> | void>, revalidar: string[] = []): Promise<EstadoPlataforma> {
  try {
    const op = await exigirOperadorAcao();
    const r = await fn(op);
    for (const c of revalidar) revalidatePath(c, "layout");
    return { ok: true, ...(r || {}) };
  } catch (e) {
    if (e instanceof ErroReautenticacao) return { erro: e.message, reauth: true };
    if (e && typeof e === "object" && "digest" in e) throw e; // notFound()/redirect() do Next: propaga
    const est = erroParaEstado(e);
    return { erro: est?.erro, campos: est?.campos };
  }
}

export async function reautenticarAcao(_: EstadoPlataforma, form: FormData): Promise<EstadoPlataforma> {
  const r = await reautenticar(String(form.get("senha") ?? ""));
  if (!r.ok) return { erro: r.erro };
  revalidatePath("/plataforma", "layout");
  return { ok: true };
}

export async function encerrarPlataformaAcao(): Promise<void> {
  await encerrarReautenticacao();
  revalidatePath("/plataforma", "layout");
}

export async function criarClienteAcao(_: EstadoPlataforma, form: FormData): Promise<EstadoPlataforma> {
  const nomes = form.getAll("municipio_nome").map(String);
  const ufs = form.getAll("municipio_uf").map(String);
  const ibges = form.getAll("municipio_ibge").map(String);
  const municipios = nomes
    .map((nome, i) => ({ nome: nome.trim(), uf: (ufs[i] ?? "").trim(), codigo_ibge: (ibges[i] ?? "").trim() }))
    .filter((m) => m.nome || m.codigo_ibge);
  const entrada = {
    nome: txt(form, "nome"), sigla: txt(form, "sigla"), cnpj: txt(form, "cnpj"), slug: txt(form, "slug"),
    modulos: form.getAll("modulos").map(String), municipios,
    admin_nome: txt(form, "admin_nome"), admin_email: txt(form, "admin_email"), admin_whatsapp: txt(form, "admin_whatsapp"),
    cota_gb: txt(form, "cota_gb") || undefined, entrega: txt(form, "entrega") || "SENHA",
  };
  return executar(async (op) => {
    const r = await criarCliente(op, entrada);
    return { mensagem: `Cliente ${r.nome} (${r.sigla}) criado.`, organizacao_id: r.organizacao_id, acesso: acessoParaEstado(r.acesso) };
  }, ["/plataforma"]);
}

export async function atualizarClienteAcao(_: EstadoPlataforma, form: FormData): Promise<EstadoPlataforma> {
  return executar(async (op) => {
    const id = Uuid.parse(txt(form, "id"));
    await atualizarCliente(op, id, { nome: txt(form, "nome"), cnpj: txt(form, "cnpj"), slug: txt(form, "slug") });
    return { mensagem: "Dados do cliente salvos." };
  }, ["/plataforma"]);
}

export async function modulosAcao(_: EstadoPlataforma, form: FormData): Promise<EstadoPlataforma> {
  return executar(async (op) => {
    const id = Uuid.parse(txt(form, "id"));
    const r = await definirModulos(op, id, form.getAll("modulos").map(String));
    return { mensagem: r.ligados.length || r.desligados.length ? `Módulos atualizados (ativados: ${r.ligados.join(", ") || "nenhum"}; desativados: ${r.desligados.join(", ") || "nenhum"}). Nenhum dado foi apagado.` : "Nenhuma alteração." };
  }, ["/plataforma"]);
}

export async function municipioAcao(_: EstadoPlataforma, form: FormData): Promise<EstadoPlataforma> {
  return executar(async (op) => {
    const id = Uuid.parse(txt(form, "id"));
    const r = await adicionarMunicipio(op, id, { nome: txt(form, "nome"), uf: txt(form, "uf"), codigo_ibge: txt(form, "codigo_ibge") });
    return { mensagem: `Órgão/município adicionado (sigla ${r.sigla}).` };
  }, ["/plataforma"]);
}

export async function suspenderAcao(_: EstadoPlataforma, form: FormData): Promise<EstadoPlataforma> {
  return executar(async (op) => {
    const id = Uuid.parse(txt(form, "id"));
    await suspenderCliente(op, id, { confirmacao: txt(form, "confirmacao"), motivo: txt(form, "motivo") });
    return { mensagem: "Cliente suspenso. Sessões derrubadas e portais públicos fora do ar; dados preservados." };
  }, ["/plataforma"]);
}

export async function reativarAcao(_: EstadoPlataforma, form: FormData): Promise<EstadoPlataforma> {
  return executar(async (op) => {
    const id = Uuid.parse(txt(form, "id"));
    await reativarCliente(op, id, { confirmacao: txt(form, "confirmacao") });
    return { mensagem: "Cliente reativado." };
  }, ["/plataforma"]);
}

export async function redefinirSenhaAcao(_: EstadoPlataforma, form: FormData): Promise<EstadoPlataforma> {
  return executar(async (op) => {
    const id = Uuid.parse(txt(form, "id"));
    const usuarioId = Uuid.parse(txt(form, "usuario_id"));
    const entrega = z.enum(["SENHA", "CONVITE", "AMBOS"]).parse(txt(form, "entrega") || "SENHA");
    const a = await redefinirSenhaAdmin(op, id, usuarioId, entrega);
    return { mensagem: "Senha do administrador redefinida (troca obrigatória no primeiro acesso).", acesso: acessoParaEstado(a) };
  }, ["/plataforma"]);
}
