"use client";
// Recarrega os dados da página (router.refresh) enquanto `ativo`, para acompanhar o lote de importação.
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function AutoAtualizar({ ativo, intervaloMs = 3000 }: { ativo: boolean; intervaloMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!ativo) return;
    const t = setInterval(() => router.refresh(), intervaloMs);
    return () => clearInterval(t);
  }, [ativo, intervaloMs, router]);
  return null;
}
