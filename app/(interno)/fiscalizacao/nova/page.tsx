import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { podeVerMunicipio } from "@/lib/rbac";
import { CabecalhoPagina } from "@/components/ui";
import { equipeDisponivel, municipiosDoUsuario } from "@/lib/fiscalizacao/servico";
import { podeRegistrarVistoria } from "@/lib/fiscalizacao/regras";
import { ehUuid } from "@/lib/fiscalizacao/api";
import { SemAcesso } from "../_componentes/sem-acesso";
import { sp1, type SP } from "../_componentes/util";
import { FormVistoria, type ContextoVistoria } from "./form-vistoria";

export const metadata = { title: "Nova vistoria – LicenciaGov" };

const n = (v: { toString(): string } | null | undefined) => (v == null ? null : Number(v.toString()));
const selEmp = { id: true, nome: true, municipio_id: true, latitude: true, longitude: true } as const;
const emp = (e: { id: string; nome: string; municipio_id: string; latitude: unknown; longitude: unknown }) => ({ ...e, latitude: n(e.latitude as never), longitude: n(e.longitude as never) });

export default async function NovaVistoria({ searchParams }: { searchParams: SP }) {
  const u = await exigirUsuario({ interno: true });
  if (!podeRegistrarVistoria(u)) return <SemAcesso mensagem="Seu perfil não pode registrar vistorias." />;
  const s = await searchParams;
  const [denunciaId, processoId, empreendimentoId] = [sp1(s.denuncia), sp1(s.processo), sp1(s.empreendimento)].map((v) => (v && ehUuid(v) ? v : null));

  const contexto: ContextoVistoria = {};
  if (denunciaId) {
    const d = await prisma.denuncia.findUnique({ where: { id: denunciaId }, select: { id: true, protocolo: true, descricao: true, endereco: true, latitude: true, longitude: true, municipio_id: true } });
    if (d) contexto.denuncia = { ...d, latitude: n(d.latitude), longitude: n(d.longitude) };
  }
  if (processoId) {
    const p = await prisma.processo.findUnique({ where: { id: processoId }, select: { id: true, numero: true, status: true, municipio_id: true, empreendimento: { select: selEmp } } });
    if (p) contexto.processo = { ...p, empreendimento: emp(p.empreendimento) };
  }
  if (empreendimentoId && !contexto.processo) {
    const e = await prisma.empreendimento.findUnique({ where: { id: empreendimentoId }, select: selEmp });
    if (e) contexto.empreendimento = emp(e);
  }
  const municipioCtx = contexto.denuncia?.municipio_id ?? contexto.processo?.municipio_id ?? contexto.empreendimento?.municipio_id;
  if (municipioCtx && (!podeVerMunicipio(u, municipioCtx) || !podeRegistrarVistoria(u, municipioCtx))) return <SemAcesso />;

  const municipios = (await municipiosDoUsuario(u)).filter((m) => podeRegistrarVistoria(u, m.id));
  const equipePorMunicipio: Record<string, { id: string; nome: string; cargo: string | null }[]> = {};
  await Promise.all(municipios.map(async (m) => (equipePorMunicipio[m.id] = await equipeDisponivel(m.id))));

  const voltar = contexto.denuncia ? `/fiscalizacao/denuncias/${contexto.denuncia.id}` : contexto.processo ? `/processos/${contexto.processo.id}` : "/fiscalizacao";
  return (
    <div className="mx-auto max-w-2xl">
      <CabecalhoPagina titulo="Registrar vistoria" subtitulo={contexto.denuncia ? "Apuração de denúncia" : contexto.processo ? "Vistoria de processo de licenciamento" : "Fiscalização de rotina"} acoes={<Link href={voltar} className="btn-secundario btn-sm">Cancelar</Link>} />
      <FormVistoria usuario={{ id: u.id, nome: u.nome }} municipios={municipios} equipePorMunicipio={equipePorMunicipio} contexto={contexto} />
    </div>
  );
}
