import Link from "next/link";
import {
  MapPin,
  ShieldAlert,
  Users,
  ArrowRight,
  PhoneCall,
  FileCheck2,
} from "lucide-react";
import { createSupabasePublicClient } from "@/lib/supabase";
import {
  DEFAULT_ANNOUNCEMENTS,
  DEFAULT_ASSOCIATION_INFO,
} from "@/lib/defaults";
import type {
  AnnouncementRow,
  AssociationInfoRow,
  BoardMember,
  EmergencyPhone,
} from "@/types/database";
import { EmergencyBar } from "@/components/EmergencyBar";
import { AnnouncementsBoard } from "@/components/AnnouncementsBoard";
import { AndroidGuideSection } from "@/components/AndroidGuideSection";

export const dynamic = "force-dynamic";

function parseEmergencyPhones(raw: unknown): EmergencyPhone[] {
  if (!Array.isArray(raw)) return DEFAULT_ASSOCIATION_INFO.telefonos_emergencia;
  const parsed = raw.filter(
    (item): item is EmergencyPhone =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as EmergencyPhone).nombre === "string" &&
      typeof (item as EmergencyPhone).numero === "string"
  );
  return parsed.length > 0
    ? parsed
    : DEFAULT_ASSOCIATION_INFO.telefonos_emergencia;
}

function parseDirectiva(raw: unknown): BoardMember[] {
  if (!Array.isArray(raw)) return DEFAULT_ASSOCIATION_INFO.directiva;
  const parsed = raw.filter(
    (item): item is BoardMember =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as BoardMember).cargo === "string" &&
      typeof (item as BoardMember).nombre === "string"
  );
  return parsed.length > 0 ? parsed : DEFAULT_ASSOCIATION_INFO.directiva;
}

async function loadPublicPortalData(): Promise<{
  info: AssociationInfoRow;
  announcements: AnnouncementRow[];
}> {
  const supabase = createSupabasePublicClient();
  if (!supabase) {
    return {
      info: DEFAULT_ASSOCIATION_INFO,
      announcements: DEFAULT_ANNOUNCEMENTS,
    };
  }

  try {
    const [infoRes, announcementsRes] = await Promise.all([
      supabase
        .from("association_info")
        .select(
          "id, group_id, titulo, descripcion, direccion, telefonos_emergencia, directiva, politica_privacidad_url, updated_at"
        )
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("announcements")
        .select(
          "id, group_id, author_id, titulo, contenido, prioridad, publicado, published_at, created_at"
        )
        .eq("publicado", true)
        .order("published_at", { ascending: false })
        .limit(12),
    ]);

    const info: AssociationInfoRow = infoRes.data
      ? {
          id: infoRes.data.id,
          group_id: infoRes.data.group_id,
          titulo: infoRes.data.titulo || DEFAULT_ASSOCIATION_INFO.titulo,
          descripcion:
            infoRes.data.descripcion || DEFAULT_ASSOCIATION_INFO.descripcion,
          direccion:
            infoRes.data.direccion || DEFAULT_ASSOCIATION_INFO.direccion,
          telefonos_emergencia: parseEmergencyPhones(
            infoRes.data.telefonos_emergencia
          ),
          directiva: parseDirectiva(infoRes.data.directiva),
          politica_privacidad_url:
            infoRes.data.politica_privacidad_url || "/privacidad",
          updated_at: infoRes.data.updated_at,
        }
      : DEFAULT_ASSOCIATION_INFO;

    const announcements: AnnouncementRow[] =
      !announcementsRes.error && announcementsRes.data
        ? (announcementsRes.data as AnnouncementRow[])
        : DEFAULT_ANNOUNCEMENTS;

    return { info, announcements };
  } catch {
    return {
      info: DEFAULT_ASSOCIATION_INFO,
      announcements: DEFAULT_ANNOUNCEMENTS,
    };
  }
}

export default async function HomePage() {
  const { info, announcements } = await loadPublicPortalData();

  return (
    <div>
      {/* Hero Institucional */}
      <section className="relative overflow-hidden bg-gradient-to-br from-brand-950 via-brand-900 to-brand-800 text-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <div className="grid items-center gap-10 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 py-1 text-xs font-semibold uppercase tracking-wider text-brand-100">
                <ShieldAlert className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
                Portal Vecinal Oficial · Perú
              </span>
              <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-5xl">
                {info.titulo}
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-relaxed text-brand-100 sm:text-lg">
                {info.descripcion}
              </p>

              {info.direccion && (
                <p className="mt-4 inline-flex items-center gap-2 text-sm text-brand-200">
                  <MapPin className="h-4 w-4 text-brand-300" aria-hidden="true" />
                  {info.direccion}
                </p>
              )}

              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href="#emergencias"
                  className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-red-950/30 transition hover:bg-red-700"
                >
                  <PhoneCall className="h-4 w-4" aria-hidden="true" />
                  Números de Emergencia
                </a>
                <a
                  href="#app-android"
                  className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-brand-900 shadow transition hover:bg-brand-50"
                >
                  Instalar App Alarma Vecinal
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </a>
                <Link
                  href="/admin"
                  className="inline-flex items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/20"
                >
                  Panel Directiva
                </Link>
              </div>
            </div>

            <div className="lg:col-span-5">
              <div className="rounded-2xl border border-white/15 bg-white/10 p-6 backdrop-blur-sm">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-brand-200">
                  Sistema de Seguridad Comunitaria
                </h2>
                <ul className="mt-4 space-y-3 text-sm text-brand-50">
                  <li className="flex items-start gap-3">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-red-400" />
                    <span>
                      <strong>Alerta inmediata:</strong> sirena fuerte por
                      altavoz en celulares Android de vecinos activos.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-300" />
                    <span>
                      <strong>Control vecinal:</strong> acceso validado por la
                      directiva con código de invitación y aprobación manual.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                    <span>
                      <strong>Privacidad Ley 29733:</strong> ubicación enviada
                      solo al disparar una alerta y retención máxima de 90 días.
                    </span>
                  </li>
                </ul>
                <div className="mt-5 border-t border-white/15 pt-4">
                  <Link
                    href="/privacidad"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-200 transition hover:text-white"
                  >
                    <FileCheck2 className="h-4 w-4" aria-hidden="true" />
                    Ver Política de Privacidad y Eliminación de Cuenta →
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Números de Emergencia */}
      <EmergencyBar phones={info.telefonos_emergencia} />

      {/* Tablón de Comunicados */}
      <AnnouncementsBoard announcements={announcements} />

      {/* Guía de App Android y Permisos de Batería */}
      <AndroidGuideSection />

      {/* Directiva Vecinal */}
      <section
        id="directiva"
        aria-labelledby="directiva-heading"
        className="border-t border-slate-200 bg-white py-14"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="mb-8 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                Organización Vecinal
              </span>
              <h2
                id="directiva-heading"
                className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl"
              >
                Directiva y Administradores de Seguridad
              </h2>
            </div>
            <p className="text-sm text-slate-600">
              Responsables de aprobar nuevos vecinos y mantener el orden
              comunitario.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {info.directiva.map((member, idx) => (
              <div
                key={`${member.cargo}-${idx}`}
                className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
                  {member.cargo}
                </p>
                <p className="mt-2 text-base font-bold text-slate-900">
                  {member.nombre}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
