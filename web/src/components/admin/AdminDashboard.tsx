"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Users,
  Siren,
  Megaphone,
  CalendarDays,
  LogOut,
  ShieldAlert,
  Loader2,
  Lock,
  AlertCircle,
} from "lucide-react";
import {
  getSupabaseBrowserClient,
  GROUP_SAFE_COLUMNS,
  isSupabaseConfigured,
} from "@/lib/supabase";
import type { GroupRow, MemberRole, MembershipRow } from "@/types/database";
import { MembersTab } from "@/components/admin/MembersTab";
import { AlertsTab } from "@/components/admin/AlertsTab";
import { AnnouncementsTab } from "@/components/admin/AnnouncementsTab";
import { MeetingsTab } from "@/components/admin/MeetingsTab";

type AdminTab = "miembros" | "alertas" | "comunicados" | "reuniones";

const ALLOWED_ADMIN_ROLES: MemberRole[] = ["admin", "presidente", "secretario"];

interface ManagedGroup {
  group: GroupRow;
  membership: MembershipRow;
}

export function AdminDashboard() {
  const router = useRouter();
  const configured = isSupabaseConfigured();

  const [checkingAuth, setCheckingAuth] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [managedGroups, setManagedGroups] = useState<ManagedGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<AdminTab>("alertas");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!configured) {
      setCheckingAuth(false);
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setCheckingAuth(false);
      return;
    }

    let mounted = true;

    async function loadSessionAndRoles() {
      if (!supabase) return;

      try {
        const {
          data: { session },
          error: sessionErr,
        } = await supabase.auth.getSession();

        if (sessionErr) throw sessionErr;

        if (!session?.user) {
          router.replace("/login?redirect=/admin");
          return;
        }

        if (!mounted) return;
        setUserId(session.user.id);
        setUserEmail(session.user.email ?? null);

        // Consultar membresías activas con rol directivo o admin
        const { data: membershipsData, error: mErr } = await supabase
          .from("memberships")
          .select("id, group_id, user_id, rol, estado, aprobado_por, created_at")
          .eq("user_id", session.user.id)
          .eq("estado", "activo")
          .in("rol", ALLOWED_ADMIN_ROLES);

        if (mErr) throw mErr;

        const eligible = (membershipsData ?? []) as MembershipRow[];
        if (eligible.length === 0) {
          if (mounted) {
            setManagedGroups([]);
            setCheckingAuth(false);
          }
          return;
        }

        const groupIds = eligible.map((m) => m.group_id);

        // Columnas explícitas sin `codigo` (respetando privilegios de columna en groups)
        const { data: groupsData, error: gErr } = await supabase
          .from("groups")
          .select(GROUP_SAFE_COLUMNS)
          .in("id", groupIds);

        if (gErr) throw gErr;

        const groupMap = new Map<string, GroupRow>();
        for (const g of (groupsData ?? []) as GroupRow[]) {
          groupMap.set(g.id, g);
        }

        const combined: ManagedGroup[] = eligible
          .map((m) => {
            const group = groupMap.get(m.group_id);
            return group ? { group, membership: m } : null;
          })
          .filter((item): item is ManagedGroup => item !== null);

        if (mounted) {
          setManagedGroups(combined);
          if (combined.length > 0) {
            setSelectedGroupId(combined[0].group.id);
          }
        }
      } catch (err) {
        if (mounted) {
          setErrorMsg(
            err instanceof Error
              ? err.message
              : "Error al verificar permisos de administración."
          );
        }
      } finally {
        if (mounted) setCheckingAuth(false);
      }
    }

    loadSessionAndRoles();

    return () => {
      mounted = false;
    };
  }, [configured, router]);

  async function handleSignOut() {
    const supabase = getSupabaseBrowserClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
    router.replace("/login");
  }

  if (!configured) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-950">
          <h1 className="text-lg font-bold">
            Configuración de Supabase requerida
          </h1>
          <p className="mt-2 text-sm">
            Para acceder a la Consola Administrativa, define las variables
            públicas <code>NEXT_PUBLIC_SUPABASE_URL</code> y{" "}
            <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> en{" "}
            <code>web/.env.local</code> (toma como referencia{" "}
            <code>web/.env.example</code>).
          </p>
          <Link
            href="/"
            className="mt-4 inline-block text-sm font-semibold text-brand-800 underline"
          >
            Volver al portal público
          </Link>
        </div>
      </div>
    );
  }

  if (checkingAuth) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-sm text-slate-600">
        <Loader2 className="h-7 w-7 animate-spin text-brand-700" />
        Verificando sesión y permisos de directiva...
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-900">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <div>
              <h1 className="text-base font-bold">
                Error al cargar el panel administrativo
              </h1>
              <p className="mt-1 text-sm">{errorMsg}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const currentManaged =
    managedGroups.find((g) => g.group.id === selectedGroupId) ??
    managedGroups[0];

  if (!userId || !currentManaged) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <Lock className="h-6 w-6" aria-hidden="true" />
          </span>
          <h1 className="mt-4 text-xl font-bold text-slate-900">
            Acceso restringido a la Directiva
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Tu cuenta (<strong>{userEmail}</strong>) no cuenta con un rol
            administrativo activo (<code>admin</code>, <code>presidente</code> o{" "}
            <code>secretario</code>) en ningún grupo de la Asociación Bello
            Horizonte.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/"
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Ir al inicio
            </Link>
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-800 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-900"
            >
              <LogOut className="h-4 w-4" />
              Cerrar sesión
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { group, membership } = currentManaged;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Encabezado del Panel */}
      <div className="no-print mb-6 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-800 text-white">
            <ShieldAlert className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900">
                Consola Administrativa
              </h1>
              <span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-semibold capitalize text-brand-800">
                Rol: {membership.rol}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              {group.nombre} · Sesión: {userEmail}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {managedGroups.length > 1 && (
            <select
              aria-label="Seleccionar grupo"
              value={group.id}
              onChange={(e) => setSelectedGroupId(e.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 focus:border-brand-600 focus:outline-none"
            >
              {managedGroups.map((item) => (
                <option key={item.group.id} value={item.group.id}>
                  {item.group.nombre} ({item.membership.rol})
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={handleSignOut}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            Cerrar sesión
          </button>
        </div>
      </div>

      {/* Pestañas */}
      <div
        className="no-print mb-6 flex flex-wrap gap-2 border-b border-slate-200 pb-3"
        role="tablist"
        aria-label="Secciones administrativas"
      >
        {(
          [
            { id: "alertas", label: "Alertas (En vivo)", Icon: Siren },
            { id: "miembros", label: "Miembros y Código", Icon: Users },
            { id: "comunicados", label: "Comunicados", Icon: Megaphone },
            {
              id: "reuniones",
              label: "Reuniones y Actas",
              Icon: CalendarDays,
            },
          ] as const
        ).map(({ id, label, Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(id)}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                active
                  ? "bg-brand-800 text-white shadow-sm"
                  : "bg-white text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </div>

      {/* Contenido del tab activo */}
      <div role="tabpanel">
        {activeTab === "miembros" && (
          <MembersTab
            groupId={group.id}
            currentUserId={userId}
            currentRole={membership.rol}
          />
        )}

        {activeTab === "alertas" && (
          <AlertsTab
            groupId={group.id}
            currentUserId={userId}
            currentRole={membership.rol}
          />
        )}

        {activeTab === "comunicados" && (
          <AnnouncementsTab groupId={group.id} currentUserId={userId} />
        )}

        {activeTab === "reuniones" && (
          <MeetingsTab
            groupId={group.id}
            groupName={group.nombre}
            currentUserId={userId}
            currentRole={membership.rol}
          />
        )}
      </div>
    </div>
  );
}
