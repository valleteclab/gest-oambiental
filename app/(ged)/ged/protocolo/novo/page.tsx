import { forbidden } from "next/navigation";
import { CabecalhoPagina, Card } from "@/components/ui";
import { FormNovoProtocolo } from "@/components/ged/protocolo/form-novo";
import { exigirGed } from "@/lib/ged/escopo";
import { podeRegistrarProtocolo } from "@/lib/ged/protocolo/regras";
import { opcoesProtocolo } from "@/lib/ged/protocolo/servico";

export const dynamic = "force-dynamic";
export const metadata = { title: "Novo protocolo – Gestão de Documentos" };

export default async function PaginaNovoProtocolo({ searchParams }: { searchParams: Promise<{ livro?: string }> }) {
  const ctx = await exigirGed();
  if (!podeRegistrarProtocolo(ctx.membro.papel)) forbidden();
  const { livro } = await searchParams;
  const opcoes = await opcoesProtocolo(ctx);
  return (
    <>
      <CabecalhoPagina titulo="Novo protocolo" subtitulo="Registre uma entrada no balcão, uma saída ou um documento interno. O número e o comprovante são gerados ao registrar." />
      <Card className="max-w-3xl">
        <FormNovoProtocolo opcoes={opcoes} livroInicial={livro === "SAIDA" || livro === "INTERNO" ? livro : "ENTRADA"} />
      </Card>
    </>
  );
}
