import Link from "next/link";

export default function LayoutAuth({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-primaria-800 to-primaria-600 p-4">
      <Link href="/" className="mb-6 text-2xl font-bold text-white">LicenciaGov</Link>
      <main id="conteudo" className="card w-full max-w-md p-6">{children}</main>
    </div>
  );
}
