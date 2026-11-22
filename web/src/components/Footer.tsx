import Link from "next/link";
import { ShieldAlert, Lock, FileText } from "lucide-react";

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-slate-200 bg-slate-900 text-slate-300">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid gap-8 md:grid-cols-3">
          <div>
            <div className="flex items-center gap-2.5 text-white">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-700 text-white">
                <ShieldAlert className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <p className="font-bold leading-tight">
                  Asociación Bello Horizonte
                </p>
                <p className="text-xs text-slate-400">
                  Red Vecinal de Alerta Temprana · Perú
                </p>
              </div>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              Herramienta comunitaria de coordinación vecinal. La alarma
              comunitaria complementa, pero no sustituye, a la Policía Nacional
              del Perú (105), Serenazgo ni servicios de emergencia.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-white">
              Enlaces Institucionales
            </h3>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link
                  href="/#emergencias"
                  className="transition hover:text-white"
                >
                  Números de Emergencia (105 / 116 / 106)
                </Link>
              </li>
              <li>
                <Link
                  href="/#comunicados"
                  className="transition hover:text-white"
                >
                  Tablón de Comunicados
                </Link>
              </li>
              <li>
                <Link
                  href="/#app-android"
                  className="transition hover:text-white"
                >
                  Guía de Instalación App Android
                </Link>
              </li>
              <li>
                <Link
                  href="/#directiva"
                  className="transition hover:text-white"
                >
                  Directiva Vecinal
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-white">
              Legal y Administración
            </h3>
            <ul className="mt-3 space-y-2.5 text-sm">
              <li>
                <Link
                  href="/privacidad"
                  className="inline-flex items-center gap-2 transition hover:text-white"
                >
                  <FileText className="h-4 w-4 text-brand-400" aria-hidden="true" />
                  Política de Privacidad y Eliminación de Cuenta (Ley 29733)
                </Link>
              </li>
              <li>
                <Link
                  href="/admin"
                  className="inline-flex items-center gap-2 transition hover:text-white"
                >
                  <Lock className="h-4 w-4 text-brand-400" aria-hidden="true" />
                  Consola Administrativa (Directiva)
                </Link>
              </li>
              <li>
                <Link
                  href="/login"
                  className="inline-flex items-center gap-2 transition hover:text-white"
                >
                  Acceso de Socios / Iniciar Sesión
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 border-t border-slate-800 pt-6 text-xs text-slate-500 sm:flex sm:items-center sm:justify-between">
          <p>
            © {year} Asociación Bello Horizonte. Todos los derechos reservados.
          </p>
          <p className="mt-2 sm:mt-0">
            Cumplimiento de la Ley N.° 29733 — Protección de Datos Personales
            (Perú).
          </p>
        </div>
      </div>
    </footer>
  );
}
