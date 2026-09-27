"use server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { criarSessao, hashSenha, validarPoliticaSenha } from "@/lib/auth";
import { auditar } from "@/lib/audit";
import { cifrar, hashBusca, mascararCpfCnpj, somenteDigitos } from "@/lib/crypto";
import { PessoaSchema } from "@/lib/cadastros/validacao";

export type EstadoCadastro = { erro?: string; campos?: Record<string, string>; valores?: Record<string, string> } | undefined;

/** Auto-cadastro do requerente: cria pessoa (CPF/CNPJ validado e cifrado) + usuário com papel REQUERENTE. */
export async function cadastrarRequerente(_: EstadoCadastro, form: FormData): Promise<EstadoCadastro> {
  const g = (k: string) => String(form.get(k) ?? "").trim();
  // Devolve o que foi digitado (exceto senhas) – o React reinicia o formulário após a action.
  const valores = Object.fromEntries(["tipo", "nome", "nome_fantasia", "cpf_cnpj", "email", "telefone", "municipio_id", "aceite"].map((k) => [k, g(k)]));
  const email = g("email").toLowerCase();
  const senha = String(form.get("senha") ?? "");
  const confirmacao = String(form.get("confirmacao") ?? "");
  const r = PessoaSchema.safeParse({ tipo: g("tipo"), cpf_cnpj: g("cpf_cnpj"), nome: g("nome"), nome_fantasia: g("nome_fantasia") || null, email, telefone: g("telefone") || null, municipio_id: g("municipio_id") || null, endereco: null });
  const campos: Record<string, string> = {};
  if (!r.success) for (const i of r.error.issues) campos[i.path.join(".")] ??= i.message;
  if (!email) campos.email ??= "Informe o e-mail.";
  const politica = validarPoliticaSenha(senha);
  if (politica) campos.senha = politica;
  if (senha !== confirmacao) campos.confirmacao = "A confirmação não confere.";
  if (!form.get("aceite")) campos.aceite = "É necessário aceitar os termos de uso e a política de privacidade.";
  if (Object.keys(campos).length || !r.success) return { erro: "Corrija os campos destacados.", campos, valores };
  const e = r.data;

  const doc = somenteDigitos(e.cpf_cnpj);
  const hash = hashBusca(doc);
  if (await prisma.usuario.findUnique({ where: { email } })) return { erro: "Já existe uma conta com este e-mail. Use “Entrar” ou recupere a senha.", campos: { email: "E-mail já cadastrado." }, valores };
  if (await prisma.pessoa.findUnique({ where: { cpf_cnpj_hash: hash }, select: { id: true } })) {
    // Evita que terceiros se apropriem de um cadastro existente (e dos processos vinculados) apenas conhecendo o CPF/CNPJ.
    return { erro: "Este CPF/CNPJ já possui cadastro no órgão ambiental. Procure o atendimento do seu município para liberar o acesso.", campos: { cpf_cnpj: "CPF/CNPJ já cadastrado." }, valores };
  }
  const municipio = e.municipio_id ? await prisma.municipio.findUnique({ where: { id: e.municipio_id }, select: { organizacao_id: true } }) : null;
  const org = municipio?.organizacao_id ?? (await prisma.organizacao.findFirst({ select: { id: true } }))?.id ?? null;
  const pf = e.tipo === "PF";
  const senha_hash = await hashSenha(senha);

  const usuario = await prisma.$transaction(async (tx) => {
    const pessoa = await tx.pessoa.create({
      data: {
        organizacao_id: org,
        tipo: e.tipo,
        cpf_cnpj_cifrado: cifrar(doc),
        cpf_cnpj_hash: hash,
        cpf_cnpj_mascara: mascararCpfCnpj(doc),
        nome: e.nome,
        nome_fantasia: e.nome_fantasia,
        email: pf ? cifrar(email) : email,
        telefone: e.telefone ? (pf ? cifrar(e.telefone) : e.telefone) : null,
        municipio_id: e.municipio_id ?? null,
      },
    });
    const u = await tx.usuario.create({ data: { nome: e.nome, email, senha_hash, trocar_senha: false, pessoa_id: pessoa.id, ...(pf ? { cpf_cifrado: cifrar(doc), cpf_hash: hash } : {}) } });
    await tx.usuarioPapel.create({ data: { usuario_id: u.id, papel: "REQUERENTE" } });
    await tx.pessoa.update({ where: { id: pessoa.id }, data: { created_by: u.id } });
    await auditar({ usuario_id: u.id, acao: "CRIAR", entidade: "pessoa", entidade_id: pessoa.id, depois: { id: pessoa.id, tipo: pessoa.tipo, nome: pessoa.nome, cpf_cnpj_mascara: pessoa.cpf_cnpj_mascara, origem: "auto-cadastro" } }, tx);
    await auditar({ usuario_id: u.id, acao: "CADASTRO_REQUERENTE", entidade: "usuario", entidade_id: u.id, depois: { email, pessoa_id: pessoa.id, papel: "REQUERENTE" } }, tx);
    return u;
  });
  await criarSessao(usuario.id);
  redirect("/meus-processos");
}
