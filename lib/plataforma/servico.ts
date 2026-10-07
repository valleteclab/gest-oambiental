import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hashSenha } from "@/lib/auth";
import { cifrar } from "@/lib/crypto";
import { invalido, naoEncontrado } from "@/lib/http";
import { normalizarTelefone } from "@/lib/canais/telefone";
import { aplicarCatalogo } from "../../prisma/seed/catalogo";
import { ClienteSchema, onboarding } from "./onboarding";
import { criarConvite, enviarConviteEmail } from "./convite";
import { auditarPlataforma, type Operador } from "./operador";
import {
  COTA_GED_PADRAO_GB, EdicaoClienteSchema, MunicipioNovoSchema, NovoClienteSchema, SETORES_GED_PADRAO, TIPOS_DOCUMENTO_GED_PADRAO,
  confirmacaoConfere, derivarSiglaMunicipio, gerarSenhaAdminCliente, montarClienteOnboarding, transicaoStatus, validarModulos,
} from "./regras";

// SERVIÇO DO PAINEL DO OPERADOR (/plataforma). O operador vê e altera SOMENTE o cadastro do cliente (organização, módulos,
// situação, órgãos e administradores). Nada de dados de negócio: processos, documentos, protocolos e pessoas só aparecem como
// CONTAGENS. Toda função de escrita registra auditoria (ator = operador, alvo = cliente, antes/depois, sem segredos).
// Quem chama (Server Actions) já executou exigirOperadorAcao(); o `operador` aqui é só o ator para a auditoria.

export type EntregaAcesso = "SENHA" | "CONVITE" | "AMBOS";
export type AcessoEntregue = {
  /** Senha temporária – exibida UMA vez ao operador (nunca é gravada em claro). */
  senha?: string;
  /** Link de definição de senha (uso único) – exibido uma vez; também enviado por e-mail quando solicitado. */
  link_convite?: string;
  email_enviado?: boolean;
  expira_em?: Date;
};

const SELECT_LISTA = {
  id: true, nome: true, sigla: true, cnpj: true, slug_publico: true, modulos: true, status: true, suspensa_em: true, created_at: true,
  _count: { select: { usuarios: true, municipios: true } },
} satisfies Prisma.OrganizacaoSelect;

export async function listarClientes() {
  return prisma.organizacao.findMany({ select: SELECT_LISTA, orderBy: [{ status: "asc" }, { nome: "asc" }] });
}

/** Cliente com metadados e contagens agregadas (sem conteúdo). 404 se não existir. */
export async function obterCliente(id: string) {
  const RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!RE.test(id)) throw naoEncontrado("Cliente não encontrado.");
  const org = await prisma.organizacao.findUnique({
    where: { id },
    select: {
      ...SELECT_LISTA, suspensa_motivo: true, updated_at: true,
      municipios: { select: { id: true, nome: true, sigla: true, codigo_ibge: true, ativo: true }, orderBy: { nome: "asc" } },
    },
  });
  if (!org) throw naoEncontrado("Cliente não encontrado.");
  const [processos, documentosGed] = await Promise.all([
    prisma.processo.count({ where: { municipio: { organizacao_id: id } } }),
    prisma.gedDocumento.count({ where: { organizacao_id: id } }),
  ]);
  return { ...org, contagens: { usuarios: org._count.usuarios, municipios: org._count.municipios, processos, documentos_ged: documentosGed } };
}

/** Usuários do cliente (nome, e-mail, papéis, último acesso). Nunca senhas, CPF ou dados de negócio. */
export async function usuariosDoCliente(orgId: string) {
  return prisma.usuario.findMany({
    where: { organizacao_id: orgId },
    select: {
      id: true, nome: true, email: true, ativo: true, ultimo_login: true, trocar_senha: true, bloqueado_ate: true,
      papeis: { select: { papel: true, municipio: { select: { sigla: true } } } },
      ged_membros: { select: { papel: true, ativo: true }, where: { organizacao_id: orgId } },
    },
    orderBy: { nome: "asc" },
  });
}

// ───────────── Criar cliente ─────────────

export async function criarCliente(operador: Operador, entrada: unknown): Promise<{ organizacao_id: string; sigla: string; nome: string; acesso: AcessoEntregue }> {
  const e = NovoClienteSchema.parse(entrada);
  const campo = (c: string, msg: string) => invalido(msg, { campo: c });
  if (await prisma.organizacao.findFirst({ where: { sigla: { equals: e.sigla, mode: "insensitive" } }, select: { id: true } })) throw campo("sigla", "Já existe um cliente com esta sigla.");
  if (e.slug && (await prisma.organizacao.findFirst({ where: { slug_publico: e.slug }, select: { id: true } }))) throw campo("slug", "Este endereço público já está em uso por outro cliente.");
  if (await prisma.usuario.findUnique({ where: { email: e.admin_email }, select: { id: true } })) throw campo("admin_email", "Já existe usuário com este e-mail. Use um e-mail novo para o administrador do cliente.");
  if (e.municipios.length) {
    const ja = await prisma.municipio.findMany({ where: { codigo_ibge: { in: e.municipios.map((m) => m.codigo_ibge) } }, select: { codigo_ibge: true } });
    if (ja.length) throw campo("municipios", `Código IBGE já cadastrado em outro cliente: ${ja.map((m) => m.codigo_ibge).join(", ")}.`);
  }
  let telefone: string | null = null;
  if (e.admin_whatsapp) {
    telefone = normalizarTelefone(e.admin_whatsapp);
    if (!telefone) throw campo("admin_whatsapp", "WhatsApp inválido (use DDD + número).");
  }
  const siglasUsadas = (await prisma.municipio.findMany({ select: { sigla: true } })).map((m) => m.sigla);
  const cliente = ClienteSchema.parse(montarClienteOnboarding(e, siglasUsadas));

  // Tudo ou nada: se qualquer etapa falhar, nada do cliente permanece.
  const r = await prisma.$transaction(
    async (tx) => {
      const res = await onboarding(tx as unknown as Parameters<typeof onboarding>[0], cliente, { ator_id: operador.id, gerarSenha: gerarSenhaAdminCliente, slug_publico: e.slug });
      if (telefone && e.modulos.includes("GED")) {
        const u = await tx.usuario.findUniqueOrThrow({ where: { email: e.admin_email }, select: { id: true } });
        await tx.gedMembro.updateMany({ where: { organizacao_id: res.organizacao.id, usuario_id: u.id }, data: { telefone_cifrado: cifrar(telefone) } });
      }
      await auditarPlataforma(
        operador,
        {
          acao: "CLIENTE_CRIADO", organizacao_id: res.organizacao.id, entidade: "organizacao", entidade_id: res.organizacao.id,
          depois: { nome: e.nome, sigla: e.sigla, cnpj: e.cnpj, slug: e.slug, modulos: e.modulos, municipios: Object.keys(res.municipios), admin_email: e.admin_email, entrega: e.entrega },
        },
        tx,
      );
      return res;
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  const acesso = await entregarAcesso(operador, r.organizacao.id, r.organizacao.nome, e.admin_email, e.admin_nome, e.entrega, r.senhas.find((s) => s.email === e.admin_email)?.senha);
  return { organizacao_id: r.organizacao.id, sigla: r.organizacao.sigla, nome: r.organizacao.nome, acesso };
}

/** Monta o que o operador entrega ao administrador: senha temporária (uma vez) e/ou convite por e-mail. */
async function entregarAcesso(operador: Operador, orgId: string, orgNome: string, email: string, nome: string, entrega: EntregaAcesso, senha: string | undefined): Promise<AcessoEntregue> {
  const acesso: AcessoEntregue = {};
  if (entrega === "SENHA" || entrega === "AMBOS") acesso.senha = senha;
  if (entrega === "CONVITE" || entrega === "AMBOS") {
    const u = await prisma.usuario.findUniqueOrThrow({ where: { email }, select: { id: true } });
    const c = await criarConvite(u.id, operador.id);
    const env = await enviarConviteEmail(email, nome, orgNome, c.link, c.expira_em);
    acesso.link_convite = c.link;
    acesso.expira_em = c.expira_em;
    acesso.email_enviado = !!process.env.SMTP_URL && !(await prisma.emailEnviado.findUnique({ where: { id: env.id }, select: { erro: true } }))?.erro;
    await auditarPlataforma(operador, { acao: "CONVITE_ENVIADO", organizacao_id: orgId, entidade: "usuario", entidade_id: u.id, depois: { email, expira_em: c.expira_em } });
  }
  return acesso;
}

// ───────────── Editar ─────────────

export async function atualizarCliente(operador: Operador, id: string, entrada: unknown) {
  const e = EdicaoClienteSchema.parse(entrada);
  const antes = await prisma.organizacao.findUnique({ where: { id }, select: { nome: true, cnpj: true, slug_publico: true } });
  if (!antes) throw naoEncontrado("Cliente não encontrado.");
  if (e.slug && (await prisma.organizacao.findFirst({ where: { slug_publico: e.slug, id: { not: id } }, select: { id: true } }))) throw invalido("Este endereço público já está em uso por outro cliente.", { campo: "slug" });
  const depois = { nome: e.nome, cnpj: e.cnpj, slug_publico: e.slug };
  await prisma.$transaction(async (tx) => {
    await tx.organizacao.update({ where: { id }, data: depois });
    await auditarPlataforma(operador, { acao: "CLIENTE_EDITADO", organizacao_id: id, entidade: "organizacao", entidade_id: id, antes, depois }, tx);
  });
}

/**
 * Ativa/desativa módulos. Desativar NÃO apaga dados: apenas bloqueia o acesso ao módulo (sessão sem papéis de licenciamento,
 * portais e GED respondem como indisponíveis). Reativar restaura tudo como estava.
 */
export async function definirModulos(operador: Operador, id: string, entrada: readonly string[]) {
  const v = validarModulos(entrada);
  if (!v.ok) throw invalido(v.erro, { campo: "modulos" });
  const org = await prisma.organizacao.findUnique({ where: { id }, select: { id: true, modulos: true } });
  if (!org) throw naoEncontrado("Cliente não encontrado.");
  const ligados = v.modulos.filter((m) => !org.modulos.includes(m));
  const desligados = org.modulos.filter((m) => !v.modulos.includes(m));
  if (!ligados.length && !desligados.length) return { ligados, desligados };
  await prisma.$transaction(
    async (tx) => {
      await tx.organizacao.update({ where: { id }, data: { modulos: v.modulos } });
      if (ligados.includes("LICENCIAMENTO")) await aplicarCatalogo(tx as unknown as Parameters<typeof aplicarCatalogo>[0], id);
      if (ligados.includes("GED")) await prepararGedPadrao(tx, id);
      await auditarPlataforma(operador, { acao: "MODULOS_ALTERADOS", organizacao_id: id, entidade: "organizacao", entidade_id: id, antes: { modulos: org.modulos }, depois: { modulos: v.modulos, ligados, desligados } }, tx);
    },
    { timeout: 60_000 },
  );
  return { ligados, desligados };
}

/** Habilitar o GED num cliente existente: config, setores e tipos padrão (se não houver) e GED_ADMIN para os admins do cliente. Só acrescenta. */
async function prepararGedPadrao(tx: Prisma.TransactionClient, orgId: string) {
  if (!(await tx.gedConfig.findUnique({ where: { organizacao_id: orgId }, select: { id: true } }))) {
    await tx.gedConfig.create({ data: { organizacao_id: orgId, cota_bytes: BigInt(COTA_GED_PADRAO_GB) * BigInt(1024 ** 3) } });
  }
  const setores = new Map<string, string>();
  for (const s of SETORES_GED_PADRAO) {
    const ex = await tx.gedSetor.findUnique({ where: { organizacao_id_sigla: { organizacao_id: orgId, sigla: s.sigla } }, select: { id: true } });
    setores.set(s.sigla, ex?.id ?? (await tx.gedSetor.create({ data: { organizacao_id: orgId, nome: s.nome, sigla: s.sigla }, select: { id: true } })).id);
  }
  for (const nome of TIPOS_DOCUMENTO_GED_PADRAO) {
    if (!(await tx.gedTipoDocumento.findFirst({ where: { organizacao_id: orgId, nome: { equals: nome, mode: "insensitive" } }, select: { id: true } }))) await tx.gedTipoDocumento.create({ data: { organizacao_id: orgId, nome } });
  }
  if ((await tx.gedMembro.count({ where: { organizacao_id: orgId } })) === 0) {
    const admins = await tx.usuario.findMany({ where: { organizacao_id: orgId, ativo: true, papeis: { some: { papel: "ADMIN" } } }, select: { id: true } });
    for (const a of admins) {
      await tx.gedMembro.create({ data: { organizacao_id: orgId, usuario_id: a.id, papel: "GED_ADMIN" } });
      await tx.gedSetorMembro.create({ data: { organizacao_id: orgId, setor_id: setores.get("ADM")!, usuario_id: a.id, chefe: true } });
    }
  }
}

export async function adicionarMunicipio(operador: Operador, id: string, entrada: unknown) {
  const m = MunicipioNovoSchema.parse(entrada);
  const org = await prisma.organizacao.findUnique({ where: { id }, select: { id: true, modulos: true } });
  if (!org) throw naoEncontrado("Cliente não encontrado.");
  if (!org.modulos.includes("LICENCIAMENTO")) throw invalido("O cliente não tem o módulo de licenciamento.");
  if (await prisma.municipio.findUnique({ where: { codigo_ibge: m.codigo_ibge }, select: { id: true } })) throw invalido("Este código IBGE já está cadastrado.", { campo: "codigo_ibge" });
  const sigla = derivarSiglaMunicipio(m.nome, (await prisma.municipio.findMany({ select: { sigla: true } })).map((x) => x.sigla));
  await prisma.$transaction(async (tx) => {
    const criado = await tx.municipio.create({ data: { nome: m.nome, sigla, codigo_ibge: m.codigo_ibge, orgao_ambiental_nome: `Órgão Ambiental de ${m.nome}`, organizacao_id: id }, select: { id: true } });
    await auditarPlataforma(operador, { acao: "MUNICIPIO_ADICIONADO", organizacao_id: id, entidade: "municipio", entidade_id: criado.id, depois: { nome: m.nome, uf: m.uf, sigla, codigo_ibge: m.codigo_ibge } }, tx);
  });
  return { sigla };
}

// ───────────── Suspender / reativar ─────────────

async function mudarStatus(operador: Operador, id: string, acao: "suspender" | "reativar", confirmacao: string, motivo: string | null) {
  const org = await prisma.organizacao.findUnique({ where: { id }, select: { id: true, sigla: true, status: true } });
  if (!org) throw naoEncontrado("Cliente não encontrado.");
  const t = transicaoStatus(org.status, acao);
  if (!t.ok) throw invalido(t.erro);
  if (!confirmacaoConfere(confirmacao, org.sigla)) throw invalido(`Digite a sigla do cliente (${org.sigla}) para confirmar.`, { campo: "confirmacao" });
  const dados = acao === "suspender" ? { status: t.proximo, suspensa_em: new Date(), suspensa_motivo: motivo } : { status: t.proximo, suspensa_em: null, suspensa_motivo: null };
  await prisma.$transaction(async (tx) => {
    await tx.organizacao.update({ where: { id }, data: dados });
    await auditarPlataforma(
      operador,
      { acao: acao === "suspender" ? "CLIENTE_SUSPENSO" : "CLIENTE_REATIVADO", organizacao_id: id, entidade: "organizacao", entidade_id: id, antes: { status: org.status }, depois: { status: t.proximo, motivo } },
      tx,
    );
  });
}

export async function suspenderCliente(operador: Operador, id: string, entrada: { confirmacao: string; motivo: string }) {
  const motivo = entrada.motivo.trim();
  if (motivo.length < 5) throw invalido("Informe o motivo da suspensão (mínimo de 5 caracteres).", { campo: "motivo" });
  await mudarStatus(operador, id, "suspender", entrada.confirmacao, motivo.slice(0, 500));
}

export async function reativarCliente(operador: Operador, id: string, entrada: { confirmacao: string }) {
  await mudarStatus(operador, id, "reativar", entrada.confirmacao, null);
}

// ───────────── Administrador do cliente ─────────────

/** Redefine a senha de um ADMIN do cliente (nova senha temporária e/ou convite). Nunca revela a senha atual. */
export async function redefinirSenhaAdmin(operador: Operador, orgId: string, usuarioId: string, entrega: EntregaAcesso): Promise<AcessoEntregue> {
  const u = await prisma.usuario.findFirst({
    where: { id: usuarioId, organizacao_id: orgId },
    select: { id: true, nome: true, email: true, papeis: { where: { papel: "ADMIN" }, select: { id: true } }, ged_membros: { where: { organizacao_id: orgId, papel: "GED_ADMIN", ativo: true }, select: { id: true } }, organizacao: { select: { nome: true } } },
  });
  if (!u) throw naoEncontrado("Usuário não encontrado neste cliente.");
  if (!u.papeis.length && !u.ged_membros.length) throw invalido("Só é possível redefinir a senha de administradores do cliente.");
  const senha = gerarSenhaAdminCliente();
  const hash = await hashSenha(senha);
  await prisma.$transaction(async (tx) => {
    await tx.usuario.update({ where: { id: u.id }, data: { senha_hash: hash, trocar_senha: true, falhas_login: 0, bloqueado_ate: null } });
    await tx.conviteSenha.updateMany({ where: { usuario_id: u.id, usado_em: null }, data: { usado_em: new Date() } });
    await auditarPlataforma(operador, { acao: "SENHA_ADMIN_REDEFINIDA", organizacao_id: orgId, entidade: "usuario", entidade_id: u.id, depois: { email: u.email, entrega } }, tx);
  });
  return entregarAcesso(operador, orgId, u.organizacao?.nome ?? "", u.email, u.nome, entrega, senha);
}
