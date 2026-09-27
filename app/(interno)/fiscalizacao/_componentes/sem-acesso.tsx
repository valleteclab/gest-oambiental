import Link from "next/link";

/** Página de acesso negado (403) – registro fora do escopo do usuário. */
export function SemAcesso({ mensagem = "Você não tem acesso a este registro." }: { mensagem?: string }) {
  return (
    <div className="card mx-auto max-w-lg p-8 text-center" data-testid="acesso-negado">
      <p className="text-4xl font-bold text-red-700">403</p>
      <h1 className="mt-2 text-lg font-semibold">Acesso negado</h1>
      <p className="mt-1 text-sm text-slate-600">{mensagem}</p>
      <Link href="/fiscalizacao" className="btn-secundario mt-6">Voltar à fiscalização</Link>
    </div>
  );
}
