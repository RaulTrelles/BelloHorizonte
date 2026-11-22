import type { PanicAlertPayload } from '../../types/alarm';

const mockNativePanicAlarm = {
  startAlarm: jest.fn<Promise<boolean>, [string, number, number]>(),
  stopAlarm: jest.fn<Promise<boolean>, []>(),
  isAlarmPlaying: jest.fn<Promise<boolean>, []>(),
  getActiveAlertId: jest.fn<Promise<string | null>, []>(),
  isBatteryOptimizationIgnored: jest.fn<Promise<boolean>, []>(),
  openBatteryOptimizationSettings: jest.fn<Promise<boolean>, []>(),
  hasDndAccess: jest.fn<Promise<boolean>, []>(),
  openDndSettings: jest.fn<Promise<boolean>, []>(),
  canUseFullScreenIntent: jest.fn<Promise<boolean>, []>(),
  openFullScreenIntentSettings: jest.fn<Promise<boolean>, []>(),
};

const mockNotifee = {
  createChannel: jest.fn<Promise<string>, [unknown]>(),
  displayNotification: jest.fn<Promise<string>, [unknown]>(),
  stopForegroundService: jest.fn<Promise<void>, []>(),
  cancelNotification: jest.fn<Promise<void>, [string]>(),
  getInitialNotification: jest.fn<Promise<unknown>, []>(),
  getNotificationSettings: jest.fn<Promise<{ authorizationStatus: number }>, []>(),
  requestPermission: jest.fn<Promise<{ authorizationStatus: number }>, []>(),
};

jest.mock('react-native', () => ({
  Platform: { OS: 'android', Version: 34 },
  NativeModules: {
    PanicAlarmModule: mockNativePanicAlarm,
  },
  PermissionsAndroid: {
    PERMISSIONS: { POST_NOTIFICATIONS: 'android.permission.POST_NOTIFICATIONS' },
    RESULTS: { GRANTED: 'granted' },
    request: jest.fn().mockResolvedValue('granted'),
  },
  Linking: {
    openSettings: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: mockNotifee,
  AndroidCategory: { ALARM: 'alarm' },
  AndroidForegroundServiceType: { FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK: 2 },
  AndroidImportance: { HIGH: 4, DEFAULT: 3 },
  AndroidVisibility: { PUBLIC: 1, PRIVATE: 0 },
  AuthorizationStatus: { AUTHORIZED: 1 },
}));

import {
  __resetAlarmControllerForTests,
  ensureNotificationChannels,
  getActiveAlarmState,
  PANIC_ALARM_CHANNEL_ID,
  rehydrateActiveAlarmState,
  silenceAlarmForOneMinute,
  stopPanicAlarm,
  triggerPanicAlarm,
} from '../alarmController';

function makePayload(overrides?: Partial<PanicAlertPayload>): PanicAlertPayload {
  return {
    type: 'PANIC_ALARM',
    alertId: 'alert-uuid-001',
    groupName: 'Asociación Bello Horizonte',
    senderName: 'Carlos Quispe',
    timestamp: new Date().toISOString(),
    lat: '-12.0464',
    lng: '-77.0428',
    message: '¡ALERTA! Robo en la cuadra',
    ...overrides,
  };
}

describe('alarmController', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-22T05:00:00.000Z'));
    jest.clearAllMocks();
    __resetAlarmControllerForTests();

    mockNativePanicAlarm.startAlarm.mockResolvedValue(true);
    mockNativePanicAlarm.stopAlarm.mockResolvedValue(true);
    mockNativePanicAlarm.isAlarmPlaying.mockResolvedValue(false);
    mockNativePanicAlarm.getActiveAlertId.mockResolvedValue(null);
    mockNotifee.createChannel.mockResolvedValue('ok');
    mockNotifee.displayNotification.mockResolvedValue('notif-id');
    mockNotifee.stopForegroundService.mockResolvedValue(undefined);
    mockNotifee.cancelNotification.mockResolvedValue(undefined);
    mockNotifee.getInitialNotification.mockResolvedValue(null);
  });

  afterEach(() => {
    __resetAlarmControllerForTests();
    jest.useRealTimers();
  });

  it('crea panic_alarm_channel sin sonido ni vibración para evitar doble reproducción', async () => {
    await ensureNotificationChannels();

    expect(mockNotifee.createChannel).toHaveBeenCalledTimes(2);
    const panicChannelCall = mockNotifee.createChannel.mock.calls[0][0] as Record<string, unknown>;
    expect(panicChannelCall.id).toBe(PANIC_ALARM_CHANNEL_ID);
    expect(panicChannelCall.sound).toBeUndefined();
    expect(panicChannelCall.vibration).toBe(false);
  });

  it('dispara alarma válida y deduplica por alertId sin superponer audios', async () => {
    const payload = makePayload({ alertId: 'dup-001' });

    const first = await triggerPanicAlarm(payload);
    const second = await triggerPanicAlarm(payload);

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(mockNativePanicAlarm.startAlarm).toHaveBeenCalledTimes(1);
    expect(mockNativePanicAlarm.startAlarm).toHaveBeenCalledWith('dup-001', 100, 90_000);
    expect(getActiveAlarmState().alert?.alertId).toBe('dup-001');
  });

  it('ignora alertas PANIC_ALARM expiradas (> 90s TTL)', async () => {
    const expiredTs = new Date(Date.now() - 95_000).toISOString();
    const payload = makePayload({ alertId: 'expired-001', timestamp: expiredTs });

    const started = await triggerPanicAlarm(payload);

    expect(started).toBe(false);
    expect(mockNativePanicAlarm.startAlarm).not.toHaveBeenCalled();
    expect(getActiveAlarmState().alert).toBeNull();
  });

  it('actualiza estado de alarma incluso si Notifee Foreground Service falla y usa fallback', async () => {
    mockNotifee.displayNotification
      .mockRejectedValueOnce(new Error('FGS not allowed'))
      .mockResolvedValueOnce('fallback-id');

    const started = await triggerPanicAlarm(makePayload({ alertId: 'fgs-fallback-001' }));

    expect(started).toBe(true);
    expect(mockNotifee.displayNotification).toHaveBeenCalledTimes(2);
    expect(getActiveAlarmState().alert?.alertId).toBe('fgs-fallback-001');
  });

  it('silencia por 1 minuto y reanuda la sirena a los 60s si no se confirmó', async () => {
    await triggerPanicAlarm(makePayload({ alertId: 'silence-001' }));
    expect(mockNativePanicAlarm.startAlarm).toHaveBeenCalledTimes(1);

    await silenceAlarmForOneMinute();

    expect(mockNativePanicAlarm.stopAlarm).toHaveBeenCalledTimes(1);
    expect(getActiveAlarmState().isSilenced).toBe(true);
    expect(getActiveAlarmState().alert?.alertId).toBe('silence-001');

    jest.advanceTimersByTime(60_000);

    expect(getActiveAlarmState().isSilenced).toBe(false);
    expect(mockNativePanicAlarm.startAlarm).toHaveBeenCalledTimes(2);
  });

  it('detiene alarma, restaura volumen y cierra Foreground Service en stopPanicAlarm y tras timeout de 90s', async () => {
    await triggerPanicAlarm(makePayload({ alertId: 'timeout-001' }));

    await jest.advanceTimersByTimeAsync(90_000);

    expect(mockNativePanicAlarm.stopAlarm).toHaveBeenCalledTimes(1);
    expect(mockNotifee.stopForegroundService).toHaveBeenCalledTimes(1);
    expect(getActiveAlarmState().alert).toBeNull();

    // Nueva alerta detenida manualmente por STOP_ALARM
    await triggerPanicAlarm(makePayload({ alertId: 'manual-stop-002' }));
    await stopPanicAlarm('manual-stop-002');

    expect(mockNativePanicAlarm.stopAlarm).toHaveBeenCalledTimes(2);
    expect(getActiveAlarmState().alert).toBeNull();
  });

  it('rehidrata estado desde getInitialNotification al abrir la app en frío', async () => {
    mockNotifee.getInitialNotification.mockResolvedValueOnce({
      notification: {
        data: {
          type: 'PANIC_ALARM',
          alertId: 'cold-start-001',
          groupName: 'Asociación Bello Horizonte',
          senderName: 'Ana Torres',
          timestamp: new Date().toISOString(),
        },
      },
    });

    const state = await rehydrateActiveAlarmState();

    expect(state.alert?.alertId).toBe('cold-start-001');
    expect(state.alert?.senderName).toBe('Ana Torres');
  });
});
