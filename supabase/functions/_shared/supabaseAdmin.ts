/**
 * Utilidades compartidas de Supabase Admin (service/secret key) y tipos de Database Webhook
 * para las Edge Functions de alertas de pánico.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

export interface AlertRecord {
  id: string;
  group_id: string;
  user_id: string;
  tipo?: string | null;
  mensaje?: string | null;
  lat?: number | null;
  lng?: number | null;
  estado: string;
  created_at?: string | null;
  closed_at?: string | null;
  closed_by?: string | null;
}

export interface SupabaseWebhookPayload<T> {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  schema: string;
  record: T | null;
  old_record: T | null;
}

/**
 * Crea un cliente Supabase administrativo leyendo las credenciales desde `Deno.env`.
 * Soporta `SUPABASE_SECRET_KEY` (nuevo estándar) y `SUPABASE_SERVICE_ROLE_KEY` como fallback.
 */
export function createSupabaseAdminClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey =
    Deno.env.get('SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      'Faltan variables de entorno SUPABASE_URL y/o SUPABASE_SECRET_KEY (o SUPABASE_SERVICE_ROLE_KEY).',
    );
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

const PROFILE_ID_CHUNK_SIZE = 100;
const TOKEN_CLEANUP_CHUNK_SIZE = 50;

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Consulta todos los `profiles.fcm_token` no nulos de miembros con `memberships.estado = 'activo'`
 * en el grupo indicado. Opcionalmente excluye a un usuario (ej. el emisor de la alerta).
 * Divide `.in('id', userIds)` en lotes de 100 para evitar límites de longitud de URL en PostgREST.
 */
export async function getActiveGroupFcmTokens(
  supabase: SupabaseClient,
  groupId: string,
  excludeUserId?: string,
): Promise<string[]> {
  let membershipQuery = supabase
    .from('memberships')
    .select('user_id')
    .eq('group_id', groupId)
    .eq('estado', 'activo');

  if (excludeUserId) {
    membershipQuery = membershipQuery.neq('user_id', excludeUserId);
  }

  const { data: memberships, error: membershipsError } = await membershipQuery;
  if (membershipsError) {
    throw new Error(`Error al consultar membresías activas: ${membershipsError.message}`);
  }

  const userIds = Array.from(
    new Set(
      (memberships ?? [])
        .map((m: { user_id: string | null }) => m.user_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  );

  if (userIds.length === 0) {
    return [];
  }

  const uniqueTokens = new Set<string>();
  const idChunks = chunkArray(userIds, PROFILE_ID_CHUNK_SIZE);

  for (const chunk of idChunks) {
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('fcm_token')
      .in('id', chunk)
      .not('fcm_token', 'is', null);

    if (profilesError) {
      throw new Error(`Error al consultar tokens FCM de perfiles: ${profilesError.message}`);
    }

    for (const profile of profiles ?? []) {
      const token = typeof profile.fcm_token === 'string' ? profile.fcm_token.trim() : '';
      if (token.length > 0) {
        uniqueTokens.add(token);
      }
    }
  }

  return Array.from(uniqueTokens);
}

/**
 * Limpia (`fcm_token = null`) los tokens que FCM reportó como inválidos / UNREGISTERED.
 */
export async function clearUnregisteredTokens(
  supabase: SupabaseClient,
  unregisteredTokens: string[],
): Promise<number> {
  if (unregisteredTokens.length === 0) {
    return 0;
  }

  const uniqueTokens = Array.from(new Set(unregisteredTokens));
  const tokenChunks = chunkArray(uniqueTokens, TOKEN_CLEANUP_CHUNK_SIZE);
  let cleanedCount = 0;

  for (const chunk of tokenChunks) {
    const { error } = await supabase
      .from('profiles')
      .update({ fcm_token: null })
      .in('fcm_token', chunk);

    if (error) {
      console.error('[fcm-cleanup] Error al limpiar tokens inválidos en profiles:', error.message);
      continue;
    }

    cleanedCount += chunk.length;
  }

  return cleanedCount;
}

/**
 * Helper para respuestas JSON consistentes.
 */
export function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}
