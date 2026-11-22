import {
  timingSafeEqualStrings,
  verifyWebhookRequest,
  WEBHOOK_SECRET_HEADER,
} from './webhookAuth.ts';

function assertEquals<T>(actual: T, expected: T, message?: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(
      `${message ?? 'Assertion failed'}: expected ${expectedJson}, got ${actualJson}`,
    );
  }
}

Deno.test('timingSafeEqualStrings compara correctamente cadenas iguales y distintas', () => {
  assertEquals(timingSafeEqualStrings('secreto-123', 'secreto-123'), true);
  assertEquals(timingSafeEqualStrings('secreto-123', 'secreto-124'), false);
  assertEquals(timingSafeEqualStrings('secreto-123', 'secreto-1234'), false);
  assertEquals(timingSafeEqualStrings('', ''), true);
});

Deno.test('verifyWebhookRequest acepta cabecera x-webhook-secret válida', () => {
  const req = new Request('https://example.supabase.co/functions/v1/dispatch-panic-alert', {
    method: 'POST',
    headers: { [WEBHOOK_SECRET_HEADER]: 'super-secret-value' },
  });

  const result = verifyWebhookRequest(req, 'super-secret-value');
  assertEquals(result, { ok: true });
});

Deno.test('verifyWebhookRequest rechaza con 401 si falta cabecera o no coincide', () => {
  const reqMissing = new Request('https://example.supabase.co/functions/v1/dispatch-panic-alert', {
    method: 'POST',
  });
  const resMissing = verifyWebhookRequest(reqMissing, 'super-secret-value');
  assertEquals(resMissing.ok, false);
  if (!resMissing.ok) {
    assertEquals(resMissing.status, 401);
  }

  const reqWrong = new Request('https://example.supabase.co/functions/v1/dispatch-panic-alert', {
    method: 'POST',
    headers: { [WEBHOOK_SECRET_HEADER]: 'wrong-secret' },
  });
  const resWrong = verifyWebhookRequest(reqWrong, 'super-secret-value');
  assertEquals(resWrong.ok, false);
  if (!resWrong.ok) {
    assertEquals(resWrong.status, 401);
  }
});

Deno.test('verifyWebhookRequest falla cerrado con 500 si WEBHOOK_SECRET está vacío', () => {
  const req = new Request('https://example.supabase.co/functions/v1/dispatch-panic-alert', {
    method: 'POST',
    headers: { [WEBHOOK_SECRET_HEADER]: 'anything' },
  });
  const res = verifyWebhookRequest(req, '');
  assertEquals(res.ok, false);
  if (!res.ok) {
    assertEquals(res.status, 500);
  }
});
