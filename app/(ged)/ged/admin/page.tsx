import Link from "next/link";
import { CabecalhoPagina, Card } from "@/components/ui";
import { exigirGed } from "@/lib/ged/escopo";
import { podeAdministrarGed, podeGerirEstruturaGed } from "@/lib/ged/papeis";
import { forbidden } from "next/navigation";

export const dynamic = "force-dynamic";

// Índice provisório da administração (frente A). A frente E pode substituí-lo mantendo o link para /ged/admin/setores.
export default async function AdminGed() {
  const ctx = await exigirGed();
  if (!podeGerirEstruturaGed(ctx)) forbidden();
  const itens = [
    { href: "/ged/admin/setores", rotulo: "Setores", texto: "Setores e seus participantes (base das permissões e do trâmite).", mostrar: true },
    { href: "/ged/admin/membros", rotulo: "Membros", texto: "Usuários do módulo e seus papéis.", mostrar: podeAdministrarGed(ctx) },
    { href: "/ged/admin/marcadores", rotulo: "Marcadores", texto: "Marcadores coloridos para classificar documentos.", mostrar: true },
    { href: "/ged/admin/exportacao", rotulo: "Exportação", texto: "Exportação completa dos dados da organização.", mostrar: podeAdministrarGed(ctx) },
  ].filter((i) => i.mostrar);
  return (
    <>
      <CabecalhoPagina titulo="Administração" />
      <Card>
        <ul className="grid gap-3 sm:grid-cols-2">
          {itens.map((i) => (
            <li key={i.href}>
              <Link href={i.href} prefetch={false} className="block h-full rounded-md border border-slate-200 p-3 hover:border-primaria-600 hover:bg-primaria-50">
                <span className="font-medium text-primaria-800">{i.rotulo}</span>
                <span className="mt-1 block text-sm text-slate-600">{i.texto}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
