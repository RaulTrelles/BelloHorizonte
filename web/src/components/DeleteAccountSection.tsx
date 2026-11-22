"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Trash2,
  AlertTriangle,
  CheckCircle2,
  LogIn,
  Loader2,
} from "lucide-react";
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
} from "@/lib/supabase";

export function DeleteAccountSection() {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmWord, setConfirmWord] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [deletedSuccess, setDeletedSuccess] = useState(false);

  const configured = isSupabaseConfigured();

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setCheckingSession(false);
      return;
    }

    let mounted = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return;
        setUserEmail(data.session?.user?.email ?? null);
        setCheckingSession(false);
      })
      .catch(() => {
        if (!mounted) return;
        setCheckingSession(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setUserEmail(session?.user?.email ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleDeleteAccount(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    if (!confirmed || confirmWord.trim().toUpperCase() !== "ELIMINAR") {
      setErrorMsg(
        'Marca la casilla de confirmación y escribe "ELIMINAR" para continuar.'
      );
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setErrorMsg("El servicio de autenticación no está configurado.");
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.rpc("delete_my_account");
      if (error) {
        setErrorMsg(
          error.message ||
            "No se pudo eliminar la cuenta. Intenta nuevamente o contacta a la directiva."
        );
        return;
      }

      await supabase.auth.signOut().catch(() => undefined);
      setUserEmail(null);
      setDeletedSuccess(true);
      setConfirmed(false);
      setConfirmWord("");
    } catch {
      setErrorMsg("Ocurrió un error inesperado al procesar la eliminación.");
    } finally {
      setSubmitting(false);
    }
  }

  if (deletedSuccess) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
        <div className="flex items-start gap-3">
          <CheckCircle2
            className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600"
            aria-hidden="true"
          />
          <div>
            <h3 className="text-base font-bold text-emerald-900">
              Tu cuenta y datos personales fueron eliminados definitivamente
            </h3>
            <p className="mt-1 text-sm text-emerald-800">
              Se eliminó tu perfil, membresías, alertas registradas y
              confirmaciones asociadas conforme a la Ley N.° 29733. Si deseas
              volver a participar en la red vecinal, deberás registrarte
              nuevamente con un código de invitación.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-red-200 bg-red-50/60 p-6">
      <div className="flex items-start gap-3">
        <Trash2
          className="mt-0.5 h-6 w-6 shrink-0 text-red-600"
          aria-hidden="true"
        />
        <div className="flex-1">
          <h3 className="text-lg font-bold text-slate-900">
            Ejecutar eliminación inmediata de cuenta
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-slate-700">
            Al ejecutar esta acción se invoca el procedimiento seguro{" "}
            <code className="rounded bg-white px-1.5 py-0.5 text-xs font-semibold text-red-700">
              delete_my_account()
            </code>
            , el cual elimina permanentemente tu usuario de autenticación, tu
            perfil (nombre, teléfono, lote, token de notificaciones), tus
            membresías, alertas y confirmaciones. Esta operación es{" "}
            <strong>irreversible</strong>.
          </p>

          {!configured ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              El entorno de Supabase aún no está configurado en este despliegue.
              Puedes solicitar la eliminación directamente a la directiva de la
              Asociación Bello Horizonte.
            </div>
          ) : checkingSession ? (
            <div className="mt-4 inline-flex items-center gap-2 text-sm text-slate-600">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Verificando sesión activa...
            </div>
          ) : !userEmail ? (
            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-700">
                Para eliminar tu cuenta de forma automática y verificar tu
                identidad, primero inicia sesión con tu cuenta registrada.
              </p>
              <Link
                href="/login?redirect=/privacidad%23eliminar-cuenta"
                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-brand-800 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-900"
              >
                <LogIn className="h-4 w-4" aria-hidden="true" />
                Iniciar sesión para eliminar mi cuenta
              </Link>
            </div>
          ) : (
            <form onSubmit={handleDeleteAccount} className="mt-5 space-y-4">
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                Sesión iniciada como:{" "}
                <strong className="text-slate-900">{userEmail}</strong>
              </div>

              <label className="flex items-start gap-2.5 text-sm text-slate-800">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-red-600 focus:ring-red-500"
                />
                <span>
                  Entiendo que esta acción es permanente, elimina todos mis
                  datos personales y dejaré de recibir alertas vecinales en la
                  app Android.
                </span>
              </label>

              <div>
                <label
                  htmlFor="confirm-delete-word"
                  className="block text-xs font-semibold uppercase tracking-wide text-slate-700"
                >
                  Escribe ELIMINAR para confirmar
                </label>
                <input
                  id="confirm-delete-word"
                  type="text"
                  value={confirmWord}
                  onChange={(e) => setConfirmWord(e.target.value)}
                  placeholder="ELIMINAR"
                  autoComplete="off"
                  className="mt-1.5 w-full max-w-xs rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-200"
                />
              </div>

              {errorMsg && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-xl border border-red-300 bg-red-100 p-3 text-sm text-red-800"
                >
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span>{errorMsg}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={
                  submitting ||
                  !confirmed ||
                  confirmWord.trim().toUpperCase() !== "ELIMINAR"
                }
                className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                    Eliminando cuenta...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Eliminar mi cuenta definitivamente
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
