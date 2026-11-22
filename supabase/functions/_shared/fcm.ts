/**
 * Cliente FCM HTTP v1 puro para Deno Edge Runtime (Asociación Bello Horizonte).
 *
 * Reglas críticas (.agents/rules/02-android-alarm-critical-rules.md):
 * - Enviar SIEMPRE mensajes `data-only` (sin bloque `notification`).
 * - Configurar `android: { priority: 'HIGH', ttl: '90s' }` para despertar dispositivos en Doze.
 * - Leer credenciales exclusivamente de `Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON')`.
 * - Nunca registrar en logs tokens FCM ni claves privadas.
 */

export interface FirebaseServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export interface PanicAlertData {
  alertId: string;
  groupName: string;
  senderName: string;
  timestamp: string;
  lat?: number | string | null;
  lng?: number | string | null;
  message?: string | null;
}

export interface StopAlertData {
  alertId: string;
  reason: 'resuelta' | 'falsa_alarma';
}

export interface FcmMessage {
  token: string;
  data: Record<string, string>;
  android: {
    priority: 'HIGH';
    ttl: string;
  };
}

export interface FcmSendSingleResult {
  token: string;
  ok: boolean;
  status: number;
  unregistered: boolean;
  errorCode?: string;
}

export interface FcmBatchResult {
  sent: number;
  failed: number;
  unregisteredTokens: string[];
  errors: Array<{ status: number; errorCode: string }>;
}

const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const DEFAULT_PANIC_MESSAGE = '¡ALERTA! Robo en la cuadra';
const DEFAULT_TTL = '90s';
const DEFAULT_CONCURRENCY = 10;
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const TOKEN_REFRESH_MARGIN_MS = 60_000;

interface CachedOAuthToken {
  cacheKey: string;
  accessToken: string;
  expiresAtMs: number;
}

let cachedToken: CachedOAuthToken | null = null;

/**
 * Limpia el caché en memoria del access token OAuth2 (útil para pruebas unitarias).
 */
export function clearFcmTokenCache(): void {
  cachedToken = null;
}

/**
 * Parsea y valida el JSON de la cuenta de servicio de Firebase.
 */
export function parseServiceAccount(rawJson: string): FirebaseServiceAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON no es un JSON válido.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON debe ser un objeto JSON.');
  }

  const record = parsed as Record<string, unknown>;
  const projectId = typeof record.project_id === 'string' ? record.project_id.trim() : '';
  const clientEmail = typeof record.client_email === 'string' ? record.client_email.trim() : '';
  const privateKeyRaw = typeof record.private_key === 'string' ? record.private_key : '';
  const tokenUri = typeof record.token_uri === 'string' && record.token_uri.trim().length > 0
    ? record.token_uri.trim()
    : DEFAULT_TOKEN_URI;

  if (!projectId || !clientEmail || !privateKeyRaw) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON debe incluir project_id, client_email y private_key.',
    );
  }

  return {
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKeyRaw.replace(/\\n/g, '\n'),
    token_uri: tokenUri,
  };
}

/**
 * Lee la cuenta de servicio de Firebase desde las variables de entorno de Deno.
 */
export function getFirebaseServiceAccountFromEnv(): FirebaseServiceAccount {
  const raw = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_JSON');
  if (!raw || raw.trim().length === 0) {
    throw new Error('La variable de entorno FIREBASE_SERVICE_ACCOUNT_JSON no está configurada.');
  }
  return parseServiceAccount(raw);
}

/**
 * Construye el mensaje FCM HTTP v1 `data-only` para disparar la alarma "Robo en la cuadra".
 * Garantiza que NO exista bloque `notification` y que todos los valores de `data` sean string.
 */
export function buildPanicFcmMessage(token: string, payload: PanicAlertData): FcmMessage {
  const normalizedMessage =
    payload.message && payload.message.trim().length > 0
      ? payload.message.trim()
      : DEFAULT_PANIC_MESSAGE;

  return {
    token,
    data: {
      type: 'PANIC_ALARM',
      alertId: payload.alertId,
      groupName: payload.groupName,
      senderName: payload.senderName,
      timestamp: payload.timestamp,
      lat: payload.lat !== null && payload.lat !== undefined ? String(payload.lat) : '',
      lng: payload.lng !== null && payload.lng !== undefined ? String(payload.lng) : '',
      message: normalizedMessage,
    },
    android: {
      priority: 'HIGH',
      ttl: DEFAULT_TTL,
    },
  };
}

/**
 * Construye el mensaje FCM HTTP v1 `data-only` para detener la sirena en todos los dispositivos.
 */
export function buildStopFcmMessage(token: string, payload: StopAlertData): FcmMessage {
  return {
    token,
    data: {
      type: 'STOP_ALARM',
      alertId: payload.alertId,
      reason: payload.reason,
    },
    android: {
      priority: 'HIGH',
      ttl: DEFAULT_TTL,
    },
  };
}

interface FcmErrorDetail {
  '@type'?: string;
  errorCode?: string;
  fieldViolations?: Array<{ field?: string; description?: string }>;
}

interface FcmErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: FcmErrorDetail[];
  };
}

/**
 * Determina si una respuesta de error de FCM HTTP v1 indica que el token ya no es válido
 * y debe limpiarse (`profiles.fcm_token = null`).
 *
 * Detecta:
 * - `errorCode === 'UNREGISTERED'` o HTTP 404 con `status === 'NOT_FOUND'`.
 * - `INVALID_ARGUMENT` específicamente asociado al token de registro (`message.token` o
 *   mensaje sobre registration token inválido), evitando limpiar tokens por errores ajenos al token.
 */
export function isUnregisteredFcmError(status: number, body: unknown): boolean {
  const err = (body && typeof body === 'object' ? (body as FcmErrorBody).error : undefined) ?? {};
  const details = Array.isArray(err.details) ? err.details : [];

  for (const detail of details) {
    if (detail?.errorCode === 'UNREGISTERED') {
      return true;
    }
  }

  if (status === 404 && (!err.status || err.status === 'NOT_FOUND')) {
    return true;
  }

  if (status === 400 && err.status === 'INVALID_ARGUMENT') {
    const msg = (err.message ?? '').toLowerCase();
    if (
      msg.includes('registration token') ||
      msg.includes('not a valid fcm') ||
      msg.includes('invalid token')
    ) {
      return true;
    }

    for (const detail of details) {
      if (Array.isArray(detail?.fieldViolations)) {
        const hasTokenViolation = detail.fieldViolations.some(
          (v) => v?.field === 'message.token' || v?.field === 'token',
        );
        if (hasTokenViolation) {
          return true;
        }
      }
    }
  }

  return false;
}

function extractFcmErrorCode(status: number, body: unknown): string {
  const err = (body && typeof body === 'object' ? (body as FcmErrorBody).error : undefined) ?? {};
  const details = Array.isArray(err.details) ? err.details : [];
  for (const detail of details) {
    if (typeof detail?.errorCode === 'string' && detail.errorCode.length > 0) {
      return detail.errorCode;
    }
  }
  if (typeof err.status === 'string' && err.status.length > 0) {
    return err.status;
  }
  return `HTTP_${status}`;
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlEncodeString(value: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function pemPrivateKeyToArrayBuffer(pem: string): ArrayBuffer {
  const cleaned = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');

  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Firma un JWT RS256 usando Web Crypto API (`crypto.subtle`) para autenticar
 * la cuenta de servicio ante Google OAuth2.
 */
export async function createSignedServiceAccountJwt(
  serviceAccount: FirebaseServiceAccount,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const tokenUri = serviceAccount.token_uri || DEFAULT_TOKEN_URI;

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: tokenUri,
    scope: FCM_SCOPE,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };

  const signingInput = `${base64UrlEncodeString(JSON.stringify(header))}.${
    base64UrlEncodeString(JSON.stringify(payload))
  }`;

  const keyBuffer = pemPrivateKeyToArrayBuffer(serviceAccount.private_key);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBuffer,
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign'],
  );

  const signatureBuffer = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );

  const signature = base64UrlEncodeBytes(new Uint8Array(signatureBuffer));
  return `${signingInput}.${signature}`;
}

/**
 * Obtiene un OAuth2 access token válido para FCM HTTP v1 (con caché en memoria).
 */
export async function getFcmAccessToken(
  serviceAccount: FirebaseServiceAccount,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<string> {
  const cacheKey = `${serviceAccount.project_id}:${serviceAccount.client_email}`;
  const nowMs = Date.now();

  if (
    cachedToken &&
    cachedToken.cacheKey === cacheKey &&
    cachedToken.expiresAtMs - TOKEN_REFRESH_MARGIN_MS > nowMs
  ) {
    return cachedToken.accessToken;
  }

  const assertion = await createSignedServiceAccountJwt(serviceAccount);
  const tokenUri = serviceAccount.token_uri || DEFAULT_TOKEN_URI;

  const response = await fetchImpl(tokenUri, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined,
  });

  if (!response.ok) {
    throw new Error(`Error al obtener token OAuth2 para FCM (HTTP ${response.status}).`);
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error('La respuesta OAuth2 de Google no incluyó access_token.');
  }

  const expiresInSec = typeof data.expires_in === 'number' && data.expires_in > 0
    ? data.expires_in
    : 3600;

  cachedToken = {
    cacheKey,
    accessToken: data.access_token,
    expiresAtMs: nowMs + expiresInSec * 1000,
  };

  return data.access_token;
}

/**
 * Envía un mensaje individual al endpoint FCM HTTP v1.
 */
export async function sendSingleFcmMessage(
  projectId: string,
  accessToken: string,
  message: FcmMessage,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<FcmSendSingleResult> {
  const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;

  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ message }),
      signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined,
    });

    if (response.ok) {
      return {
        token: message.token,
        ok: true,
        status: response.status,
        unregistered: false,
      };
    }

    let errorBody: unknown = null;
    try {
      errorBody = await response.json();
    } catch {
      errorBody = null;
    }

    const unregistered = isUnregisteredFcmError(response.status, errorBody);
    return {
      token: message.token,
      ok: false,
      status: response.status,
      unregistered,
      errorCode: extractFcmErrorCode(response.status, errorBody),
    };
  } catch (err) {
    const isTimeout = err instanceof DOMException &&
      (err.name === 'TimeoutError' || err.name === 'AbortError');
    return {
      token: message.token,
      ok: false,
      status: 0,
      unregistered: false,
      errorCode: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
    };
  }
}

/**
 * Envía un lote de mensajes FCM HTTP v1 en paralelo con concurrencia controlada.
 * Devuelve conteos de éxito/fallo y la lista de tokens inválidos para limpieza en BD.
 */
export async function sendFcmBatch(
  messages: FcmMessage[],
  options: {
    projectId: string;
    accessToken: string;
    concurrency?: number;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<FcmBatchResult> {
  const result: FcmBatchResult = {
    sent: 0,
    failed: 0,
    unregisteredTokens: [],
    errors: [],
  };

  if (messages.length === 0) {
    return result;
  }

  const concurrency = Math.max(1, Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, messages.length));
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < messages.length) {
      const currentIndex = cursor;
      cursor += 1;
      const msg = messages[currentIndex];
      const single = await sendSingleFcmMessage(
        options.projectId,
        options.accessToken,
        msg,
        fetchImpl,
        timeoutMs,
      );

      if (single.ok) {
        result.sent += 1;
      } else {
        result.failed += 1;
        if (single.unregistered) {
          result.unregisteredTokens.push(single.token);
        }
        result.errors.push({
          status: single.status,
          errorCode: single.errorCode ?? 'UNKNOWN_ERROR',
        });
      }
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  return result;
}
