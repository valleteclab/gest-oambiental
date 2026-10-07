import "server-only";
import { prisma } from "@/lib/db";
import { auditar } from "@/lib/audit";
import { enviarEmail } from "@/lib/email";
import { conviteUtilizavel, gerarTokenConvite, hashTokenConvite, RE_TOKEN_CONVITE, VALIDADE_CONVITE_HORAS } from "./regras";

// Convite de definição de senha (uso único, expira em 72 h). Só o hash do token fica no banco; o link vai por e-mail e/ou é
// mostrado UMA vez ao operador. Usado pelo painel /plataforma (administrador inicial e redefinição de senha do admin).

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const urlBase = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
export const linkConvite = (token: string) => `${urlBase()}/definir-senha/${token}`;

/** Cria um convite novo e invalida os anteriores ainda abertos do mesmo usuário. Devolve o token (só nesta chamada). */
export async function criarConvite(usuarioId: string, criadoPor: string | null): Promise<{ token: string; link: string; expira_em: Date }> {
  const { token, hash } = gerarTokenConvite();
  const expira_em = new Date(Date.now() + VALIDADE_CONVITE_HORAS * 3_600_000);
  await prisma.$transaction([
    prisma.conviteSenha.updateMany({ where: { usuario_id: usuarioId, usado_em: null }, data: { usado_em: new Date() } }),
    prisma.conviteSenha.create({ data: { usuario_id: usuarioId, token_hash: hash, expira_em, criado_por: criadoPor } }),
  ]);
  return { token, link: linkConvite(token), expira_em };
}

/** Envia o convite por e-mail (outbox/serviço existente: sem SMTP fica na caixa de teste /admin/emails). */
export async function enviarConviteEmail(para: string, nome: string, organizacaoNome: string, link: string, expira_em: Date) {
  const validade = expira_em.toLocaleString("pt-BR", { timeZone: "America/Bahia" });
  const corpo = `<p>Olá, ${esc(nome)}.</p>
<p>Você foi cadastrado(a) como administrador(a) de <strong>${esc(organizacaoNome)}</strong> na plataforma LicenciaGov.</p>
<p>Para definir sua senha e acessar, abra o link abaixo (uso único, válido até ${esc(validade)}):</p>
<p><a href="${esc(link)}">${esc(link)}</a></p>
<p>Se você não esperava esta mensagem, ignore-a: sem a definição da senha, ninguém acessa a conta.</p>`;
  return enviarEmail(para, "Defina sua senha de acesso – LicenciaGov", corpo);
}

/** Convite utilizável para o token (null = inexistente, usado, expirado ou formato inválido – sem distinguir). */
export async function conviteDoToken(token: string) {
  if (typeof token !== "string" || !RE_TOKEN_CONVITE.test(token)) return null;
  const c = await prisma.conviteSenha.findUnique({ where: { token_hash: hashTokenConvite(token) }, select: { id: true, usuario_id: true, usado_em: true, expira_em: true, usuario: { select: { nome: true, email: true, ativo: true } } } });
  if (!c || !conviteUtilizavel(c) || !c.usuario.ativo) return null;
  return c;
}

/**
 * Consome o convite (atomicamente: só uma requisição vence) e grava a senha. Retorna false se o token já foi usado/expirou.
 * `hashNovaSenha` já calculado pelo chamador (argon2id).
 */
export async function consumirConvite(token: string, hashNovaSenha: string): Promise<boolean> {
  const c = await conviteDoToken(token);
  if (!c) return false;
  const ok = await prisma.$transaction(async (tx) => {
    const r = await tx.conviteSenha.updateMany({ where: { id: c.id, usado_em: null, expira_em: { gt: new Date() } }, data: { usado_em: new Date() } });
    if (r.count !== 1) return false;
    await tx.usuario.update({ where: { id: c.usuario_id }, data: { senha_hash: hashNovaSenha, trocar_senha: false, falhas_login: 0, bloqueado_ate: null } });
    await auditar({ usuario_id: c.usuario_id, acao: "CONVITE_SENHA_USADO", entidade: "usuario", entidade_id: c.usuario_id }, tx);
    return true;
  });
  return ok;
}
