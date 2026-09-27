"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Recarrega a página periodicamente enquanto houver exportação em andamento. */
export function AtualizarEnquanto({ ativo, ms = 3000 }: { ativo: boolean; ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!ativo) return;
    const t = setInterval(() => router.refresh(), ms);
    return () => clearInterval(t);
  }, [ativo, ms, router]);
  return ativo ? <p className="text-xs text-slate-500" aria-live="polite">Exportação em andamento – esta página atualiza sozinha.</p> : null;
}
