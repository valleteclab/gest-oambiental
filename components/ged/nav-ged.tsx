import type { CtxGed } from "@/lib/ged/escopo";
import { podeGerirEstruturaGed, podeVerLogs } from "@/lib/ged/papeis";
import { NavGedLinks } from "./nav-ged-links";

type ItemMenu = { href: string; rotulo: string; visivel: (ctx: CtxGed) => boolean };

/** Itens do menu. Rotas de outras frentes podem responder 404 até serem implementadas. */
export const ITENS_NAV_GED: ItemMenu[] = [
  { href: "/ged", rotulo: "Início", visivel: () => true },
  { href: "/ged/documentos", rotulo: "Documentos", visivel: () => true },
  { href: "/ged/pastas", rotulo: "Pastas", visivel: () => true },
  { href: "/ged/assinaturas", rotulo: "Assinaturas", visivel: () => true },
  { href: "/ged/tramite", rotulo: "Trâmite", visivel: () => true },
  { href: "/ged/logs", rotulo: "Logs", visivel: (ctx) => podeVerLogs(ctx) },
  { href: "/ged/admin", rotulo: "Administração", visivel: (ctx) => podeGerirEstruturaGed(ctx) },
];

export const itensNavGed = (ctx: CtxGed) => ITENS_NAV_GED.filter((i) => i.visivel(ctx)).map(({ href, rotulo }) => ({ href, rotulo }));

export function NavGed({ ctx }: { ctx: CtxGed }) {
  return (
    <nav aria-label="Menu da Gestão de Documentos">
      <NavGedLinks itens={itensNavGed(ctx)} />
    </nav>
  );
}
