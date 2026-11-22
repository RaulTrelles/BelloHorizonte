import type { Metadata } from "next";
import { AdminDashboard } from "@/components/admin/AdminDashboard";

export const metadata: Metadata = {
  title: "Consola Administrativa",
  description:
    "Panel de administración de la Asociación Bello Horizonte: gestión de miembros, monitoreo en vivo de alertas de pánico y comunicados oficiales.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminPage() {
  return <AdminDashboard />;
}
