/**
 * Supabase Edge Function: `transcribe-meeting-chunk`
 *
 * Transcribe un bloque de audio subido al bucket privado `meeting-recordings`
 * mediante Faster-Whisper (`POST ${STT_URL}/v1/audio/transcriptions`),
 * guarda/actualiza el texto en `public.transcripts` y actualiza `public.recordings`.
 *
 * Seguridad:
 * - Requiere JWT válido en `Authorization: Bearer <jwt>`.
 * - Verifica membresía activa con `rol IN ('admin', 'presidente', 'secretario')`
 *   en el `group_id` de la reunión.
 * - Todas las credenciales se leen desde `Deno.env.get(...)`.
 */

import {
  corsHeaders,
  DEFAULT_STT_MODEL,
  inferAudioMimeType,
  isValidMeetingStoragePath,
  jsonCorsResponse,
  sanitizeErrorMessage,
  transcribeAudioChunk,
} from '../_shared/meetingsAi.ts';
import { createSupabaseAdminClient } from '../_shared/supabaseAdmin.ts';

const RECORDINGS_BUCKET = 'meeting-recordings';
const BOARD_ROLES = ['admin', 'presidente', 'secretario'] as const;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extractBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function extractFileName(storagePath: string): string {
  const parts = storagePath.split('/');
  const last = parts[parts.length - 1]?.trim();
  return last && last.length > 0 ? last : 'chunk.m4a';
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

  let body: { recordingId?: unknown; recording_id?: unknown };
  try {
    body = (await req.json()) as { recordingId?: unknown; recording_id?: unknown };
  } catch {
    return jsonCorsResponse({ ok: false, error: 'Payload JSON inválido.' }, 400);
  }

  const rawRecordingId = body.recordingId ?? body.recording_id;
  const recordingId = typeof rawRecordingId === 'string' ? rawRecordingId.trim() : '';
  if (!UUID_REGEX.test(recordingId)) {
    return jsonCorsResponse(
      { ok: false, error: 'recordingId (o recording_id) debe ser un UUID válido.' },
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

  const { data: recording, error: recordingError } = await supabaseAdmin
    .from('recordings')
    .select('id, meeting_id, chunk_index, storage_path, estado')
    .eq('id', recordingId)
    .maybeSingle();

  if (recordingError) {
    console.error('[transcribe-meeting-chunk] Error consultando recording:', recordingError.message);
    return jsonCorsResponse({ ok: false, error: 'Error al consultar la grabación.' }, 500);
  }

  if (!recording) {
    return jsonCorsResponse({ ok: false, error: 'Grabación no encontrada.' }, 404);
  }

  const { data: meeting, error: meetingError } = await supabaseAdmin
    .from('meetings')
    .select('id, group_id')
    .eq('id', recording.meeting_id)
    .maybeSingle();

  if (meetingError || !meeting) {
    return jsonCorsResponse({ ok: false, error: 'Reunión asociada no encontrada.' }, 404);
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
    console.error('[transcribe-meeting-chunk] Error verificando membresía:', membershipError.message);
    return jsonCorsResponse({ ok: false, error: 'Error al validar permisos.' }, 500);
  }

  if (!membership) {
    return jsonCorsResponse(
      {
        ok: false,
        error: 'Acceso denegado: solo admin, presidente o secretario activo puede transcribir.',
      },
      403,
    );
  }

  if (recording.estado === 'eliminado') {
    return jsonCorsResponse(
      { ok: false, error: 'El audio de esta grabación ya fue eliminado (Ley 29733).' },
      409,
    );
  }

  if (!isValidMeetingStoragePath(recording.storage_path, meeting.group_id, meeting.id)) {
    console.warn('[transcribe-meeting-chunk] Ruta storage_path rechazada por validación de alcance.', {
      recordingId: recording.id,
      meetingId: meeting.id,
      groupId: meeting.group_id,
    });
    return jsonCorsResponse(
      { ok: false, error: 'Ruta de almacenamiento no autorizada para esta reunión.' },
      403,
    );
  }

  const sttUrl = Deno.env.get('STT_URL')?.trim() ?? '';
  const sttApiKey = Deno.env.get('STT_API_KEY')?.trim() ?? '';
  const sttModel = Deno.env.get('STT_MODEL')?.trim() || DEFAULT_STT_MODEL;

  if (!sttUrl) {
    const msg = 'Servicio STT no configurado (falta STT_URL en secretos).';
    await supabaseAdmin
      .from('recordings')
      .update({ estado: 'error', error_message: msg })
      .eq('id', recording.id);
    return jsonCorsResponse({ ok: false, error: msg }, 500);
  }

  const { error: markProcessingError } = await supabaseAdmin
    .from('recordings')
    .update({ estado: 'transcribiendo', error_message: null })
    .eq('id', recording.id);

  if (markProcessingError) {
    console.error(
      '[transcribe-meeting-chunk] Error actualizando estado transcribiendo:',
      markProcessingError.message,
    );
  }

  try {
    const { data: audioBlob, error: downloadError } = await supabaseAdmin.storage
      .from(RECORDINGS_BUCKET)
      .download(recording.storage_path);

    if (downloadError || !audioBlob) {
      throw new Error(
        `No se pudo descargar el audio desde Storage: ${downloadError?.message ?? 'archivo vacío'}`,
      );
    }

    const audioBytes = new Uint8Array(await audioBlob.arrayBuffer());
    const fileName = extractFileName(recording.storage_path);
    const mimeType = audioBlob.type || inferAudioMimeType(fileName);

    const transcriptText = await transcribeAudioChunk({
      audioBytes,
      fileName,
      mimeType,
      sttUrl,
      sttApiKey,
      sttModel,
    });

    const { error: upsertTranscriptError } = await supabaseAdmin
      .from('transcripts')
      .upsert(
        {
          recording_id: recording.id,
          meeting_id: recording.meeting_id,
          chunk_index: recording.chunk_index,
          texto: transcriptText,
          proveedor: sttModel,
        },
        { onConflict: 'recording_id' },
      );

    if (upsertTranscriptError) {
      throw new Error(`Error al guardar transcripción: ${upsertTranscriptError.message}`);
    }

    const { error: markDoneError } = await supabaseAdmin
      .from('recordings')
      .update({ estado: 'transcrito', error_message: null })
      .eq('id', recording.id);

    if (markDoneError) {
      throw new Error(`Error al actualizar estado transcrito: ${markDoneError.message}`);
    }

    const textPreview =
      transcriptText.length > 240 ? `${transcriptText.slice(0, 237)}...` : transcriptText;

    console.info('[transcribe-meeting-chunk] Bloque transcrito correctamente.', {
      recordingId: recording.id,
      meetingId: recording.meeting_id,
      chunkIndex: recording.chunk_index,
      chars: transcriptText.length,
    });

    return jsonCorsResponse({
      ok: true,
      recordingId: recording.id,
      chunkIndex: recording.chunk_index,
      textPreview,
    });
  } catch (err) {
    const safeMessage = sanitizeErrorMessage(err);
    console.error('[transcribe-meeting-chunk] Error al transcribir bloque:', {
      recordingId: recording.id,
      error: safeMessage,
    });

    await supabaseAdmin
      .from('recordings')
      .update({ estado: 'error', error_message: safeMessage })
      .eq('id', recording.id);

    return jsonCorsResponse({ ok: false, error: safeMessage }, 500);
  }
});
