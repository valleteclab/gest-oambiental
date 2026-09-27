import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { storageSaudavel } from "@/lib/storage";

export const dynamic = "force-dynamic";

// Monitor externo a cada 1 min (SPEC 9.1): checa banco e storage.
export async function GET() {
  const inicio = Date.now();
  const db = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
  const storage = await storageSaudavel();
  const ok = db && storage;
  return NextResponse.json({ status: ok ? "ok" : "degradado", db, storage, latencia_ms: Date.now() - inicio, em: new Date().toISOString() }, { status: ok ? 200 : 503 });
}
