import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { fmtDataHora } from "@/lib/format";
import { CabecalhoPagina } from "@/components/ui";
import { ehUuid } from "@/lib/fiscalizacao/api";
import { SemAcesso } from "../../_componentes/sem-acesso";
import { fiscalizacaoParaForm } from "../../_componentes/ficha-emissao";
import { FormNotificacao } from "./form-notificacao";

export const metadata = { title: "Notificação – LicenciaGov" };

export default async function NovaNotificacao({ params }: { params: Promise<{ id: string }> }) {
  const u = await exigirUsuario({ interno: true });
  const { id } = await params;
  if (!ehUuid(id)) notFound();
  const r = await fiscalizacaoParaForm(u, id);
  if (r.status === 404) notFound();
  if (r.status === 403) return <SemAcesso mensagem="Seu perfil não pode emitir notificações neste município." />;
  const { f } = r;
  return (
    <div className="mx-auto max-w-3xl">
      <CabecalhoPagina titulo="Gerar Notificação" subtitulo={`Vistoria de ${fmtDataHora(f.data_hora)} · ${f.municipio.nome}${f.empreendimento ? ` · ${f.empreendimento.nome}` : ""}`} acoes={<Link href={`/fiscalizacao/${f.id}`} className="btn-secundario btn-sm">Voltar</Link>} />
      <FormNotificacao fiscalizacaoId={f.id} sugestao={f.empreendimento?.requerente ?? null} />
    </div>
  );
}
