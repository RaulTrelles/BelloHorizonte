import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  computeSha256Hex,
  corsHeaders,
  DEFAULT_DEEPSEEK_URL,
  DEFAULT_STT_MODEL,
  generateStructuredMinute,
  isValidMeetingStoragePath,
  sanitizeErrorMessage,
  transcribeAudioChunk,
} from './meetingsAi.ts';

describe('meetingsAi — transcribeAudioChunk', () => {
  it('envía multipart/form-data a Faster-Whisper y retorna texto limpio', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;

    const mockFetch: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(
        JSON.stringify({ text: '  Buenos   días vecinos.\r\n\r\n\r\nSe abre   la sesión.  ' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    };

    const audioBytes = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    const text = await transcribeAudioChunk({
      audioBytes,
      fileName: 'chunk_01.m4a',
      mimeType: 'audio/mp4',
      sttUrl: 'https://stt.example.com/',
      sttApiKey: 'test-stt-secret-token',
      fetchImpl: mockFetch,
      timeoutMs: 5_000,
    });

    assert.equal(capturedUrl, 'https://stt.example.com/v1/audio/transcriptions');
    assert.equal(capturedInit?.method, 'POST');
    assert.ok(capturedInit?.signal, 'Debe incluir AbortSignal.timeout');

    const headers = capturedInit?.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer test-stt-secret-token');

    assert.ok(capturedInit?.body instanceof FormData, 'El cuerpo debe ser FormData');
    const formData = capturedInit.body as FormData;
    assert.equal(formData.get('model'), DEFAULT_STT_MODEL);
    assert.equal(formData.get('language'), 'es');
    const fileField = formData.get('file');
    assert.ok(fileField instanceof File || fileField instanceof Blob);

    assert.equal(text, 'Buenos días vecinos.\n\nSe abre la sesión.');
  });

  it('lanza error sanitizado si el servicio STT falla sin filtrar secretos', async () => {
    const mockFetch: typeof fetch = async () =>
      new Response('Unauthorized Bearer super-secret-xyz', { status: 401 });

    await assert.rejects(
      () =>
        transcribeAudioChunk({
          audioBytes: new Uint8Array([1, 2, 3]),
          fileName: 'chunk_02.m4a',
          sttUrl: 'https://stt.example.com',
          sttApiKey: 'super-secret-xyz',
          fetchImpl: mockFetch,
        }),
      (err: Error) => {
        assert.match(err.message, /HTTP 401/);
        assert.doesNotMatch(err.message, /super-secret-xyz/);
        return true;
      },
    );
  });

  it('rechaza bloque de audio vacío', async () => {
    await assert.rejects(
      () =>
        transcribeAudioChunk({
          audioBytes: new Uint8Array([]),
          fileName: 'empty.m4a',
          sttUrl: 'https://stt.example.com',
          sttApiKey: 'key',
        }),
      /vacío/i,
    );
  });
});

describe('meetingsAi — generateStructuredMinute', () => {
  const sampleMeeting = {
    titulo: 'Asamblea Ordinaria de Seguridad Vecinal',
    fecha: '2026-11-22T20:00:00-05:00',
    lugar: 'Parque Central Bello Horizonte',
    agenda: '1. Revisión de cámaras\n2. Mantenimiento de alarmas\n3. Cuota mensual',
    groupName: 'Asociación Bello Horizonte',
  };

  it('parsea respuesta JSON válida de DeepSeek-V3', async () => {
    let capturedUrl = '';
    let capturedBody = '';

    const mockFetch: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedBody = String(init?.body ?? '');
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  contenido_acta:
                    'ACTA DE ASAMBLEA ORDINARIA — ASOCIACIÓN BELLO HORIZONTE\nSe aprobaron los acuerdos por unanimidad.',
                  temas_tratados: ['Revisión de cámaras', 'Mantenimiento de alarmas'],
                  acuerdos: [
                    {
                      descripcion: 'Cotizar 2 cámaras adicionales para la esquina norte',
                      responsable: 'Comité de Seguridad',
                      plazo: '30/11/2026',
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const result = await generateStructuredMinute({
      meeting: sampleMeeting,
      transcriptText: 'Se acordó cotizar dos cámaras adicionales para la esquina norte.',
      attendees: ['Ana Torres', 'Carlos Quispe'],
      deepseekApiKey: 'sk-test-deepseek-key',
      fetchImpl: mockFetch,
    });

    assert.equal(capturedUrl, DEFAULT_DEEPSEEK_URL);
    assert.match(capturedBody, /"model":"deepseek-chat"/);
    assert.equal(result.used_fallback, false);
    assert.equal(result.provider, 'deepseek-chat');
    assert.match(result.contenido_acta, /ACTA DE ASAMBLEA ORDINARIA/);
    assert.deepEqual(result.temas_tratados, ['Revisión de cámaras', 'Mantenimiento de alarmas']);
    assert.equal(result.acuerdos.length, 1);
    assert.equal(result.acuerdos[0].responsable, 'Comité de Seguridad');
  });

  it('usa fallback determinístico si DEEPSEEK_API_KEY no está configurada', async () => {
    const result = await generateStructuredMinute({
      meeting: sampleMeeting,
      transcriptText:
        'El presidente inició la sesión. Se acordó realizar mantenimiento de alarmas este sábado.',
      attendees: ['Ana Torres', 'Luis Paredes'],
      deepseekApiKey: '',
    });

    assert.equal(result.used_fallback, true);
    assert.equal(result.provider, 'deterministic-fallback');
    assert.match(result.contenido_acta, /ACTA DE REUNIÓN — ASOCIACIÓN BELLO HORIZONTE/);
    assert.match(result.contenido_acta, /Ana Torres/);
    assert.deepEqual(result.temas_tratados, [
      'Revisión de cámaras',
      'Mantenimiento de alarmas',
      'Cuota mensual',
    ]);
    assert.ok(result.acuerdos.length >= 1, 'Debe extraer acuerdo heurístico de la transcripción');
  });

  it('usa fallback determinístico si DeepSeek falla con HTTP 503 o error de red', async () => {
    const failingFetch: typeof fetch = async () => new Response('Service Unavailable', { status: 503 });

    const result = await generateStructuredMinute({
      meeting: sampleMeeting,
      transcriptText: 'Se aprobó el presupuesto mensual por mayoría.',
      attendees: ['María Rojas'],
      deepseekApiKey: 'sk-test-key',
      fetchImpl: failingFetch,
    });

    assert.equal(result.used_fallback, true);
    assert.equal(result.provider, 'deterministic-fallback');
    assert.match(result.contenido_acta, /Libro de Actas legalizado/);
  });
});

describe('meetingsAi — computeSha256Hex y utilidades', () => {
  it('calcula SHA-256 exacto en hexadecimal minúscula', async () => {
    const emptyHash = await computeSha256Hex('');
    assert.equal(
      emptyHash,
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );

    const holaHash = await computeSha256Hex('hola');
    assert.equal(
      holaHash,
      'b221d9dbb083a7f33428d7c2a3c3198ae925614d70210e28716ccaa7cd4ddb79',
    );

    const actaHash = await computeSha256Hex('Acta N° 01 — Asociación Bello Horizonte (Perú)');
    assert.equal(actaHash.length, 64);
    assert.match(actaHash, /^[0-9a-f]{64}$/);
  });

  it('sanitiza tokens Bearer y llaves sk- en mensajes de error', () => {
    const clean = sanitizeErrorMessage('Fallo con Bearer abc.123.xyz y clave sk-1234567890abcdef');
    assert.doesNotMatch(clean, /abc\.123\.xyz/);
    assert.doesNotMatch(clean, /sk-1234567890abcdef/);
    assert.match(clean, /\[REDACTED\]/);
  });

  it('expone corsHeaders con las cabeceras requeridas por Supabase', () => {
    assert.equal(
      corsHeaders['Access-Control-Allow-Headers'],
      'authorization, x-client-info, apikey, content-type',
    );
  });

  it('valida estrictamente storage_path contra IDOR entre grupos y path traversal', () => {
    const groupId = '11111111-1111-1111-1111-111111111111';
    const otherGroupId = '22222222-2222-2222-2222-222222222222';
    const meetingId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

    assert.equal(
      isValidMeetingStoragePath(`${groupId}/${meetingId}/chunk_01.m4a`, groupId, meetingId),
      true,
    );
    assert.equal(
      isValidMeetingStoragePath(`${otherGroupId}/${meetingId}/chunk_01.m4a`, groupId, meetingId),
      false,
    );
    assert.equal(
      isValidMeetingStoragePath(`${groupId}/${meetingId}/../other/chunk_01.m4a`, groupId, meetingId),
      false,
    );
    assert.equal(
      isValidMeetingStoragePath(`${groupId}/${meetingId}/`, groupId, meetingId),
      false,
    );
    assert.equal(
      isValidMeetingStoragePath(`${groupId}/${meetingId}\\chunk_01.m4a`, groupId, meetingId),
      false,
    );
  });
});
