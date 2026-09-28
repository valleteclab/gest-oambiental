import Link from "next/link";
import { can, temPapel, type UsuarioSessao } from "@/lib/rbac";

type Item = { href: string; rotulo: string; visivel: (u: UsuarioSessao) => boolean };

// Menu único do painel interno. Novos módulos: adicionar aqui.
export const ITENS_MENU: Item[] = [
  { href: "/dashboard", rotulo: "Painel", visivel: (u) => can(u, "ver", "dashboard") },
  { href: "/caixa", rotulo: "Caixa de entrada", visivel: (u) => temPapel(u, "TEC_CONSORCIO", "TEC_MUNICIPAL", "GESTOR_MUNICIPAL", "ADMIN") },
  { href: "/processos", rotulo: "Processos", visivel: (u) => can(u, "ver", "processo") },
  { href: "/prazos", rotulo: "Prazos", visivel: (u) => can(u, "ver", "processo") },
  { href: "/demandas", rotulo: "Demandas urbanas", visivel: (u) => can(u, "ver", "processo") },
  { href: "/empreendimentos", rotulo: "Empreendimentos", visivel: (u) => can(u, "ver", "empreendimento") },
  { href: "/pessoas", rotulo: "Pessoas", visivel: (u) => can(u, "ver", "pessoa") },
  { href: "/responsaveis-tecnicos", rotulo: "Responsáveis técnicos", visivel: (u) => can(u, "ver", "pessoa") },
  { href: "/fiscalizacao", rotulo: "Fiscalização", visivel: (u) => can(u, "ver", "fiscalizacao") },
  { href: "/fiscalizacao/denuncias", rotulo: "Denúncias", visivel: (u) => can(u, "ver", "denuncia") },
  { href: "/fiscalizacao/mapa", rotulo: "Mapa", visivel: (u) => can(u, "ver", "fiscalizacao") },
  { href: "/monitoramento", rotulo: "Monitoramento", visivel: (u) => can(u, "ver", "fiscalizacao") },
  { href: "/atendimento", rotulo: "Atendimento", visivel: (u) => can(u, "ver", "denuncia") },
  { href: "/documentos", rotulo: "Documentos emitidos", visivel: (u) => can(u, "ver", "documento") },
  { href: "/relatorios", rotulo: "Relatórios", visivel: (u) => can(u, "ver", "relatorio") },
  { href: "/admin", rotulo: "Administração", visivel: (u) => can(u, "ver", "admin") || can(u, "exportar", "exportacao") },
];

export function NavInterno({ usuario }: { usuario: UsuarioSessao }) {
  return (
    <nav aria-label="Menu principal" className="flex flex-col gap-0.5">
      {ITENS_MENU.filter((i) => i.visivel(usuario)).map((i) => (
        <Link key={i.href} href={i.href} className="rounded-md px-3 py-2 text-sm text-slate-200 hover:bg-primaria-700 hover:text-white focus-visible:outline-2 focus-visible:outline-white">
          {i.rotulo}
        </Link>
      ))}
    </nav>
  );
}
