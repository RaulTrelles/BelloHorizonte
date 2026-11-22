"use client";

import { useState } from "react";
import {
  Smartphone,
  Volume2,
  BatteryCharging,
  BellRing,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
} from "lucide-react";
import { ANDROID_BRAND_GUIDES } from "@/lib/defaults";

const INSTALL_STEPS = [
  {
    step: "1",
    title: "Instala la App Android",
    description:
      "Descarga la app oficial de Asociación Bello Horizonte desde el enlace de prueba cerrada en Google Play compartido por la directiva.",
  },
  {
    step: "2",
    title: "Regístrate con código de invitación",
    description:
      "Ingresa el código vigente de tu cuadra, tu nombre completo, teléfono (+51) y acepta el consentimiento de datos personales (Ley 29733).",
  },
  {
    step: "3",
    title: "Aprobación por la directiva",
    description:
      "Tu solicitud quedará en estado pendiente hasta que uno de los administradores valide que eres vecino de la asociación.",
  },
  {
    step: "4",
    title: "Configura permisos críticos",
    description:
      "Concede notificaciones, pantalla completa y batería sin restricciones para que la sirena suene incluso con el celular bloqueado o en silencio.",
  },
];

export function AndroidGuideSection() {
  const [selectedBrandId, setSelectedBrandId] = useState(
    ANDROID_BRAND_GUIDES[0].id
  );

  const selectedGuide =
    ANDROID_BRAND_GUIDES.find((g) => g.id === selectedBrandId) ??
    ANDROID_BRAND_GUIDES[0];

  return (
    <section
      id="app-android"
      aria-labelledby="app-android-heading"
      className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:px-8"
    >
      <div className="mb-10 max-w-3xl">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-800">
          <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
          App Móvil Android · Alarma Vecinal
        </span>
        <h2
          id="app-android-heading"
          className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl"
        >
          Botón de Pánico Comunitario (&ldquo;Robo en la cuadra&rdquo;)
        </h2>
        <p className="mt-3 text-base leading-relaxed text-slate-600">
          Al mantener pulsado el botón <strong>ALERTA</strong> por 2 segundos y
          confirmar, todos los vecinos activos reciben una sirena fuerte por el
          altavoz del celular (canal de alarma), incluso si el timbre está en
          silencio o la pantalla bloqueada.
        </p>
      </div>

      {/* Características clave */}
      <div className="mb-10 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <Volume2 className="h-6 w-6 text-red-600" aria-hidden="true" />
          <h3 className="mt-3 font-semibold text-slate-900">
            Sirena por altavoz (STREAM_ALARM)
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            Reproduce la sirena al máximo volumen de alarma y restaura tu
            volumen original al confirmar &ldquo;Estoy enterado&rdquo;.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <ShieldCheck className="h-6 w-6 text-brand-700" aria-hidden="true" />
          <h3 className="mt-3 font-semibold text-slate-900">
            Anti-abuso y sin anonimato
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            Requiere mantener 2 s + confirmación, límite de 1 alerta cada 2 min
            y siempre muestra el nombre del vecino que activó la alerta.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <BellRing className="h-6 w-6 text-amber-600" aria-hidden="true" />
          <h3 className="mt-3 font-semibold text-slate-900">
            Confirmación y cierre en vivo
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            Los vecinos confirman recepción (&ldquo;Estoy enterado&rdquo;) y el
            emisor o admin puede detener todas las sirenas si se resuelve.
          </p>
        </div>
      </div>

      {/* Pasos de instalación */}
      <div className="mb-10 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h3 className="text-lg font-bold text-slate-900">
          Guía rápida de instalación y activación
        </h3>
        <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {INSTALL_STEPS.map((item) => (
            <div key={item.step} className="relative flex flex-col">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-800 text-sm font-bold text-white">
                {item.step}
              </span>
              <h4 className="mt-3 text-sm font-bold text-slate-900">
                {item.title}
              </h4>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                {item.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Guía de permisos de batería por marca */}
      <div className="rounded-2xl border border-slate-200 bg-slate-900 p-6 text-white shadow-lg sm:p-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-400">
              <BatteryCharging className="h-4 w-4" aria-hidden="true" />
              Paso obligatorio para recepción confiable
            </span>
            <h3 className="mt-1 text-xl font-bold">
              Permisos de batería por marca de celular Android
            </h3>
          </div>
          <p className="text-xs text-slate-400">
            Selecciona la marca de tu equipo:
          </p>
        </div>

        {/* Selector de marcas */}
        <div
          className="mt-5 flex flex-wrap gap-2"
          role="tablist"
          aria-label="Marcas Android"
        >
          {ANDROID_BRAND_GUIDES.map((guide) => {
            const active = guide.id === selectedGuide.id;
            return (
              <button
                key={guide.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSelectedBrandId(guide.id)}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  active
                    ? "bg-white text-slate-900 shadow"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"
                }`}
              >
                {guide.brand.split(" (")[0]}
              </button>
            );
          })}
        </div>

        {/* Detalle de la marca seleccionada */}
        <div
          role="tabpanel"
          className="mt-6 rounded-xl border border-slate-700/80 bg-slate-800/70 p-5 sm:p-6"
        >
          <h4 className="text-lg font-bold text-white">
            {selectedGuide.brand}
          </h4>
          <p className="mt-1 text-sm text-slate-300">{selectedGuide.tagline}</p>

          <ol className="mt-4 space-y-3">
            {selectedGuide.steps.map((step, idx) => (
              <li key={idx} className="flex items-start gap-3 text-sm">
                <CheckCircle2
                  className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400"
                  aria-hidden="true"
                />
                <span className="leading-relaxed text-slate-200">{step}</span>
              </li>
            ))}
          </ol>

          <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-200">
            <AlertCircle
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-400"
              aria-hidden="true"
            />
            <p className="leading-relaxed">{selectedGuide.warning}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
