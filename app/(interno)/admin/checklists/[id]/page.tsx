import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { usuarioAdminPagina } from "@/lib/admin/guard";
import { whereOrganizacao } from "@/lib/rbac";
import { AcessoNegado } from "@/components/acesso-negado";
import { CabecalhoPagina, Card } from "@/components/ui";
import { EditorChecklist } from "./editor";

export const metadata = { title: "Checklist – Administração" };

type Item = { id: string; texto: string; tipo: "SIM_NAO" | "TEXTO" | "NUMERO"; obrigatorio: boolean };

export default async function EditarChecklist({ params }: { params: Promise<{ id: string }> }) {
  const { u: admin, ok } = await usuarioAdminPagina();
  if (!ok) return <AcessoNegado />;
  const { id } = await params;
  const novo = id === "novo";
  const c = novo ? null : await prisma.checklistModelo.findFirst({ where: { id, ...whereOrganizacao(admin) } }).catch(() => null);
  if (!novo && !c) notFound();
  const itens = (Array.isArray(c?.itens) ? c!.itens : []) as unknown as Item[];
  return (
    <>
      <CabecalhoPagina titulo={c?.nome ?? "Novo checklist"} subtitulo={<Link href="/admin/checklists" className="underline">Checklists</Link>} />
      <Card><EditorChecklist id={c?.id} nome={c?.nome} itens={itens} /></Card>
    </>
  );
}
