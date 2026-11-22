"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, ShieldAlert, X, Lock } from "lucide-react";

const NAV_LINKS = [
  { href: "/", label: "Inicio" },
  { href: "/#emergencias", label: "Emergencias" },
  { href: "/#comunicados", label: "Comunicados" },
  { href: "/#app-android", label: "App Android" },
  { href: "/privacidad", label: "Privacidad" },
];

export function Navbar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-brand-900 transition hover:opacity-90"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-800 text-white shadow-sm">
            <ShieldAlert className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="leading-tight">
            <span className="block text-sm font-bold tracking-tight sm:text-base">
              Asociación Bello Horizonte
            </span>
            <span className="block text-xs text-slate-500">
              Seguridad y Comunidad · Perú
            </span>
          </div>
        </Link>

        {/* Navegación Desktop */}
        <nav className="hidden items-center gap-1 md:flex" aria-label="Principal">
          {NAV_LINKS.map((link) => {
            const isActive =
              link.href === "/"
                ? pathname === "/"
                : !link.href.startsWith("/#") && pathname.startsWith(link.href);

            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? "bg-brand-50 text-brand-800"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                {link.label}
              </Link>
            );
          })}

          <Link
            href="/admin"
            className="ml-2 inline-flex items-center gap-1.5 rounded-lg bg-brand-800 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-900"
          >
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            Panel Admin
          </Link>
        </nav>

        {/* Botón Menú Móvil */}
        <button
          type="button"
          onClick={() => setMobileOpen((prev) => !prev)}
          className="inline-flex items-center justify-center rounded-lg p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900 md:hidden"
          aria-expanded={mobileOpen}
          aria-label={mobileOpen ? "Cerrar menú" : "Abrir menú"}
        >
          {mobileOpen ? (
            <X className="h-6 w-6" aria-hidden="true" />
          ) : (
            <Menu className="h-6 w-6" aria-hidden="true" />
          )}
        </button>
      </div>

      {/* Menú Móvil */}
      {mobileOpen && (
        <div className="border-t border-slate-200 bg-white px-4 pb-4 pt-2 md:hidden">
          <nav className="flex flex-col gap-1" aria-label="Menú móvil">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/admin"
              onClick={() => setMobileOpen(false)}
              className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-900"
            >
              <Lock className="h-4 w-4" aria-hidden="true" />
              Panel Administrativo
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
