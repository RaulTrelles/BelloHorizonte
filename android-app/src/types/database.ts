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
