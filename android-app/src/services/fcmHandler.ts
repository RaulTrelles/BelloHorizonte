import notifee, { EventType } from '@notifee/react-native';
import messaging, { type FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import type { PanicAlertPayload } from '../types/alarm';
import {
  ensureNotificationChannels,
  hydrateAlarmFromNotificationData,
  parseAlertDataRecord,
  stopPanicAlarm,
  triggerPanicAlarm,
} from './alarmController';

/**
 * Parsea un mensaje FCM data-only hacia PanicAlertPayload.
 * Usa `remoteMessage.sentTime` como fallback de `timestamp` antes de `Date.now()`
 * y valida numéricamente `lat`/`lng`.
 */
export function parsePanicMessage(
  remoteMessage: FirebaseMessagingTypes.RemoteMessage
): PanicAlertPayload | null {
  const data = remoteMessage.data as Record<string, unknown> | undefined;
  return parseAlertDataRecord(data, remoteMessage.sentTime);
}

/**
 * Procesa mensajes FCM data-only (PANIC_ALARM y STOP_ALARM) tanto en foreground como background.
 */
export async function handleFcmRemoteMessage(
  remoteMessage: FirebaseMessagingTypes.RemoteMessage
): Promise<void> {
  const parsed = parsePanicMessage(remoteMessage);
  if (!parsed) {
    return;
  }

  if (parsed.type === 'PANIC_ALARM') {
    await triggerPanicAlarm(parsed);
    return;
  }

  if (parsed.type === 'STOP_ALARM') {
    await stopPanicAlarm(parsed.alertId);
  }
}

/**
 * Registra los manejadores en segundo plano de FCM y Notifee en el punto de entrada (index.ts).
 */
export function registerBackgroundAlarmHandlers(): void {
  try {
    messaging().setBackgroundMessageHandler(async (remoteMessage) => {
      await ensureNotificationChannels();
      await handleFcmRemoteMessage(remoteMessage);
    });
  } catch (error) {
    console.warn(
      '[fcmHandler] No se pudo registrar setBackgroundMessageHandler (verifica google-services.json):',
      error
    );
  }

  notifee.registerForegroundService(() => {
    return new Promise<void>(() => {
      // El Foreground Service permanece activo hasta que stopPanicAlarm() llame stopForegroundService().
    });
  });

  notifee.onBackgroundEvent(async ({ type, detail }) => {
    if (type === EventType.PRESS) {
      const data = detail.notification?.data as Record<string, unknown> | undefined;
      hydrateAlarmFromNotificationData(data);
    }
  });
}

/**
 * Suscribe eventos Notifee en primer plano para mantener sincronizada la pantalla de alarma.
 */
export function subscribeForegroundNotifeeEvents(): () => void {
  return notifee.onForegroundEvent(({ type, detail }) => {
    if (type === EventType.PRESS || type === EventType.DELIVERED) {
      const data = detail.notification?.data as Record<string, unknown> | undefined;
      hydrateAlarmFromNotificationData(data);
    }
  });
}

/**
 * Suscribe el listener de mensajes FCM con la app en primer plano.
 */
export function subscribeForegroundFcmMessages(): () => void {
  try {
    return messaging().onMessage(async (remoteMessage) => {
      await handleFcmRemoteMessage(remoteMessage);
    });
  } catch (error) {
    console.warn('[fcmHandler] FCM foreground listener no disponible:', error);
    return () => {};
  }
}

/**
 * Obtiene el fcm_token del dispositivo Android para pruebas de push (Fase 0)
 * y futuro registro en Supabase profiles.fcm_token (Fase 1).
 */
export async function getFcmToken(): Promise<{ token: string | null; error?: string }> {
  try {
    const token = await messaging().getToken();
    return { token };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Firebase no inicializado (falta google-services.json o Development Build).';
    return { token: null, error: message };
  }
}

/**
 * Escucha rotaciones automáticas del fcm_token.
 */
export function subscribeFcmTokenRefresh(onToken: (token: string) => void): () => void {
  try {
    return messaging().onTokenRefresh((newToken) => {
      onToken(newToken);
    });
  } catch {
    return () => {};
  }
}
