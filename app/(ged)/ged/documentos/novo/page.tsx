import { forbidden } from "next/navigation";
import { Aviso, CabecalhoPagina, Card } from "@/components/ui";
import { UploadDocumento } from "@/components/ged/upload-documento";
import { exigirGed } from "@/lib/ged/escopo";
import { listarMarcadores } from "@/lib/ged/marcadores";
import { podeCriarDocumento } from "@/lib/ged/papeis";
import { pastasParaSeletor } from "@/lib/ged/pastas";
import { listarTiposDocumento } from "@/lib/ged/tipos-documento";

export const dynamic = "force-dynamic";
export const metadata = { title: "Novo documento – Gestão de Documentos" };

export default async function PaginaNovoDocumento({ searchParams }: { searchParams: Promise<{ pasta?: string }> }) {
  const ctx = await exigirGed();
  if (!podeCriarDocumento(ctx)) forbidden();
  const { pasta } = await searchParams;
  const [tipos, pastas, marcadores] = await Promise.all([listarTiposDocumento(ctx), pastasParaSeletor(ctx), listarMarcadores(ctx)]);
  return (
    <>
      <CabecalhoPagina titulo="Novo documento" subtitulo="Envie um PDF ou crie o documento no editor de texto." />
      <Card className="max-w-3xl">
        {pastas.length === 0 && ctx.membro.papel !== "GED_ADMIN" && (
          <div className="mb-4"><Aviso tipo="info">Você não tem permissão de edição em nenhuma pasta. O documento ficará sem pasta, visível só a você e a quem receber permissão.</Aviso></div>
        )}
        <UploadDocumento tipos={tipos} pastas={pastas} marcadores={marcadores} pastaInicial={pasta ?? null} />
      </Card>
    </>
  );
}
