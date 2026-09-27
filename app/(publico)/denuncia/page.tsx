import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { FormDenuncia } from "./form";

export const metadata: Metadata = { title: "Denúncia ambiental – LicenciaGov" };
export const dynamic = "force-dynamic";

export default async function PaginaDenuncia() {
  const municipios = await prisma.municipio.findMany({ where: { ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true, latitude: true, longitude: true } });
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="titulo-pagina">Denúncia ambiental</h1>
      <p className="mt-1 text-sm text-slate-600">
        Informe desmatamento, poluição, descarte irregular de resíduos, obras sem licença ou outra irregularidade ambiental. A denúncia pode ser anônima.
        Você receberá um número de protocolo para acompanhamento.
      </p>
      <div className="mt-6">
        <FormDenuncia municipios={municipios.map((m) => ({ id: m.id, nome: m.nome, lat: m.latitude ? Number(m.latitude) : null, lng: m.longitude ? Number(m.longitude) : null }))} />
      </div>
    </div>
  );
}
