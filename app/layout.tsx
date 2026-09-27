import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "LicenciaGov", template: "%s · LicenciaGov" },
  description: "Sistema de Gestão de Licenciamento e Fiscalização Ambiental",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#065f46" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
