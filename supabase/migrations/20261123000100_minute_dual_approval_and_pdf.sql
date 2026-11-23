-- ============================================================================
-- Migración: Doble Aprobación Directiva (Presidente + Secretario) y Bucket PDF
-- Asociación Bello Horizonte
-- Incluye:
--   - Columnas de doble confirmación en public.minutes
--   - Trigger trg_minutes_reset_approvals_on_edit (invalida aprobaciones y PDF
--     si se edita contenido o resumen_estructurado)
--   - RPC SECURITY DEFINER public.confirm_minute_by_role(p_minute_id, p_as_role)
--   - Storage Bucket público 'meeting-minutes-pdf' (10 MB, application/pdf)
--     con RLS estricta de escritura para directiva/admin en storage.objects
-- ============================================================================

-- ============================================================================
-- 1. Columnas de doble aprobación en public.minutes
-- ============================================================================

ALTER TABLE public.minutes
    ADD COLUMN IF NOT EXISTS aprobada_presidente_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS aprobada_presidente_at timestamptz,
    ADD COLUMN IF NOT EXISTS aprobada_secretario_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS aprobada_secretario_at timestamptz;

COMMENT ON COLUMN public.minutes.aprobada_presidente_por IS 'Usuario que registró el visto bueno del rol Presidente.';
COMMENT ON COLUMN public.minutes.aprobada_presidente_at IS 'Fecha/hora de confirmación del Presidente sobre la versión vigente del acta.';
COMMENT ON COLUMN public.minutes.aprobada_secretario_por IS 'Usuario que registró el visto bueno del rol Secretario.';
COMMENT ON COLUMN public.minutes.aprobada_secretario_at IS 'Fecha/hora de confirmación del Secretario sobre la versión vigente del acta.';

-- ============================================================================
-- 2. Trigger: reiniciar aprobaciones y PDF al editar el contenido del acta
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reset_minute_approvals_on_edit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NEW.contenido IS DISTINCT FROM OLD.contenido
       OR NEW.resumen_estructurado IS DISTINCT FROM OLD.resumen_estructurado THEN
        NEW.aprobada_presidente_por := NULL;
        NEW.aprobada_presidente_at := NULL;
        NEW.aprobada_secretario_por := NULL;
        NEW.aprobada_secretario_at := NULL;
        NEW.aprobada_por := NULL;
        NEW.aprobada_at := NULL;
        NEW.pdf_path := NULL;

        IF NEW.hash_sha256 IS NOT DISTINCT FROM OLD.hash_sha256 THEN
            NEW.hash_sha256 := NULL;
        END IF;

        IF OLD.estado IN ('aprobada', 'asentada_en_libro') THEN
            NEW.estado := 'revision';
        END IF;
    ELSE
        IF auth.uid() IS NOT NULL
           AND current_setting('app.allow_minute_approval_update', true) IS DISTINCT FROM 'true'
           AND (
               NEW.aprobada_presidente_por IS DISTINCT FROM OLD.aprobada_presidente_por
               OR NEW.aprobada_presidente_at IS DISTINCT FROM OLD.aprobada_presidente_at
               OR NEW.aprobada_secretario_por IS DISTINCT FROM OLD.aprobada_secretario_por
               OR NEW.aprobada_secretario_at IS DISTINCT FROM OLD.aprobada_secretario_at
           ) THEN
            RAISE EXCEPTION 'APPROVAL_VIA_RPC_ONLY: Usa confirm_minute_by_role para confirmar el acta.'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_minutes_reset_approvals_on_edit ON public.minutes;
CREATE TRIGGER trg_minutes_reset_approvals_on_edit
    BEFORE UPDATE ON public.minutes
    FOR EACH ROW
    EXECUTE FUNCTION public.reset_minute_approvals_on_edit();

-- ============================================================================
-- 3. RPC: Confirmación de acta por rol directivo (Presidente / Secretario)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.confirm_minute_by_role(
    p_minute_id uuid,
    p_as_role text DEFAULT NULL
)
RETURNS public.minutes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_minute public.minutes%ROWTYPE;
    v_group_id uuid;
    v_user_role text;
    v_target_role text;
    v_now timestamptz := now();
    v_pres_por uuid;
    v_pres_at timestamptz;
    v_sec_por uuid;
    v_sec_at timestamptz;
    v_both_approved boolean := false;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHORIZED: Debes iniciar sesión para confirmar un acta'
            USING ERRCODE = '28000';
    END IF;

    -- Bloqueo de fila para evitar condiciones de carrera si ambos aprueban a la vez
    SELECT min.*
    INTO v_minute
    FROM public.minutes min
    WHERE min.id = p_minute_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'MINUTE_NOT_FOUND: El acta indicada no existe'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT m.group_id
    INTO v_group_id
    FROM public.meetings m
    WHERE m.id = v_minute.meeting_id;

    IF v_group_id IS NULL THEN
        RAISE EXCEPTION 'MEETING_NOT_FOUND: La reunión asociada al acta no existe'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT mb.rol
    INTO v_user_role
    FROM public.memberships mb
    WHERE mb.group_id = v_group_id
      AND mb.user_id = v_user_id
      AND mb.estado = 'activo'
    LIMIT 1;

    IF v_user_role = 'presidente' THEN
        IF p_as_role IS NOT NULL AND p_as_role <> 'presidente' THEN
            RAISE EXCEPTION 'FORBIDDEN: Un usuario con rol presidente solo puede confirmar como presidente'
                USING ERRCODE = '42501';
        END IF;
        v_target_role := 'presidente';
    ELSIF v_user_role = 'secretario' THEN
        IF p_as_role IS NOT NULL AND p_as_role <> 'secretario' THEN
            RAISE EXCEPTION 'FORBIDDEN: Un usuario con rol secretario solo puede confirmar como secretario'
                USING ERRCODE = '42501';
        END IF;
        v_target_role := 'secretario';
    ELSIF v_user_role = 'admin' THEN
        IF p_as_role IS NOT NULL THEN
            IF p_as_role NOT IN ('presidente', 'secretario') THEN
                RAISE EXCEPTION 'INVALID_ROLE: p_as_role debe ser presidente o secretario'
                    USING ERRCODE = '22023';
            END IF;
            v_target_role := p_as_role;
        ELSE
            IF v_minute.aprobada_presidente_at IS NULL THEN
                v_target_role := 'presidente';
            ELSIF v_minute.aprobada_secretario_at IS NULL THEN
                v_target_role := 'secretario';
            ELSE
                RETURN v_minute;
            END IF;
        END IF;
    ELSE
        RAISE EXCEPTION 'FORBIDDEN: Solo presidente, secretario o administrador activo del grupo puede aprobar el acta'
            USING ERRCODE = '42501';
    END IF;

    v_pres_por := v_minute.aprobada_presidente_por;
    v_pres_at := v_minute.aprobada_presidente_at;
    v_sec_por := v_minute.aprobada_secretario_por;
    v_sec_at := v_minute.aprobada_secretario_at;

    IF v_target_role = 'presidente' THEN
        v_pres_por := v_user_id;
        v_pres_at := v_now;
    ELSIF v_target_role = 'secretario' THEN
        v_sec_por := v_user_id;
        v_sec_at := v_now;
    END IF;

    v_both_approved := (v_pres_at IS NOT NULL AND v_sec_at IS NOT NULL);

    PERFORM set_config('app.allow_minute_approval_update', 'true', true);

    UPDATE public.minutes
    SET aprobada_presidente_por = v_pres_por,
        aprobada_presidente_at = v_pres_at,
        aprobada_secretario_por = v_sec_por,
        aprobada_secretario_at = v_sec_at,
        estado = CASE
            WHEN v_both_approved AND estado <> 'asentada_en_libro' THEN 'aprobada'
            ELSE estado
        END,
        aprobada_at = CASE
            WHEN v_both_approved THEN v_now
            ELSE aprobada_at
        END,
        aprobada_por = CASE
            WHEN v_both_approved THEN v_user_id
            ELSE aprobada_por
        END
    WHERE id = p_minute_id
    RETURNING * INTO v_minute;

    RETURN v_minute;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_minute_by_role(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_minute_by_role(uuid, text) TO authenticated, service_role;

-- ============================================================================
-- 4. Storage Bucket público 'meeting-minutes-pdf' y RLS en storage.objects
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'meeting-minutes-pdf',
    'meeting-minutes-pdf',
    true,
    10485760, -- 10 MB
    ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Lectura pública para que los vecinos abran el PDF desde WhatsApp con 1 clic
DROP POLICY IF EXISTS meeting_minutes_pdf_select_public ON storage.objects;
CREATE POLICY meeting_minutes_pdf_select_public
    ON storage.objects
    FOR SELECT
    TO anon, authenticated
    USING (bucket_id = 'meeting-minutes-pdf');

-- Escritura / actualización / borrado restringidos a directiva/admin del grupo
-- Ruta esperada: <group_id>/<meeting_id>/acta.pdf
DROP POLICY IF EXISTS meeting_minutes_pdf_insert_board ON storage.objects;
CREATE POLICY meeting_minutes_pdf_insert_board
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'meeting-minutes-pdf'
        AND array_length(storage.foldername(name), 1) >= 2
        AND CASE
            WHEN COALESCE((storage.foldername(name))[1], '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN public.is_group_board_or_admin(((storage.foldername(name))[1])::uuid)
            ELSE false
        END
    );

DROP POLICY IF EXISTS meeting_minutes_pdf_update_board ON storage.objects;
CREATE POLICY meeting_minutes_pdf_update_board
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'meeting-minutes-pdf'
        AND CASE
            WHEN COALESCE((storage.foldername(name))[1], '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN public.is_group_board_or_admin(((storage.foldername(name))[1])::uuid)
            ELSE false
        END
    )
    WITH CHECK (
        bucket_id = 'meeting-minutes-pdf'
        AND array_length(storage.foldername(name), 1) >= 2
        AND CASE
            WHEN COALESCE((storage.foldername(name))[1], '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN public.is_group_board_or_admin(((storage.foldername(name))[1])::uuid)
            ELSE false
        END
    );

DROP POLICY IF EXISTS meeting_minutes_pdf_delete_board ON storage.objects;
CREATE POLICY meeting_minutes_pdf_delete_board
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'meeting-minutes-pdf'
        AND CASE
            WHEN COALESCE((storage.foldername(name))[1], '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN public.is_group_board_or_admin(((storage.foldername(name))[1])::uuid)
            ELSE false
        END
    );
