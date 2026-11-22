"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Siren,
  Radio,
  CheckCircle2,
  XCircle,
  MapPin,
  Users,
  Clock,
  Loader2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import type {
  AlertAckRow,
  AlertRow,
  AlertStatus,
  GroupMemberName,
  MemberRole,
} from "@/types/database";
import { formatDateTimePE, formatRelativeTimePE } from "@/lib/format";

interface AlertsTabProps {
  groupId: string;
  currentUserId: string;
  currentRole: MemberRole;
}

const ALERT_STATUS_META: Record<
  AlertStatus,
  { label: string; badgeClass: string }
> = {
  activa: {
    label: "ACTIVA",
    badgeClass:
      "bg-red-600 text-white animate-pulse ring-2 ring-red-200",
  },
  resuelta: {
    label: "Resuelta",
    badgeClass:
      "bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-200",
  },
  falsa_alarma: {
    label: "Falsa alarma",
    badgeClass:
      "bg-slate-200 text-slate-700 ring-1 ring-inset ring-slate-300",
  },
};

export function AlertsTab({
  groupId,
  currentUserId,
  currentRole,
}: AlertsTabProps) {
  const isAdmin = currentRole === "admin";

  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [acksByAlert, setAcksByAlert] = useState<Record<string, AlertAckRow[]>>(
    {}
  );
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [closingAlertId, setClosingAlertId] = useState<string | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  const loadAlertsData = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setErrorMsg(null);
    try {
      const [alertsRes, namesRes] = await Promise.all([
        supabase
          .from("alerts")
          .select(
            "id, group_id, user_id, tipo, mensaje, lat, lng, estado, created_at, closed_at, closed_by"
          )
          .eq("group_id", groupId)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase.rpc("get_group_member_names", { p_group_id: groupId }),
      ]);

      if (alertsRes.error) throw alertsRes.error;

      const alertRows = (alertsRes.data ?? []) as AlertRow[];
      setAlerts(alertRows);

      const namesMap: Record<string, string> = {};
      if (!namesRes.error && Array.isArray(namesRes.data)) {
        for (const item of namesRes.data as GroupMemberName[]) {
          namesMap[item.user_id] = item.nombre || "Vecino";
        }
      }
      setMemberNames(namesMap);

      if (alertRows.length > 0) {
        const alertIds = alertRows.map((a) => a.id);
        const { data: acksData, error: acksErr } = await supabase
          .from("alert_acks")
          .select("id, alert_id, user_id, tipo_ack, recibido_at")
          .in("alert_id", alertIds);

        if (acksErr) throw acksErr;

        const grouped: Record<string, AlertAckRow[]> = {};
        for (const ack of (acksData ?? []) as AlertAckRow[]) {
          if (!grouped[ack.alert_id]) grouped[ack.alert_id] = [];
          grouped[ack.alert_id].push(ack);
        }
        setAcksByAlert(grouped);
      } else {
        setAcksByAlert({});
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "No se pudo cargar el historial de alertas."
      );
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    setLoading(true);
    loadAlertsData();

    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    const channel = supabase
      .channel(`admin-alerts-${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "alerts",
          filter: `group_id=eq.${groupId}`,
        },
        () => {
          loadAlertsData();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "alert_acks",
        },
        () => {
          loadAlertsData();
        }
      )
      .subscribe((status) => {
        setRealtimeConnected(status === "SUBSCRIBED");
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId, loadAlertsData]);

  async function handleCloseAlert(
    alertId: string,
    estado: "resuelta" | "falsa_alarma"
  ) {
    const label = estado === "resuelta" ? "RESUELTA" : "FALSA ALARMA";
    const confirmed = window.confirm(
      `¿Marcar esta alerta como ${label}? Esto enviará la señal STOP_ALARM para detener la sirena en todos los celulares.`
    );
    if (!confirmed) return;

    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setClosingAlertId(alertId);
    setErrorMsg(null);
    try {
      // Solo enviamos `estado`; el trigger enforce_alert_update_fields fija closed_at y closed_by
      const { error } = await supabase
        .from("alerts")
        .update({ estado })
        .eq("id", alertId);

      if (error) throw error;
      await loadAlertsData();
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "No se pudo cerrar la alerta. Verifica tus permisos."
      );
    } finally {
      setClosingAlertId(null);
    }
  }

  const activeCount = alerts.filter((a) => a.estado === "activa").length;

  return (
    <div className="space-y-5">
      {/* Cabecera Realtime */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <Siren
              className={`h-5 w-5 ${activeCount > 0 ? "text-red-600" : "text-brand-700"}`}
              aria-hidden="true"
            />
            <h2 className="text-base font-bold text-slate-900">
              Monitor de Alertas Vecinales
            </h2>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                realtimeConnected
                  ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              <Radio
                className={`h-3 w-3 ${realtimeConnected ? "animate-pulse" : ""}`}
                aria-hidden="true"
              />
              {realtimeConnected ? "En vivo (Realtime)" : "Conectando..."}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-600">
            Al marcar una alerta como resuelta o falsa alarma se detiene la
            sirena en todos los celulares Android vía webhook{" "}
            <code>stop-panic-alert</code>.
          </p>
        </div>

        <button
          type="button"
          onClick={loadAlertsData}
          disabled={loading}
          className="inline-flex items-center gap-1.5 self-start rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 sm:self-auto"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </button>
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

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-12 text-sm text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin text-brand-700" />
          Cargando historial de alertas...
        </div>
      ) : alerts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-500" />
          <p className="mt-3 text-sm font-semibold text-slate-800">
            Sin alertas registradas en este grupo
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Cuando un vecino active el botón de pánico, aparecerá aquí al
            instante.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {alerts.map((alert) => {
            const statusMeta = ALERT_STATUS_META[alert.estado];
            const authorName =
              memberNames[alert.user_id] ?? "Vecino registrado";
            const closedByName = alert.closed_by
              ? memberNames[alert.closed_by] ?? "Administrador"
              : null;

            const acks = acksByAlert[alert.id] ?? [];
            const enteradoUsers = new Set(
              acks
                .filter((a) => a.tipo_ack === "enterado")
                .map((a) => a.user_id)
            );
            const totalNotifiedUsers = new Set(acks.map((a) => a.user_id));

            const canClose =
              alert.estado === "activa" &&
              (isAdmin || alert.user_id === currentUserId);
            const isClosing = closingAlertId === alert.id;

            return (
              <article
                key={alert.id}
                className={`rounded-2xl border bg-white p-5 shadow-sm transition ${
                  alert.estado === "activa"
                    ? "border-red-300 ring-2 ring-red-100"
                    : "border-slate-200"
                }`}
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${statusMeta.badgeClass}`}
                      >
                        {statusMeta.label}
                      </span>
                      <span className="text-sm font-bold text-slate-900">
                        {authorName}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                        <Clock className="h-3.5 w-3.5" />
                        {formatDateTimePE(alert.created_at)} (
                        {formatRelativeTimePE(alert.created_at)})
                      </span>
                    </div>

                    <p className="mt-2 text-sm text-slate-700">
                      {alert.mensaje ||
                        `¡ALERTA! Robo en la cuadra — activada por ${authorName}.`}
                    </p>

                    <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-600">
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 font-semibold text-slate-800">
                        <Users className="h-3.5 w-3.5 text-brand-700" />
                        {enteradoUsers.size} confirmaron &ldquo;Estoy
                        enterado&rdquo;
                        {totalNotifiedUsers.size > enteradoUsers.size && (
                          <span className="font-normal text-slate-500">
                            ({totalNotifiedUsers.size} en total)
                          </span>
                        )}
                      </span>

                      {alert.lat !== null && alert.lng !== null && (
                        <a
                          href={`https://www.google.com/maps?q=${alert.lat},${alert.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-semibold text-brand-700 underline hover:text-brand-900"
                        >
                          <MapPin className="h-3.5 w-3.5" />
                          Ver ubicación ({alert.lat.toFixed(4)},{" "}
                          {alert.lng.toFixed(4)})
                        </a>
                      )}

                      {alert.closed_at && (
                        <span className="text-slate-500">
                          Cerrada el {formatDateTimePE(alert.closed_at)}
                          {closedByName ? ` por ${closedByName}` : ""}
                        </span>
                      )}
                    </div>
                  </div>

                  {canClose && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={isClosing}
                        onClick={() => handleCloseAlert(alert.id, "resuelta")}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {isClosing ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                        Marcar resuelta
                      </button>

                      <button
                        type="button"
                        disabled={isClosing}
                        onClick={() =>
                          handleCloseAlert(alert.id, "falsa_alarma")
                        }
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                      >
                        <XCircle className="h-3.5 w-3.5 text-slate-500" />
                        Falsa alarma
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
