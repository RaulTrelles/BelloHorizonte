import {
  buildPanicFcmMessage,
  buildStopFcmMessage,
  clearFcmTokenCache,
  createSignedServiceAccountJwt,
  getFcmAccessToken,
  isUnregisteredFcmError,
  parseServiceAccount,
  sendFcmBatch,
  sendSingleFcmMessage,
} from './fcm.ts';

function assertEquals<T>(actual: T, expected: T, message?: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(
      `${message ?? 'Assertion failed'}: expected ${expectedJson}, got ${actualJson}`,
    );
  }
}

Deno.test('buildPanicFcmMessage genera payload data-only sin bloque notification y con prioridad HIGH', () => {
  const msg = buildPanicFcmMessage('token-vecino-1', {
    alertId: '11111111-1111-4111-8111-111111111111',
    groupName: 'Asociación Bello Horizonte',
    senderName: 'Carlos Pérez',
    timestamp: '2026-11-22T06:30:00Z',
    lat: -12.0464,
    lng: -77.0428,
  });

  assertEquals('notification' in msg, false, 'No debe incluir bloque notification');
  assertEquals(msg.token, 'token-vecino-1');
  assertEquals(msg.android, { priority: 'HIGH', ttl: '90s' });
  assertEquals(msg.data, {
    type: 'PANIC_ALARM',
    alertId: '11111111-1111-4111-8111-111111111111',
    groupName: 'Asociación Bello Horizonte',
    senderName: 'Carlos Pérez',
    timestamp: '2026-11-22T06:30:00Z',
    lat: '-12.0464',
    lng: '-77.0428',
    message: '¡ALERTA! Robo en la cuadra',
  });
});

Deno.test('buildPanicFcmMessage convierte lat/lng nulos a cadena vacía', () => {
  const msg = buildPanicFcmMessage('token-vecino-2', {
    alertId: '22222222-2222-4222-8222-222222222222',
    groupName: 'Asociación Bello Horizonte',
    senderName: 'María López',
    timestamp: '2026-11-22T06:35:00Z',
    lat: null,
    lng: undefined,
    message: '   ',
  });

  assertEquals(msg.data.lat, '');
  assertEquals(msg.data.lng, '');
  assertEquals(msg.data.message, '¡ALERTA! Robo en la cuadra');
});

Deno.test('buildStopFcmMessage genera payload data-only STOP_ALARM con prioridad HIGH', () => {
  const msg = buildStopFcmMessage('token-vecino-1', {
    alertId: '11111111-1111-4111-8111-111111111111',
    reason: 'falsa_alarma',
  });

  assertEquals('notification' in msg, false, 'No debe incluir bloque notification');
  assertEquals(msg.android, { priority: 'HIGH', ttl: '90s' });
  assertEquals(msg.data, {
    type: 'STOP_ALARM',
    alertId: '11111111-1111-4111-8111-111111111111',
    reason: 'falsa_alarma',
  });
});

Deno.test('isUnregisteredFcmError detecta UNREGISTERED, NOT_FOUND 404 e INVALID_ARGUMENT de token', () => {
  assertEquals(
    isUnregisteredFcmError(404, {
      error: {
        code: 404,
        status: 'NOT_FOUND',
        details: [{ errorCode: 'UNREGISTERED' }],
      },
    }),
    true,
  );

  assertEquals(
    isUnregisteredFcmError(400, {
      error: {
        code: 400,
        status: 'INVALID_ARGUMENT',
        message: 'The registration token is not a valid FCM registration token',
      },
    }),
    true,
  );

  assertEquals(
    isUnregisteredFcmError(400, {
      error: {
        code: 400,
        status: 'INVALID_ARGUMENT',
        message: 'Invalid argument',
        details: [{ fieldViolations: [{ field: 'message.token' }] }],
      },
    }),
    true,
  );

  // Error de payload no relacionado al token NO debe marcar el token para limpieza
  assertEquals(
    isUnregisteredFcmError(400, {
      error: {
        code: 400,
        status: 'INVALID_ARGUMENT',
        message: 'Invalid TTL format',
      },
    }),
    false,
  );

  assertEquals(
    isUnregisteredFcmError(503, { error: { status: 'UNAVAILABLE' } }),
    false,
  );
});

Deno.test('parseServiceAccount normaliza saltos de línea escapados en private_key', () => {
  const sa = parseServiceAccount(
    JSON.stringify({
      project_id: 'bello-horizonte-test',
      client_email: 'fcm@bello-horizonte-test.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n',
    }),
  );

  assertEquals(sa.project_id, 'bello-horizonte-test');
  assertEquals(sa.private_key.includes('\nABC\n'), true);
});

Deno.test('sendFcmBatch procesa envíos en paralelo y separa tokens UNREGISTERED', async () => {
  const mockFetch: typeof fetch = (_input, init) => {
    const parsed = JSON.parse(String(init?.body)) as { message: { token: string } };
    const token = parsed.message.token;

    if (token === 'token-dead') {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              code: 404,
              status: 'NOT_FOUND',
              details: [{ errorCode: 'UNREGISTERED' }],
            },
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }

    if (token === 'token-temp-error') {
      return Promise.resolve(
        new Response(
          JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE' } }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }

    return Promise.resolve(
      new Response(JSON.stringify({ name: 'projects/test/messages/1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  };

  const messages = ['token-ok-1', 'token-dead', 'token-ok-2', 'token-temp-error'].map((token) =>
    buildStopFcmMessage(token, { alertId: 'alert-1', reason: 'resuelta' })
  );

  const result = await sendFcmBatch(messages, {
    projectId: 'bello-horizonte-test',
    accessToken: 'fake-access-token',
    concurrency: 2,
    fetchImpl: mockFetch,
  });

  assertEquals(result.sent, 2);
  assertEquals(result.failed, 2);
  assertEquals(result.unregisteredTokens, ['token-dead']);
});

Deno.test('createSignedServiceAccountJwt firma JWT RS256 verificable y getFcmAccessToken intercambia OAuth2', async () => {
  clearFcmTokenCache();
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );

  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey));
  let bin = '';
  for (let i = 0; i < pkcs8.length; i++) {
    bin += String.fromCharCode(pkcs8[i]);
  }
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(bin)}\n-----END PRIVATE KEY-----`;

  const serviceAccount = {
    project_id: 'bello-horizonte-test',
    client_email: 'fcm@bello-horizonte-test.iam.gserviceaccount.com',
    private_key: pem,
  };

  const jwt = await createSignedServiceAccountJwt(serviceAccount, 1_700_000_000);
  const parts = jwt.split('.');
  assertEquals(parts.length, 3, 'El JWT debe tener 3 segmentos');

  // Verificar firma RS256 con la clave pública
  const base64Sig = parts[2].replace(/-/g, '+').replace(/_/g, '/');
  const paddedSig = base64Sig + '='.repeat((4 - (base64Sig.length % 4)) % 4);
  const sigBinary = atob(paddedSig);
  const sigBytes = new Uint8Array(sigBinary.length);
  for (let i = 0; i < sigBinary.length; i++) {
    sigBytes[i] = sigBinary.charCodeAt(i);
  }

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    keyPair.publicKey,
    sigBytes,
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  assertEquals(valid, true, 'La firma RS256 debe ser válida');

  // Verificar intercambio OAuth2 y caché en memoria
  let oauthCalls = 0;
  const mockOAuthFetch: typeof fetch = () => {
    oauthCalls += 1;
    return Promise.resolve(
      new Response(JSON.stringify({ access_token: 'mock-oauth-token', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  };

  const token1 = await getFcmAccessToken(serviceAccount, mockOAuthFetch);
  const token2 = await getFcmAccessToken(serviceAccount, mockOAuthFetch);
  assertEquals(token1, 'mock-oauth-token');
  assertEquals(token2, 'mock-oauth-token');
  assertEquals(oauthCalls, 1, 'Debe reutilizar el token cacheado');
  clearFcmTokenCache();
});

Deno.test('sendSingleFcmMessage pasa AbortSignal y clasifica TimeoutError como TIMEOUT', async () => {
  let receivedSignal = false;
  const mockTimeoutFetch: typeof fetch = (_input, init) => {
    receivedSignal = init?.signal instanceof AbortSignal;
    return Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'));
  };

  const msg = buildStopFcmMessage('token-timeout', { alertId: 'alert-2', reason: 'resuelta' });
  const result = await sendSingleFcmMessage(
    'bello-horizonte-test',
    'fake-access-token',
    msg,
    mockTimeoutFetch,
    5_000,
  );

  assertEquals(receivedSignal, true, 'Debe pasar AbortSignal.timeout al fetch');
  assertEquals(result.ok, false);
  assertEquals(result.unregistered, false);
  assertEquals(result.errorCode, 'TIMEOUT');
});
