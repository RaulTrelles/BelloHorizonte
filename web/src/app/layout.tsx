import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Asociación Bello Horizonte — Portal Vecinal y Alarma Comunitaria",
    template: "%s | Asociación Bello Horizonte",
  },
  description:
    "Portal institucional de la Asociación Bello Horizonte (Perú). Comunicados oficiales, teléfonos de emergencia (PNP 105, Serenazgo, Bomberos 116, SAMU 106), guía de la App Android de Alarma Vecinal y Política de Privacidad Ley 29733.",
  keywords: [
    "Asociación Bello Horizonte",
    "Alarma Vecinal",
    "Seguridad Ciudadana Perú",
    "PNP 105",
    "Serenazgo",
    "Ley 29733",
  ],
  openGraph: {
    title: "Asociación Bello Horizonte — Portal Vecinal y Alarma Comunitaria",
    description:
      "Información institucional, comunicados oficiales, números de emergencia y guía de la App Android de Alarma Vecinal.",
    locale: "es_PE",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es-PE">
      <body className={`${inter.className} flex min-h-screen flex-col`}>
        <Navbar />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
