import Link from "next/link";
import { listarOrgaos, ultimoOrgaoEscolhido } from "@/lib/auth";
import { FormLogin } from "./form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Entrar" };

export default async function PaginaLogin({ searchParams }: { searchParams: Promise<{ next?: string; orgao?: string }> }) {
  const { next, orgao } = await searchParams;
  const [orgaos, ultimo] = await Promise.all([listarOrgaos(), ultimoOrgaoEscolhido()]);
  const siglas = new Set(orgaos.map((o) => o.sigla));
  const pedido = orgao?.trim().toUpperCase();
  const inicial = pedido && siglas.has(pedido) ? pedido : ultimo && siglas.has(ultimo) ? ultimo : orgaos.length === 1 ? orgaos[0].sigla : "";
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Entrar</h1>
      <p className="mb-4 text-sm text-slate-600">Escolha o órgão ambiental e informe suas credenciais.</p>
      <FormLogin next={next} orgaoInicial={inicial} orgaos={orgaos.map((o) => ({ sigla: o.sigla, rotulo: `${o.nome} – ${o.orgao_ambiental_nome}` }))} />
      <p className="mt-4 text-center text-sm text-slate-600">
        Requerente sem conta? <Link href="/cadastro" className="font-medium text-primaria-700 hover:underline">Cadastre-se</Link>
      </p>
    </>
  );
}
