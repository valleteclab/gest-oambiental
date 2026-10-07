import { operadorDaPagina } from "@/lib/plataforma/operador";
import { CabecalhoPagina, Card } from "@/components/ui";
import { FormNovoCliente, FormReautenticar } from "../_comp/forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Novo cliente – Plataforma", robots: { index: false, follow: false } };

export default async function NovoCliente() {
  const { reautenticado } = await operadorDaPagina();
  if (!reautenticado) return <Card titulo="Confirme sua senha"><FormReautenticar /></Card>;
  return (
    <>
      <CabecalhoPagina titulo="Novo cliente" subtitulo="Cria a organização, os módulos contratados e o administrador inicial. Tudo ou nada: se algo falhar, nada é criado." />
      <Card><FormNovoCliente /></Card>
    </>
  );
}
