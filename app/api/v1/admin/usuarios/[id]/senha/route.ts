import { NextResponse } from "next/server";
import { rota } from "@/lib/http";
import { exigirAdmin } from "@/lib/admin/guard";
import { redefinirSenha } from "@/lib/admin/usuarios";

/** POST – redefine a senha (temporária, troca obrigatória). */
export const POST = rota(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const admin = await exigirAdmin();
  const senha = await redefinirSenha(admin, (await params).id);
  return NextResponse.json({ senha_temporaria: senha, trocar_senha: true });
});
