import { PhoneCall, Siren, Shield, HeartPulse } from "lucide-react";
import type { EmergencyPhone } from "@/types/database";
import { sanitizeTelHref } from "@/lib/format";

interface EmergencyBarProps {
  phones: EmergencyPhone[];
}

function getStyleByTipo(tipo?: string) {
  switch (tipo) {
    case "emergencia":
      return {
        card: "border-red-200 bg-red-50/70 hover:border-red-300 hover:bg-red-50",
        badge: "bg-red-600 text-white",
        number: "text-red-700",
        Icon: Siren,
      };
    case "salud":
      return {
        card: "border-emerald-200 bg-emerald-50/70 hover:border-emerald-300 hover:bg-emerald-50",
        badge: "bg-emerald-600 text-white",
        number: "text-emerald-700",
        Icon: HeartPulse,
      };
    case "serenazgo":
      return {
        card: "border-amber-200 bg-amber-50/70 hover:border-amber-300 hover:bg-amber-50",
        badge: "bg-amber-600 text-white",
        number: "text-amber-800",
        Icon: Shield,
      };
    default:
      return {
        card: "border-brand-200 bg-brand-50/60 hover:border-brand-300 hover:bg-brand-50",
        badge: "bg-brand-700 text-white",
        number: "text-brand-800",
        Icon: PhoneCall,
      };
  }
}

export function EmergencyBar({ phones }: EmergencyBarProps) {
  return (
    <section
      id="emergencias"
      aria-labelledby="emergencias-heading"
      className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8"
    >
      <div className="mb-6 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-red-700">
            <Siren className="h-3.5 w-3.5" aria-hidden="true" />
            Atención Inmediata · Perú (+51)
          </span>
          <h2
            id="emergencias-heading"
            className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl"
          >
            Números de Emergencia
          </h2>
        </div>
        <p className="text-sm text-slate-600">
          Toca cualquier tarjeta desde tu celular para marcar directamente.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {phones.map((item, idx) => {
          const { card, badge, number, Icon } = getStyleByTipo(item.tipo);
          return (
            <a
              key={`${item.nombre}-${idx}`}
              href={sanitizeTelHref(item.numero)}
              className={`group flex flex-col justify-between rounded-2xl border p-5 shadow-sm transition ${card}`}
            >
              <div className="flex items-start justify-between gap-3">
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm ${badge}`}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                  <PhoneCall className="h-3 w-3" aria-hidden="true" />
                  Llamar
                </span>
              </div>

              <div className="mt-4">
                <p className="text-sm font-medium text-slate-700">
                  {item.nombre}
                </p>
                <p
                  className={`mt-1 text-2xl font-extrabold tracking-tight ${number}`}
                >
                  {item.numero}
                </p>
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}
