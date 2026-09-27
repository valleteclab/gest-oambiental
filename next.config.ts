import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Permite rodar vários `next dev` em paralelo no mesmo checkout (NEXT_DIST_DIR=.next-xyz)
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["@node-rs/argon2", "puppeteer-core", "exceljs", "pg-boss", "archiver", "nodemailer"],
  experimental: { serverActions: { bodySizeLimit: "30mb" }, authInterrupts: true },
  async headers() {
    return [
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
    ];
  },
};

export default nextConfig;
