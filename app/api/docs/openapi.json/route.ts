import { NextResponse } from "next/server";
import { documentoOpenApi } from "@/lib/openapi";

export const dynamic = "force-static";

// OpenAPI 3.1 da API /api/v1 (SPEC 12)
export function GET() {
  return NextResponse.json(documentoOpenApi(), {
    headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" },
  });
}
