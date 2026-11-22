-- ============================================================================
-- Migración Entrega B (BH-050 / BH-060 / BH-070):
-- Reuniones, Grabación por bloques (chunks) y Actas — Asociación Bello Horizonte
-- Incluye:
--   - 6 tablas: meetings, meeting_attendance, recordings, transcripts,
--     minutes, minute_signatures
--   - Índices de rendimiento por grupo, reunión, chunk y acta
--   - Triggers: updated_at (reutilizando public.set_updated_at) y protección
--     de columna asistio en meeting_attendance
--   - Políticas Row Level Security (RLS) estrictas en las 6 tablas (Ley 29733)
--   - Storage Bucket privado 'meeting-recordings' (25 MB, audio) + RLS en
--     storage.objects por ruta <group_id>/<meeting_id>/chunk_XX.m4a
--   - Publicación Supabase Realtime idempotente para meetings, recordings y minutes
-- ============================================================================

-- ============================================================================
-- 1. Tablas de Reuniones, Grabaciones por bloques y Actas
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.meetings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
    titulo text NOT NULL,
    fecha timestamptz NOT NULL,
    lugar text,
    agenda text,
    estado text NOT NULL DEFAULT 'programada'
        CHECK (estado IN ('programada', 'en_curso', 'finalizada', 'cancelada')),
    created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.meetings IS 'Reuniones y asambleas vecinales de la Asociación Bello Horizonte.';

CREATE TABLE IF NOT EXISTS public.meeting_attendance (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    respuesta text NOT NULL DEFAULT 'pendiente'
        CHECK (respuesta IN ('asistire', 'no_asistire', 'pendiente')),
    asistio boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT meeting_attendance_unique UNIQUE (meeting_id, user_id)
);

COMMENT ON TABLE public.meeting_attendance IS 'Confirmación previa (RSVP) y control de asistencia real por directiva.';

CREATE TABLE IF NOT EXISTS public.recordings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
    chunk_index integer NOT NULL DEFAULT 1
        CHECK (chunk_index >= 1),
    storage_path text NOT NULL,
    duration_seconds integer
        CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
    consentimientos jsonb NOT NULL DEFAULT '{}'::jsonb,
    estado text NOT NULL DEFAULT 'subido'
        CHECK (estado IN ('grabando', 'subido', 'transcribiendo', 'transcrito', 'error', 'eliminado')),
    error_message text,
    created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT recordings_meeting_chunk_unique UNIQUE (meeting_id, chunk_index)
);

COMMENT ON TABLE public.recordings IS 'Bloques de audio grabados con consentimiento explícito (Ley 29733); acceso exclusivo directiva/admin.';

CREATE TABLE IF NOT EXISTS public.transcripts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recording_id uuid NOT NULL UNIQUE REFERENCES public.recordings(id) ON DELETE CASCADE,
    meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
    chunk_index integer NOT NULL DEFAULT 1
        CHECK (chunk_index >= 1),
    texto text NOT NULL,
    proveedor text NOT NULL DEFAULT 'faster-whisper-small',
    created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.transcripts IS 'Transcripciones por bloque de grabación; acceso exclusivo directiva/admin.';

CREATE TABLE IF NOT EXISTS public.minutes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id uuid NOT NULL UNIQUE REFERENCES public.meetings(id) ON DELETE CASCADE,
    contenido text NOT NULL,
    resumen_estructurado jsonb NOT NULL DEFAULT '{}'::jsonb,
    estado text NOT NULL DEFAULT 'borrador'
        CHECK (estado IN ('borrador', 'revision', 'aprobada', 'asentada_en_libro')),
    pdf_path text,
    hash_sha256 text,
    plazo_observaciones_hasta timestamptz,
    aprobada_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    aprobada_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.minutes IS 'Actas oficiales de reunión con resumen estructurado, hash SHA-256 y flujo de aprobación.';

CREATE TABLE IF NOT EXISTS public.minute_signatures (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    minute_id uuid NOT NULL REFERENCES public.minutes(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    tipo text NOT NULL
        CHECK (tipo IN ('acuse_recibo', 'conformidad_simple')),
    firmado_at timestamptz NOT NULL DEFAULT now(),
    firma_texto text,
    dispositivo_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT minute_signatures_unique UNIQUE (minute_id, user_id, tipo)
);

COMMENT ON TABLE public.minute_signatures IS 'Acuse de recibo y conformidad simple de socios sobre actas aprobadas (respaldo digital).';

-- ============================================================================
-- 2. Índices
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_meetings_group_fecha
    ON public.meetings (group_id, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_meeting_attendance_user_id
    ON public.meeting_attendance (user_id);

CREATE INDEX IF NOT EXISTS idx_recordings_meeting_chunk
    ON public.recordings (meeting_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_transcripts_meeting_chunk
    ON public.transcripts (meeting_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_minute_signatures_minute_user
    ON public.minute_signatures (minute_id, user_id);

-- ============================================================================
-- 3. Triggers (updated_at y protección de asistio en meeting_attendance)
-- ============================================================================

DROP TRIGGER IF EXISTS trg_meetings_updated_at ON public.meetings;
CREATE TRIGGER trg_meetings_updated_at
    BEFORE UPDATE ON public.meetings
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_meeting_attendance_updated_at ON public.meeting_attendance;
CREATE TRIGGER trg_meeting_attendance_updated_at
    BEFORE UPDATE ON public.meeting_attendance
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_minutes_updated_at ON public.minutes;
CREATE TRIGGER trg_minutes_updated_at
    BEFORE UPDATE ON public.minutes
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- Impide que un miembro regular marque o modifique el campo asistio, o reasigne
-- claves inmutables (meeting_id, user_id) al actualizar su RSVP.
CREATE OR REPLACE FUNCTION public.enforce_meeting_attendance_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_group_id uuid;
    v_is_board boolean := false;
BEGIN
    SELECT m.group_id
    INTO v_group_id
    FROM public.meetings m
    WHERE m.id = NEW.meeting_id;

    IF v_group_id IS NULL THEN
        RAISE EXCEPTION 'MEETING_NOT_FOUND: La reunión indicada no existe'
            USING ERRCODE = 'P0002';
    END IF;

    -- Si auth.uid() es NULL (service_role / migraciones), no restringir por rol de usuario
    IF auth.uid() IS NOT NULL THEN
        v_is_board := public.is_group_board_or_admin(v_group_id);

        IF TG_OP = 'INSERT' THEN
            IF NOT v_is_board AND NEW.asistio IS TRUE THEN
                RAISE EXCEPTION 'ATTENDANCE_FORBIDDEN: Solo la directiva o administración puede marcar asistencia real (asistio)'
                    USING ERRCODE = '42501';
            END IF;
        ELSIF TG_OP = 'UPDATE' THEN
            IF NEW.id IS DISTINCT FROM OLD.id
               OR NEW.meeting_id IS DISTINCT FROM OLD.meeting_id
               OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
                RAISE EXCEPTION 'ATTENDANCE_IMMUTABLE_KEYS: No se permite alterar id, meeting_id ni user_id'
                    USING ERRCODE = '42501';
            END IF;

            IF NOT v_is_board AND NEW.asistio IS DISTINCT FROM OLD.asistio THEN
                RAISE EXCEPTION 'ATTENDANCE_FORBIDDEN: Solo la directiva o administración puede modificar el estado de asistencia real (asistio)'
                    USING ERRCODE = '42501';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_meeting_attendance_guard ON public.meeting_attendance;
CREATE TRIGGER trg_meeting_attendance_guard
    BEFORE INSERT OR UPDATE ON public.meeting_attendance
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_meeting_attendance_guard();

-- ============================================================================
-- 4. Row Level Security (RLS) estricta en las 6 tablas
-- ============================================================================

-- 4.1 meetings
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meetings_select_active_member ON public.meetings;
CREATE POLICY meetings_select_active_member
    ON public.meetings
    FOR SELECT
    TO authenticated
    USING (public.is_active_member(group_id));

DROP POLICY IF EXISTS meetings_insert_board ON public.meetings;
CREATE POLICY meetings_insert_board
    ON public.meetings
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_group_board_or_admin(group_id)
        AND (created_by IS NULL OR created_by = auth.uid())
    );

DROP POLICY IF EXISTS meetings_update_board ON public.meetings;
CREATE POLICY meetings_update_board
    ON public.meetings
    FOR UPDATE
    TO authenticated
    USING (public.is_group_board_or_admin(group_id))
    WITH CHECK (public.is_group_board_or_admin(group_id));

DROP POLICY IF EXISTS meetings_delete_board ON public.meetings;
CREATE POLICY meetings_delete_board
    ON public.meetings
    FOR DELETE
    TO authenticated
    USING (public.is_group_board_or_admin(group_id));

-- 4.2 meeting_attendance
ALTER TABLE public.meeting_attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meeting_attendance_select_active_member ON public.meeting_attendance;
CREATE POLICY meeting_attendance_select_active_member
    ON public.meeting_attendance
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.meetings m
            WHERE m.id = meeting_attendance.meeting_id
              AND public.is_active_member(m.group_id)
        )
    );

DROP POLICY IF EXISTS meeting_attendance_insert_member_or_board ON public.meeting_attendance;
CREATE POLICY meeting_attendance_insert_member_or_board
    ON public.meeting_attendance
    FOR INSERT
    TO authenticated
    WITH CHECK (
        (
            user_id = auth.uid()
            AND asistio = false
            AND EXISTS (
                SELECT 1
                FROM public.meetings m
                WHERE m.id = meeting_attendance.meeting_id
                  AND public.is_active_member(m.group_id)
            )
        )
        OR EXISTS (
            SELECT 1
            FROM public.meetings m
            WHERE m.id = meeting_attendance.meeting_id
              AND public.is_group_board_or_admin(m.group_id)
        )
    );

DROP POLICY IF EXISTS meeting_attendance_update_member_or_board ON public.meeting_attendance;
CREATE POLICY meeting_attendance_update_member_or_board
    ON public.meeting_attendance
    FOR UPDATE
    TO authenticated
    USING (
        (
            user_id = auth.uid()
            AND EXISTS (
                SELECT 1
                FROM public.meetings m
                WHERE m.id = meeting_attendance.meeting_id
                  AND public.is_active_member(m.group_id)
            )
        )
        OR EXISTS (
            SELECT 1
            FROM public.meetings m
            WHERE m.id = meeting_attendance.meeting_id
              AND public.is_group_board_or_admin(m.group_id)
        )
    )
    WITH CHECK (
        (
            user_id = auth.uid()
            AND EXISTS (
                SELECT 1
                FROM public.meetings m
                WHERE m.id = meeting_attendance.meeting_id
                  AND public.is_active_member(m.group_id)
            )
        )
        OR EXISTS (
            SELECT 1
            FROM public.meetings m
            WHERE m.id = meeting_attendance.meeting_id
              AND public.is_group_board_or_admin(m.group_id)
        )
    );

DROP POLICY IF EXISTS meeting_attendance_delete_board ON public.meeting_attendance;
CREATE POLICY meeting_attendance_delete_board
    ON public.meeting_attendance
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.meetings m
            WHERE m.id = meeting_attendance.meeting_id
              AND public.is_group_board_or_admin(m.group_id)
        )
    );

-- 4.3 recordings (acceso exclusivo directiva/admin — privacidad audios crudos Ley 29733)
ALTER TABLE public.recordings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recordings_select_board ON public.recordings;
CREATE POLICY recordings_select_board
    ON public.recordings
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.meetings m
            WHERE m.id = recordings.meeting_id
              AND public.is_group_board_or_admin(m.group_id)
        )
    );

DROP POLICY IF EXISTS recordings_insert_board ON public.recordings;
CREATE POLICY recordings_insert_board
    ON public.recordings
    FOR INSERT
    TO authenticated
    WITH CHECK (
        (created_by IS NULL OR created_by = auth.uid())
        AND EXISTS (
            SELECT 1
            FROM public.meetings m
            WHERE m.id = recordings.meeting_id
              AND public.is_group_board_or_admin(m.group_id)
        )
    );

DROP POLICY IF EXISTS recordings_update_board ON public.recordings;
CREATE POLICY recordings_update_board
    ON public.recordings
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.meetings m
            WHERE m.id = recordings.meeting_id
              AND public.is_group_board_or_admin(m.group_id)
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.meetings m
            WHERE m.id = recordings.meeting_id
              AND public.is_group_board_or_admin(m.group_id)
        )
    );

DROP POLICY IF EXISTS recordings_delete_board ON public.recordings;
CREATE POLICY recordings_delete_board
    ON public.recordings
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.meetings m
            WHERE m.id = recordings.meeting_id
              AND public.is_group_board_or_admin(m.group_id)
        )
    );

-- 4.4 transcripts (acceso exclusivo directiva/admin — privacidad transcripciones crudas Ley 29733)
ALTER TABLE public.transcripts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transcripts_select_board ON public.transcripts;
CREATE POLICY transcripts_select_board
    ON public.transcripts
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.meetings m
            WHERE m.id = transcripts.meeting_id
              AND public.is_group_board_or_admin(m.group_id)
        )
    );

DROP POLICY IF EXISTS transcripts_insert_board ON public.transcripts;
CREATE POLICY transcripts_insert_board
    ON public.transcripts
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.meetings m
            JOIN public.recordings r
              ON r.meeting_id = m.id
            WHERE m.id = transcripts.meeting_id
              AND r.id = transcripts.recording_id
              AND public.is_group_board_or_admin(m.group_id)
        )
    );

DROP POLICY IF EXISTS transcripts_update_board ON public.transcripts;
CREATE POLICY transcripts_update_board
    ON public.transcripts
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.meetings m
            WHERE m.id = transcripts.meeting_id
              AND public.is_group_board_or_admin(m.group_id)
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.meetings m
            JOIN public.recordings r
              ON r.meeting_id = m.id
            WHERE m.id = transcripts.meeting_id
              AND r.id = transcripts.recording_id
              AND public.is_group_board_or_admin(m.group_id)
        )
    );

DROP POLICY IF EXISTS transcripts_delete_board ON public.transcripts;
CREATE POLICY transcripts_delete_board
    ON public.transcripts
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.meetings m
            WHERE m.id = transcripts.meeting_id
              AND public.is_group_board_or_admin(m.group_id)
        )
    );

-- 4.5 minutes
ALTER TABLE public.minutes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS minutes_select_member_or_board ON public.minutes;
CREATE POLICY minutes_select_member_or_board
    ON public.minutes
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.meetings m
            WHERE m.id = minutes.meeting_id
              AND (
                  public.is_group_board_or_admin(m.group_id)
                  OR (
                      public.is_active_member(m.group_id)
                      AND minutes.estado IN ('aprobada', 'asentada_en_libro')
                  )
              )
        )
    );

DROP POLICY IF EXISTS minutes_insert_board ON public.minutes;
CREATE POLICY minutes_insert_board
    ON public.minutes
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.meetings m
            WHERE m.id = minutes.meeting_id
              AND public.is_group_board_or_admin(m.group_id)
        )
    );

DROP POLICY IF EXISTS minutes_update_board ON public.minutes;
CREATE POLICY minutes_update_board
    ON public.minutes
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.meetings m
            WHERE m.id = minutes.meeting_id
              AND public.is_group_board_or_admin(m.group_id)
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.meetings m
            WHERE m.id = minutes.meeting_id
              AND public.is_group_board_or_admin(m.group_id)
        )
    );

DROP POLICY IF EXISTS minutes_delete_board ON public.minutes;
CREATE POLICY minutes_delete_board
    ON public.minutes
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.meetings m
            WHERE m.id = minutes.meeting_id
              AND public.is_group_board_or_admin(m.group_id)
        )
    );

-- 4.6 minute_signatures
ALTER TABLE public.minute_signatures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS minute_signatures_select_active_member ON public.minute_signatures;
CREATE POLICY minute_signatures_select_active_member
    ON public.minute_signatures
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.minutes min
            JOIN public.meetings m
              ON m.id = min.meeting_id
            WHERE min.id = minute_signatures.minute_id
              AND public.is_active_member(m.group_id)
        )
    );

DROP POLICY IF EXISTS minute_signatures_insert_active_member ON public.minute_signatures;
CREATE POLICY minute_signatures_insert_active_member
    ON public.minute_signatures
    FOR INSERT
    TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        AND EXISTS (
            SELECT 1
            FROM public.minutes min
            JOIN public.meetings m
              ON m.id = min.meeting_id
            WHERE min.id = minute_signatures.minute_id
              AND min.estado IN ('aprobada', 'asentada_en_libro')
              AND public.is_active_member(m.group_id)
        )
    );

-- ============================================================================
-- 5. Storage Bucket privado 'meeting-recordings' y RLS en storage.objects
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'meeting-recordings',
    'meeting-recordings',
    false,
    26214400, -- 25 MB (chunks de audio de 5 a 10 minutos)
    ARRAY[
        'audio/mp4',
        'audio/m4a',
        'audio/x-m4a',
        'audio/mpeg',
        'audio/wav',
        'audio/webm',
        'audio/ogg',
        'application/octet-stream'
    ]
)
ON CONFLICT (id) DO NOTHING;

-- Ruta esperada: <group_id>/<meeting_id>/chunk_XX.m4a
-- Se valida formato UUID antes del cast para evitar errores 22P02 en otros buckets.
DROP POLICY IF EXISTS meeting_recordings_select_board ON storage.objects;
CREATE POLICY meeting_recordings_select_board
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'meeting-recordings'
        AND CASE
            WHEN COALESCE((storage.foldername(name))[1], '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN public.is_group_board_or_admin(((storage.foldername(name))[1])::uuid)
            ELSE false
        END
    );

DROP POLICY IF EXISTS meeting_recordings_insert_board ON storage.objects;
CREATE POLICY meeting_recordings_insert_board
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'meeting-recordings'
        AND array_length(storage.foldername(name), 1) >= 2
        AND CASE
            WHEN COALESCE((storage.foldername(name))[1], '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN public.is_group_board_or_admin(((storage.foldername(name))[1])::uuid)
            ELSE false
        END
    );

DROP POLICY IF EXISTS meeting_recordings_update_board ON storage.objects;
CREATE POLICY meeting_recordings_update_board
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'meeting-recordings'
        AND CASE
            WHEN COALESCE((storage.foldername(name))[1], '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN public.is_group_board_or_admin(((storage.foldername(name))[1])::uuid)
            ELSE false
        END
    )
    WITH CHECK (
        bucket_id = 'meeting-recordings'
        AND array_length(storage.foldername(name), 1) >= 2
        AND CASE
            WHEN COALESCE((storage.foldername(name))[1], '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN public.is_group_board_or_admin(((storage.foldername(name))[1])::uuid)
            ELSE false
        END
    );

DROP POLICY IF EXISTS meeting_recordings_delete_board ON storage.objects;
CREATE POLICY meeting_recordings_delete_board
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'meeting-recordings'
        AND CASE
            WHEN COALESCE((storage.foldername(name))[1], '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN public.is_group_board_or_admin(((storage.foldername(name))[1])::uuid)
            ELSE false
        END
    );

-- ============================================================================
-- 6. Supabase Realtime (idempotente para meetings, recordings y minutes)
-- ============================================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (
            SELECT 1
            FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = 'meetings'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.meetings;
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = 'recordings'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.recordings;
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = 'minutes'
        ) THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.minutes;
        END IF;
    END IF;
END;
$$;
