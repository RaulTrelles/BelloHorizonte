/**
 * Helpers puros y testeables para transcripción STT (Faster-Whisper),
 * generación estructurada de actas con IA (DeepSeek-V3 + fallback determinístico)
 * y cálculo de hash SHA-256 verificable (Libro de Actas — Perú / Ley 29733).
 *
 * Sin dependencias directas de `Deno.env`: todas las credenciales y URLs
 * se inyectan por parámetros desde las Edge Functions.
 */

export const DEFAULT_STT_MODEL = 'Systran/faster-whisper-small';
export const DEFAULT_STT_TIMEOUT_MS = 120_000;
export const DEFAULT_DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat';
export const DEFAULT_DEEPSEEK_TIMEOUT_MS = 90_000;

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export interface TranscribeAudioChunkParams {
  audioBytes: Uint8Array | ArrayBuffer;
  fileName: string;
  mimeType?: string;
  sttUrl: string;
  sttApiKey?: string;
  sttModel?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface MeetingMinuteContext {
  titulo: string;
  fecha?: string | null;
  lugar?: string | null;
  agenda?: string | null;
  groupName?: string | null;
}

export interface MinuteAgreement {
  descripcion: string;
  responsable: string;
  plazo: string;
}

export interface StructuredMinute {
  contenido_acta: string;
  temas_tratados: string[];
  acuerdos: MinuteAgreement[];
  provider: 'deepseek-chat' | 'deterministic-fallback';
  used_fallback: boolean;
}

export interface GenerateStructuredMinuteParams {
  meeting: MeetingMinuteContext;
  transcriptText: string;
  attendees: string[];
  deepseekUrl?: string;
  deepseekApiKey?: string;
  deepseekModel?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Helper para respuestas JSON con cabeceras CORS consistentes.
 */
export function jsonCorsResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

/**
 * Limpia mensajes de error para evitar filtrar tokens Bearer o credenciales en logs/BD.
 */
export function sanitizeErrorMessage(raw: unknown, maxLength = 280): string {
  const base =
    raw instanceof Error
      ? raw.message
      : typeof raw === 'string'
        ? raw
        : 'Error interno inesperado';

  const redacted = base
    .replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, 'Bearer [REDACTED]')
    .replace(/(sk-[A-Za-z0-9]{8,})/g, '[REDACTED_KEY]')
    .replace(/\s+/g, ' ')
    .trim();

  if (redacted.length === 0) {
    return 'Error interno inesperado';
  }
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength - 3)}...` : redacted;
}

/**
 * Infiere el MIME type de audio según la extensión del archivo.
 */
export function inferAudioMimeType(fileName: string, fallback = 'audio/mp4'): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.m4a') || lower.endsWith('.mp4')) return 'audio/mp4';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.webm')) return 'audio/webm';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  return fallback;
}

/**
 * Valida estrictamente que una ruta en el bucket privado `meeting-recordings`
 * pertenezca al `groupId` y `meetingId` esperados y no contenga secuencias de
 * path traversal (`..` o `\`), previniendo IDOR entre grupos/reuniones.
 */
export function isValidMeetingStoragePath(
  storagePath: string | null | undefined,
  groupId: string,
  meetingId: string,
): boolean {
  if (typeof storagePath !== 'string' || !groupId || !meetingId) {
    return false;
  }
  const trimmed = storagePath.trim();
  const expectedPrefix = `${groupId}/${meetingId}/`;
  return (
    trimmed.startsWith(expectedPrefix) &&
    trimmed.length > expectedPrefix.length &&
    !trimmed.includes('..') &&
    !trimmed.includes('\\')
  );
}

function normalizeTranscriptText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Envía un bloque de audio al servicio Faster-Whisper compatible con OpenAI Audio API
 * (`POST ${sttUrl}/v1/audio/transcriptions`) y retorna el texto transcrito limpio.
 */
export async function transcribeAudioChunk(params: TranscribeAudioChunkParams): Promise<string> {
  const {
    audioBytes,
    fileName,
    mimeType,
    sttUrl,
    sttApiKey,
    sttModel = DEFAULT_STT_MODEL,
    fetchImpl = fetch,
    timeoutMs = DEFAULT_STT_TIMEOUT_MS,
  } = params;

  const trimmedUrl = sttUrl.trim().replace(/\/+$/, '');
  if (!trimmedUrl) {
    throw new Error('STT_URL no está configurado.');
  }

  const bytes =
    audioBytes instanceof Uint8Array
      ? new Uint8Array(audioBytes)
      : new Uint8Array(audioBytes);

  if (bytes.byteLength === 0) {
    throw new Error('El bloque de audio está vacío.');
  }

  const resolvedFileName = fileName.trim() || 'chunk.m4a';
  const resolvedMime = mimeType?.trim() || inferAudioMimeType(resolvedFileName);
  const resolvedModel = sttModel.trim() || DEFAULT_STT_MODEL;

  const formData = new FormData();
  const audioBlob = new Blob([bytes], { type: resolvedMime });
  formData.append('file', audioBlob, resolvedFileName);
  formData.append('model', resolvedModel);
  formData.append('language', 'es');

  const headers: Record<string, string> = {};
  if (sttApiKey && sttApiKey.trim().length > 0) {
    headers['Authorization'] = `Bearer ${sttApiKey.trim()}`;
  }

  const endpoint = `${trimmedUrl}/v1/audio/transcriptions`;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers,
    body: formData,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    let detail = '';
    try {
      detail = sanitizeErrorMessage(await response.text(), 160);
    } catch {
      detail = response.statusText || 'sin detalle';
    }
    throw new Error(`Error del servicio STT (HTTP ${response.status}): ${detail}`);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error('El servicio STT devolvió una respuesta JSON inválida.');
  }

  if (
    !data ||
    typeof data !== 'object' ||
    typeof (data as { text?: unknown }).text !== 'string'
  ) {
    throw new Error('La respuesta del servicio STT no contiene el campo "text".');
  }

  return normalizeTranscriptText((data as { text: string }).text);
}

function formatMeetingDateEsPe(fecha?: string | null): string {
  if (!fecha || !fecha.trim()) {
    return 'Fecha por confirmar';
  }
  const parsed = new Date(fecha);
  if (Number.isNaN(parsed.getTime())) {
    return fecha.trim();
  }
  try {
    return new Intl.DateTimeFormat('es-PE', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: 'America/Lima',
    }).format(parsed);
  } catch {
    return parsed.toISOString();
  }
}

function parseAgendaTopics(agenda?: string | null, fallbackTitle?: string): string[] {
  if (agenda && agenda.trim().length > 0) {
    const items = agenda
      .split(/\r?\n|;/)
      .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
      .filter((line) => line.length > 0);
    if (items.length > 0) {
      return items;
    }
  }
  const title = fallbackTitle?.trim();
  return [title ? `Desarrollo de la reunión: ${title}` : 'Asuntos generales de la asociación'];
}

function extractHeuristicAgreements(transcriptText: string): MinuteAgreement[] {
  const normalized = transcriptText.trim();
  if (!normalized) {
    return [];
  }

  const candidateRegex =
    /(?:^|[^\p{L}])(acuerd[ao]s?|acord[oó]|se aprueba|aprobaron|aprob[oó]|compromete|encarga|acordamos)(?=$|[^\p{L}])/iu;

  const sentences = normalized
    .split(/(?<=[.!?])\s+|\r?\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12 && candidateRegex.test(s));

  const seen = new Set<string>();
  const agreements: MinuteAgreement[] = [];

  for (const sentence of sentences) {
    const key = sentence.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    agreements.push({
      descripcion: sentence.length > 260 ? `${sentence.slice(0, 257)}...` : sentence,
      responsable: 'Junta Directiva',
      plazo: 'Por definir en sesión',
    });

    if (agreements.length >= 8) break;
  }

  return agreements;
}

/**
 * Construye un borrador formal determinístico para libro de actas en Perú
 * cuando DeepSeek no está configurado o falla.
 */
export function buildDeterministicFallbackMinute(
  meeting: MeetingMinuteContext,
  transcriptText: string,
  attendees: string[],
): StructuredMinute {
  const groupName = meeting.groupName?.trim() || 'Asociación Bello Horizonte';
  const titulo = meeting.titulo.trim() || 'Reunión Vecinal';
  const fechaTexto = formatMeetingDateEsPe(meeting.fecha);
  const lugarTexto = meeting.lugar?.trim() || 'Local comunal / por precisar';
  const cleanAttendees = attendees.map((a) => a.trim()).filter((a) => a.length > 0);
  const temasTratados = parseAgendaTopics(meeting.agenda, titulo);
  const cleanTranscript = normalizeTranscriptText(transcriptText);
  const acuerdos = extractHeuristicAgreements(cleanTranscript);

  const attendeesSection =
    cleanAttendees.length > 0
      ? cleanAttendees.map((name, idx) => `${idx + 1}. ${name}`).join('\n')
      : 'Registro de asistencia pendiente de consignar por Secretaría.';

  const agendaSection = temasTratados
    .map((tema, idx) => `${idx + 1}. ${tema}`)
    .join('\n');

  const desarrolloSection =
    cleanTranscript.length > 0
      ? cleanTranscript
      : 'No se registró transcripción de audio para esta sesión. El Secretario consignará el resumen manual correspondiente.';

  const acuerdosSection =
    acuerdos.length > 0
      ? acuerdos
          .map(
            (a, idx) =>
              `${idx + 1}. ${a.descripcion} (Responsable: ${a.responsable}; Plazo: ${a.plazo}).`,
          )
          .join('\n')
      : 'Sin acuerdos estructurados extraídos automáticamente; revisar y completar por Secretaría antes de la aprobación.';

  const contenidoActa = [
    `ACTA DE REUNIÓN — ${groupName.toUpperCase()}`,
    `Sesión: ${titulo}`,
    '',
    `En ${lugarTexto}, siendo ${fechaTexto}, se reunieron los integrantes de ${groupName} con el objeto de tratar los puntos de la agenda convocada.`,
    '',
    `I. ASISTENTES CONFIRMADOS (${cleanAttendees.length})`,
    attendeesSection,
    '',
    'II. AGENDA / TEMAS TRATADOS',
    agendaSection,
    '',
    'III. DESARROLLO DE LA SESIÓN',
    desarrolloSection,
    '',
    'IV. ACUERDOS ADOPTADOS',
    acuerdosSection,
    '',
    'V. CIERRE DE SESIÓN',
    'No habiendo otros asuntos que tratar, se dio por concluida la sesión, redactándose la presente acta en calidad de borrador para revisión de la Junta Directiva y socios, y posterior asentamiento en el Libro de Actas legalizado de la asociación.',
  ].join('\n');

  return {
    contenido_acta: contenidoActa,
    temas_tratados: temasTratados,
    acuerdos,
    provider: 'deterministic-fallback',
    used_fallback: true,
  };
}

function stripMarkdownCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function normalizeAgreements(raw: unknown): MinuteAgreement[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const result: MinuteAgreement[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const descripcion = typeof rec.descripcion === 'string' ? rec.descripcion.trim() : '';
    if (!descripcion) continue;
    const responsable =
      typeof rec.responsable === 'string' && rec.responsable.trim().length > 0
        ? rec.responsable.trim()
        : 'Junta Directiva';
    const plazo =
      typeof rec.plazo === 'string' && rec.plazo.trim().length > 0
        ? rec.plazo.trim()
        : 'Por definir';
    result.push({ descripcion, responsable, plazo });
  }
  return result;
}

function normalizeTopics(raw: unknown, fallbackTopics: string[]): string[] {
  if (!Array.isArray(raw)) {
    return fallbackTopics;
  }
  const topics = raw
    .filter((item): item is string => typeof item === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return topics.length > 0 ? topics : fallbackTopics;
}

/**
 * Genera un borrador estructurado de acta en español formal (Perú) usando DeepSeek-V3.
 * Si `deepseekApiKey` no está configurada o la API externa falla / devuelve JSON inválido,
 * retorna un fallback determinístico limpio para nunca bloquear el flujo.
 */
export async function generateStructuredMinute(
  params: GenerateStructuredMinuteParams,
): Promise<StructuredMinute> {
  const {
    meeting,
    transcriptText,
    attendees,
    deepseekUrl = DEFAULT_DEEPSEEK_URL,
    deepseekApiKey,
    deepseekModel = DEFAULT_DEEPSEEK_MODEL,
    fetchImpl = fetch,
    timeoutMs = DEFAULT_DEEPSEEK_TIMEOUT_MS,
  } = params;

  const trimmedKey = deepseekApiKey?.trim() ?? '';
  if (!trimmedKey) {
    return buildDeterministicFallbackMinute(meeting, transcriptText, attendees);
  }

  const endpoint = deepseekUrl.trim() || DEFAULT_DEEPSEEK_URL;
  const model = deepseekModel.trim() || DEFAULT_DEEPSEEK_MODEL;
  const groupName = meeting.groupName?.trim() || 'Asociación Bello Horizonte';
  const fechaTexto = formatMeetingDateEsPe(meeting.fecha);
  const lugarTexto = meeting.lugar?.trim() || 'Por precisar';
  const agendaTexto = meeting.agenda?.trim() || 'No especificada';
  const cleanAttendees = attendees.map((a) => a.trim()).filter((a) => a.length > 0);
  const cleanTranscript = normalizeTranscriptText(transcriptText);

  const systemPrompt = [
    'Eres el Secretario de Actas de una asociación civil sin fines de lucro en el Perú.',
    'Redacta un borrador formal y fiel a la transcripción, apto para ser asentado en un Libro de Actas legalizado en Perú.',
    'NO inventes acuerdos, montos ni nombres que no aparezcan en los datos o la transcripción.',
    'Responde ÚNICAMENTE con un objeto JSON válido con la estructura exacta:',
    '{"contenido_acta": string, "temas_tratados": string[], "acuerdos": [{"descripcion": string, "responsable": string, "plazo": string}]}',
  ].join(' ');

  const userPrompt = [
    `Asociación: ${groupName}`,
    `Título de la reunión: ${meeting.titulo}`,
    `Fecha y hora: ${fechaTexto}`,
    `Lugar: ${lugarTexto}`,
    `Agenda convocada:\n${agendaTexto}`,
    `Asistentes confirmados (${cleanAttendees.length}): ${
      cleanAttendees.length > 0 ? cleanAttendees.join(', ') : 'Pendiente de registro'
    }`,
    `Transcripción de la sesión:\n${
      cleanTranscript || '(Sin transcripción disponible; redactar borrador base según agenda)'
    }`,
  ].join('\n\n');

  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${trimmedKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      return buildDeterministicFallbackMinute(meeting, transcriptText, attendees);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };

    const rawContent = payload?.choices?.[0]?.message?.content;
    if (typeof rawContent !== 'string' || rawContent.trim().length === 0) {
      return buildDeterministicFallbackMinute(meeting, transcriptText, attendees);
    }

    const parsed = JSON.parse(stripMarkdownCodeFences(rawContent)) as Record<string, unknown>;
    const contenidoActa =
      typeof parsed.contenido_acta === 'string' ? parsed.contenido_acta.trim() : '';

    if (!contenidoActa) {
      return buildDeterministicFallbackMinute(meeting, transcriptText, attendees);
    }

    const fallbackTopics = parseAgendaTopics(meeting.agenda, meeting.titulo);

    return {
      contenido_acta: contenidoActa,
      temas_tratados: normalizeTopics(parsed.temas_tratados, fallbackTopics),
      acuerdos: normalizeAgreements(parsed.acuerdos),
      provider: 'deepseek-chat',
      used_fallback: false,
    };
  } catch {
    return buildDeterministicFallbackMinute(meeting, transcriptText, attendees);
  }
}

/**
 * Calcula el hash SHA-256 en formato hexadecimal minúscula (64 caracteres)
 * usando Web Crypto API (`crypto.subtle.digest`).
 */
export async function computeSha256Hex(content: string): Promise<string> {
  const encoded = new TextEncoder().encode(content);
  const digestBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const bytes = new Uint8Array(digestBuffer);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
