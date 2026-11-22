import notifee, {
  AndroidCategory,
  AndroidForegroundServiceType,
  AndroidImportance,
  AndroidVisibility,
  AuthorizationStatus,
} from '@notifee/react-native';
import { Linking, NativeModules, PermissionsAndroid, Platform } from 'react-native';
import type {
  ActiveAlarmState,
  PanicAlarmNativeBridge,
  PanicAlertPayload,
  PermissionStatusMap,
} from '../types/alarm';

export const PANIC_ALARM_CHANNEL_ID = 'panic_alarm_channel';
export const MEETINGS_AND_NEWS_CHANNEL_ID = 'meetings_and_news_channel';

export const ALERT_TTL_MS = 90_000;
const PANIC_NOTIFICATION_ID = 'bello_horizonte_active_panic_alarm';
const DEFAULT_ALARM_VOLUME_PERCENT = 100;
const MAX_ALARM_DURATION_MS = 90_000;
const LOCAL_TEST_DURATION_MS = 5_000;
const SILENCE_DURATION_MS = 60_000;
const PROCESSED_RETENTION_MS = 10 * 60_000;

type AlarmStateListener = (state: ActiveAlarmState) => void;

const processedAlertTimestamps = new Map<string, number>();
const stoppedAlertIds = new Set<string>();
const stateListeners = new Set<AlarmStateListener>();

let channelsInitialized = false;
let silenceResumeTimer: ReturnType<typeof setTimeout> | null = null;
let localTestTimer: ReturnType<typeof setTimeout> | null = null;
let safetyStopTimer: ReturnType<typeof setTimeout> | null = null;

let currentState: ActiveAlarmState = {
  alert: null,
  isSilenced: false,
  silencedUntilMs: null,
  startedAtMs: null,
};

function getNativeAlarmModule(): PanicAlarmNativeBridge | undefined {
  return NativeModules.PanicAlarmModule as PanicAlarmNativeBridge | undefined;
}

function emitState(): void {
  const snapshot: ActiveAlarmState = { ...currentState };
  stateListeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {
      console.warn('[alarmController] Error en listener de estado:', error);
    }
  });
}

function pruneProcessedAlerts(nowMs: number): void {
  for (const [alertId, seenAt] of processedAlertTimestamps.entries()) {
    if (nowMs - seenAt > PROCESSED_RETENTION_MS) {
      processedAlertTimestamps.delete(alertId);
      stoppedAlertIds.delete(alertId);
    }
  }
}

function readStringField(
  data: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  if (!data) {
    return undefined;
  }
  const value = data[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function parseValidatedCoordinates(
  rawLat?: string,
  rawLng?: string
): { lat?: string; lng?: string } {
  if (!rawLat || !rawLng) {
    return {};
  }
  const latNum = Number(rawLat);
  const lngNum = Number(rawLng);
  if (
    !Number.isFinite(latNum) ||
    !Number.isFinite(lngNum) ||
    latNum < -90 ||
    latNum > 90 ||
    lngNum < -180 ||
    lngNum > 180
  ) {
    return {};
  }
  return { lat: String(latNum), lng: String(lngNum) };
}

/**
 * Parsea y valida un diccionario de datos (FCM o notificación Notifee) hacia PanicAlertPayload.
 * Usa `fallbackSentTimeMs` antes de `Date.now()` para no enmascarar mensajes expirados.
 */
export function parseAlertDataRecord(
  data: Record<string, unknown> | undefined,
  fallbackSentTimeMs?: number
): PanicAlertPayload | null {
  const type = readStringField(data, 'type');
  const alertId = readStringField(data, 'alertId');

  if (!alertId || (type !== 'PANIC_ALARM' && type !== 'STOP_ALARM')) {
    return null;
  }

  const rawTimestamp = readStringField(data, 'timestamp');
  const fallbackTimestamp =
    typeof fallbackSentTimeMs === 'number' &&
    Number.isFinite(fallbackSentTimeMs) &&
    fallbackSentTimeMs > 0
      ? new Date(fallbackSentTimeMs).toISOString()
      : new Date().toISOString();

  const coords = parseValidatedCoordinates(
    readStringField(data, 'lat'),
    readStringField(data, 'lng')
  );

  return {
    type,
    alertId,
    groupName: readStringField(data, 'groupName') ?? 'Asociación Bello Horizonte',
    senderName: readStringField(data, 'senderName') ?? 'Vecino',
    timestamp: rawTimestamp ?? fallbackTimestamp,
    lat: coords.lat,
    lng: coords.lng,
    message: readStringField(data, 'message') ?? '¡ALERTA! Robo en la cuadra',
  };
}

export function formatAlertTime(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toLocaleTimeString('es-PE', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return parsed.toLocaleTimeString('es-PE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatAlertHeadline(alert: PanicAlertPayload): string {
  const sender = alert.senderName.trim() || 'Un vecino';
  const timeLabel = formatAlertTime(alert.timestamp);
  return `¡ALERTA! Robo en la cuadra – ${sender} avisó a las ${timeLabel}`;
}

export function isNativeAlarmAvailable(): boolean {
  return Boolean(getNativeAlarmModule());
}

export function getActiveAlarmState(): ActiveAlarmState {
  return { ...currentState };
}

export function subscribeAlarmState(listener: AlarmStateListener): () => void {
  stateListeners.add(listener);
  listener({ ...currentState });
  return () => {
    stateListeners.delete(listener);
  };
}

/**
 * Crea ambos canales Android estrictamente separados:
 * - panic_alarm_channel: emergencia (importancia máxima, bypass DND, full-screen intent),
 *   SIN sonido ni vibración a nivel de notificación para evitar doble reproducción simultánea
 *   con PanicAlarmModule (que controla 100% el audio STREAM_ALARM y vibración USAGE_ALARM).
 * - meetings_and_news_channel: comunicados y reuniones (normal, sin sirena crítica).
 */
export async function ensureNotificationChannels(): Promise<void> {
  if (channelsInitialized || Platform.OS !== 'android') {
    return;
  }

  await notifee.createChannel({
    id: PANIC_ALARM_CHANNEL_ID,
    name: 'Alarma Vecinal de Emergencia',
    description: 'Alertas críticas de robo en la cuadra de Asociación Bello Horizonte.',
    importance: AndroidImportance.HIGH,
    visibility: AndroidVisibility.PUBLIC,
    bypassDnd: true,
    vibration: false,
    lights: true,
    lightColor: '#DC2626',
  });

  await notifee.createChannel({
    id: MEETINGS_AND_NEWS_CHANNEL_ID,
    name: 'Reuniones y Comunicados',
    description: 'Avisos informativos y recordatorios de reuniones de Asociación Bello Horizonte.',
    importance: AndroidImportance.DEFAULT,
    visibility: AndroidVisibility.PRIVATE,
    bypassDnd: false,
    vibration: true,
  });

  channelsInitialized = true;
}

export function isAlertExpired(timestamp: string, ttlMs: number = ALERT_TTL_MS): boolean {
  const parsedMs = Date.parse(timestamp);
  if (Number.isNaN(parsedMs)) {
    return false;
  }
  const ageMs = Date.now() - parsedMs;
  return ageMs > ttlMs;
}

async function displayPanicNotificationSafe(
  payload: PanicAlertPayload,
  isTest: boolean
): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }

  const headline = formatAlertHeadline(payload);
  const subtitle = isTest
    ? 'Prueba local de alarma (solo en este dispositivo).'
    : `${payload.groupName || 'Asociación Bello Horizonte'} — Pulsa para abrir la alerta.`;

  const baseNotification = {
    id: PANIC_NOTIFICATION_ID,
    title: headline,
    body: subtitle,
    data: {
      type: payload.type,
      alertId: payload.alertId,
      groupName: payload.groupName,
      senderName: payload.senderName,
      timestamp: payload.timestamp,
      ...(payload.lat ? { lat: payload.lat } : {}),
      ...(payload.lng ? { lng: payload.lng } : {}),
    },
  };

  try {
    await notifee.displayNotification({
      ...baseNotification,
      android: {
        channelId: PANIC_ALARM_CHANNEL_ID,
        category: AndroidCategory.ALARM,
        importance: AndroidImportance.HIGH,
        visibility: AndroidVisibility.PUBLIC,
        ongoing: true,
        autoCancel: false,
        asForegroundService: true,
        foregroundServiceTypes: [
          AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
        ],
        color: '#DC2626',
        pressAction: {
          id: 'default',
          launchActivity: 'default',
        },
        fullScreenAction: {
          id: 'default',
          launchActivity: 'default',
        },
      },
    });
  } catch (fgError) {
    console.warn(
      '[alarmController] Error mostrando Foreground Service Notifee; intentando fallback sin FGS:',
      fgError
    );
    try {
      await notifee.displayNotification({
        ...baseNotification,
        android: {
          channelId: PANIC_ALARM_CHANNEL_ID,
          category: AndroidCategory.ALARM,
          importance: AndroidImportance.HIGH,
          visibility: AndroidVisibility.PUBLIC,
          ongoing: true,
          autoCancel: false,
          color: '#DC2626',
          pressAction: {
            id: 'default',
            launchActivity: 'default',
          },
          fullScreenAction: {
            id: 'default',
            launchActivity: 'default',
          },
        },
      });
    } catch (fallbackError) {
      console.warn('[alarmController] Error en fallback de notificación Notifee:', fallbackError);
    }
  }
}

export async function triggerPanicAlarm(
  payload: PanicAlertPayload,
  options?: {
    isTest?: boolean;
    maxDurationMs?: number;
    volumePercent?: number;
  }
): Promise<boolean> {
  const nowMs = Date.now();
  pruneProcessedAlerts(nowMs);

  const isTest = Boolean(options?.isTest ?? payload.isTest);
  const alertId = payload.alertId.trim();

  if (!alertId) {
    console.warn('[alarmController] Alerta ignorada: falta alertId.');
    return false;
  }

  // Deduplicación estricta: nunca superponer dos audios ni reabrir alertas ya detenidas
  if (currentState.alert?.alertId === alertId) {
    console.info(`[alarmController] Alerta ${alertId} ya activa; deduplicada.`);
    return false;
  }

  if (stoppedAlertIds.has(alertId) || processedAlertTimestamps.has(alertId)) {
    console.info(`[alarmController] Alerta ${alertId} ya procesada/detenida; ignorada.`);
    return false;
  }

  // Verificar TTL (90s) salvo en pruebas locales
  if (!isTest && isAlertExpired(payload.timestamp)) {
    console.warn(`[alarmController] Alerta ${alertId} expirada (TTL > ${ALERT_TTL_MS}ms); ignorada.`);
    return false;
  }

  processedAlertTimestamps.set(alertId, nowMs);
  clearPendingTimers();

  await ensureNotificationChannels();

  const effectiveDurationMs = Math.min(
    MAX_ALARM_DURATION_MS,
    Math.max(1_000, options?.maxDurationMs ?? MAX_ALARM_DURATION_MS)
  );
  const volumePercent = options?.volumePercent ?? DEFAULT_ALARM_VOLUME_PERCENT;

  const nativeAlarmModule = getNativeAlarmModule();
  if (nativeAlarmModule) {
    await nativeAlarmModule.startAlarm(alertId, volumePercent, effectiveDurationMs);
  } else {
    console.warn(
      '[alarmController] PanicAlarmModule no disponible (requiere Expo Development Build en Android).'
    );
  }

  // Actualizar estado UI antes/independientemente de cualquier fallo en Notifee
  currentState = {
    alert: { ...payload, isTest },
    isSilenced: false,
    silencedUntilMs: null,
    startedAtMs: nowMs,
  };
  emitState();

  // Timer de seguridad sincronizado con PanicAlarmModule (90s) para cerrar Foreground Service limpiamente
  safetyStopTimer = setTimeout(() => {
    safetyStopTimer = null;
    if (currentState.alert?.alertId === alertId) {
      stopPanicAlarm(alertId).catch((err) => {
        console.warn('[alarmController] Error en auto-stop de seguridad:', err);
      });
    }
  }, effectiveDurationMs);

  await displayPanicNotificationSafe(payload, isTest);

  return true;
}

export async function stopPanicAlarm(alertId?: string): Promise<void> {
  if (alertId) {
    stoppedAlertIds.add(alertId);
    if (currentState.alert && currentState.alert.alertId !== alertId) {
      return;
    }
  } else if (currentState.alert?.alertId) {
    stoppedAlertIds.add(currentState.alert.alertId);
  }

  clearPendingTimers();

  const nativeAlarmModule = getNativeAlarmModule();
  if (nativeAlarmModule) {
    try {
      await nativeAlarmModule.stopAlarm();
    } catch (error) {
      console.warn('[alarmController] Error deteniendo módulo nativo:', error);
    }
  }

  if (Platform.OS === 'android') {
    try {
      await notifee.stopForegroundService();
    } catch {
      // Puede no haber un Foreground Service activo si la app estaba en prueba UI
    }
    try {
      await notifee.cancelNotification(PANIC_NOTIFICATION_ID);
    } catch {
      // Ignorar si ya fue cancelada
    }
  }

  currentState = {
    alert: null,
    isSilenced: false,
    silencedUntilMs: null,
    startedAtMs: null,
  };
  emitState();
}

/**
 * Rehidrata el estado de la alarma al abrir la app en frío (Full-Screen Intent / tap de notificación)
 * o si PanicAlarmModule ya está reproduciendo una alarma en curso.
 */
export async function rehydrateActiveAlarmState(): Promise<ActiveAlarmState> {
  if (currentState.alert) {
    return { ...currentState };
  }

  try {
    const initial = await notifee.getInitialNotification();
    const initialData = initial?.notification?.data as Record<string, unknown> | undefined;
    if (initialData) {
      const hydrated = hydrateAlarmFromNotificationData(initialData);
      if (hydrated) {
        return hydrated;
      }
    }
  } catch (error) {
    console.warn('[alarmController] Error consultando getInitialNotification:', error);
  }

  const nativeAlarmModule = getNativeAlarmModule();
  if (nativeAlarmModule) {
    try {
      const [playing, activeId] = await Promise.all([
        nativeAlarmModule.isAlarmPlaying(),
        nativeAlarmModule.getActiveAlertId(),
      ]);

      if (playing && activeId && !stoppedAlertIds.has(activeId)) {
        const fallbackAlert: PanicAlertPayload = {
          type: 'PANIC_ALARM',
          alertId: activeId,
          groupName: 'Asociación Bello Horizonte',
          senderName: 'Vecino',
          timestamp: new Date().toISOString(),
          message: '¡ALERTA! Robo en la cuadra',
        };
        currentState = {
          alert: fallbackAlert,
          isSilenced: false,
          silencedUntilMs: null,
          startedAtMs: Date.now(),
        };
        emitState();
      }
    } catch (error) {
      console.warn('[alarmController] Error consultando estado nativo:', error);
    }
  }

  return { ...currentState };
}

export function hydrateAlarmFromNotificationData(
  data: Record<string, unknown> | undefined
): ActiveAlarmState | null {
  const parsed = parseAlertDataRecord(data);
  if (!parsed || parsed.type !== 'PANIC_ALARM') {
    return null;
  }
  if (stoppedAlertIds.has(parsed.alertId) || isAlertExpired(parsed.timestamp)) {
    return null;
  }
  if (currentState.alert?.alertId === parsed.alertId) {
    return { ...currentState };
  }

  const parsedStartedAt = Date.parse(parsed.timestamp);
  currentState = {
    alert: parsed,
    isSilenced: false,
    silencedUntilMs: null,
    startedAtMs: Number.isNaN(parsedStartedAt) ? Date.now() : parsedStartedAt,
  };
  emitState();
  return { ...currentState };
}

/**
 * Silencia el audio/vibración por 1 minuto manteniendo la alerta visible;
 * si al cabo de 60s el vecino no confirmó "Estoy enterado", reanuda la sirena.
 */
export async function silenceAlarmForOneMinute(): Promise<void> {
  const activeAlert = currentState.alert;
  if (!activeAlert) {
    return;
  }

  if (silenceResumeTimer) {
    clearTimeout(silenceResumeTimer);
    silenceResumeTimer = null;
  }
  if (safetyStopTimer) {
    clearTimeout(safetyStopTimer);
    safetyStopTimer = null;
  }

  const nativeAlarmModule = getNativeAlarmModule();
  if (nativeAlarmModule) {
    await nativeAlarmModule.stopAlarm();
  }

  const resumeAtMs = Date.now() + SILENCE_DURATION_MS;
  currentState = {
    ...currentState,
    isSilenced: true,
    silencedUntilMs: resumeAtMs,
  };
  emitState();

  silenceResumeTimer = setTimeout(() => {
    silenceResumeTimer = null;
    const stillActive = currentState.alert;
    if (!stillActive || stillActive.alertId !== activeAlert.alertId) {
      return;
    }
    currentState = {
      ...currentState,
      isSilenced: false,
      silencedUntilMs: null,
    };
    emitState();

    const native = getNativeAlarmModule();
    if (native) {
      native
        .startAlarm(
          `${stillActive.alertId}:resume:${Date.now()}`,
          DEFAULT_ALARM_VOLUME_PERCENT,
          MAX_ALARM_DURATION_MS
        )
        .catch((err) => {
          console.warn('[alarmController] Error reanudando sirena tras silencio:', err);
        });
    }

    safetyStopTimer = setTimeout(() => {
      safetyStopTimer = null;
      if (currentState.alert?.alertId === stillActive.alertId) {
        stopPanicAlarm(stillActive.alertId).catch(() => {});
      }
    }, MAX_ALARM_DURATION_MS);
  }, SILENCE_DURATION_MS);
}

/**
 * Prueba local de 5 segundos por STREAM_ALARM sin alertar a otros vecinos.
 */
export async function triggerLocalTestAlarm(): Promise<void> {
  clearPendingTimers();
  const testAlertId = `local-test-${Date.now()}`;
  await ensureNotificationChannels();

  const nativeAlarmModule = getNativeAlarmModule();
  if (nativeAlarmModule) {
    await nativeAlarmModule.startAlarm(
      testAlertId,
      DEFAULT_ALARM_VOLUME_PERCENT,
      LOCAL_TEST_DURATION_MS
    );
  } else {
    console.warn('[alarmController] Prueba local simulada (sin módulo nativo Android).');
  }

  localTestTimer = setTimeout(() => {
    localTestTimer = null;
    const native = getNativeAlarmModule();
    if (native) {
      native.stopAlarm().catch(() => {});
    }
  }, LOCAL_TEST_DURATION_MS + 150);
}

export async function checkAllPermissions(): Promise<PermissionStatusMap> {
  let notifications = false;
  try {
    const settings = await notifee.getNotificationSettings();
    notifications = settings.authorizationStatus >= AuthorizationStatus.AUTHORIZED;
  } catch {
    notifications = false;
  }

  const nativeAlarmModule = getNativeAlarmModule();
  if (!nativeAlarmModule) {
    return {
      notifications,
      fullScreenIntent: false,
      batteryOptimizationIgnored: false,
      dndAccess: false,
    };
  }

  const [fullScreenIntent, batteryOptimizationIgnored, dndAccess] = await Promise.all([
    nativeAlarmModule.canUseFullScreenIntent().catch(() => false),
    nativeAlarmModule.isBatteryOptimizationIgnored().catch(() => false),
    nativeAlarmModule.hasDndAccess().catch(() => false),
  ]);

  return {
    notifications,
    fullScreenIntent,
    batteryOptimizationIgnored,
    dndAccess,
  };
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'android' && typeof Platform.Version === 'number' && Platform.Version >= 33) {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
    );
    if (result === PermissionsAndroid.RESULTS.GRANTED) {
      return true;
    }
  }
  const settings = await notifee.requestPermission();
  return settings.authorizationStatus >= AuthorizationStatus.AUTHORIZED;
}

export async function openFullScreenIntentSettings(): Promise<void> {
  const nativeAlarmModule = getNativeAlarmModule();
  if (nativeAlarmModule) {
    await nativeAlarmModule.openFullScreenIntentSettings();
    return;
  }
  await Linking.openSettings();
}

export async function openBatteryOptimizationSettings(): Promise<void> {
  const nativeAlarmModule = getNativeAlarmModule();
  if (nativeAlarmModule) {
    await nativeAlarmModule.openBatteryOptimizationSettings();
    return;
  }
  await Linking.openSettings();
}

export async function openDndSettings(): Promise<void> {
  const nativeAlarmModule = getNativeAlarmModule();
  if (nativeAlarmModule) {
    await nativeAlarmModule.openDndSettings();
    return;
  }
  await Linking.openSettings();
}

function clearPendingTimers(): void {
  if (silenceResumeTimer) {
    clearTimeout(silenceResumeTimer);
    silenceResumeTimer = null;
  }
  if (localTestTimer) {
    clearTimeout(localTestTimer);
    localTestTimer = null;
  }
  if (safetyStopTimer) {
    clearTimeout(safetyStopTimer);
    safetyStopTimer = null;
  }
}

/**
 * Helper exclusivo para pruebas unitarias (reinicia estado en memoria y timers).
 */
export function __resetAlarmControllerForTests(): void {
  clearPendingTimers();
  processedAlertTimestamps.clear();
  stoppedAlertIds.clear();
  stateListeners.clear();
  channelsInitialized = false;
  currentState = {
    alert: null,
    isSilenced: false,
    silencedUntilMs: null,
    startedAtMs: null,
  };
}
