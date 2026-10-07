import type { Metadata } from "next";

export const dynamic = "force-dynamic";
// Página PÚBLICA de documentos compartilhados: nunca indexada, sem Referer (o token está na URL) e sem cache.
export const metadata: Metadata = { title: "Documentos compartilhados", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function LayoutCompartilhado({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
