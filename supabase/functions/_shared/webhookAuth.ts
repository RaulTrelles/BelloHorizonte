/**
 * Autenticación de Database Webhooks de Supabase mediante cabecera `x-webhook-secret`
 * con comparación de tiempo constante para prevenir ataques de timing.
 */

export const WEBHOOK_SECRET_HEADER = 'x-webhook-secret';

export type WebhookAuthResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * Comparación en tiempo constante de dos arreglos de bytes.
 */
export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  const maxLen = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;

  for (let i = 0; i < maxLen; i++) {
    const byteA = i < a.length ? a[i] : 0;
    const byteB = i < b.length ? b[i] : 0;
    diff |= byteA ^ byteB;
  }

  return diff === 0;
}

/**
 * Comparación en tiempo constante de dos cadenas UTF-8.
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  return timingSafeEqualBytes(encoder.encode(a), encoder.encode(b));
}

/**
 * Valida que la petición incluya la cabecera `x-webhook-secret` coincidente con
 * `Deno.env.get('WEBHOOK_SECRET')` (o el secreto esperado pasado para pruebas).
 *
 * Falla de forma cerrada (500 si el secreto no está configurado; 401 si no coincide).
 */
export function verifyWebhookRequest(
  req: Request,
  expectedSecret?: string,
): WebhookAuthResult {
  const configuredSecret = expectedSecret ?? Deno.env.get('WEBHOOK_SECRET');

  if (!configuredSecret || configuredSecret.trim().length === 0) {
    return {
      ok: false,
      status: 500,
      error: 'WEBHOOK_SECRET no está configurado en el entorno.',
    };
  }

  const providedSecret = req.headers.get(WEBHOOK_SECRET_HEADER);
  if (!providedSecret || providedSecret.length === 0) {
    return {
      ok: false,
      status: 401,
      error: 'Cabecera x-webhook-secret faltante.',
    };
  }

  if (!timingSafeEqualStrings(providedSecret, configuredSecret)) {
    return {
      ok: false,
      status: 401,
      error: 'Firma de webhook inválida.',
    };
  }

  return { ok: true };
}
