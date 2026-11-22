-- ============================================================================
-- Datos iniciales (Seed) — Asociación Bello Horizonte (Perú)
-- Idempotente: utiliza UUIDs fijos y ON CONFLICT DO NOTHING.
-- ============================================================================

-- 1. Grupo principal: Asociación Bello Horizonte
INSERT INTO public.groups (id, nombre, codigo, lat, lng)
VALUES (
    '11111111-1111-4111-8111-111111111111',
    'Asociación Bello Horizonte',
    'BH-2026',
    -12.0464,
    -77.0428
)
ON CONFLICT DO NOTHING;

-- 2. Información institucional y teléfonos de emergencia (Perú)
INSERT INTO public.association_info (
    id,
    group_id,
    titulo,
    descripcion,
    direccion,
    telefonos_emergencia,
    directiva,
    politica_privacidad_url
)
VALUES (
    '22222222-2222-4222-8222-222222222222',
    '11111111-1111-4111-8111-111111111111',
    'Asociación Bello Horizonte',
    'Organización vecinal dedicada a la seguridad ciudadana, coordinación comunitaria y bienestar de los socios de Bello Horizonte.',
    'Urbanización Bello Horizonte, Perú',
    '[
        {"nombre": "Policía Nacional del Perú (PNP)", "numero": "105", "tipo": "emergencia"},
        {"nombre": "Serenazgo Municipal", "numero": "+51010000000", "tipo": "serenazgo"},
        {"nombre": "Bomberos Voluntarios", "numero": "116", "tipo": "emergencia"},
        {"nombre": "SAMU Emergencias Médicas", "numero": "106", "tipo": "salud"}
    ]'::jsonb,
    '[
        {"cargo": "Presidente", "nombre": "Por definir en asamblea"},
        {"cargo": "Secretario", "nombre": "Por definir en asamblea"},
        {"cargo": "Administrador de Seguridad (Titular)", "nombre": "Por definir"},
        {"cargo": "Administrador de Seguridad (Suplente)", "nombre": "Por definir"}
    ]'::jsonb,
    '/privacidad'
)
ON CONFLICT (group_id) DO NOTHING;

-- 3. Comunicado de bienvenida
INSERT INTO public.announcements (
    id,
    group_id,
    author_id,
    titulo,
    contenido,
    prioridad,
    publicado,
    published_at
)
VALUES (
    '33333333-3333-4333-8333-333333333333',
    '11111111-1111-4111-8111-111111111111',
    NULL,
    'Bienvenidos al Portal y Alarma Vecinal de Asociación Bello Horizonte',
    'Estimados vecinos: ya está disponible nuestra plataforma comunitaria de información y alerta temprana. Para activar el botón de pánico en la app Android, solicita el código de invitación a la directiva y espera la aprobación de un administrador.',
    'importante',
    true,
    now()
)
ON CONFLICT (id) DO NOTHING;
