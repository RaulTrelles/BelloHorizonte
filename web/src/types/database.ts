export type MemberRole = "admin" | "presidente" | "secretario" | "miembro";
export type MemberStatus = "pendiente" | "activo" | "suspendido";
export type AlertStatus = "activa" | "resuelta" | "falsa_alarma";
export type AlertAckType = "recibido" | "enterado" | "silenciado_1m";
export type AnnouncementPriority = "normal" | "importante" | "urgente";

export interface EmergencyPhone {
  nombre: string;
  numero: string;
  tipo?: string;
}

export interface BoardMember {
  cargo: string;
  nombre: string;
}

/**
 * Columnas seguras de public.groups (excluye `codigo`, revocado a nivel de columna).
 * El código de invitación solo se obtiene vía RPC `get_group_invite_code(p_group_id)`.
 */
export interface GroupRow {
  id: string;
  nombre: string;
  lat: number | null;
  lng: number | null;
  created_at: string;
}

/**
 * Columnas seguras de public.profiles (excluye `fcm_token`, revocado a nivel de columna).
 */
export interface ProfileRow {
  id: string;
  nombre: string;
  telefono: string | null;
  direccion_lote: string | null;
  device_brand: string | null;
  consentimiento_datos: boolean;
  consentimiento_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MembershipRow {
  id: string;
  group_id: string;
  user_id: string;
  rol: MemberRole;
  estado: MemberStatus;
  aprobado_por: string | null;
  created_at: string;
}

export interface AlertRow {
  id: string;
  group_id: string;
  user_id: string;
  tipo: string;
  mensaje: string | null;
  lat: number | null;
  lng: number | null;
  estado: AlertStatus;
  created_at: string;
  closed_at: string | null;
  closed_by: string | null;
}

export interface AlertAckRow {
  id: string;
  alert_id: string;
  user_id: string;
  tipo_ack: AlertAckType;
  recibido_at: string;
}

export interface AssociationInfoRow {
  id: string;
  group_id: string;
  titulo: string;
  descripcion: string | null;
  direccion: string | null;
  telefonos_emergencia: EmergencyPhone[];
  directiva: BoardMember[];
  politica_privacidad_url: string | null;
  updated_at: string;
}

export interface AnnouncementRow {
  id: string;
  group_id: string;
  author_id: string | null;
  titulo: string;
  contenido: string;
  prioridad: AnnouncementPriority;
  publicado: boolean;
  published_at: string;
  created_at: string;
}

export interface GroupMemberName {
  user_id: string;
  nombre: string;
}
