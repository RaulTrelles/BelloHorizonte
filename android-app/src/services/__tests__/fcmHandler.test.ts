import type { FirebaseMessagingTypes } from '@react-native-firebase/messaging';

const mockNativePanicAlarm = {
  startAlarm: jest.fn<Promise<boolean>, [string, number, number]>(),
  stopAlarm: jest.fn<Promise<boolean>, []>(),
  isAlarmPlaying: jest.fn<Promise<boolean>, []>(),
  getActiveAlertId: jest.fn<Promise<string | null>, []>(),
};

const mockNotifee = {
  createChannel: jest.fn().mockResolvedValue('ok'),
  displayNotification: jest.fn().mockResolvedValue('notif-id'),
  stopForegroundService: jest.fn().mockResolvedValue(undefined),
  cancelNotification: jest.fn().mockResolvedValue(undefined),
  registerForegroundService: jest.fn(),
  onBackgroundEvent: jest.fn(),
  onForegroundEvent: jest.fn(() => jest.fn()),
};

const mockMessagingInstance = {
  setBackgroundMessageHandler: jest.fn(),
  onMessage: jest.fn(() => jest.fn()),
  getToken: jest.fn().mockResolvedValue('fcm-test-token-123'),
  onTokenRefresh: jest.fn(() => jest.fn()),
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
    openSettings: jest.fn(),
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
  EventType: { PRESS: 1, DELIVERED: 3 },
}));

jest.mock('@react-native-firebase/messaging', () => ({
  __esModule: true,
  default: () => mockMessagingInstance,
}));

import { __resetAlarmControllerForTests, getActiveAlarmState } from '../alarmController';
import { handleFcmRemoteMessage, parsePanicMessage } from '../fcmHandler';

describe('fcmHandler', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-22T05:00:00.000Z'));
    jest.clearAllMocks();
    __resetAlarmControllerForTests();
    mockNativePanicAlarm.startAlarm.mockResolvedValue(true);
    mockNativePanicAlarm.stopAlarm.mockResolvedValue(true);
  });

  afterEach(() => {
    __resetAlarmControllerForTests();
    jest.useRealTimers();
  });

  it('usa remoteMessage.sentTime como fallback de timestamp y valida lat/lng', () => {
    const sentTime = Date.parse('2026-11-22T04:59:30.000Z');
    const validMsg: FirebaseMessagingTypes.RemoteMessage = {
      sentTime,
      data: {
        type: 'PANIC_ALARM',
        alertId: 'fcm-001',
        senderName: 'Lucía Vega',
        lat: '-12.0464',
        lng: '-77.0428',
      },
      fcmOptions: {},
    };

    const parsed = parsePanicMessage(validMsg);
    expect(parsed).not.toBeNull();
    expect(parsed?.timestamp).toBe('2026-11-22T04:59:30.000Z');
    expect(parsed?.lat).toBe('-12.0464');
    expect(parsed?.lng).toBe('-77.0428');

    const invalidCoordsMsg: FirebaseMessagingTypes.RemoteMessage = {
      sentTime,
      data: {
        type: 'PANIC_ALARM',
        alertId: 'fcm-002',
        lat: '999',
        lng: 'not-a-number',
      },
      fcmOptions: {},
    };
    const parsedInvalid = parsePanicMessage(invalidCoordsMsg);
    expect(parsedInvalid?.lat).toBeUndefined();
    expect(parsedInvalid?.lng).toBeUndefined();
  });

  it('procesa PANIC_ALARM y luego detiene todo con STOP_ALARM del mismo alertId', async () => {
    const startMsg: FirebaseMessagingTypes.RemoteMessage = {
      sentTime: Date.now(),
      data: {
        type: 'PANIC_ALARM',
        alertId: 'fcm-live-001',
        groupName: 'Asociación Bello Horizonte',
        senderName: 'Jorge Salazar',
        timestamp: new Date().toISOString(),
      },
      fcmOptions: {},
    };

    await handleFcmRemoteMessage(startMsg);
    expect(mockNativePanicAlarm.startAlarm).toHaveBeenCalledTimes(1);
    expect(getActiveAlarmState().alert?.alertId).toBe('fcm-live-001');

    const stopMsg: FirebaseMessagingTypes.RemoteMessage = {
      sentTime: Date.now(),
      data: {
        type: 'STOP_ALARM',
        alertId: 'fcm-live-001',
      },
      fcmOptions: {},
    };

    await handleFcmRemoteMessage(stopMsg);
    expect(mockNativePanicAlarm.stopAlarm).toHaveBeenCalledTimes(1);
    expect(getActiveAlarmState().alert).toBeNull();
  });

  it('descarta PANIC_ALARM expirado cuando sentTime supera el TTL de 90s', async () => {
    const oldSentTime = Date.now() - 120_000;
    const staleMsg: FirebaseMessagingTypes.RemoteMessage = {
      sentTime: oldSentTime,
      data: {
        type: 'PANIC_ALARM',
        alertId: 'fcm-stale-001',
        senderName: 'Vecino Antiguo',
      },
      fcmOptions: {},
    };

    await handleFcmRemoteMessage(staleMsg);
    expect(mockNativePanicAlarm.startAlarm).not.toHaveBeenCalled();
    expect(getActiveAlarmState().alert).toBeNull();
  });
});
