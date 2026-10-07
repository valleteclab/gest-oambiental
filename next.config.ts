import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Permite rodar vários `next dev` em paralelo no mesmo checkout (NEXT_DIST_DIR=.next-xyz)
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["@node-rs/argon2", "puppeteer-core", "exceljs", "pg-boss", "archiver", "nodemailer"],
  experimental: { serverActions: { bodySizeLimit: "30mb" }, authInterrupts: true },
  async headers() {
    // GED (docs/ged-design.md §1.3): nada de documento do cliente em cache compartilhado ou indexado por buscadores.
    const semCacheGed = [
      { key: "Cache-Control", value: "private, no-store" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ];
    // Páginas PÚBLICAS do protocolo (acesso liberado, sem login): nunca em cache compartilhado nem indexadas; o código de consulta
    // pode estar na URL, então também sem Referer. Estas regras vêm DEPOIS da regra geral para vencer o Referrer-Policy dela.
    const publicoSemRastro = [
      { key: "Cache-Control", value: "no-store" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
      { key: "Referrer-Policy", value: "no-referrer" },
    ];
    return [
      { source: "/ged/:path*", headers: semCacheGed },
      { source: "/api/v1/ged/:path*", headers: semCacheGed },
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "geolocation=(self), camera=(self)" },
        ],
      },
      { source: "/protocolo/:path*", headers: publicoSemRastro },
      { source: "/verificar/protocolo/:path*", headers: publicoSemRastro },
      { source: "/api/v1/publico/:path*", headers: publicoSemRastro },
    ];
  },
};

export default nextConfig;
