import type {
  AnnouncementRow,
  AssociationInfoRow,
  BoardMember,
  EmergencyPhone,
} from "@/types/database";

export const DEFAULT_EMERGENCY_PHONES: EmergencyPhone[] = [
  {
    nombre: "Policía Nacional del Perú (PNP)",
    numero: "105",
    tipo: "emergencia",
  },
  {
    nombre: "Serenazgo Municipal",
    numero: "+51 01 000 0000",
    tipo: "serenazgo",
  },
  {
    nombre: "Bomberos Voluntarios",
    numero: "116",
    tipo: "emergencia",
  },
  {
    nombre: "SAMU Emergencias Médicas",
    numero: "106",
    tipo: "salud",
  },
];

export const DEFAULT_DIRECTIVA: BoardMember[] = [
  { cargo: "Presidente", nombre: "Directiva Asociación Bello Horizonte" },
  { cargo: "Secretario", nombre: "Secretaría General" },
  { cargo: "Administrador de Seguridad (Titular)", nombre: "Comité de Seguridad" },
  { cargo: "Administrador de Seguridad (Suplente)", nombre: "Comité de Seguridad" },
];

export const DEFAULT_ASSOCIATION_INFO: AssociationInfoRow = {
  id: "default-association-info",
  group_id: "11111111-1111-4111-8111-111111111111",
  titulo: "Asociación Bello Horizonte",
  descripcion:
    "Organización vecinal dedicada a la seguridad ciudadana, alerta temprana comunitaria y bienestar de las familias de Bello Horizonte.",
  direccion: "Urbanización Bello Horizonte, Perú",
  telefonos_emergencia: DEFAULT_EMERGENCY_PHONES,
  directiva: DEFAULT_DIRECTIVA,
  politica_privacidad_url: "/privacidad",
  updated_at: new Date().toISOString(),
};

export const DEFAULT_ANNOUNCEMENTS: AnnouncementRow[] = [
  {
    id: "default-welcome-announcement",
    group_id: "11111111-1111-4111-8111-111111111111",
    author_id: null,
    titulo:
      "Bienvenidos al Portal y Alarma Vecinal de Asociación Bello Horizonte",
    contenido:
      "Estimados vecinos: ya está disponible nuestra plataforma comunitaria de información y alerta temprana. Para activar el botón de pánico en la app Android, solicita el código de invitación a la directiva y espera la aprobación de un administrador.",
    prioridad: "importante",
    publicado: true,
    published_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  },
];

export interface AndroidBrandGuide {
  id: string;
  brand: string;
  tagline: string;
  steps: string[];
  warning: string;
}

export const ANDROID_BRAND_GUIDES: AndroidBrandGuide[] = [
  {
    id: "samsung",
    brand: "Samsung (One UI)",
    tagline: "Desactivar suspensión profunda y batería adaptativa para la app.",
    steps: [
      "Abre Ajustes > Aplicaciones > Bello Horizonte > Batería y selecciona 'No restringido'.",
      "En Ajustes > Cuidado del dispositivo > Batería > Límites de uso en segundo plano, agrega 'Bello Horizonte' a 'Aplicaciones nunca suspendidas'.",
      "Activa 'Notificaciones' y permite 'Mostrar sobre otras aplicaciones' y 'Alarmas y recordatorios'.",
    ],
    warning:
      "Si Samsung mueve la app a 'Aplicaciones en suspensión profunda', la sirena podría retrasarse con la pantalla bloqueada.",
  },
  {
    id: "xiaomi",
    brand: "Xiaomi / Redmi / POCO (MIUI / HyperOS)",
    tagline: "Habilitar inicio automático y pantalla de bloqueo.",
    steps: [
      "Abre Ajustes > Aplicaciones > Administrar aplicaciones > Bello Horizonte.",
      "Activa 'Inicio automático en segundo plano' (Autostart).",
      "En 'Ahorro de batería', elige 'Sin restricciones'.",
      "En 'Otros permisos', activa 'Mostrar en pantalla de bloqueo', 'Mostrar ventanas emergentes en segundo plano' y 'Notificaciones permanentes'.",
    ],
    warning:
      "MIUI/HyperOS bloquea por defecto las ventanas de pantalla completa; activar 'Mostrar en pantalla de bloqueo' es obligatorio.",
  },
  {
    id: "motorola",
    brand: "Motorola (Android casi puro)",
    tagline: "Configuración rápida de batería sin restricciones.",
    steps: [
      "Abre Ajustes > Aplicaciones > Ver todas las aplicaciones > Bello Horizonte.",
      "Toca 'Uso de batería de la aplicación' y selecciona 'Sin restricciones'.",
      "En 'Notificaciones', verifica que el canal 'Alarma Vecinal Crítica' esté activado con sonido y pantalla completa.",
    ],
    warning:
      "Desactiva el 'Ahorro de batería extremo' durante la noche o excluye explícitamente la app.",
  },
  {
    id: "honor-huawei",
    brand: "Honor / Huawei (MagicOS / EMUI)",
    tagline: "Cambiar el inicio de aplicaciones a gestión manual.",
    steps: [
      "Abre Ajustes > Batería > Inicio de aplicaciones (App Launch).",
      "Busca 'Bello Horizonte', desactiva 'Gestionar automáticamente' y deja activos los 3 interruptores: Inicio automático, Inicio secundario y Ejecutar en segundo plano.",
      "En Ajustes > Aplicaciones > Bello Horizonte > Notificaciones, habilita 'Mostrar en pantalla de bloqueo' y 'Banners'.",
    ],
    warning:
      "MagicOS y EMUI cierran apps en segundo plano al apagar la pantalla si permanecen en modo automático.",
  },
  {
    id: "oppo",
    brand: "Oppo / Realme / OnePlus (ColorOS)",
    tagline: "Permitir actividad en segundo plano y arranque automático.",
    steps: [
      "Abre Ajustes > Aplicaciones > Administración de aplicaciones > Bello Horizonte > Uso de batería.",
      "Activa 'Permitir actividad en primer plano', 'Permitir actividad en segundo plano' y 'Permitir inicio automático'.",
      "En 'Notificaciones', habilita 'Mostrar en pantalla de bloqueo' y prioridad alta.",
    ],
    warning:
      "Verifica también en 'Batería > Más ajustes > Optimizar uso en reposo' que no cierre conexiones nocturnas.",
  },
];
