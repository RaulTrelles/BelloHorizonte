import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

/**
 * Columnas explícitas permitidas por RLS/privilegios de columna.
 * - `groups`: nunca seleccionar `codigo` ni `*`.
 * - `profiles`: nunca seleccionar `fcm_token` ni `*`.
 */
export const GROUP_SAFE_COLUMNS = "id, nombre, lat, lng, created_at" as const;
export const PROFILE_SAFE_COLUMNS =
  "id, nombre, telefono, direccion_lote, device_brand, consentimiento_datos, consentimiento_at, created_at, updated_at" as const;

export function isSupabaseConfigured(): boolean {
  return Boolean(
    SUPABASE_URL.trim() &&
      SUPABASE_PUBLISHABLE_KEY.trim() &&
      !SUPABASE_URL.includes("tu-proyecto.supabase.co")
  );
}

let browserClient: SupabaseClient | null = null;

/**
 * Cliente Supabase para componentes del navegador (auth persistente + Realtime).
 * Usa exclusivamente NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
 */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) {
    return null;
  }

  if (!browserClient) {
    browserClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  return browserClient;
}

/**
 * Cliente Supabase sin sesión persistente para lecturas públicas `anon` en Server Components.
 * Usa exclusivamente NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
 */
export function createSupabasePublicClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) {
    return null;
  }

  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
