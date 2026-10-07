// Promoção de OPERADORES da plataforma – única porta de entrada (CLI `npm run plataforma:operador` e bootstrap do predeploy
// por PLATAFORMA_OPERADORES). Nenhuma tela/API de cliente chama isto. Sem dependências do Next (roda em tsx).
import type { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { gerarSenhaTemporaria } from "../admin/senha";
import { motivoInelegivelOperador } from "./regras";

const hashSenha = (senha: string) => hash(senha, { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 });

export type ResultadoOperador = { email: string; acao: "criado" | "promovido" | "ja_operador" | "reativado" | "desativado" | "senha_redefinida"; senha?: string };

/**
 * Cria (usuário novo, senha temporária impressa uma vez, troca obrigatória) ou promove um usuário EXISTENTE a operador.
 * Recusa quem tem organização, papéis, cadastro de pessoa ou GED (admin de cliente e requerente NUNCA viram operador).
 */
export async function promoverOperador(prisma: PrismaClient, entrada: { email: string; nome?: string | null; origem: "cli" | "env"; senha?: string | null }): Promise<ResultadoOperador> {
  const email = entrada.email.trim().toLowerCase();
  const u = await prisma.usuario.findUnique({
    where: { email },
    select: { id: true, nome: true, ativo: true, organizacao_id: true, pessoa_id: true, _count: { select: { papeis: true, ged_membros: true } }, operador: { select: { id: true, ativo: true } } },
  });
  let senha: string | undefined;
  let acao: ResultadoOperador["acao"];
  if (!u) {
    senha = entrada.senha || gerarSenhaTemporaria(16);
    const criado = await prisma.usuario.create({
      data: { email, nome: entrada.nome?.trim() || email.split("@")[0], senha_hash: await hashSenha(senha), trocar_senha: true },
      select: { id: true },
    });
    await prisma.operadorPlataforma.create({ data: { usuario_id: criado.id, origem: entrada.origem } });
    await prisma.logAuditoria.create({ data: { usuario_id: null, acao: "PLATAFORMA_OPERADOR_CRIADO", entidade: "usuario", entidade_id: criado.id, depois: { email, origem: entrada.origem } } });
    return { email, acao: "criado", senha };
  }
  const motivo = motivoInelegivelOperador({ ativo: u.ativo, organizacao_id: u.organizacao_id, pessoa_id: u.pessoa_id, papeis: u._count.papeis, ged_membros: u._count.ged_membros });
  if (motivo) throw new Error(`${email} não pode ser operador: ${motivo}. Use um e-mail exclusivo para a operação da plataforma.`);
  if (u.operador) {
    if (u.operador.ativo) return { email, acao: "ja_operador" };
    await prisma.operadorPlataforma.update({ where: { id: u.operador.id }, data: { ativo: true } });
    acao = "reativado";
  } else {
    await prisma.operadorPlataforma.create({ data: { usuario_id: u.id, origem: entrada.origem } });
    acao = "promovido";
  }
  await prisma.logAuditoria.create({ data: { usuario_id: null, acao: "PLATAFORMA_OPERADOR_PROMOVIDO", entidade: "usuario", entidade_id: u.id, depois: { email, origem: entrada.origem, acao } } });
  return { email, acao };
}

/** Nova senha temporária para um operador existente (esqueceu a senha): troca obrigatória no próximo acesso. */
export async function redefinirSenhaOperador(prisma: PrismaClient, emailBruto: string, senhaFixa?: string | null): Promise<ResultadoOperador> {
  const email = emailBruto.trim().toLowerCase();
  const u = await prisma.usuario.findUnique({ where: { email }, select: { id: true, operador: { select: { ativo: true } } } });
  if (!u?.operador?.ativo) throw new Error(`${email} não é operador ativo da plataforma.`);
  const senha = senhaFixa || gerarSenhaTemporaria(16);
  await prisma.usuario.update({ where: { id: u.id }, data: { senha_hash: await hashSenha(senha), trocar_senha: true, falhas_login: 0, bloqueado_ate: null } });
  await prisma.logAuditoria.create({ data: { usuario_id: null, acao: "PLATAFORMA_OPERADOR_SENHA_REDEFINIDA", entidade: "usuario", entidade_id: u.id, depois: { email } } });
  return { email, acao: "senha_redefinida", senha };
}

export async function desativarOperador(prisma: PrismaClient, emailBruto: string): Promise<ResultadoOperador> {
  const email = emailBruto.trim().toLowerCase();
  const u = await prisma.usuario.findUnique({ where: { email }, select: { id: true, operador: { select: { id: true } } } });
  if (!u?.operador) throw new Error(`${email} não é operador da plataforma.`);
  await prisma.operadorPlataforma.update({ where: { id: u.operador.id }, data: { ativo: false } });
  await prisma.logAuditoria.create({ data: { usuario_id: null, acao: "PLATAFORMA_OPERADOR_DESATIVADO", entidade: "usuario", entidade_id: u.id, depois: { email } } });
  return { email, acao: "desativado" };
}
