import Link from "next/link";
import { Aviso } from "@/components/ui";

/** Tela 403 – acesso por URL a registro fora do escopo (SPEC 4.1 / T7). */
export function Proibido({ voltar = "/processos", mensagem }: { voltar?: string; mensagem?: string }) {
  return (
    <div className="mx-auto max-w-xl py-10" data-testid="acesso-negado">
      <p className="text-sm font-semibold text-red-700">Erro 403</p>
      <h1 className="titulo-pagina mb-4">Acesso negado</h1>
      <Aviso tipo="erro">{mensagem ?? "Você não tem permissão para acessar este processo. Ele pertence a um município fora do seu escopo de atuação."}</Aviso>
      <Link href={voltar} className="btn-secundario mt-6">Voltar</Link>
    </div>
  );
}
