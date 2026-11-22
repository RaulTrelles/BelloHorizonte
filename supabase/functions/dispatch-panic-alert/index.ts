/**
 * Supabase Edge Function: `dispatch-panic-alert`
 *
 * Activada por Database Webhook en `INSERT` de `public.alerts` (`record.estado === 'activa'`).
 * Despacha notificaciones FCM HTTP v1 `data-only` (`type: "PANIC_ALARM"`) con prioridad alta
 * y TTL de 90s a todos los miembros activos del grupo (excluyendo al emisor), y limpia
 * automáticamente los tokens reportados como `UNREGISTERED`.
 */

import {
  buildPanicFcmMessage,
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

const DEFAULT_GROUP_NAME = 'Asociación Bello Horizonte';
const DEFAULT_SENDER_NAME = 'Un vecino';
const DEFAULT_PANIC_MESSAGE = '¡ALERTA! Robo en la cuadra';
const ALERT_TTL_MS = 90_000;

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
    payload.type !== 'INSERT' ||
    payload.schema !== 'public' ||
    payload.table !== 'alerts' ||
    !payload.record
  ) {
    return jsonResponse({
      ok: true,
      ignored: true,
      reason: 'Evento no corresponde a INSERT en public.alerts.',
    });
  }

  const record = payload.record;
  if (record.estado !== 'activa') {
    return jsonResponse({
      ok: true,
      ignored: true,
      reason: `Estado de alerta ignorado: ${record.estado}`,
    });
  }

  if (!record.id || !record.group_id || !record.user_id) {
    return jsonResponse(
      { ok: false, error: 'El registro de alerta no contiene id, group_id o user_id.' },
      400,
    );
  }

  if (record.created_at) {
    const createdAtMs = Date.parse(record.created_at);
    if (!Number.isNaN(createdAtMs) && Date.now() - createdAtMs > ALERT_TTL_MS) {
      console.info('[dispatch-panic-alert] Alerta omitida por TTL expirado (>90s).', {
        alertId: record.id,
        groupId: record.group_id,
      });
      return jsonResponse({ ok: true, skipped: 'expired_ttl' });
    }
  }

  try {
    const supabase = createSupabaseAdminClient();

    const [groupRes, senderRes, recipientTokens] = await Promise.all([
      supabase.from('groups').select('nombre').eq('id', record.group_id).maybeSingle(),
      supabase.from('profiles').select('nombre').eq('id', record.user_id).maybeSingle(),
      getActiveGroupFcmTokens(supabase, record.group_id, record.user_id),
    ]);

    if (groupRes.error) {
      console.error('[dispatch-panic-alert] Error al consultar groups:', groupRes.error.message);
    }
    if (senderRes.error) {
      console.error('[dispatch-panic-alert] Error al consultar profiles:', senderRes.error.message);
    }

    const groupName =
      typeof groupRes.data?.nombre === 'string' && groupRes.data.nombre.trim().length > 0
        ? groupRes.data.nombre.trim()
        : DEFAULT_GROUP_NAME;

    const senderName =
      typeof senderRes.data?.nombre === 'string' && senderRes.data.nombre.trim().length > 0
        ? senderRes.data.nombre.trim()
        : DEFAULT_SENDER_NAME;

    if (recipientTokens.length === 0) {
      console.info('[dispatch-panic-alert] Sin destinatarios con fcm_token activo.', {
        alertId: record.id,
        groupId: record.group_id,
      });
      return jsonResponse({
        ok: true,
        alertId: record.id,
        sent: 0,
        failed: 0,
        cleanedTokens: 0,
      });
    }

    const serviceAccount = getFirebaseServiceAccountFromEnv();
    const accessToken = await getFcmAccessToken(serviceAccount);

    const timestamp = record.created_at ?? new Date().toISOString();
    const messageText =
      typeof record.mensaje === 'string' && record.mensaje.trim().length > 0
        ? record.mensaje.trim()
        : DEFAULT_PANIC_MESSAGE;

    const messages = recipientTokens.map((token) =>
      buildPanicFcmMessage(token, {
        alertId: record.id,
        groupName,
        senderName,
        timestamp,
        lat: record.lat,
        lng: record.lng,
        message: messageText,
      })
    );

    const batchResult = await sendFcmBatch(messages, {
      projectId: serviceAccount.project_id,
      accessToken,
    });

    const cleanedTokens = await clearUnregisteredTokens(supabase, batchResult.unregisteredTokens);

    console.info('[dispatch-panic-alert] Despacho completado.', {
      alertId: record.id,
      groupId: record.group_id,
      recipients: recipientTokens.length,
      sent: batchResult.sent,
      failed: batchResult.failed,
      cleanedTokens,
    });

    return jsonResponse({
      ok: true,
      alertId: record.id,
      sent: batchResult.sent,
      failed: batchResult.failed,
      cleanedTokens,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Error interno inesperado';
    console.error('[dispatch-panic-alert] Error en despacho:', errorMessage);
    return jsonResponse({ ok: false, error: 'Error interno al despachar alerta.' }, 500);
  }
});
