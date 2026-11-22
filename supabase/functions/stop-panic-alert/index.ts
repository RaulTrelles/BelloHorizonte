/**
 * Supabase Edge Function: `stop-panic-alert`
 *
 * Activada por Database Webhook en `UPDATE` de `public.alerts` cuando `estado` transiciona
 * de `'activa'` a `'resuelta'` o `'falsa_alarma'`.
 * Envía FCM HTTP v1 `data-only` (`type: "STOP_ALARM"`) a todos los miembros activos del grupo
 * para detener la sirena en todos los celulares y limpia tokens `UNREGISTERED`.
 */

import {
  buildStopFcmMessage,
  getFcmAccessToken,
  getFirebaseServiceAccountFromEnv,
  sendFcmBatch,
} from '../_shared/fcm.ts';
import {
  type AlertRecord,
  clearUnregisteredTokens,
  createSupabaseAdminClient,
  getActiveGroupFcmTokens,
  jsonResponse,
  type SupabaseWebhookPayload,
} from '../_shared/supabaseAdmin.ts';
import { verifyWebhookRequest } from '../_shared/webhookAuth.ts';

type StopReason = 'resuelta' | 'falsa_alarma';

function isStopReason(value: string): value is StopReason {
  return value === 'resuelta' || value === 'falsa_alarma';
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method Not Allowed' }, 405);
  }

  const auth = verifyWebhookRequest(req);
  if (!auth.ok) {
    return jsonResponse({ ok: false, error: auth.error }, auth.status);
  }

  let payload: SupabaseWebhookPayload<AlertRecord>;
  try {
    payload = (await req.json()) as SupabaseWebhookPayload<AlertRecord>;
  } catch {
    return jsonResponse({ ok: false, error: 'Payload JSON inválido.' }, 400);
  }

  if (
    payload.type !== 'UPDATE' ||
    payload.schema !== 'public' ||
    payload.table !== 'alerts' ||
    !payload.record
  ) {
    return jsonResponse({
      ok: true,
      ignored: true,
      reason: 'Evento no corresponde a UPDATE en public.alerts.',
    });
  }

  const record = payload.record;
  const oldRecord = payload.old_record;

  if (oldRecord?.estado !== 'activa' || !isStopReason(record.estado)) {
    return jsonResponse({
      ok: true,
      ignored: true,
      reason: `Transición de estado ignorada (${oldRecord?.estado ?? 'desconocido'} -> ${record.estado}).`,
    });
  }

  if (!record.id || !record.group_id) {
    return jsonResponse(
      { ok: false, error: 'El registro de alerta no contiene id o group_id.' },
      400,
    );
  }

  const stopReason: StopReason = record.estado;

  try {
    const supabase = createSupabaseAdminClient();
    const recipientTokens = await getActiveGroupFcmTokens(supabase, record.group_id);

    if (recipientTokens.length === 0) {
      console.info('[stop-panic-alert] Sin destinatarios con fcm_token activo.', {
        alertId: record.id,
        groupId: record.group_id,
        reason: stopReason,
      });
      return jsonResponse({
        ok: true,
        alertId: record.id,
        reason: stopReason,
        sent: 0,
        failed: 0,
        cleanedTokens: 0,
      });
    }

    const serviceAccount = getFirebaseServiceAccountFromEnv();
    const accessToken = await getFcmAccessToken(serviceAccount);

    const messages = recipientTokens.map((token) =>
      buildStopFcmMessage(token, {
        alertId: record.id,
        reason: stopReason,
      })
    );

    const batchResult = await sendFcmBatch(messages, {
      projectId: serviceAccount.project_id,
      accessToken,
    });

    const cleanedTokens = await clearUnregisteredTokens(supabase, batchResult.unregisteredTokens);

    console.info('[stop-panic-alert] Señal STOP_ALARM despachada.', {
      alertId: record.id,
      groupId: record.group_id,
      reason: stopReason,
      recipients: recipientTokens.length,
      sent: batchResult.sent,
      failed: batchResult.failed,
      cleanedTokens,
    });

    return jsonResponse({
      ok: true,
      alertId: record.id,
      reason: stopReason,
      sent: batchResult.sent,
      failed: batchResult.failed,
      cleanedTokens,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Error interno inesperado';
    console.error('[stop-panic-alert] Error al despachar STOP_ALARM:', errorMessage);
    return jsonResponse({ ok: false, error: 'Error interno al detener alerta.' }, 500);
  }
});
