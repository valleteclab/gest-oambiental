import Link from "next/link";
import { FormLogin } from "./form";

export const metadata = { title: "Entrar" };

export default async function PaginaLogin({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Entrar</h1>
      <FormLogin next={next} />
      <p className="mt-4 text-center text-sm text-slate-600">
        Requerente sem conta? <Link href="/cadastro" className="font-medium text-primaria-700 hover:underline">Cadastre-se</Link>
      </p>
    </>
  );
}
