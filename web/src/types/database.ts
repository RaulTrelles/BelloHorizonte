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

// ============================================================================
// Entrega B: Reuniones, Grabaciones, Transcripciones y Actas (Fases 5-7)
// ============================================================================

export type MeetingStatus =
  | "programada"
  | "en_curso"
  | "finalizada"
  | "cancelada";

export type AttendanceResponse = "asistire" | "no_asistire" | "pendiente";

export type RecordingStatus =
  | "grabando"
  | "subido"
  | "transcribiendo"
  | "transcrito"
  | "error"
  | "eliminado";

export type MinuteStatus =
  | "borrador"
  | "revision"
  | "aprobada"
  | "asentada_en_libro";

export type MinuteSignatureType = "acuse_recibo" | "conformidad_simple";

export interface MeetingAgreement {
  acuerdo: string;
  responsable?: string;
  plazo?: string;
}

export interface MeetingRow {
  id: string;
  group_id: string;
  titulo: string;
  fecha: string;
  lugar: string | null;
  agenda: string | null;
  estado: MeetingStatus;
  created_by: string | null;
  created_at: string;
}

export interface MeetingAttendanceRow {
  id: string;
  meeting_id: string;
  user_id: string;
  respuesta: AttendanceResponse;
  asistio: boolean;
  updated_at: string;
}

export interface RecordingRow {
  id: string;
  meeting_id: string;
  storage_path: string | null;
  consentimientos: Record<string, unknown> | unknown[] | null;
  estado: RecordingStatus;
  created_at: string;
}

export interface TranscriptRow {
  id: string;
  recording_id: string;
  texto: string;
  proveedor: string | null;
  created_at: string;
}

export interface MinuteRow {
  id: string;
  meeting_id: string;
  contenido: string;
  estado: MinuteStatus;
  pdf_path: string | null;
  hash_sha256: string | null;
  plazo_observaciones_hasta: string | null;
  aprobada_por: string | null;
  created_at: string;
}

export interface MinuteSignatureRow {
  id: string;
  minute_id: string;
  user_id: string;
  tipo: MinuteSignatureType;
  firmado_at: string;
  firma_texto: string | null;
  dispositivo_meta: Record<string, unknown> | null;
}
