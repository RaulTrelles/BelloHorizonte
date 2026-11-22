"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Megaphone,
  Plus,
  Eye,
  EyeOff,
  Trash2,
  Loader2,
  AlertCircle,
  Clock,
} from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import type { AnnouncementPriority, AnnouncementRow } from "@/types/database";
import { formatDateTimePE } from "@/lib/format";

interface AnnouncementsTabProps {
  groupId: string;
  currentUserId: string;
}

const PRIORITY_BADGE: Record<AnnouncementPriority, string> = {
  urgente: "bg-red-100 text-red-800 ring-1 ring-inset ring-red-200",
  importante: "bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200",
  normal: "bg-brand-100 text-brand-800 ring-1 ring-inset ring-brand-200",
};

export function AnnouncementsTab({
  groupId,
  currentUserId,
}: AnnouncementsTabProps) {
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [titulo, setTitulo] = useState("");
  const [contenido, setContenido] = useState("");
  const [prioridad, setPrioridad] = useState<AnnouncementPriority>("normal");
  const [publicado, setPublicado] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadAnnouncements = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setLoading(true);
    setErrorMsg(null);
    try {
      const { data, error } = await supabase
        .from("announcements")
        .select(
          "id, group_id, author_id, titulo, contenido, prioridad, publicado, published_at, created_at"
        )
        .eq("group_id", groupId)
        .order("published_at", { ascending: false });

      if (error) throw error;
      setAnnouncements((data ?? []) as AnnouncementRow[]);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "No se pudieron cargar los comunicados."
      );
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    loadAnnouncements();
  }, [loadAnnouncements]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    if (!titulo.trim() || !contenido.trim()) {
      setErrorMsg("Completa el título y el contenido del comunicado.");
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setCreating(true);
    try {
      const { error } = await supabase.from("announcements").insert({
        group_id: groupId,
        author_id: currentUserId,
        titulo: titulo.trim(),
        contenido: contenido.trim(),
        prioridad,
        publicado,
        published_at: new Date().toISOString(),
      });

      if (error) throw error;

      setTitulo("");
      setContenido("");
      setPrioridad("normal");
      setPublicado(true);
      await loadAnnouncements();
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "No se pudo crear el comunicado."
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleTogglePublish(item: AnnouncementRow) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setBusyId(item.id);
    setErrorMsg(null);
    try {
      const nextPublished = !item.publicado;
      const { error } = await supabase
        .from("announcements")
        .update({
          publicado: nextPublished,
          ...(nextPublished ? { published_at: new Date().toISOString() } : {}),
        })
        .eq("id", item.id)
        .eq("group_id", groupId);

      if (error) throw error;
      await loadAnnouncements();
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "No se pudo actualizar la visibilidad del comunicado."
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(item: AnnouncementRow) {
    const confirmed = window.confirm(
      `¿Eliminar definitivamente el comunicado "${item.titulo}"?`
    );
    if (!confirmed) return;

    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setBusyId(item.id);
    setErrorMsg(null);
    try {
      const { error } = await supabase
        .from("announcements")
        .delete()
        .eq("id", item.id)
        .eq("group_id", groupId);

      if (error) throw error;
      await loadAnnouncements();
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "No se pudo eliminar el comunicado."
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Formulario de nuevo comunicado */}
      <form
        onSubmit={handleCreate}
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
      >
        <div className="flex items-center gap-2">
          <Megaphone className="h-5 w-5 text-brand-700" aria-hidden="true" />
          <h2 className="text-base font-bold text-slate-900">
            Nuevo Comunicado Oficial
          </h2>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label
              htmlFor="ann-titulo"
              className="block text-xs font-semibold uppercase tracking-wide text-slate-700"
            >
              Título
            </label>
            <input
              id="ann-titulo"
              type="text"
              required
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ej. Asamblea vecinal de seguridad — Sábado 7:00 p. m."
              className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          </div>

          <div>
            <label
              htmlFor="ann-prioridad"
              className="block text-xs font-semibold uppercase tracking-wide text-slate-700"
            >
              Prioridad
            </label>
            <select
              id="ann-prioridad"
              value={prioridad}
              onChange={(e) =>
                setPrioridad(e.target.value as AnnouncementPriority)
              }
              className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-200"
            >
              <option value="normal">Normal</option>
              <option value="importante">Importante</option>
              <option value="urgente">Urgente</option>
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label
            htmlFor="ann-contenido"
            className="block text-xs font-semibold uppercase tracking-wide text-slate-700"
          >
            Contenido
          </label>
          <textarea
            id="ann-contenido"
            rows={4}
            required
            value={contenido}
            onChange={(e) => setContenido(e.target.value)}
            placeholder="Redacta el comunicado para los vecinos de Asociación Bello Horizonte..."
            className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={publicado}
              onChange={(e) => setPublicado(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500"
            />
            Publicar inmediatamente en el portal público
          </label>

          <button
            type="submit"
            disabled={creating}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-900 disabled:opacity-50"
          >
            {creating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Guardando...
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                Crear comunicado
              </>
            )}
          </button>
        </div>
      </form>

      {errorMsg && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Listado de comunicados */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-12 text-sm text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin text-brand-700" />
            Cargando comunicados...
          </div>
        ) : announcements.length === 0 ? (
          <div className="p-12 text-center">
            <Megaphone className="mx-auto h-8 w-8 text-slate-400" />
            <p className="mt-3 text-sm font-medium text-slate-700">
              Aún no hay comunicados creados.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {announcements.map((item) => {
              const busy = busyId === item.id;
              return (
                <div
                  key={item.id}
                  className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${
                          PRIORITY_BADGE[item.prioridad]
                        }`}
                      >
                        {item.prioridad}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          item.publicado
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-200 text-slate-700"
                        }`}
                      >
                        {item.publicado ? "Publicado" : "Oculto (borrador)"}
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                        <Clock className="h-3.5 w-3.5" />
                        {formatDateTimePE(item.published_at)}
                      </span>
                    </div>

                    <h3 className="mt-2 font-bold text-slate-900">
                      {item.titulo}
                    </h3>
                    <p className="mt-1 whitespace-pre-line text-sm text-slate-600">
                      {item.contenido}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleTogglePublish(item)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : item.publicado ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                      {item.publicado ? "Ocultar" : "Publicar"}
                    </button>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleDelete(item)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Eliminar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
