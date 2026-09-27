import Link from "next/link";
import { prisma } from "@/lib/db";
import { FormCadastro } from "./form";

export const metadata = { title: "Cadastro de requerente" };
// Lista de municípios vem do banco: renderizar por requisição (o banco não existe no build da imagem)
export const dynamic = "force-dynamic";

export default async function PaginaCadastro() {
  const municipios = await prisma.municipio.findMany({ where: { ativo: true }, select: { id: true, nome: true }, orderBy: { nome: "asc" } });
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Cadastro de requerente</h1>
      <p className="mb-4 text-sm text-slate-600">Crie sua conta para solicitar licenças ambientais e acompanhar seus processos.</p>
      <FormCadastro municipios={municipios} />
      <p className="mt-4 text-center text-sm text-slate-600">Já tem conta? <Link href="/login" className="font-medium text-primaria-700 hover:underline">Entrar</Link></p>
    </>
  );
}
