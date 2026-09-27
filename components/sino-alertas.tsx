import Link from "next/link";
import { Bell } from "lucide-react";
import { prisma } from "@/lib/db";

// Sino do cabeçalho interno: contagem de alertas não lidos do usuário (T3). Clique abre /alertas.
export async function SinoAlertas({ usuarioId }: { usuarioId: string }) {
  const n = await prisma.alerta.count({ where: { usuario_id: usuarioId, lido: false } });
  const vencidos = n > 0 ? await prisma.alerta.count({ where: { usuario_id: usuarioId, lido: false, tipo: { in: ["PRAZO_VENCIDO", "PENDENCIA_VENCIDA"] } } }) : 0;
  return (
    <Link
      href="/alertas"
      className="relative inline-flex rounded-full p-2 text-slate-700 hover:bg-slate-100"
      aria-label={`Alertas: ${n} não lido(s)${vencidos ? `, ${vencidos} de prazo vencido` : ""}`}
      title={n ? `${n} alerta(s) não lido(s)` : "Sem alertas novos"}
      data-testid="sino-alertas"
    >
      <Bell className="h-5 w-5" aria-hidden />
      {n > 0 && (
        <span className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-red-600 px-1 text-center text-xs font-bold text-white" data-testid="sino-contador" data-valor={n}>
          {n > 99 ? "99+" : n}
        </span>
      )}
    </Link>
  );
}
