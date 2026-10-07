import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { fmtDataHora } from "@/lib/format";
import { CabecalhoPagina } from "@/components/ui";
import { ehUuid } from "@/lib/fiscalizacao/api";
import { SemAcesso } from "../../_componentes/sem-acesso";
import { fiscalizacaoParaForm } from "../../_componentes/ficha-emissao";
import { FormAuto } from "./form-auto";

export const metadata = { title: "Auto de infração – LicenciaGov" };

export default async function NovoAuto({ params }: { params: Promise<{ id: string }> }) {
  const u = await exigirUsuario({ interno: true });
  const { id } = await params;
  if (!ehUuid(id)) notFound();
  const r = await fiscalizacaoParaForm(u, id);
  if (r.status === 404) notFound();
  if (r.status === 403) return <SemAcesso mensagem="Seu perfil não pode lavrar autos de infração neste município." />;
  const { f } = r;
  return (
    <div className="mx-auto max-w-3xl">
      <CabecalhoPagina titulo="Gerar Auto de Infração" subtitulo={`Vistoria de ${fmtDataHora(f.data_hora)} · ${f.municipio.nome}${f.empreendimento ? ` · ${f.empreendimento.nome}` : ""}`} acoes={<Link href={`/fiscalizacao/${f.id}`} className="btn-secundario btn-sm">Voltar</Link>} />
      <FormAuto fiscalizacaoId={f.id} sugestao={f.empreendimento?.requerente ?? null} relato={f.relato ?? ""} />
    </div>
  );
}
