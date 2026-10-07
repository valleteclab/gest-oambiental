import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { ContextoOrgao } from "@/components/contexto-orgao";
import { EscolhaDenuncia } from "./escolha";

export const metadata: Metadata = { title: "Denúncia ambiental – LicenciaGov" };
export const dynamic = "force-dynamic";

export default async function PaginaDenuncia({ searchParams }: { searchParams: Promise<{ municipio?: string; orgao?: string }> }) {
  const sp = await searchParams;
  const sigla = (sp.municipio ?? sp.orgao ?? "").trim().toUpperCase();
  const [municipios, chatsInativos] = await Promise.all([
    prisma.municipio.findMany({ where: { ativo: true, organizacao: { status: "ATIVO", modulos: { has: "LICENCIAMENTO" } } }, orderBy: { nome: "asc" }, select: { id: true, sigla: true, nome: true, latitude: true, longitude: true } }),
    prisma.canalAtendimento.findMany({ where: { tipo: "WEBCHAT", ativo: false }, select: { municipio_id: true } }),
  ]);
  const semChat = new Set(chatsInativos.map((c) => c.municipio_id));
  const inicial = municipios.find((m) => m.sigla === sigla)?.id ?? "";
  return (
    <div className="mx-auto max-w-3xl">
      {inicial && <ContextoOrgao sigla={sigla} />}
      <h1 className="titulo-pagina">Denúncia ambiental</h1>
      <p className="mt-1 text-sm text-slate-600">
        Informe desmatamento, poluição, descarte irregular de resíduos, obras sem licença ou outra irregularidade ambiental. A denúncia pode ser anônima.
        Converse com o Assistente Ambiental ou, se preferir, preencha o formulário. Você receberá um número de protocolo para acompanhamento
        (<a href="/denuncia/acompanhar" className="underline">acompanhar denúncia</a>).
      </p>
      <div className="mt-6">
        <EscolhaDenuncia
          municipioInicial={inicial}
          municipios={municipios.map((m) => ({ id: m.id, sigla: m.sigla, nome: m.nome, lat: m.latitude ? Number(m.latitude) : null, lng: m.longitude ? Number(m.longitude) : null, chat: !semChat.has(m.id) }))}
        />
      </div>
    </div>
  );
}
