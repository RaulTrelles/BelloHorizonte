import type { Session, User } from '@supabase/supabase-js';
import * as WebBrowser from 'expo-web-browser';
import { Linking, Platform } from 'react-native';
import type {
  AlertAckRecord,
  AlertAckType,
  AlertRecord,
  AlertStatus,
  AlertWithDetails,
  AnnouncementRecord,
  AssociationInfoRecord,
  BoardMemberItem,
  EmergencyPhoneItem,
  GroupInfo,
  JoinGroupResult,
  MemberNameRow,
  MembershipRecord,
  MembershipRole,
  MembershipStatus,
  MembershipWithGroup,
  MembershipWithProfile,
  ProfileRecord,
} from '../types/database';
import { getSupabaseClient } from './supabaseClient';

export const OAUTH_REDIRECT_URI = 'pe.bellohorizonte.alarma://auth-callback';

/**
 * Visibilidad estricta de controles de prueba/simulación de alarma (BH-025):
 * SOLO administradores (`rol === 'admin'`) pueden verlos y ejecutarlos.
 */
export function canUseAdminTestControls(role: MembershipRole | null | undefined): boolean {
  return role === 'admin';
}

// Columnas explícitas para respetar los privilegios de columna (RLS / Ley 29733):
// - En groups: NUNCA seleccionar `codigo`
// - En profiles: NUNCA seleccionar `fcm_token`
export const GROUPS_SAFE_COLUMNS = 'id, nombre, lat, lng, created_at';
export const PROFILES_SAFE_COLUMNS =
  'id, nombre, telefono, direccion_lote, device_brand, consentimiento_datos, consentimiento_at, created_at, updated_at';
export const ADMIN_PROFILES_SAFE_COLUMNS =
  'id, nombre, telefono, direccion_lote, device_brand';

export class CooldownActiveError extends Error {
  readonly code = 'COOLDOWN_ACTIVE';

  constructor(message = 'Espera 2 minutos antes de enviar otra alerta.') {
    super(message);
    this.name = 'CooldownActiveError';
  }
}

export function isCooldownError(error: unknown): boolean {
  if (error instanceof CooldownActiveError) {
    return true;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const msg = String((error as { message?: unknown }).message ?? '');
    return msg.includes('COOLDOWN_ACTIVE');
  }
  return false;
}

export function getDeviceBrandLabel(): string {
  const constants = Platform.constants as
    | { Brand?: string; Manufacturer?: string; Model?: string }
    | undefined;
  const brand = constants?.Brand || constants?.Manufacturer || '';
  const model = constants?.Model || '';
  const combined = [brand, model].filter(Boolean).join(' ').trim();
  return combined || Platform.OS;
}

// ============================================================================
// Autenticación
// ============================================================================

export async function getCurrentSession(): Promise<Session | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }
  return data.session;
}

export async function signInWithEmail(email: string, password: string): Promise<Session> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) {
    throw error;
  }
  if (!data.session) {
    throw new Error('No se pudo iniciar sesión. Verifica tus credenciales.');
  }
  return data.session;
}

export async function signUpWithEmail(
  email: string,
  password: string,
  nombre: string
): Promise<{ session: Session | null; user: User | null }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: {
      data: {
        nombre: nombre.trim(),
      },
    },
  });
  if (error) {
    throw error;
  }
  return { session: data.session, user: data.user };
}

export async function signOutUser(): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw error;
  }
}

export interface OAuthCallbackParams {
  code?: string;
  accessToken?: string;
  refreshToken?: string;
  errorDescription?: string;
}

/**
 * Extrae parámetros PKCE (`?code=...`) o tokens implícitos (`#access_token=...&refresh_token=...`)
 * desde la URL de retorno de OAuth.
 */
export function extractOAuthCallbackParams(callbackUrl: string): OAuthCallbackParams {
  const queryStart = callbackUrl.indexOf('?');
  const hashStart = callbackUrl.indexOf('#');

  const queryString =
    queryStart !== -1
      ? callbackUrl.slice(queryStart + 1, hashStart !== -1 && hashStart > queryStart ? hashStart : undefined)
      : '';
  const hashString = hashStart !== -1 ? callbackUrl.slice(hashStart + 1) : '';

  const queryParams = new URLSearchParams(queryString);
  const hashParams = new URLSearchParams(hashString);

  const code = queryParams.get('code') || hashParams.get('code') || undefined;
  const accessToken =
    hashParams.get('access_token') || queryParams.get('access_token') || undefined;
  const refreshToken =
    hashParams.get('refresh_token') || queryParams.get('refresh_token') || undefined;
  const errorDescription =
    queryParams.get('error_description') ||
    hashParams.get('error_description') ||
    queryParams.get('error') ||
    hashParams.get('error') ||
    undefined;

  return {
    code,
    accessToken,
    refreshToken,
    errorDescription,
  };
}

/**
 * Inicia sesión con Google OAuth (PKCE) mediante expo-web-browser.
 */
export async function signInWithGoogle(): Promise<{
  cancelled: boolean;
  session: Session | null;
}> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: OAUTH_REDIRECT_URI,
      skipBrowserRedirect: true,
    },
  });

  if (error) {
    throw error;
  }
  if (!data?.url) {
    throw new Error('No se pudo obtener la URL de autenticación de Google.');
  }

  const authResult = await WebBrowser.openAuthSessionAsync(data.url, OAUTH_REDIRECT_URI);

  if (authResult.type !== 'success' || !authResult.url) {
    return { cancelled: true, session: null };
  }

  const parsed = extractOAuthCallbackParams(authResult.url);
  if (parsed.errorDescription) {
    throw new Error(parsed.errorDescription);
  }

  if (parsed.code) {
    const { data: exchangeData, error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(parsed.code);
    if (exchangeError) {
      throw exchangeError;
    }
    return { cancelled: false, session: exchangeData.session };
  }

  if (parsed.accessToken && parsed.refreshToken) {
    const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
      access_token: parsed.accessToken,
      refresh_token: parsed.refreshToken,
    });
    if (sessionError) {
      throw sessionError;
    }
    return { cancelled: false, session: sessionData.session };
  }

  throw new Error('La respuesta de Google OAuth no incluyó código ni sesión válida.');
}

// ============================================================================
// Perfil, Membresía y Token FCM
// ============================================================================

export async function joinGroupByCode(params: {
  codigo: string;
  nombre: string;
  telefono: string;
  consentimiento: boolean;
  direccionLote?: string;
}): Promise<JoinGroupResult> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('join_group_by_code', {
    p_codigo: params.codigo.trim().toUpperCase(),
    p_nombre: params.nombre.trim(),
    p_telefono: params.telefono.trim(),
    p_consentimiento: params.consentimiento,
    p_direccion_lote: params.direccionLote?.trim() || null,
  });

  if (error) {
    throw error;
  }
  return data as JoinGroupResult;
}

export async function getMyProfile(userId: string): Promise<ProfileRecord | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILES_SAFE_COLUMNS)
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  return (data as ProfileRecord | null) ?? null;
}

export async function getMyMembershipWithGroup(
  userId: string
): Promise<MembershipWithGroup | null> {
  const supabase = getSupabaseClient();

  const { data: memberships, error: memError } = await supabase
    .from('memberships')
    .select('id, group_id, user_id, rol, estado, aprobado_por, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(5);

  if (memError) {
    throw memError;
  }

  const rows = (memberships as MembershipRecord[] | null) ?? [];
  if (rows.length === 0) {
    return null;
  }

  // Priorizar membresía activa si existiera más de una
  const chosen = rows.find((m) => m.estado === 'activo') ?? rows[0];

  const { data: groupData, error: groupError } = await supabase
    .from('groups')
    .select(GROUPS_SAFE_COLUMNS)
    .eq('id', chosen.group_id)
    .maybeSingle();

  if (groupError) {
    throw groupError;
  }

  const group: GroupInfo = (groupData as GroupInfo | null) ?? {
    id: chosen.group_id,
    nombre: 'Asociación Bello Horizonte',
    lat: null,
    lng: null,
    created_at: chosen.created_at,
  };

  return {
    ...chosen,
    group,
  };
}

export async function updateMyFcmToken(
  fcmToken: string,
  deviceBrand?: string
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc('update_my_fcm_token', {
    p_fcm_token: fcmToken,
    p_device_brand: deviceBrand ?? getDeviceBrandLabel(),
  });
  if (error) {
    throw error;
  }
}

export async function getGroupMemberNamesMap(
  groupId: string
): Promise<Map<string, string>> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('get_group_member_names', {
    p_group_id: groupId,
  });

  if (error) {
    throw error;
  }

  const rows = (data as MemberNameRow[] | null) ?? [];
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.user_id, row.nombre || 'Vecino');
  }
  return map;
}

// ============================================================================
// Alertas de Pánico, ACKs e Historial + Realtime
// ============================================================================

export async function createPanicAlert(params: {
  groupId: string;
  userId: string;
  mensaje?: string;
  lat?: number | null;
  lng?: number | null;
}): Promise<AlertRecord> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('alerts')
    .insert({
      group_id: params.groupId,
      user_id: params.userId,
      tipo: 'robo_cuadra',
      mensaje: params.mensaje?.trim() || '¡ALERTA! Robo en la cuadra',
      lat: typeof params.lat === 'number' && Number.isFinite(params.lat) ? params.lat : null,
      lng: typeof params.lng === 'number' && Number.isFinite(params.lng) ? params.lng : null,
    })
    .select('id, group_id, user_id, tipo, mensaje, lat, lng, estado, created_at, closed_at, closed_by')
    .single();

  if (error) {
    if (error.message?.includes('COOLDOWN_ACTIVE')) {
      throw new CooldownActiveError(
        'Ya enviaste una alerta hace menos de 2 minutos. Espera un momento antes de enviar otra.'
      );
    }
    throw error;
  }

  return data as AlertRecord;
}

export async function acknowledgeAlert(
  alertId: string,
  userId: string,
  tipoAck: AlertAckType
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('alert_acks').insert({
    alert_id: alertId,
    user_id: userId,
    tipo_ack: tipoAck,
  });

  if (error) {
    // 23505 = unique_violation (ya confirmó este tipo_ack para esta alerta)
    if (error.code === '23505') {
      return;
    }
    throw error;
  }
}

export async function closePanicAlert(
  alertId: string,
  estado: Extract<AlertStatus, 'resuelta' | 'falsa_alarma'>
): Promise<AlertRecord> {
  const supabase = getSupabaseClient();
  // Solo enviar `estado` para respetar trg_alerts_immutable_fields
  const { data, error } = await supabase
    .from('alerts')
    .update({ estado })
    .eq('id', alertId)
    .select('id, group_id, user_id, tipo, mensaje, lat, lng, estado, created_at, closed_at, closed_by')
    .single();

  if (error) {
    throw error;
  }

  return data as AlertRecord;
}

export async function getGroupAlertsHistory(
  groupId: string,
  limit: number = 30
): Promise<AlertWithDetails[]> {
  const supabase = getSupabaseClient();

  const [alertsRes, namesMap] = await Promise.all([
    supabase
      .from('alerts')
      .select('id, group_id, user_id, tipo, mensaje, lat, lng, estado, created_at, closed_at, closed_by')
      .eq('group_id', groupId)
      .order('created_at', { ascending: false })
      .limit(limit),
    getGroupMemberNamesMap(groupId).catch(() => new Map<string, string>()),
  ]);

  if (alertsRes.error) {
    throw alertsRes.error;
  }

  const alerts = (alertsRes.data as AlertRecord[] | null) ?? [];
  if (alerts.length === 0) {
    return [];
  }

  const alertIds = alerts.map((a) => a.id);
  const { data: acksData, error: acksError } = await supabase
    .from('alert_acks')
    .select('id, alert_id, user_id, tipo_ack, recibido_at')
    .in('alert_id', alertIds)
    .order('recibido_at', { ascending: true });

  if (acksError) {
    throw acksError;
  }

  const acksByAlert = new Map<string, Array<AlertAckRecord & { userName: string }>>();
  for (const ack of (acksData as AlertAckRecord[] | null) ?? []) {
    const list = acksByAlert.get(ack.alert_id) ?? [];
    list.push({
      ...ack,
      userName: namesMap.get(ack.user_id) ?? 'Vecino',
    });
    acksByAlert.set(ack.alert_id, list);
  }

  return alerts.map((alert) => ({
    ...alert,
    authorName: namesMap.get(alert.user_id) ?? 'Vecino',
    acks: acksByAlert.get(alert.id) ?? [],
  }));
}

export function subscribeToGroupAlertsRealtime(
  groupId: string,
  onChange: () => void
): () => void {
  const supabase = getSupabaseClient();
  const channel = supabase
    .channel(`bh-group-alerts-${groupId}-${Date.now()}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'alerts',
        filter: `group_id=eq.${groupId}`,
      },
      () => {
        onChange();
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'alert_acks',
      },
      () => {
        onChange();
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel).catch(() => {});
  };
}

// ============================================================================
// Portal de Asociación Bello Horizonte (Info + Comunicados)
// ============================================================================

export async function getAssociationInfo(
  groupId: string
): Promise<AssociationInfoRecord | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('association_info')
    .select(
      'id, group_id, titulo, descripcion, direccion, telefonos_emergencia, directiva, politica_privacidad_url, updated_at'
    )
    .eq('group_id', groupId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    group_id: String(row.group_id),
    titulo: String(row.titulo ?? 'Asociación Bello Horizonte'),
    descripcion: typeof row.descripcion === 'string' ? row.descripcion : null,
    direccion: typeof row.direccion === 'string' ? row.direccion : null,
    telefonos_emergencia: Array.isArray(row.telefonos_emergencia)
      ? (row.telefonos_emergencia as EmergencyPhoneItem[])
      : [],
    directiva: Array.isArray(row.directiva) ? (row.directiva as BoardMemberItem[]) : [],
    politica_privacidad_url:
      typeof row.politica_privacidad_url === 'string' ? row.politica_privacidad_url : null,
    updated_at: String(row.updated_at ?? ''),
  };
}

export async function getAnnouncements(
  groupId: string,
  limit: number = 10
): Promise<AnnouncementRecord[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('announcements')
    .select('id, group_id, author_id, titulo, contenido, prioridad, publicado, published_at, created_at')
    .eq('group_id', groupId)
    .eq('publicado', true)
    .order('published_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data as AnnouncementRecord[] | null) ?? [];
}

// ============================================================================
// Administración (solo rol === 'admin')
// ============================================================================

export async function getGroupMembersForAdmin(
  groupId: string
): Promise<MembershipWithProfile[]> {
  const supabase = getSupabaseClient();
  const { data: membershipsData, error: memError } = await supabase
    .from('memberships')
    .select('id, group_id, user_id, rol, estado, aprobado_por, created_at')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false });

  if (memError) {
    throw memError;
  }

  const memberships = (membershipsData as MembershipRecord[] | null) ?? [];
  if (memberships.length === 0) {
    return [];
  }

  const userIds = memberships.map((m) => m.user_id);
  const { data: profilesData, error: profError } = await supabase
    .from('profiles')
    .select(ADMIN_PROFILES_SAFE_COLUMNS)
    .in('id', userIds);

  if (profError) {
    throw profError;
  }

  const profileMap = new Map<
    string,
    Pick<ProfileRecord, 'id' | 'nombre' | 'telefono' | 'direccion_lote' | 'device_brand'>
  >();
  for (const p of (profilesData as Array<
    Pick<ProfileRecord, 'id' | 'nombre' | 'telefono' | 'direccion_lote' | 'device_brand'>
  > | null) ?? []) {
    profileMap.set(p.id, p);
  }

  return memberships.map((m) => ({
    ...m,
    profile: profileMap.get(m.user_id) ?? null,
  }));
}

export async function updateMembershipStatus(
  membershipId: string,
  estado: Extract<MembershipStatus, 'activo' | 'suspendido'>,
  adminUserId: string
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('memberships')
    .update({
      estado,
      aprobado_por: adminUserId,
    })
    .eq('id', membershipId);

  if (error) {
    throw error;
  }
}

export async function getGroupInviteCode(groupId: string): Promise<string> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('get_group_invite_code', {
    p_group_id: groupId,
  });
  if (error) {
    throw error;
  }
  return String(data ?? '');
}

export async function regenerateGroupInviteCode(groupId: string): Promise<string> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('regenerate_group_code', {
    p_group_id: groupId,
  });
  if (error) {
    throw error;
  }
  return String(data ?? '');
}

// ============================================================================
// Privacidad (Ley 29733 — Derecho de cancelación)
// ============================================================================

export async function deleteMyAccount(): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc('delete_my_account');
  if (error) {
    throw error;
  }
  await supabase.auth.signOut().catch(() => {});
}

// ============================================================================
// Compartir gratis por WhatsApp (wa.me)
// ============================================================================

export function buildWhatsAppShareUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

export function buildPanicAlertWhatsAppText(params: {
  groupName: string;
  senderName: string;
  timeLabel: string;
  lat?: string | number | null;
  lng?: string | number | null;
}): string {
  const lines = [
    `🚨 ¡ALERTA! Robo en la cuadra – ${params.senderName} avisó a las ${params.timeLabel}`,
    `Grupo: ${params.groupName}`,
  ];
  const latStr =
    params.lat !== undefined && params.lat !== null ? String(params.lat).trim() : '';
  const lngStr =
    params.lng !== undefined && params.lng !== null ? String(params.lng).trim() : '';
  if (latStr.length > 0 && lngStr.length > 0) {
    lines.push(
      `Ubicación: https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${latStr},${lngStr}`
      )}`
    );
  }
  lines.push('Emergencia PNP / Serenazgo Perú: 105');
  return lines.join('\n');
}

export function buildInviteWhatsAppText(params: {
  groupName: string;
  inviteCode: string;
}): string {
  return [
    `👋 Únete a la Alarma Vecinal de *${params.groupName}*`,
    `Código de invitación: *${params.inviteCode}*`,
    'Descarga la app, regístrate con este código y un administrador aprobará tu ingreso.',
  ].join('\n');
}

export async function openWhatsAppShare(message: string): Promise<void> {
  const url = buildWhatsAppShareUrl(message);
  await Linking.openURL(url);
}
