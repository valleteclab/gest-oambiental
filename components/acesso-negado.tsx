import Link from "next/link";
import { ShieldAlert } from "lucide-react";

/**
 * Tela 403 reutilizável (SPEC 4.1 / T7): registro fora do escopo do usuário ou perfil sem permissão.
 * Uso em página: `if (!podeVerMunicipio(u, x.municipio_id)) return <AcessoNegado />;`
 */
export function AcessoNegado({ mensagem, voltar = "/dashboard" }: { mensagem?: string; voltar?: string }) {
  return (
    <section role="alert" aria-labelledby="titulo-403" data-testid="acesso-negado" className="mx-auto mt-10 max-w-lg rounded-lg border border-red-200 bg-white p-6 text-center shadow-sm">
      <ShieldAlert className="mx-auto h-10 w-10 text-red-700" aria-hidden />
      <p className="mt-2 text-sm font-semibold uppercase tracking-wide text-red-700">Erro 403</p>
      <h1 id="titulo-403" className="mt-1 text-xl font-semibold text-slate-900">Acesso negado</h1>
      <p className="mt-2 text-sm text-slate-600">{mensagem ?? "Você não tem permissão para acessar este registro. Ele pertence a um município fora do seu escopo ou exige outro perfil."}</p>
      <Link href={voltar} className="btn-secundario mt-4">Voltar</Link>
    </section>
  );
}
