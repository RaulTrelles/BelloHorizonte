import { Megaphone, AlertTriangle, Info, Clock } from "lucide-react";
import type { AnnouncementPriority, AnnouncementRow } from "@/types/database";
import { formatDateTimePE } from "@/lib/format";

interface AnnouncementsBoardProps {
  announcements: AnnouncementRow[];
}

function getPriorityMeta(prioridad: AnnouncementPriority) {
  switch (prioridad) {
    case "urgente":
      return {
        label: "Urgente",
        badgeClass: "bg-red-100 text-red-800 ring-1 ring-inset ring-red-200",
        borderClass: "border-l-4 border-l-red-600",
        Icon: AlertTriangle,
      };
    case "importante":
      return {
        label: "Importante",
        badgeClass:
          "bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200",
        borderClass: "border-l-4 border-l-amber-500",
        Icon: Megaphone,
      };
    default:
      return {
        label: "Normal",
        badgeClass:
          "bg-brand-100 text-brand-800 ring-1 ring-inset ring-brand-200",
        borderClass: "border-l-4 border-l-brand-600",
        Icon: Info,
      };
  }
}

export function AnnouncementsBoard({ announcements }: AnnouncementsBoardProps) {
  return (
    <section
      id="comunicados"
      aria-labelledby="comunicados-heading"
      className="border-y border-slate-200 bg-white py-14"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-800">
              <Megaphone className="h-3.5 w-3.5" aria-hidden="true" />
              Tablón Oficial
            </span>
            <h2
              id="comunicados-heading"
              className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl"
            >
              Comunicados de la Asociación
            </h2>
          </div>
          <p className="text-sm text-slate-600">
            Avisos vecinales, coordinación de seguridad y acuerdos comunitarios.
          </p>
        </div>

        {announcements.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
            <Megaphone
              className="mx-auto h-8 w-8 text-slate-400"
              aria-hidden="true"
            />
            <p className="mt-3 text-sm font-medium text-slate-700">
              No hay comunicados publicados por el momento.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Cuando la directiva publique un nuevo aviso aparecerá aquí.
            </p>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            {announcements.map((item) => {
              const { label, badgeClass, borderClass, Icon } = getPriorityMeta(
                item.prioridad
              );

              return (
                <article
                  key={item.id}
                  className={`flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md ${borderClass}`}
                >
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeClass}`}
                      >
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        {label}
                      </span>
                      <time
                        dateTime={item.published_at}
                        className="inline-flex items-center gap-1 text-xs text-slate-500"
                      >
                        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                        {formatDateTimePE(item.published_at)}
                      </time>
                    </div>

                    <h3 className="mt-3 text-lg font-bold leading-snug text-slate-900">
                      {item.titulo}
                    </h3>
                    <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600">
                      {item.contenido}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
