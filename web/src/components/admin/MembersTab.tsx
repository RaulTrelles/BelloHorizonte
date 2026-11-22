"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Users,
  KeyRound,
  RefreshCw,
  Copy,
  Check,
  UserCheck,
  UserX,
  RotateCcw,
  Loader2,
  AlertCircle,
  ShieldCheck,
  Smartphone,
  Phone,
  Home,
} from "lucide-react";
import {
  getSupabaseBrowserClient,
  PROFILE_SAFE_COLUMNS,
} from "@/lib/supabase";
import type {
  GroupMemberName,
  MemberRole,
  MemberStatus,
  MembershipRow,
  ProfileRow,
} from "@/types/database";
import { formatDateTimePE } from "@/lib/format";

interface MembersTabProps {
  groupId: string;
  currentUserId: string;
  currentRole: MemberRole;
}

interface EnrichedMember {
  membership: MembershipRow;
  nombre: string;
  telefono: string | null;
  direccion_lote: string | null;
  device_brand: string | null;
}

const ROLE_LABELS: Record<MemberRole, string> = {
  admin: "Administrador",
  presidente: "Presidente",
  secretario: "Secretario",
  miembro: "Vecino",
};

const STATUS_BADGES: Record<MemberStatus, string> = {
  pendiente: "bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200",
  activo: "bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-200",
  suspendido: "bg-red-100 text-red-800 ring-1 ring-inset ring-red-200",
};

export function MembersTab({
  groupId,
  currentUserId,
  currentRole,
}: MembersTabProps) {
  const isAdmin = currentRole === "admin";

  const [members, setMembers] = useState<EnrichedMember[]>([]);
  const [filterStatus, setFilterStatus] = useState<"todos" | MemberStatus>(
    "todos"
  );
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [loadingCode, setLoadingCode] = useState(false);
  const [regeneratingCode, setRegeneratingCode] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const loadMembers = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setLoading(true);
    setErrorMsg(null);

    try {
      const { data: membershipsData, error: mErr } = await supabase
        .from("memberships")
        .select("id, group_id, user_id, rol, estado, aprobado_por, created_at")
        .eq("group_id", groupId)
        .order("created_at", { ascending: false });

      if (mErr) throw mErr;

      const rows = (membershipsData ?? []) as MembershipRow[];
      const userIds = Array.from(new Set(rows.map((r) => r.user_id)));

      const profileMap = new Map<string, Partial<ProfileRow>>();

      if (userIds.length > 0) {
        if (isAdmin) {
          // Columnas explícitas sin fcm_token (respetando privilegios de columna)
          const { data: profilesData, error: pErr } = await supabase
            .from("profiles")
            .select(PROFILE_SAFE_COLUMNS)
            .in("id", userIds);

          if (pErr) throw pErr;
          for (const p of (profilesData ?? []) as ProfileRow[]) {
            profileMap.set(p.id, p);
          }
        } else {
          // Directiva no-admin: usar RPC get_group_member_names (minimización Ley 29733)
          const { data: namesData, error: nErr } = await supabase.rpc(
            "get_group_member_names",
            { p_group_id: groupId }
          );
          if (!nErr && Array.isArray(namesData)) {
            for (const n of namesData as GroupMemberName[]) {
              profileMap.set(n.user_id, { nombre: n.nombre });
            }
          }
        }
      }

      const enriched: EnrichedMember[] = rows.map((m) => {
        const p = profileMap.get(m.user_id);
        return {
          membership: m,
          nombre: p?.nombre?.trim() || "Vecino sin nombre",
          telefono: p?.telefono ?? null,
          direccion_lote: p?.direccion_lote ?? null,
          device_brand: p?.device_brand ?? null,
        };
      });

      setMembers(enriched);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "No se pudo cargar la lista de miembros."
      );
    } finally {
      setLoading(false);
    }
  }, [groupId, isAdmin]);

  const loadInviteCode = useCallback(async () => {
    if (!isAdmin) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setLoadingCode(true);
    try {
      const { data, error } = await supabase.rpc("get_group_invite_code", {
        p_group_id: groupId,
      });
      if (error) throw error;
      setInviteCode(typeof data === "string" ? data : null);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "No se pudo consultar el código de invitación."
      );
    } finally {
      setLoadingCode(false);
    }
  }, [groupId, isAdmin]);

  useEffect(() => {
    loadMembers();
    loadInviteCode();
  }, [loadMembers, loadInviteCode]);

  async function handleRegenerateCode() {
    if (!isAdmin) return;
    const confirmed = window.confirm(
      "¿Regenerar el código de invitación? El código anterior dejará de funcionar para nuevos registros."
    );
    if (!confirmed) return;

    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setRegeneratingCode(true);
    setErrorMsg(null);
    try {
      const { data, error } = await supabase.rpc("regenerate_group_code", {
        p_group_id: groupId,
      });
      if (error) throw error;
      setInviteCode(typeof data === "string" ? data : null);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "No se pudo regenerar el código de invitación."
      );
    } finally {
      setRegeneratingCode(false);
    }
  }

  async function handleCopyCode() {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      // Fallback silencioso si el navegador bloquea el portapapeles
    }
  }

  async function handleUpdateStatus(
    membershipId: string,
    nextStatus: MemberStatus
  ) {
    if (!isAdmin) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setActionLoadingId(membershipId);
    setErrorMsg(null);

    try {
      const updatePayload: {
        estado: MemberStatus;
        aprobado_por?: string;
      } = { estado: nextStatus };

      if (nextStatus === "activo") {
        updatePayload.aprobado_por = currentUserId;
      }

      const { error } = await supabase
        .from("memberships")
        .update(updatePayload)
        .eq("id", membershipId)
        .eq("group_id", groupId);

      if (error) throw error;
      await loadMembers();
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "No se pudo actualizar el estado del miembro."
      );
    } finally {
      setActionLoadingId(null);
    }
  }

  const counts = {
    todos: members.length,
    pendiente: members.filter((m) => m.membership.estado === "pendiente")
      .length,
    activo: members.filter((m) => m.membership.estado === "activo").length,
    suspendido: members.filter((m) => m.membership.estado === "suspendido")
      .length,
  };

  const filteredMembers =
    filterStatus === "todos"
      ? members
      : members.filter((m) => m.membership.estado === filterStatus);

  return (
    <div className="space-y-6">
      {/* Tarjeta de Código de Invitación (solo admin activo) */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-brand-700" aria-hidden="true" />
              <h2 className="text-base font-bold text-slate-900">
                Código de Invitación del Grupo
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              Comparte este código con vecinos verificados para que soliciten
              unirse desde la App Android.
            </p>
          </div>

          {isAdmin ? (
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2">
                {loadingCode ? (
                  <Loader2 className="h-4 w-4 animate-spin text-brand-700" />
                ) : (
                  <code className="text-base font-extrabold tracking-widest text-brand-900">
                    {inviteCode ?? "—"}
                  </code>
                )}
              </div>

              <button
                type="button"
                onClick={handleCopyCode}
                disabled={!inviteCode}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                {copiedCode ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                    Copiado
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copiar
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleRegenerateCode}
                disabled={regeneratingCode}
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand-800 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-brand-900 disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${regeneratingCode ? "animate-spin" : ""}`}
                />
                Regenerar código
              </button>
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs text-amber-900">
              <ShieldCheck className="h-4 w-4 shrink-0 text-amber-600" />
              Solo el rol <strong>Administrador</strong> puede ver o regenerar
              el código y aprobar solicitudes.
            </div>
          )}
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Filtros y recarga */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {(
            [
              { key: "todos", label: "Todos" },
              { key: "pendiente", label: "Pendientes" },
              { key: "activo", label: "Activos" },
              { key: "suspendido", label: "Suspendidos" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFilterStatus(tab.key)}
              className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
                filterStatus === tab.key
                  ? "bg-brand-800 text-white shadow-sm"
                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {tab.label}{" "}
              <span className="ml-1 opacity-80">({counts[tab.key]})</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={loadMembers}
          disabled={loading}
          className="inline-flex items-center gap-1.5 self-start rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 sm:self-auto"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </button>
      </div>

      {/* Lista de miembros */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-12 text-sm text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin text-brand-700" />
            Cargando miembros del grupo...
          </div>
        ) : filteredMembers.length === 0 ? (
          <div className="p-12 text-center">
            <Users className="mx-auto h-8 w-8 text-slate-400" />
            <p className="mt-3 text-sm font-medium text-slate-700">
              No hay miembros en esta categoría.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {filteredMembers.map(
              ({
                membership,
                nombre,
                telefono,
                direccion_lote,
                device_brand,
              }) => {
                const isSelf = membership.user_id === currentUserId;
                const busy = actionLoadingId === membership.id;

                return (
                  <div
                    key={membership.id}
                    className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-slate-900">
                          {nombre}
                          {isSelf && (
                            <span className="ml-1.5 text-xs font-normal text-slate-500">
                              (Tú)
                            </span>
                          )}
                        </p>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${
                            STATUS_BADGES[membership.estado]
                          }`}
                        >
                          {membership.estado}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                          {ROLE_LABELS[membership.rol]}
                        </span>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                        {telefono && (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="h-3.5 w-3.5 text-slate-400" />
                            {telefono}
                          </span>
                        )}
                        {direccion_lote && (
                          <span className="inline-flex items-center gap-1">
                            <Home className="h-3.5 w-3.5 text-slate-400" />
                            {direccion_lote}
                          </span>
                        )}
                        {device_brand && (
                          <span className="inline-flex items-center gap-1">
                            <Smartphone className="h-3.5 w-3.5 text-slate-400" />
                            {device_brand}
                          </span>
                        )}
                        <span className="text-slate-400">
                          Registro: {formatDateTimePE(membership.created_at)}
                        </span>
                      </div>
                    </div>

                    {isAdmin && (
                      <div className="flex flex-wrap items-center gap-2">
                        {membership.estado === "pendiente" && (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                handleUpdateStatus(membership.id, "activo")
                              }
                              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                            >
                              {busy ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <UserCheck className="h-3.5 w-3.5" />
                              )}
                              Aprobar
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                handleUpdateStatus(membership.id, "suspendido")
                              }
                              className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                            >
                              <UserX className="h-3.5 w-3.5" />
                              Suspender
                            </button>
                          </>
                        )}

                        {membership.estado === "activo" && !isSelf && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              handleUpdateStatus(membership.id, "suspendido")
                            }
                            className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                          >
                            {busy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <UserX className="h-3.5 w-3.5" />
                            )}
                            Suspender
                          </button>
                        )}

                        {membership.estado === "suspendido" && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              handleUpdateStatus(membership.id, "activo")
                            }
                            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-700 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-brand-800 disabled:opacity-50"
                          >
                            {busy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RotateCcw className="h-3.5 w-3.5" />
                            )}
                            Reactivar
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              }
            )}
          </div>
        )}
      </div>
    </div>
  );
}
