const mockDisplayNotification = jest.fn();
const mockCancelNotification = jest.fn();
const mockRequestPermissionsAsync = jest.fn();
const mockSetAudioModeAsync = jest.fn();
const mockCreateAsync = jest.fn();
const mockUploadMeetingAudioChunk = jest.fn();

jest.mock('react-native', () => ({
  Platform: { OS: 'android', Version: 34 },
  NativeModules: {},
  Linking: { openURL: jest.fn() },
  PermissionsAndroid: {
    PERMISSIONS: { POST_NOTIFICATIONS: 'android.permission.POST_NOTIFICATIONS' },
    RESULTS: { GRANTED: 'granted' },
    request: jest.fn(),
  },
}));

jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    createChannel: jest.fn().mockResolvedValue('ok'),
    displayNotification: (...args: unknown[]) => mockDisplayNotification(...args),
    cancelNotification: (...args: unknown[]) => mockCancelNotification(...args),
  },
  AndroidImportance: { HIGH: 4, DEFAULT: 3 },
  AndroidVisibility: { PUBLIC: 1, PRIVATE: 0 },
  AndroidCategory: { ALARM: 'alarm' },
  AndroidForegroundServiceType: { FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK: 2 },
  AuthorizationStatus: { AUTHORIZED: 1 },
}));

jest.mock('expo-av', () => ({
  Audio: {
    requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissionsAsync(...args),
    setAudioModeAsync: (...args: unknown[]) => mockSetAudioModeAsync(...args),
    AndroidOutputFormat: { MPEG_4: 2 },
    AndroidAudioEncoder: { AAC: 3 },
    IOSOutputFormat: { MPEG4AAC: 'aac' },
    IOSAudioQuality: { MEDIUM: 64 },
    Recording: {
      createAsync: (...args: unknown[]) => mockCreateAsync(...args),
    },
  },
}));

jest.mock('../belloHorizonteApi', () => ({
  uploadMeetingAudioChunk: (...args: unknown[]) => mockUploadMeetingAudioChunk(...args),
}));

import { MEETINGS_AND_NEWS_CHANNEL_ID } from '../alarmController';
import {
  __resetMeetingRecorderForTests,
  CHUNK_INTERVAL_MS,
  getMeetingRecorderState,
  startMeetingRecording,
  stopMeetingRecording,
} from '../meetingRecorder';

describe('meetingRecorder', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-22T18:00:00.000Z'));
    jest.clearAllMocks();
    __resetMeetingRecorderForTests();

    mockRequestPermissionsAsync.mockResolvedValue({ granted: true });
    mockSetAudioModeAsync.mockResolvedValue(undefined);
    mockDisplayNotification.mockResolvedValue('notif-rec-1');
    mockCancelNotification.mockResolvedValue(undefined);

    let recCounter = 0;
    mockCreateAsync.mockImplementation(async () => {
      recCounter += 1;
      const uri = `file:///cache/chunk_${recCounter}.m4a`;
      return {
        recording: {
          stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined),
          getURI: jest.fn().mockReturnValue(uri),
        },
      };
    });

    mockUploadMeetingAudioChunk.mockImplementation(async (params: { chunkIndex: number }) => ({
      recording: { id: `rec-${params.chunkIndex}` },
      transcribed: true,
    }));
  });

  afterEach(() => {
    __resetMeetingRecorderForTests();
    jest.useRealTimers();
  });

  it('muestra notificación visible en canal normal, rota bloques cada 5 min y cierra limpiamente', async () => {
    await startMeetingRecording({
      groupId: 'group-bh',
      meetingId: 'meeting-001',
      meetingTitle: 'Asamblea Noviembre',
      userId: 'user-admin',
    });

    expect(getMeetingRecorderState().isRecording).toBe(true);
    expect(getMeetingRecorderState().currentChunkIndex).toBe(1);

    // Notificación visible en meetings_and_news_channel (nunca en panic_alarm_channel)
    expect(mockDisplayNotification).toHaveBeenCalledTimes(1);
    const notifArg = mockDisplayNotification.mock.calls[0][0] as {
      title: string;
      android: { channelId: string; ongoing: boolean };
    };
    expect(notifArg.title).toContain('Reunión en grabación');
    expect(notifArg.android.channelId).toBe(MEETINGS_AND_NEWS_CHANNEL_ID);
    expect(notifArg.android.ongoing).toBe(true);

    // Avanzar 5 minutos -> rota bloque 1 -> inicia bloque 2 y sube bloque 1
    await jest.advanceTimersByTimeAsync(CHUNK_INTERVAL_MS);

    expect(mockCreateAsync).toHaveBeenCalledTimes(2);
    expect(getMeetingRecorderState().currentChunkIndex).toBe(2);
    expect(mockUploadMeetingAudioChunk).toHaveBeenCalledTimes(1);
    expect(mockUploadMeetingAudioChunk.mock.calls[0][0]).toMatchObject({
      groupId: 'group-bh',
      meetingId: 'meeting-001',
      chunkIndex: 1,
      fileUri: 'file:///cache/chunk_1.m4a',
    });

    // Detener grabación -> cierra bloque 2, lo sube/transcribe y cancela notificación
    const summary = await stopMeetingRecording();

    expect(mockUploadMeetingAudioChunk).toHaveBeenCalledTimes(2);
    expect(mockUploadMeetingAudioChunk.mock.calls[1][0]).toMatchObject({
      chunkIndex: 2,
      fileUri: 'file:///cache/chunk_2.m4a',
    });
    expect(mockCancelNotification).toHaveBeenCalledTimes(1);
    expect(summary).toEqual({
      meetingId: 'meeting-001',
      chunksUploaded: 2,
      chunksTranscribed: 2,
      chunksFailed: 0,
    });
    expect(getMeetingRecorderState().isRecording).toBe(false);
  });

  it('rechaza iniciar grabación si el usuario deniega permiso de micrófono', async () => {
    mockRequestPermissionsAsync.mockResolvedValueOnce({ granted: false });

    await expect(
      startMeetingRecording({
        groupId: 'group-bh',
        meetingId: 'meeting-002',
        meetingTitle: 'Reunión sin permiso',
        userId: 'user-admin',
      })
    ).rejects.toThrow('RECORD_AUDIO');

    expect(getMeetingRecorderState().isRecording).toBe(false);
    expect(mockDisplayNotification).not.toHaveBeenCalled();
  });
});
