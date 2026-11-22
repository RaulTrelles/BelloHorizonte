export type MembershipRole = 'admin' | 'presidente' | 'secretario' | 'miembro';
export type MembershipStatus = 'pendiente' | 'activo' | 'suspendido';
export type AlertStatus = 'activa' | 'resuelta' | 'falsa_alarma';
export type AlertAckType = 'recibido' | 'enterado' | 'silenciado_1m';
export type AnnouncementPriority = 'normal' | 'importante' | 'urgente';

export interface ProfileRecord {
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

export interface GroupInfo {
  id: string;
  nombre: string;
  lat: number | null;
  lng: number | null;
  created_at: string;
}

export interface MembershipRecord {
  id: string;
  group_id: string;
  user_id: string;
  rol: MembershipRole;
  estado: MembershipStatus;
  aprobado_por: string | null;
  created_at: string;
}

export interface MembershipWithGroup extends MembershipRecord {
  group: GroupInfo;
}

export interface MembershipWithProfile extends MembershipRecord {
  profile: Pick<
    ProfileRecord,
    'id' | 'nombre' | 'telefono' | 'direccion_lote' | 'device_brand'
  > | null;
}

export interface JoinGroupResult {
  group_id: string;
  group_name: string;
  membership_id: string;
  rol: MembershipRole;
  estado: MembershipStatus;
  already_member: boolean;
}

export interface MemberNameRow {
  user_id: string;
  nombre: string;
}

export interface AlertRecord {
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

export interface AlertAckRecord {
  id: string;
  alert_id: string;
  user_id: string;
  tipo_ack: AlertAckType;
  recibido_at: string;
}

export interface AlertWithDetails extends AlertRecord {
  authorName: string;
  acks: Array<AlertAckRecord & { userName: string }>;
}

export interface EmergencyPhoneItem {
  nombre: string;
  numero: string;
}

export interface BoardMemberItem {
  cargo: string;
  nombre: string;
}

export interface AssociationInfoRecord {
  id: string;
  group_id: string;
  titulo: string;
  descripcion: string | null;
  direccion: string | null;
  telefonos_emergencia: EmergencyPhoneItem[];
  directiva: BoardMemberItem[];
  politica_privacidad_url: string | null;
  updated_at: string;
}

export interface AnnouncementRecord {
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

// ============================================================================
// Fases 5–7: Reuniones, Grabación con Consentimiento y Actas (Ley 29733)
// ============================================================================

export type MeetingStatus = 'programada' | 'en_curso' | 'finalizada' | 'cancelada';
export type AttendanceResponse = 'asistire' | 'no_asistire' | 'pendiente';
export type RecordingStatus =
  | 'grabando'
  | 'subido'
  | 'transcribiendo'
  | 'transcrito'
  | 'error'
  | 'eliminado';
export type MinuteStatus = 'borrador' | 'revision' | 'aprobada' | 'asentada_en_libro';
export type MinuteSignatureType = 'acuse_recibo' | 'conformidad_simple';

export interface MeetingRecord {
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

export interface MeetingAttendanceRecord {
  id: string;
  meeting_id: string;
  user_id: string;
  respuesta: AttendanceResponse;
  asistio: boolean | null;
  updated_at: string;
}

export interface RecordingRecord {
  id: string;
  meeting_id: string;
  storage_path: string | null;
  consentimientos: Record<string, unknown>;
  estado: RecordingStatus;
  chunk_index?: number | null;
  duration_seconds?: number | null;
  created_by?: string | null;
  created_at: string;
}

export interface TranscriptRecord {
  id: string;
  recording_id: string;
  texto: string;
  proveedor: string | null;
  created_at: string;
}

export interface MinuteRecord {
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

export interface MinuteSignatureRecord {
  id: string;
  minute_id: string;
  user_id: string;
  tipo: MinuteSignatureType;
  firmado_at: string;
  firma_texto: string | null;
  dispositivo_meta: Record<string, unknown> | null;
}

export interface MeetingDetailsBundle {
  meeting: MeetingRecord;
  attendance: Array<MeetingAttendanceRecord & { userName: string }>;
  recordings: RecordingRecord[];
  transcripts: TranscriptRecord[];
  minute: MinuteRecord | null;
  signatures: Array<MinuteSignatureRecord & { userName: string }>;
}
