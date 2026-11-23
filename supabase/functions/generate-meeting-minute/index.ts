/**
 * Supabase Edge Function: `generate-meeting-minute`
 *
 * Soporta 3 acciones autenticadas para directiva (`admin`, `presidente`, `secretario`):
 * 1. `action: 'generate'` (default): consolida reunión, asistentes confirmados y
 *    transcripciones ordenadas por `chunk_index`; genera borrador estructurado con
 *    DeepSeek-V3 (o fallback determinístico si falla/no hay API key); calcula
 *    `hash_sha256`; y hace upsert en `public.minutes` (`estado = 'borrador'`).
 * 2. `action: 'purge_audio'`: elimina los archivos de audio del bucket privado
 *    `meeting-recordings` asociados a la reunión y marca `recordings.estado = 'eliminado'`
 *    en cumplimiento del principio de retención mínima (Ley 29733 — Perú).
 * 3. `action: 'generate_pdf'`: valida doble aprobación vigente (Presidente + Secretario),
 *    genera el PDF oficial A4 con `pdf-lib`, lo sube al bucket público `meeting-minutes-pdf`,
 *    actualiza `minutes.pdf_path` y devuelve enlace público + mensaje listo para WhatsApp.
 */

import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';

import {
  computeSha256Hex,
  corsHeaders,
  DEFAULT_DEEPSEEK_URL,
  generateStructuredMinute,
  isValidMeetingStoragePath,
  jsonCorsResponse,
  sanitizeErrorMessage,
} from '../_shared/meetingsAi.ts';
import {
  buildMinuteWhatsAppSharePayload,
  buildOfficialMinutePdfBytes,
  type MinutePdfAgreement,
  type MinutePdfSignature,
} from '../_shared/minutePdf.ts';
import { createSupabaseAdminClient } from '../_shared/supabaseAdmin.ts';

const RECORDINGS_BUCKET = 'meeting-recordings';
const MINUTES_PDF_BUCKET = 'meeting-minutes-pdf';
const BOARD_ROLES = ['admin', 'presidente', 'secretario'] as const;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STORAGE_REMOVE_CHUNK_SIZE = 50;

function extractBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonCorsResponse({ ok: false, error: 'Method Not Allowed' }, 405);
  }

  const jwt = extractBearerToken(req);
  if (!jwt) {
    return jsonCorsResponse(
      { ok: false, error: 'Cabecera Authorization Bearer requerida.' },
      401,
    );
  }

  let body: { meetingId?: unknown; meeting_id?: unknown; action?: unknown };
  try {
    body = (await req.json()) as { meetingId?: unknown; meeting_id?: unknown; action?: unknown };
  } catch {
    return jsonCorsResponse({ ok: false, error: 'Payload JSON inválido.' }, 400);
  }

  const rawMeetingId = body.meetingId ?? body.meeting_id;
  const meetingId = typeof rawMeetingId === 'string' ? rawMeetingId.trim() : '';
  if (!UUID_REGEX.test(meetingId)) {
    return jsonCorsResponse(
      { ok: false, error: 'meetingId (o meeting_id) debe ser un UUID válido.' },
      400,
    );
  }

  const action =
    body.action === undefined || body.action === null || body.action === ''
      ? 'generate'
      : body.action;

  if (action !== 'generate' && action !== 'purge_audio' && action !== 'generate_pdf') {
    return jsonCorsResponse(
      {
        ok: false,
        error:
          "action inválida. Valores permitidos: 'generate' | 'purge_audio' | 'generate_pdf'.",
      },
      400,
    );
  }

  const supabaseAdmin = createSupabaseAdminClient();

  const {
    data: { user },
    error: authError,
  } = await supabaseAdmin.auth.getUser(jwt);

  if (authError || !user) {
    return jsonCorsResponse({ ok: false, error: 'Token de sesión inválido o expirado.' }, 401);
  }

  const { data: meeting, error: meetingError } = await supabaseAdmin
    .from('meetings')
    .select('id, group_id, titulo, fecha, lugar, agenda, estado')
    .eq('id', meetingId)
    .maybeSingle();

  if (meetingError) {
    console.error('[generate-meeting-minute] Error consultando reunión:', meetingError.message);
    return jsonCorsResponse({ ok: false, error: 'Error al consultar la reunión.' }, 500);
  }

  if (!meeting) {
    return jsonCorsResponse({ ok: false, error: 'Reunión no encontrada.' }, 404);
  }

  const { data: membership, error: membershipError } = await supabaseAdmin
    .from('memberships')
    .select('id, rol, estado')
    .eq('group_id', meeting.group_id)
    .eq('user_id', user.id)
    .eq('estado', 'activo')
    .in('rol', [...BOARD_ROLES])
    .maybeSingle();

  if (membershipError) {
    console.error('[generate-meeting-minute] Error validando membresía:', membershipError.message);
    return jsonCorsResponse({ ok: false, error: 'Error al validar permisos.' }, 500);
  }

  if (!membership) {
    return jsonCorsResponse(
      {
        ok: false,
        error: 'Acceso denegado: solo admin, presidente o secretario activo puede operar actas.',
      },
      403,
    );
  }

  try {
    if (action === 'purge_audio') {
      const { data: recordings, error: recordingsError } = await supabaseAdmin
        .from('recordings')
        .select('id, storage_path, estado')
        .eq('meeting_id', meeting.id)
        .neq('estado', 'eliminado');

      if (recordingsError) {
        throw new Error(`Error al listar grabaciones: ${recordingsError.message}`);
      }

      const activeRecordings = recordings ?? [];
      const rawPaths = Array.from(
        new Set(
          activeRecordings
            .map((r: { storage_path: string | null }) => r.storage_path?.trim() ?? '')
            .filter((p): p is string => p.length > 0),
        ),
      );

      const invalidPath = rawPaths.find(
        (p) => !isValidMeetingStoragePath(p, meeting.group_id, meeting.id),
      );
      if (invalidPath) {
        console.warn('[generate-meeting-minute] Purga bloqueada por ruta storage_path fuera de alcance.', {
          meetingId: meeting.id,
          groupId: meeting.group_id,
        });
        return jsonCorsResponse(
          { ok: false, error: 'Ruta de almacenamiento no autorizada para esta reunión.' },
          403,
        );
      }

      const paths = rawPaths;

      let removedFiles = 0;
      for (let i = 0; i < paths.length; i += STORAGE_REMOVE_CHUNK_SIZE) {
        const chunk = paths.slice(i, i + STORAGE_REMOVE_CHUNK_SIZE);
        const { error: removeError } = await supabaseAdmin.storage
          .from(RECORDINGS_BUCKET)
          .remove(chunk);

        if (removeError) {
          throw new Error(`Error al eliminar audios de Storage: ${removeError.message}`);
        }
        removedFiles += chunk.length;
      }

      if (activeRecordings.length > 0) {
        const ids = activeRecordings.map((r: { id: string }) => r.id);
        const { error: updateError } = await supabaseAdmin
          .from('recordings')
          .update({ estado: 'eliminado', error_message: null })
          .in('id', ids);

        if (updateError) {
          throw new Error(`Error al marcar grabaciones como eliminadas: ${updateError.message}`);
        }
      }

      console.info('[generate-meeting-minute] Audios eliminados (Ley 29733).', {
        meetingId: meeting.id,
        purgedCount: activeRecordings.length,
        removedFiles,
      });

      return jsonCorsResponse({
        ok: true,
        action: 'purge_audio',
        meetingId: meeting.id,
        purgedCount: activeRecordings.length,
        removedFiles,
      });
    }

    if (action === 'generate_pdf') {
      const { data: existingMinute, error: minuteFetchError } = await supabaseAdmin
        .from('minutes')
        .select(
          'id, meeting_id, contenido, resumen_estructurado, estado, pdf_path, hash_sha256, aprobada_presidente_por, aprobada_presidente_at, aprobada_secretario_por, aprobada_secretario_at',
        )
        .eq('meeting_id', meeting.id)
        .maybeSingle();

      if (minuteFetchError) {
        throw new Error(`Error al consultar el acta: ${minuteFetchError.message}`);
      }

      if (!existingMinute) {
        return jsonCorsResponse(
          { ok: false, error: 'No existe un acta generada para esta reunión.' },
          404,
        );
      }

      if (!existingMinute.aprobada_presidente_at || !existingMinute.aprobada_secretario_at) {
        return jsonCorsResponse(
          {
            ok: false,
            error:
              'Se requiere la confirmación del Presidente y del Secretario sobre la versión vigente antes de generar el PDF oficial.',
          },
          409,
        );
      }

      const [groupRes, signaturesRes] = await Promise.all([
        supabaseAdmin.from('groups').select('nombre').eq('id', meeting.group_id).maybeSingle(),
        supabaseAdmin
          .from('minute_signatures')
          .select('user_id, tipo, firmado_at')
          .eq('minute_id', existingMinute.id)
          .order('firmado_at', { ascending: true }),
      ]);

      if (signaturesRes.error) {
        console.error(
          '[generate-meeting-minute] Error consultando conformidades:',
          signaturesRes.error.message,
        );
      }

      const signatureRows = (signaturesRes.data ?? []) as Array<{
        user_id: string;
        tipo: string;
        firmado_at: string | null;
      }>;

      const profileIds = Array.from(
        new Set(
          [
            existingMinute.aprobada_presidente_por,
            existingMinute.aprobada_secretario_por,
            ...signatureRows.map((s) => s.user_id),
          ].filter((id): id is string => typeof id === 'string' && id.length > 0),
        ),
      );

      const profileMap = new Map<string, string>();
      if (profileIds.length > 0) {
        const { data: profiles, error: profilesError } = await supabaseAdmin
          .from('profiles')
          .select('id, nombre')
          .in('id', profileIds);

        if (profilesError) {
          console.error(
            '[generate-meeting-minute] Error consultando perfiles para PDF:',
            profilesError.message,
          );
        } else {
          for (const p of profiles ?? []) {
            if (typeof p.id === 'string' && typeof p.nombre === 'string' && p.nombre.trim()) {
              profileMap.set(p.id, p.nombre.trim());
            }
          }
        }
      }

      const presidenteNombre =
        (existingMinute.aprobada_presidente_por &&
          profileMap.get(existingMinute.aprobada_presidente_por)) ||
        'Presidente de la Asociación';
      const secretarioNombre =
        (existingMinute.aprobada_secretario_por &&
          profileMap.get(existingMinute.aprobada_secretario_por)) ||
        'Secretario/a de la Asociación';

      const signatures: MinutePdfSignature[] = signatureRows.map((s) => ({
        nombre: profileMap.get(s.user_id) ?? 'Socio registrado',
        tipo: s.tipo,
        firmadoAt: s.firmado_at,
      }));

      const resumen =
        existingMinute.resumen_estructurado &&
        typeof existingMinute.resumen_estructurado === 'object'
          ? (existingMinute.resumen_estructurado as Record<string, unknown>)
          : {};

      const temasTratados = Array.isArray(resumen.temas_tratados)
        ? resumen.temas_tratados.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        : [];

      const acuerdos: MinutePdfAgreement[] = Array.isArray(resumen.acuerdos)
        ? resumen.acuerdos
            .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === 'object')
            .map((a) => ({
              descripcion: typeof a.descripcion === 'string' ? a.descripcion : '',
              responsable:
                typeof a.responsable === 'string' && a.responsable.trim()
                  ? a.responsable.trim()
                  : 'Junta Directiva',
              plazo:
                typeof a.plazo === 'string' && a.plazo.trim() ? a.plazo.trim() : 'Por definir',
            }))
            .filter((a) => a.descripcion.trim().length > 0)
        : [];

      const hashSha256 =
        typeof existingMinute.hash_sha256 === 'string' && existingMinute.hash_sha256.trim().length > 0
          ? existingMinute.hash_sha256.trim()
          : await computeSha256Hex(existingMinute.contenido);

      const shortHash = hashSha256.slice(0, 12);
      const pdfPath = `${meeting.group_id}/${meeting.id}/acta_${shortHash}.pdf`;

      if (!isValidMeetingStoragePath(pdfPath, meeting.group_id, meeting.id)) {
        return jsonCorsResponse(
          { ok: false, error: 'Ruta de destino PDF inválida para esta reunión.' },
          403,
        );
      }

      const groupName =
        typeof groupRes.data?.nombre === 'string' && groupRes.data.nombre.trim().length > 0
          ? groupRes.data.nombre.trim()
          : 'Asociación Bello Horizonte';

      const pdfBytes = await buildOfficialMinutePdfBytes(
        {
          groupName,
          meetingTitle: meeting.titulo,
          meetingDate: meeting.fecha,
          meetingPlace: meeting.lugar,
          contenido: existingMinute.contenido,
          temasTratados,
          acuerdos,
          presidenteNombre,
          presidenteAprobadoAt: existingMinute.aprobada_presidente_at,
          secretarioNombre,
          secretarioAprobadoAt: existingMinute.aprobada_secretario_at,
          signatures,
          hashSha256,
          estado: existingMinute.estado,
        },
        { PDFDocument, StandardFonts, rgb },
      );

      const { error: uploadError } = await supabaseAdmin.storage
        .from(MINUTES_PDF_BUCKET)
        .upload(pdfPath, pdfBytes, {
          contentType: 'application/pdf',
          upsert: true,
        });

      if (uploadError) {
        throw new Error(`Error al subir el PDF oficial a Storage: ${uploadError.message}`);
      }

      const updateFields: Record<string, unknown> = { pdf_path: pdfPath };
      if (!existingMinute.hash_sha256) {
        updateFields.hash_sha256 = hashSha256;
      }

      const { data: updatedMinute, error: updateMinuteError } = await supabaseAdmin
        .from('minutes')
        .update(updateFields)
        .eq('id', existingMinute.id)
        .select('*')
        .single();

      if (updateMinuteError || !updatedMinute) {
        throw new Error(
          `Error al actualizar pdf_path del acta: ${updateMinuteError?.message ?? 'sin registro'}`,
        );
      }

      const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').trim().replace(/\/+$/, '');
      const pdfUrl = `${supabaseUrl}/storage/v1/object/public/${MINUTES_PDF_BUCKET}/${pdfPath}`;

      const { whatsappText, whatsappShareUrl } = buildMinuteWhatsAppSharePayload({
        groupName,
        meetingTitle: meeting.titulo,
        meetingDate: meeting.fecha,
        meetingPlace: meeting.lugar,
        acuerdos,
        pdfUrl,
        hashSha256,
      });

      console.info('[generate-meeting-minute] PDF oficial generado y publicado.', {
        meetingId: meeting.id,
        minuteId: existingMinute.id,
        pdfPath,
        pdfBytes: pdfBytes.byteLength,
      });

      return jsonCorsResponse({
        ok: true,
        pdfPath,
        pdfUrl,
        whatsappText,
        whatsappShareUrl,
        minute: updatedMinute,
      });
    }

    // action === 'generate'
    const [groupRes, attendanceRes, transcriptsRes] = await Promise.all([
      supabaseAdmin.from('groups').select('nombre').eq('id', meeting.group_id).maybeSingle(),
      supabaseAdmin
        .from('meeting_attendance')
        .select('user_id, respuesta, asistio')
        .eq('meeting_id', meeting.id),
      supabaseAdmin
        .from('transcripts')
        .select('chunk_index, texto')
        .eq('meeting_id', meeting.id)
        .order('chunk_index', { ascending: true }),
    ]);

    if (attendanceRes.error) {
      throw new Error(`Error al consultar asistencia: ${attendanceRes.error.message}`);
    }
    if (transcriptsRes.error) {
      throw new Error(`Error al consultar transcripciones: ${transcriptsRes.error.message}`);
    }

    const attendanceRows = (attendanceRes.data ?? []) as Array<{
      user_id: string;
      respuesta: string;
      asistio: boolean;
    }>;

    // Prioriza asistentes marcados físicamente (`asistio = true`); si aún no se marcó lista,
    // usa quienes confirmaron asistencia (`respuesta = 'asistire'`).
    const realAttendees = attendanceRows.filter((row) => row.asistio === true);
    const confirmedRows =
      realAttendees.length > 0
        ? realAttendees
        : attendanceRows.filter((row) => row.respuesta === 'asistire');

    const attendeeIds = Array.from(new Set(confirmedRows.map((row) => row.user_id)));
    let attendeeNames: string[] = [];

    if (attendeeIds.length > 0) {
      const { data: profiles, error: profilesError } = await supabaseAdmin
        .from('profiles')
        .select('id, nombre')
        .in('id', attendeeIds);

      if (profilesError) {
        console.error('[generate-meeting-minute] Error consultando perfiles:', profilesError.message);
      } else {
        attendeeNames = (profiles ?? [])
          .map((p: { nombre: string | null }) => (typeof p.nombre === 'string' ? p.nombre.trim() : ''))
          .filter((name): name is string => name.length > 0)
          .sort((a, b) => a.localeCompare(b, 'es'));
      }
    }

    const transcriptRows = (transcriptsRes.data ?? []) as Array<{
      chunk_index: number;
      texto: string;
    }>;

    const combinedTranscript =
      transcriptRows.length <= 1
        ? (transcriptRows[0]?.texto ?? '').trim()
        : transcriptRows
            .map((row) => `[Bloque ${row.chunk_index}]\n${row.texto.trim()}`)
            .join('\n\n');

    const groupName =
      typeof groupRes.data?.nombre === 'string' && groupRes.data.nombre.trim().length > 0
        ? groupRes.data.nombre.trim()
        : 'Asociación Bello Horizonte';

    const deepseekUrl = Deno.env.get('DEEPSEEK_API_URL')?.trim() || DEFAULT_DEEPSEEK_URL;
    const deepseekApiKey = Deno.env.get('DEEPSEEK_API_KEY')?.trim() ?? '';

    const structured = await generateStructuredMinute({
      meeting: {
        titulo: meeting.titulo,
        fecha: meeting.fecha,
        lugar: meeting.lugar,
        agenda: meeting.agenda,
        groupName,
      },
      transcriptText: combinedTranscript,
      attendees: attendeeNames,
      deepseekUrl,
      deepseekApiKey,
    });

    const hashSha256 = await computeSha256Hex(structured.contenido_acta);

    const resumenEstructurado = {
      temas_tratados: structured.temas_tratados,
      acuerdos: structured.acuerdos,
      provider: structured.provider,
      used_fallback: structured.used_fallback,
      attendees_count: attendeeNames.length,
      transcript_chunks: transcriptRows.length,
      generated_at: new Date().toISOString(),
    };

    const { data: minute, error: upsertError } = await supabaseAdmin
      .from('minutes')
      .upsert(
        {
          meeting_id: meeting.id,
          contenido: structured.contenido_acta,
          resumen_estructurado: resumenEstructurado,
          estado: 'borrador',
          hash_sha256: hashSha256,
        },
        { onConflict: 'meeting_id' },
      )
      .select('*')
      .single();

    if (upsertError || !minute) {
      throw new Error(`Error al guardar el acta en base de datos: ${upsertError?.message ?? 'sin registro'}`);
    }

    console.info('[generate-meeting-minute] Borrador de acta generado.', {
      meetingId: meeting.id,
      minuteId: minute.id,
      provider: structured.provider,
      usedFallback: structured.used_fallback,
      chunks: transcriptRows.length,
      attendees: attendeeNames.length,
    });

    return jsonCorsResponse({
      ok: true,
      minute,
    });
  } catch (err) {
    const safeMessage = sanitizeErrorMessage(err);
    console.error('[generate-meeting-minute] Error en operación:', {
      meetingId: meeting.id,
      action,
      error: safeMessage,
    });
    return jsonCorsResponse({ ok: false, error: safeMessage }, 500);
  }
});
