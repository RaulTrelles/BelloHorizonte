"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ShieldAlert,
  Mail,
  Lock,
  User,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
} from "lucide-react";
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
} from "@/lib/supabase";

type AuthMode = "login" | "register";

function getSafeRedirect(raw: string | null): string {
  if (
    !raw ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    raw.includes("\\")
  ) {
    return "/admin";
  }
  return raw;
}

function LoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = getSafeRedirect(searchParams.get("redirect"));

  const [mode, setMode] = useState<AuthMode>("login");
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consentimiento, setConsentimiento] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const configured = isSupabaseConfigured();

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        router.replace(redirectTo);
      }
    });
  }, [router, redirectTo]);

  async function handleGoogleSignIn() {
    setErrorMsg(null);
    setInfoMsg(null);

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setErrorMsg(
        "Supabase no está configurado. Define NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
      );
      return;
    }

    setGoogleLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}${redirectTo}`,
        },
      });

      if (error) {
        setErrorMsg(
          error.message || "No se pudo iniciar sesión con Google."
        );
        setGoogleLoading(false);
      }
    } catch {
      setErrorMsg("Ocurrió un error inesperado al iniciar sesión con Google.");
      setGoogleLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setErrorMsg(
        "Supabase no está configurado. Define NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
      );
      return;
    }

    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setErrorMsg("Ingresa tu correo electrónico y contraseña.");
      return;
    }

    if (mode === "register") {
      if (!nombre.trim()) {
        setErrorMsg("Ingresa tu nombre completo.");
        return;
      }
      if (password.length < 8) {
        setErrorMsg("La contraseña debe tener al menos 8 caracteres.");
        return;
      }
      if (!consentimiento) {
        setErrorMsg(
          "Debes aceptar la Política de Privacidad (Ley 29733) para registrarte."
        );
        return;
      }
    }

    setLoading(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });

        if (error) {
          setErrorMsg(
            error.message === "Invalid login credentials"
              ? "Correo o contraseña incorrectos."
              : error.message
          );
          return;
        }

        router.replace(redirectTo);
        router.refresh();
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: {
              nombre: nombre.trim(),
            },
          },
        });

        if (error) {
          setErrorMsg(error.message);
          return;
        }

        if (data.session) {
          router.replace(redirectTo);
          router.refresh();
        } else {
          setInfoMsg(
            "Cuenta creada correctamente. Revisa tu correo electrónico para confirmar tu registro y luego inicia sesión."
          );
          setMode("login");
          setPassword("");
        }
      }
    } catch {
      setErrorMsg("Ocurrió un error inesperado al conectar con autenticación.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-12rem)] max-w-md flex-col justify-center px-4 py-12 sm:px-6">
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 transition hover:text-brand-900"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Volver al Portal
      </Link>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-800 text-white shadow-sm">
            <ShieldAlert className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              {mode === "login" ? "Iniciar Sesión" : "Crear Cuenta"}
            </h1>
            <p className="text-xs text-slate-500">
              Asociación Bello Horizonte · Acceso Directiva y Vecinos
            </p>
          </div>
        </div>

        {/* Selector de modo */}
        <div className="mt-6 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setErrorMsg(null);
            }}
            className={`rounded-lg py-2 text-sm font-semibold transition ${
              mode === "login"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Ingresar
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("register");
              setErrorMsg(null);
            }}
            className={`rounded-lg py-2 text-sm font-semibold transition ${
              mode === "register"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Registrarse
          </button>
        </div>

        {!configured && (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900">
            <strong>Configuración pendiente:</strong> Define{" "}
            <code>NEXT_PUBLIC_SUPABASE_URL</code> y{" "}
            <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> en{" "}
            <code>web/.env.local</code>.
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            className="mt-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800"
          >
            <AlertCircle
              className="mt-0.5 h-4 w-4 shrink-0 text-red-600"
              aria-hidden="true"
            />
            <span>{errorMsg}</span>
          </div>
        )}

        {infoMsg && (
          <div
            role="status"
            className="mt-5 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm text-emerald-800"
          >
            <CheckCircle2
              className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
              aria-hidden="true"
            />
            <span>{infoMsg}</span>
          </div>
        )}

        {/* Botón Google OAuth */}
        <div className="mt-5">
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={googleLoading || loading || !configured}
            className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {googleLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Conectando con Google...
              </>
            ) : (
              <>
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    fill="#4285F4"
                    d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.08 3.56-5.15 3.56-8.65z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.87-3c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.29v3.09A12 12 0 0 0 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.29 14.29A7.2 7.2 0 0 1 4.91 12c0-.79.14-1.56.38-2.29V6.62H1.29A12 12 0 0 0 0 12c0 1.94.46 3.77 1.29 5.38l4-3.09z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.76c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.62l4 3.09c.94-2.84 3.59-4.95 6.71-4.95z"
                  />
                </svg>
                Continuar con Google
              </>
            )}
          </button>

          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-2.5 text-slate-500">
                o continúa con tu correo
              </span>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "register" && (
            <div>
              <label
                htmlFor="nombre"
                className="block text-xs font-semibold uppercase tracking-wide text-slate-700"
              >
                Nombre completo
              </label>
              <div className="relative mt-1.5">
                <User
                  className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  id="nombre"
                  type="text"
                  required
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Ej. María Quispe Mendoza"
                  className="w-full rounded-xl border border-slate-300 py-2.5 pl-9 pr-3.5 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </div>
            </div>
          )}

          <div>
            <label
              htmlFor="email"
              className="block text-xs font-semibold uppercase tracking-wide text-slate-700"
            >
              Correo electrónico
            </label>
            <div className="relative mt-1.5">
              <Mail
                className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400"
                aria-hidden="true"
              />
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vecino@ejemplo.pe"
                className="w-full rounded-xl border border-slate-300 py-2.5 pl-9 pr-3.5 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-200"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-xs font-semibold uppercase tracking-wide text-slate-700"
            >
              Contraseña
            </label>
            <div className="relative mt-1.5">
              <Lock
                className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400"
                aria-hidden="true"
              />
              <input
                id="password"
                type="password"
                required
                minLength={8}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl border border-slate-300 py-2.5 pl-9 pr-3.5 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-200"
              />
            </div>
          </div>

          {mode === "register" && (
            <label className="flex items-start gap-2.5 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={consentimiento}
                onChange={(e) => setConsentimiento(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500"
              />
              <span>
                Acepto el tratamiento de mis datos personales conforme a la{" "}
                <Link
                  href="/privacidad"
                  className="font-semibold text-brand-700 underline hover:text-brand-900"
                >
                  Política de Privacidad (Ley N.° 29733)
                </Link>
                .
              </span>
            </label>
          )}

          <button
            type="submit"
            disabled={loading || googleLoading || !configured}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Procesando...
              </>
            ) : mode === "login" ? (
              "Iniciar sesión"
            ) : (
              "Registrarme"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-brand-700" />
        </div>
      }
    >
      <LoginFormContent />
    </Suspense>
  );
}
