import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ECORSE AFRIC BTP Manager 360", template: "%s · ECORSE AFRIC BTP Manager 360" },
  description: "Gestion intégrée des chantiers, parties prenantes et opérations d'ECORSE AFRIC.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0b264f" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
