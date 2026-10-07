import Link from "next/link";
import { Leaf } from "lucide-react";
import { FaixaDemo } from "@/components/orgao";

export default function LayoutAuth({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-primaria-800 to-primaria-600">
      <FaixaDemo />
      <div className="flex flex-1 flex-col items-center justify-center p-4">
        <Link href="/" className="mb-6 flex items-center gap-2 text-2xl font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/15" aria-hidden><Leaf className="h-5 w-5" /></span>
          LicenciaGov
        </Link>
        <main id="conteudo" className="card w-full max-w-md p-6">{children}</main>
        <p className="mt-6 text-center text-xs text-emerald-100">Plataforma de licenciamento e fiscalização ambiental</p>
      </div>
    </div>
  );
}
