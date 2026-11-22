-- ============================================================================
-- Migración inicial MVP: Asociación Bello Horizonte (Perú, Ley 29733)
-- Incluye:
--   - Extensión pgcrypto
--   - 7 tablas núcleo (profiles, groups, memberships, alerts, alert_acks,
--     association_info, announcements)
--   - Índices críticos de rendimiento y cooldown
--   - Triggers: updated_at, handle_new_user, cooldown 2 min en alerts,
--     protección de campos inmutables en UPDATE de alerts
--   - Funciones SECURITY DEFINER (helpers RLS, join_group_by_code,
--     regenerate_group_code, cleanup_old_alerts, delete_my_account)
--   - Políticas Row Level Security (RLS) estrictas en TODAS las tablas
--   - Publicación Supabase Realtime para alerts y alert_acks
-- ============================================================================

-- 1. Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- 2. Tablas del esquema público (MVP + Portal Asociación)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    nombre text NOT NULL DEFAULT '',
    telefono text,
    direccion_lote text,
    fcm_token text,
    device_brand text,
    consentimiento_datos boolean NOT NULL DEFAULT false,
    consentimiento_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.profiles IS 'Perfil de socio/vecino vinculado a auth.users. Cumple consentimiento Ley 29733.';

CREATE TABLE IF NOT EXISTS public.groups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre text NOT NULL,
    codigo text UNIQUE NOT NULL,
    lat double precision,
    lng double precision,
    created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.groups IS 'Grupos/cuadras o asociaciones vecinales con código de invitación único.';

CREATE TABLE IF NOT EXISTS public.memberships (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    rol text NOT NULL DEFAULT 'miembro'
        CHECK (rol IN ('admin', 'presidente', 'secretario', 'miembro')),
    estado text NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente', 'activo', 'suspendido')),
    aprobado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT memberships_group_user_unique UNIQUE (group_id, user_id)
);

COMMENT ON TABLE public.memberships IS 'Relación de membresía, rol directivo y estado de aprobación por grupo.';

CREATE TABLE IF NOT EXISTS public.alerts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    tipo text NOT NULL DEFAULT 'robo_cuadra',
    mensaje text,
    lat double precision,
    lng double precision,
    estado text NOT NULL DEFAULT 'activa'
        CHECK (estado IN ('activa', 'resuelta', 'falsa_alarma')),
    created_at timestamptz NOT NULL DEFAULT now(),
    closed_at timestamptz,
    closed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.alerts IS 'Alertas de pánico comunitario (sin anonimato; cooldown 2 min por usuario).';

CREATE TABLE IF NOT EXISTS public.alert_acks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id uuid NOT NULL REFERENCES public.alerts(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    tipo_ack text NOT NULL
        CHECK (tipo_ack IN ('recibido', 'enterado', 'silenciado_1m')),
    recibido_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT alert_acks_unique_per_type UNIQUE (alert_id, user_id, tipo_ack)
);

COMMENT ON TABLE public.alert_acks IS 'Confirmaciones de recepción, enterado o silencio temporal de cada alerta.';

CREATE TABLE IF NOT EXISTS public.association_info (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id uuid NOT NULL UNIQUE REFERENCES public.groups(id) ON DELETE CASCADE,
    titulo text NOT NULL,
    descripcion text,
    direccion text,
    telefonos_emergencia jsonb NOT NULL DEFAULT '[]'::jsonb,
    directiva jsonb NOT NULL DEFAULT '[]'::jsonb,
    politica_privacidad_url text,
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.association_info IS 'Información institucional pública, teléfonos de emergencia y directiva.';

CREATE TABLE IF NOT EXISTS public.announcements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
    author_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    titulo text NOT NULL,
    contenido text NOT NULL,
    prioridad text NOT NULL DEFAULT 'normal'
        CHECK (prioridad IN ('normal', 'importante', 'urgente')),
    publicado boolean NOT NULL DEFAULT true,
    published_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.announcements IS 'Comunicados oficiales de la Asociación Bello Horizonte para portal web y app.';

-- ============================================================================
-- 3. Índices críticos
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_memberships_group_active
    ON public.memberships (group_id, estado);

CREATE INDEX IF NOT EXISTS idx_memberships_user_id
    ON public.memberships (user_id);

CREATE INDEX IF NOT EXISTS idx_alerts_group_created
    ON public.alerts (group_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_user_created
    ON public.alerts (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_acks_alert
    ON public.alert_acks (alert_id, user_id);

CREATE INDEX IF NOT EXISTS idx_announcements_published
    ON public.announcements (group_id, publicado, published_at DESC);

-- ============================================================================
-- 4. Funciones Trigger (updated_at, auth sync, cooldown e inmutabilidad)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_association_info_updated_at ON public.association_info;
CREATE TRIGGER trg_association_info_updated_at
    BEFORE UPDATE ON public.association_info
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- Creación automática de perfil al registrarse en auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, nombre)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data ->> 'nombre', '')
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- Trigger de Cooldown (máximo 1 alerta cada 2 minutos por usuario)
-- Serializado con advisory lock por usuario para evitar race conditions concurrentes.
-- Fuerza created_at = now() y estado inicial 'activa' para evitar evasión del cooldown.
CREATE OR REPLACE FUNCTION public.enforce_alert_cooldown()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('alert_cooldown:' || NEW.user_id::text));

    IF EXISTS (
        SELECT 1
        FROM public.alerts a
        WHERE a.user_id = NEW.user_id
          AND a.created_at > (now() - interval '2 minutes')
    ) THEN
        RAISE EXCEPTION 'COOLDOWN_ACTIVE: Espera 2 minutos antes de enviar otra alerta'
            USING ERRCODE = 'P0001';
    END IF;

    NEW.created_at := now();
    NEW.estado := 'activa';
    NEW.closed_at := NULL;
    NEW.closed_by := NULL;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_alerts_cooldown ON public.alerts;
CREATE TRIGGER trg_alerts_cooldown
    BEFORE INSERT ON public.alerts
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_alert_cooldown();

-- Trigger de protección en UPDATE de alerts:
-- Impide modificar o reabrir alertas ya cerradas, protege campos inmutables y
-- fuerza closed_at y closed_by desde el servidor al cerrar.
CREATE OR REPLACE FUNCTION public.enforce_alert_update_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF OLD.estado <> 'activa' THEN
        RAISE EXCEPTION 'ALERT_ALREADY_CLOSED: No se puede modificar ni reabrir una alerta cerrada'
            USING ERRCODE = 'P0001';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.group_id IS DISTINCT FROM OLD.group_id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.tipo IS DISTINCT FROM OLD.tipo
       OR NEW.mensaje IS DISTINCT FROM OLD.mensaje
       OR NEW.lat IS DISTINCT FROM OLD.lat
       OR NEW.lng IS DISTINCT FROM OLD.lng
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'ALERT_IMMUTABLE_FIELDS: Solo se permite actualizar estado, closed_at y closed_by'
            USING ERRCODE = '42501';
    END IF;

    IF NEW.estado IN ('resuelta', 'falsa_alarma') THEN
        NEW.closed_at := now();
        NEW.closed_by := COALESCE(auth.uid(), NEW.closed_by);
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_alerts_immutable_fields ON public.alerts;
CREATE TRIGGER trg_alerts_immutable_fields
    BEFORE UPDATE ON public.alerts
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_alert_update_fields();

-- ============================================================================
-- 5. Funciones Helper y RPCs (SECURITY DEFINER con SET search_path = public)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_active_member(p_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.memberships m
        WHERE m.group_id = p_group_id
          AND m.user_id = auth.uid()
          AND m.estado = 'activo'
    );
$$;

CREATE OR REPLACE FUNCTION public.is_group_admin(p_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.memberships m
        WHERE m.group_id = p_group_id
          AND m.user_id = auth.uid()
          AND m.estado = 'activo'
          AND m.rol = 'admin'
    );
$$;

CREATE OR REPLACE FUNCTION public.is_group_board_or_admin(p_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.memberships m
        WHERE m.group_id = p_group_id
          AND m.user_id = auth.uid()
          AND m.estado = 'activo'
          AND m.rol IN ('admin', 'presidente', 'secretario')
    );
$$;

-- Helper para lectura segura de perfiles (minimización Ley 29733):
-- - Propio perfil
-- - Miembros del grupo únicamente para administradores activos (para aprobar/gestionar)
-- Para listar nombres de vecinos en alertas/acks sin exponer teléfono/lote/fcm_token,
-- usar la RPC get_group_member_names(p_group_id).
CREATE OR REPLACE FUNCTION public.can_view_profile(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        p_profile_id = auth.uid()
        OR EXISTS (
            SELECT 1
            FROM public.memberships my_m
            JOIN public.memberships target_m
              ON target_m.group_id = my_m.group_id
            WHERE my_m.user_id = auth.uid()
              AND my_m.estado = 'activo'
              AND my_m.rol = 'admin'
              AND target_m.user_id = p_profile_id
        );
$$;

-- RPC de solo lectura: nombres de miembros activos del grupo (minimización Ley 29733)
-- Expone únicamente (user_id, nombre) para mostrar autoría en alertas y ACKs sin
-- exponer telefono, direccion_lote ni fcm_token.
CREATE OR REPLACE FUNCTION public.get_group_member_names(p_group_id uuid)
RETURNS TABLE (
    user_id uuid,
    nombre text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Sesión requerida'
            USING ERRCODE = '28000';
    END IF;

    IF NOT public.is_active_member(p_group_id) THEN
        RAISE EXCEPTION 'FORBIDDEN: Solo miembros activos del grupo pueden consultar los nombres de vecinos'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT m.user_id, p.nombre
    FROM public.memberships m
    JOIN public.profiles p
      ON p.id = m.user_id
    WHERE m.group_id = p_group_id
      AND m.estado = 'activo'
    ORDER BY p.nombre ASC;
END;
$$;

-- RPC: Actualizar token FCM propio sin requerir SELECT sobre profiles.fcm_token
CREATE OR REPLACE FUNCTION public.update_my_fcm_token(
    p_fcm_token text,
    p_device_brand text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Debes iniciar sesión para actualizar tu token FCM'
            USING ERRCODE = '28000';
    END IF;

    UPDATE public.profiles
    SET fcm_token = NULLIF(trim(COALESCE(p_fcm_token, '')), ''),
        device_brand = COALESCE(NULLIF(trim(COALESCE(p_device_brand, '')), ''), device_brand),
        updated_at = now()
    WHERE id = v_user_id;
END;
$$;

-- RPC: Consultar código de invitación del grupo (solo admin activo)
CREATE OR REPLACE FUNCTION public.get_group_invite_code(p_group_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code text;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Sesión requerida'
            USING ERRCODE = '28000';
    END IF;

    IF NOT public.is_group_admin(p_group_id) THEN
        RAISE EXCEPTION 'FORBIDDEN: Solo un administrador activo puede consultar el código de invitación'
            USING ERRCODE = '42501';
    END IF;

    SELECT g.codigo
    INTO v_code
    FROM public.groups g
    WHERE g.id = p_group_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'GROUP_NOT_FOUND: Grupo no encontrado'
            USING ERRCODE = 'P0002';
    END IF;

    RETURN v_code;
END;
$$;

-- RPC: Unirse a un grupo mediante código de invitación (sin exponer la tabla groups)
CREATE OR REPLACE FUNCTION public.join_group_by_code(
    p_codigo text,
    p_nombre text,
    p_telefono text,
    p_consentimiento boolean,
    p_direccion_lote text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_group public.groups%ROWTYPE;
    v_membership public.memberships%ROWTYPE;
    v_clean_code text := upper(trim(COALESCE(p_codigo, '')));
    v_clean_name text := trim(COALESCE(p_nombre, ''));
    v_clean_phone text := trim(COALESCE(p_telefono, ''));
    v_clean_lote text := NULLIF(trim(COALESCE(p_direccion_lote, '')), '');
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Debes iniciar sesión para unirte a un grupo'
            USING ERRCODE = '28000';
    END IF;

    IF p_consentimiento IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'CONSENT_REQUIRED: Debes aceptar el consentimiento de datos personales (Ley 29733)'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_clean_code = '' THEN
        RAISE EXCEPTION 'INVALID_GROUP_CODE: Código de invitación requerido'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_clean_name = '' THEN
        RAISE EXCEPTION 'INVALID_NAME: El nombre completo es obligatorio'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_clean_phone = '' THEN
        RAISE EXCEPTION 'INVALID_PHONE: El teléfono es obligatorio'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT *
    INTO v_group
    FROM public.groups g
    WHERE upper(trim(g.codigo)) = v_clean_code
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'INVALID_GROUP_CODE: Código de invitación no válido'
            USING ERRCODE = 'P0002';
    END IF;

    -- Actualiza o crea el perfil registrando el consentimiento Ley 29733
    INSERT INTO public.profiles (
        id,
        nombre,
        telefono,
        direccion_lote,
        consentimiento_datos,
        consentimiento_at,
        updated_at
    )
    VALUES (
        v_user_id,
        v_clean_name,
        v_clean_phone,
        v_clean_lote,
        true,
        now(),
        now()
    )
    ON CONFLICT (id) DO UPDATE
    SET nombre = EXCLUDED.nombre,
        telefono = EXCLUDED.telefono,
        direccion_lote = COALESCE(EXCLUDED.direccion_lote, public.profiles.direccion_lote),
        consentimiento_datos = true,
        consentimiento_at = COALESCE(public.profiles.consentimiento_at, now()),
        updated_at = now();

    -- Verifica si ya existe una membresía para este grupo y usuario
    SELECT *
    INTO v_membership
    FROM public.memberships m
    WHERE m.group_id = v_group.id
      AND m.user_id = v_user_id
    LIMIT 1;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'group_id', v_group.id,
            'group_name', v_group.nombre,
            'membership_id', v_membership.id,
            'rol', v_membership.rol,
            'estado', v_membership.estado,
            'already_member', true
        );
    END IF;

    INSERT INTO public.memberships (group_id, user_id, rol, estado)
    VALUES (v_group.id, v_user_id, 'miembro', 'pendiente')
    RETURNING * INTO v_membership;

    RETURN jsonb_build_object(
        'group_id', v_group.id,
        'group_name', v_group.nombre,
        'membership_id', v_membership.id,
        'rol', v_membership.rol,
        'estado', v_membership.estado,
        'already_member', false
    );
END;
$$;

-- RPC: Regenerar código de invitación del grupo (solo admin activo)
CREATE OR REPLACE FUNCTION public.regenerate_group_code(p_group_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_new_code text;
    v_attempts int := 0;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Sesión requerida'
            USING ERRCODE = '28000';
    END IF;

    IF NOT public.is_group_admin(p_group_id) THEN
        RAISE EXCEPTION 'FORBIDDEN: Solo un administrador activo puede regenerar el código del grupo'
            USING ERRCODE = '42501';
    END IF;

    LOOP
        v_attempts := v_attempts + 1;
        v_new_code := 'BH-' || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6));

        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM public.groups g WHERE g.codigo = v_new_code
        );

        IF v_attempts >= 10 THEN
            RAISE EXCEPTION 'CODE_GENERATION_FAILED: No se pudo generar un código único';
        END IF;
    END LOOP;

    UPDATE public.groups
    SET codigo = v_new_code
    WHERE id = p_group_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'GROUP_NOT_FOUND: Grupo no encontrado'
            USING ERRCODE = 'P0002';
    END IF;

    RETURN v_new_code;
END;
$$;

-- Función de retención de datos (Ley 29733): elimina alertas mayores a p_days días
CREATE OR REPLACE FUNCTION public.cleanup_old_alerts(p_days int DEFAULT 90)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_deleted int := 0;
BEGIN
    IF p_days IS NULL OR p_days < 1 THEN
        RAISE EXCEPTION 'INVALID_RETENTION_DAYS: p_days debe ser mayor o igual a 1'
            USING ERRCODE = '22023';
    END IF;

    DELETE FROM public.alerts
    WHERE created_at < (now() - make_interval(days => p_days));

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

-- RPC: Derecho de cancelación / eliminación de cuenta propia (Ley 29733 y Google Play)
CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_user_id uuid := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Debes iniciar sesión para eliminar tu cuenta'
            USING ERRCODE = '28000';
    END IF;

    -- Al eliminar en auth.users se eliminan en cascada profiles, memberships, alerts y alert_acks
    DELETE FROM auth.users
    WHERE id = v_user_id;
END;
$$;

-- Permisos explícitos de ejecución de funciones
REVOKE ALL ON FUNCTION public.is_active_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_member(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_group_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_group_admin(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_group_board_or_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_group_board_or_admin(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.can_view_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_profile(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_group_member_names(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_group_member_names(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.update_my_fcm_token(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_my_fcm_token(text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_group_invite_code(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_group_invite_code(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.join_group_by_code(text, text, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_group_by_code(text, text, text, boolean, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.regenerate_group_code(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.regenerate_group_code(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.cleanup_old_alerts(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_old_alerts(int) TO service_role;

REVOKE ALL ON FUNCTION public.delete_my_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;

-- ============================================================================
-- 6. Row Level Security (RLS) y Privilegios de Columna en TODAS las tablas
-- ============================================================================

-- 6.1 profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Proteger fcm_token a nivel de columna: solo service_role / Edge Functions leen fcm_token.
REVOKE SELECT ON public.profiles FROM anon, authenticated;
GRANT SELECT (
    id,
    nombre,
    telefono,
    direccion_lote,
    device_brand,
    consentimiento_datos,
    consentimiento_at,
    created_at,
    updated_at
) ON public.profiles TO authenticated;

DROP POLICY IF EXISTS profiles_select_policy ON public.profiles;
CREATE POLICY profiles_select_policy
    ON public.profiles
    FOR SELECT
    TO authenticated
    USING (public.can_view_profile(id));

DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
CREATE POLICY profiles_insert_own
    ON public.profiles
    FOR INSERT
    TO authenticated
    WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own
    ON public.profiles
    FOR UPDATE
    TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS profiles_delete_own ON public.profiles;
CREATE POLICY profiles_delete_own
    ON public.profiles
    FOR DELETE
    TO authenticated
    USING (id = auth.uid());

-- 6.2 groups
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

-- Proteger groups.codigo a nivel de columna: solo admins vía get_group_invite_code().
REVOKE SELECT ON public.groups FROM anon, authenticated;
GRANT SELECT (id, nombre, lat, lng, created_at) ON public.groups TO authenticated;

DROP POLICY IF EXISTS groups_select_member ON public.groups;
CREATE POLICY groups_select_member
    ON public.groups
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.memberships m
            WHERE m.group_id = groups.id
              AND m.user_id = auth.uid()
              AND m.estado IN ('pendiente', 'activo')
        )
    );

DROP POLICY IF EXISTS groups_update_admin ON public.groups;
CREATE POLICY groups_update_admin
    ON public.groups
    FOR UPDATE
    TO authenticated
    USING (public.is_group_admin(id))
    WITH CHECK (public.is_group_admin(id));

-- 6.3 memberships
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS memberships_select_policy ON public.memberships;
CREATE POLICY memberships_select_policy
    ON public.memberships
    FOR SELECT
    TO authenticated
    USING (
        user_id = auth.uid()
        OR (public.is_active_member(group_id) AND estado = 'activo')
        OR public.is_group_admin(group_id)
    );

DROP POLICY IF EXISTS memberships_insert_admin ON public.memberships;
CREATE POLICY memberships_insert_admin
    ON public.memberships
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_group_admin(group_id));

DROP POLICY IF EXISTS memberships_update_admin ON public.memberships;
CREATE POLICY memberships_update_admin
    ON public.memberships
    FOR UPDATE
    TO authenticated
    USING (public.is_group_admin(group_id))
    WITH CHECK (public.is_group_admin(group_id));

DROP POLICY IF EXISTS memberships_delete_admin_or_own ON public.memberships;
CREATE POLICY memberships_delete_admin_or_own
    ON public.memberships
    FOR DELETE
    TO authenticated
    USING (
        (user_id = auth.uid() AND estado <> 'suspendido')
        OR public.is_group_admin(group_id)
    );

-- 6.4 alerts
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS alerts_select_active_member ON public.alerts;
CREATE POLICY alerts_select_active_member
    ON public.alerts
    FOR SELECT
    TO authenticated
    USING (public.is_active_member(group_id));

DROP POLICY IF EXISTS alerts_insert_active_member ON public.alerts;
CREATE POLICY alerts_insert_active_member
    ON public.alerts
    FOR INSERT
    TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        AND public.is_active_member(group_id)
    );

DROP POLICY IF EXISTS alerts_update_author_or_admin ON public.alerts;
CREATE POLICY alerts_update_author_or_admin
    ON public.alerts
    FOR UPDATE
    TO authenticated
    USING (
        (user_id = auth.uid() AND public.is_active_member(group_id))
        OR public.is_group_admin(group_id)
    )
    WITH CHECK (
        (user_id = auth.uid() AND public.is_active_member(group_id))
        OR public.is_group_admin(group_id)
    );

-- 6.5 alert_acks
ALTER TABLE public.alert_acks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS alert_acks_select_active_member ON public.alert_acks;
CREATE POLICY alert_acks_select_active_member
    ON public.alert_acks
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.alerts a
            WHERE a.id = alert_acks.alert_id
              AND public.is_active_member(a.group_id)
        )
    );

DROP POLICY IF EXISTS alert_acks_insert_active_member ON public.alert_acks;
CREATE POLICY alert_acks_insert_active_member
    ON public.alert_acks
    FOR INSERT
    TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        AND EXISTS (
            SELECT 1
            FROM public.alerts a
            WHERE a.id = alert_acks.alert_id
              AND public.is_active_member(a.group_id)
        )
    );

-- 6.6 association_info
ALTER TABLE public.association_info ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS association_info_select_public ON public.association_info;
CREATE POLICY association_info_select_public
    ON public.association_info
    FOR SELECT
    TO anon, authenticated
    USING (true);

DROP POLICY IF EXISTS association_info_insert_board ON public.association_info;
CREATE POLICY association_info_insert_board
    ON public.association_info
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_group_board_or_admin(group_id));

DROP POLICY IF EXISTS association_info_update_board ON public.association_info;
CREATE POLICY association_info_update_board
    ON public.association_info
    FOR UPDATE
    TO authenticated
    USING (public.is_group_board_or_admin(group_id))
    WITH CHECK (public.is_group_board_or_admin(group_id));

DROP POLICY IF EXISTS association_info_delete_board ON public.association_info;
CREATE POLICY association_info_delete_board
    ON public.association_info
    FOR DELETE
    TO authenticated
    USING (public.is_group_board_or_admin(group_id));

-- 6.7 announcements
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS announcements_select_public_or_board ON public.announcements;
DROP POLICY IF EXISTS announcements_select_public ON public.announcements;
CREATE POLICY announcements_select_public
    ON public.announcements
    FOR SELECT
    TO anon, authenticated
    USING (publicado = true);

DROP POLICY IF EXISTS announcements_select_board ON public.announcements;
CREATE POLICY announcements_select_board
    ON public.announcements
    FOR SELECT
    TO authenticated
    USING (public.is_group_board_or_admin(group_id));

DROP POLICY IF EXISTS announcements_insert_board ON public.announcements;
CREATE POLICY announcements_insert_board
    ON public.announcements
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_group_board_or_admin(group_id)
        AND (author_id IS NULL OR author_id = auth.uid())
    );

DROP POLICY IF EXISTS announcements_update_board ON public.announcements;
CREATE POLICY announcements_update_board
    ON public.announcements
    FOR UPDATE
    TO authenticated
    USING (public.is_group_board_or_admin(group_id))
    WITH CHECK (public.is_group_board_or_admin(group_id));

DROP POLICY IF EXISTS announcements_delete_board ON public.announcements;
CREATE POLICY announcements_delete_board
    ON public.announcements
    FOR DELETE
    TO authenticated
    USING (public.is_group_board_or_admin(group_id));

-- ============================================================================
-- 7. Supabase Realtime (idempotente para alerts y alert_acks)
-- ============================================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = 'alerts'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.alerts;
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = 'alert_acks'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.alert_acks;
        END IF;
    END IF;
END;
$$;
