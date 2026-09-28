import Link from "next/link";
import { listarOrgaos, ultimoOrgaoEscolhido } from "@/lib/auth";
import { ContextoOrgao } from "@/components/contexto-orgao";
import { FormLogin } from "./form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Entrar" };

export default async function PaginaLogin({ searchParams }: { searchParams: Promise<{ next?: string; orgao?: string }> }) {
  const { next, orgao } = await searchParams;
  const [orgaos, ultimo] = await Promise.all([listarOrgaos(), ultimoOrgaoEscolhido()]);
  const siglas = new Set(orgaos.map((o) => o.sigla));
  const pedido = orgao?.trim().toUpperCase();
  const inicial = pedido && siglas.has(pedido) ? pedido : ultimo && siglas.has(ultimo) ? ultimo : orgaos.length === 1 ? orgaos[0].sigla : "";
  // Lista pública (pré-login) agrupada por organização/cliente; a permissão é validada ao entrar.
  return (
    <>
      {pedido && siglas.has(pedido) && <ContextoOrgao sigla={pedido} />}
      <h1 className="mb-1 text-xl font-semibold">Entrar</h1>
      <p className="mb-4 text-sm text-slate-600">Informe suas credenciais. O órgão pode ser escolhido agora ou depois de entrar (aparecem só os órgãos do seu usuário).</p>
      <FormLogin
        next={next}
        orgaoInicial={inicial}
        orgaos={orgaos.map((o) => ({ sigla: o.sigla, rotulo: `${o.nome} – ${o.orgao_ambiental_nome}`, grupo: o.organizacao.nome }))}
      />
      <p className="mt-4 text-center text-sm text-slate-600">
        Requerente sem conta? <Link href="/cadastro" className="font-medium text-primaria-700 hover:underline">Cadastre-se</Link>
      </p>
    </>
  );
}
