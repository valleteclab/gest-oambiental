"use server";
import type { Papel } from "@prisma/client";
import { acaoAdmin, bool, txt, txtOuNulo } from "@/lib/admin/acao";
import type { EstadoAcao } from "@/lib/admin/guard";
import { adicionarPapel, criarUsuario, editarUsuario, redefinirSenha, removerPapel } from "@/lib/admin/usuarios";

export async function acaoCriarUsuario(_: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  return acaoAdmin("/admin/usuarios", async (u) => {
    const r = await criarUsuario(u, { nome: txt(f, "nome"), email: txt(f, "email"), cargo: txtOuNulo(f, "cargo"), cpf: txtOuNulo(f, "cpf"), papel: txtOuNulo(f, "papel"), municipio_id: txtOuNulo(f, "municipio_id") });
    return { mensagem: `Usuário ${r.usuario.email} criado.`, extra: { senha: r.senhaTemporaria, link: `/admin/usuarios/${r.usuario.id}` } };
  });
}

export async function acaoEditarUsuario(_: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  const id = txt(f, "id");
  return acaoAdmin(["/admin/usuarios", `/admin/usuarios/${id}`], async (u) => {
    await editarUsuario(u, id, { nome: txt(f, "nome"), email: txt(f, "email"), cargo: txtOuNulo(f, "cargo") });
    return "Dados do usuário atualizados.";
  });
}

export async function acaoAtivacao(_: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  const id = txt(f, "id");
  return acaoAdmin(["/admin/usuarios", `/admin/usuarios/${id}`], async (u) => {
    const ativo = bool(f, "ativo");
    await editarUsuario(u, id, { ativo });
    return ativo ? "Usuário reativado." : "Usuário desativado (histórico preservado).";
  });
}

export async function acaoAdicionarPapel(_: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  const id = txt(f, "id");
  return acaoAdmin(`/admin/usuarios/${id}`, async (u) => {
    await adicionarPapel(u, id, txt(f, "papel") as Papel, txtOuNulo(f, "municipio_id"));
    return "Papel adicionado.";
  });
}

export async function acaoRemoverPapel(_: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  const id = txt(f, "id");
  return acaoAdmin(`/admin/usuarios/${id}`, async (u) => {
    await removerPapel(u, id, txt(f, "papel_id"));
    return "Papel removido.";
  });
}

export async function acaoRedefinirSenha(_: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  const id = txt(f, "id");
  return acaoAdmin(`/admin/usuarios/${id}`, async (u) => {
    const senha = await redefinirSenha(u, id);
    return { mensagem: "Senha redefinida. O usuário deverá trocá-la no próximo acesso.", extra: { senha } };
  });
}
