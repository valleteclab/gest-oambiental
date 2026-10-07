import Link from "next/link";
import { conviteDoToken } from "@/lib/plataforma/convite";
import { FormDefinirSenha } from "./form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Definir senha", robots: { index: false, follow: false } };

export default async function DefinirSenha({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const c = await conviteDoToken(token);
  if (!c) {
    return (
      <>
        <h1 className="mb-2 text-xl font-semibold">Link indisponível</h1>
        <p className="text-sm text-slate-600">Este link é inválido, expirou ou já foi usado. Peça um novo convite ao administrador da plataforma.</p>
        <Link href="/login" className="btn-secundario mt-4 inline-block">Ir para o login</Link>
      </>
    );
  }
  return <FormDefinirSenha token={token} nome={c.usuario.nome} />;
}
