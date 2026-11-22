import notifee, { AndroidImportance, AndroidVisibility } from '@notifee/react-native';
import { Audio } from 'expo-av';
import { Platform } from 'react-native';
import {
  ensureNotificationChannels,
  MEETINGS_AND_NEWS_CHANNEL_ID,
} from './alarmController';
import { uploadMeetingAudioChunk } from './belloHorizonteApi';

// Bloques de 25s para que Faster-Whisper CPU en VPS transcriba siempre por debajo del timeout de Edge Functions (150s)
export const CHUNK_INTERVAL_MS = 25 * 1000;
const RECORDING_NOTIFICATION_ID = 'bello_horizonte_meeting_recording';

/**
 * Perfil de voz mono ligero (m4a / AAC, 16 kHz, 40 kbps) para que 1–2 horas de reunión
 * ocupen pocos megabytes y suban rápido en bloques de 5 minutos.
 */
export const MEETING_VOICE_RECORDING_OPTIONS: Audio.RecordingOptions = {
  isMeteringEnabled: false,
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 40000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.MEDIUM,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 40000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 40000,
  },
};

export interface MeetingRecorderState {
  isRecording: boolean;
  isStopping: boolean;
  meetingId: string | null;
  groupId: string | null;
  meetingTitle: string | null;
  startedAtMs: number | null;
  currentChunkIndex: number;
  chunksUploaded: number;
  chunksTranscribed: number;
  chunksFailed: number;
  lastError: string | null;
}

export interface MeetingStopSummary {
  meetingId: string | null;
  chunksUploaded: number;
  chunksTranscribed: number;
  chunksFailed: number;
}

export interface StartMeetingRecordingParams {
  groupId: string;
  meetingId: string;
  meetingTitle: string;
  userId: string;
  consentNote?: string;
  chunkIntervalMs?: number;
}

type RecorderListener = (state: MeetingRecorderState) => void;

const listeners = new Set<RecorderListener>();

let activeRecording: Audio.Recording | null = null;
let chunkTimer: ReturnType<typeof setInterval> | null = null;
let isRotatingChunk = false;
let activeRotationPromise: Promise<void> | null = null;
let chunkStartedAtMs = 0;
let activeConsent: {
  ley29733_avisado: boolean;
  confirmado_por_user_id: string;
  confirmado_at: string;
  nota?: string;
} | null = null;
let inFlightUploads: Promise<void>[] = [];

let state: MeetingRecorderState = {
  isRecording: false,
  isStopping: false,
  meetingId: null,
  groupId: null,
  meetingTitle: null,
  startedAtMs: null,
  currentChunkIndex: 0,
  chunksUploaded: 0,
  chunksTranscribed: 0,
  chunksFailed: 0,
  lastError: null,
};

function emit(): void {
  const snapshot: MeetingRecorderState = { ...state };
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (err) {
      console.warn('[meetingRecorder] Error en listener:', err);
    }
  });
}

export function getMeetingRecorderState(): MeetingRecorderState {
  return { ...state };
}

export function subscribeMeetingRecorderState(listener: RecorderListener): () => void {
  listeners.add(listener);
  listener({ ...state });
  return () => {
    listeners.delete(listener);
  };
}

async function showRecordingNotification(meetingTitle: string): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  await ensureNotificationChannels();
  try {
    await notifee.displayNotification({
      id: RECORDING_NOTIFICATION_ID,
      title: '🎙️ Reunión en grabación — Asociación Bello Horizonte',
      body: `Grabando "${meetingTitle}" con consentimiento Ley 29733. El audio se eliminará tras aprobar el acta.`,
      android: {
        channelId: MEETINGS_AND_NEWS_CHANNEL_ID,
        importance: AndroidImportance.DEFAULT,
        visibility: AndroidVisibility.PUBLIC,
        ongoing: true,
        autoCancel: false,
        pressAction: {
          id: 'default',
          launchActivity: 'default',
        },
      },
    });
  } catch (err) {
    console.warn('[meetingRecorder] No se pudo mostrar notificación persistente:', err);
  }
}

async function cancelRecordingNotification(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  try {
    await notifee.cancelNotification(RECORDING_NOTIFICATION_ID);
  } catch {
    // Ignorar si ya fue cancelada
  }
}

function enqueueChunkUpload(params: {
  groupId: string;
  meetingId: string;
  chunkIndex: number;
  fileUri: string;
  durationSeconds: number;
}): void {
  if (!activeConsent) {
    return;
  }
  const consentPayload = { ...activeConsent };

  const task = uploadMeetingAudioChunk({
    groupId: params.groupId,
    meetingId: params.meetingId,
    chunkIndex: params.chunkIndex,
    fileUri: params.fileUri,
    durationSeconds: params.durationSeconds,
    consentimientos: consentPayload,
  })
    .then((res) => {
      state = {
        ...state,
        chunksUploaded: state.chunksUploaded + 1,
        chunksTranscribed: state.chunksTranscribed + (res.transcribed ? 1 : 0),
        lastError: res.transcriptionError ?? state.lastError,
      };
      emit();
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : 'Error subiendo bloque de audio';
      state = {
        ...state,
        chunksFailed: state.chunksFailed + 1,
        lastError: msg,
      };
      emit();
    });

  inFlightUploads.push(task);
}

async function rotateChunk(): Promise<void> {
  if (!state.isRecording || !activeRecording || isRotatingChunk || state.isStopping) {
    return;
  }
  if (!state.groupId || !state.meetingId) {
    return;
  }

  isRotatingChunk = true;
  const finishedRecording = activeRecording;
  activeRecording = null;
  const finishedChunkIndex = state.currentChunkIndex;
  const finishedDurationSec = Math.max(1, Math.round((Date.now() - chunkStartedAtMs) / 1000));
  const groupId = state.groupId;
  const meetingId = state.meetingId;

  try {
    await finishedRecording.stopAndUnloadAsync();
    const uri = finishedRecording.getURI();

    // Si stopMeetingRecording() fue llamado mientras cerrábamos este bloque, no crear nextRecording
    if (state.isStopping) {
      if (uri) {
        enqueueChunkUpload({
          groupId,
          meetingId,
          chunkIndex: finishedChunkIndex,
          fileUri: uri,
          durationSeconds: finishedDurationSec,
        });
      }
      return;
    }

    // Iniciar inmediatamente el siguiente bloque para no perder audio
    const { recording: nextRecording } = await Audio.Recording.createAsync(
      MEETING_VOICE_RECORDING_OPTIONS
    );
    if (state.isStopping) {
      // Si stopMeetingRecording() llegó durante createAsync, descartar el bloque vacío
      await nextRecording.stopAndUnloadAsync().catch(() => {});
    } else {
      activeRecording = nextRecording;
      chunkStartedAtMs = Date.now();
      state = {
        ...state,
        currentChunkIndex: finishedChunkIndex + 1,
      };
      emit();
    }

    // Subir y mandar a transcribir el bloque cerrado en segundo plano
    if (uri) {
      enqueueChunkUpload({
        groupId,
        meetingId,
        chunkIndex: finishedChunkIndex,
        fileUri: uri,
        durationSeconds: finishedDurationSec,
      });
    }
  } catch (err) {
    state = {
      ...state,
      lastError: err instanceof Error ? err.message : 'Error rotando bloque de grabación',
    };
    emit();
  } finally {
    isRotatingChunk = false;
  }
}

export async function startMeetingRecording(
  params: StartMeetingRecordingParams
): Promise<void> {
  if (state.isRecording) {
    throw new Error('Ya existe una grabación de reunión en curso.');
  }

  const permission = await Audio.requestPermissionsAsync();
  if (!permission.granted) {
    throw new Error(
      'Se requiere permiso de micrófono (RECORD_AUDIO) para grabar la reunión.'
    );
  }

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    staysActiveInBackground: true,
  });

  const { recording } = await Audio.Recording.createAsync(MEETING_VOICE_RECORDING_OPTIONS);
  activeRecording = recording;
  inFlightUploads = [];
  chunkStartedAtMs = Date.now();
  activeConsent = {
    ley29733_avisado: true,
    confirmado_por_user_id: params.userId,
    confirmado_at: new Date().toISOString(),
    nota:
      params.consentNote ||
      'Aviso previo confirmado a los asistentes (Ley 29733 — audio temporal para borrador de acta).',
  };

  state = {
    isRecording: true,
    isStopping: false,
    meetingId: params.meetingId,
    groupId: params.groupId,
    meetingTitle: params.meetingTitle,
    startedAtMs: Date.now(),
    currentChunkIndex: 1,
    chunksUploaded: 0,
    chunksTranscribed: 0,
    chunksFailed: 0,
    lastError: null,
  };
  emit();

  await showRecordingNotification(params.meetingTitle);

  const intervalMs = params.chunkIntervalMs ?? CHUNK_INTERVAL_MS;
  chunkTimer = setInterval(() => {
    const p = rotateChunk()
      .catch(() => {})
      .finally(() => {
        if (activeRotationPromise === p) {
          activeRotationPromise = null;
        }
      });
    activeRotationPromise = p;
  }, intervalMs);
}

export async function stopMeetingRecording(): Promise<MeetingStopSummary> {
  if (!state.isRecording) {
    return {
      meetingId: state.meetingId,
      chunksUploaded: state.chunksUploaded,
      chunksTranscribed: state.chunksTranscribed,
      chunksFailed: state.chunksFailed,
    };
  }

  if (chunkTimer) {
    clearInterval(chunkTimer);
    chunkTimer = null;
  }

  state = { ...state, isStopping: true };
  emit();

  // Esperar a que cualquier rotación de bloque en curso finalice antes de cerrar activeRecording
  if (activeRotationPromise) {
    await activeRotationPromise.catch(() => {});
  }

  const groupId = state.groupId;
  const meetingId = state.meetingId;
  const finalChunkIndex = state.currentChunkIndex;
  const finalDurationSec = Math.max(1, Math.round((Date.now() - chunkStartedAtMs) / 1000));

  try {
    if (activeRecording) {
      const rec = activeRecording;
      activeRecording = null;
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      if (uri && groupId && meetingId) {
        enqueueChunkUpload({
          groupId,
          meetingId,
          chunkIndex: finalChunkIndex,
          fileUri: uri,
          durationSeconds: finalDurationSec,
        });
      }
    }

    // Esperar a que terminen los bloques en vuelo (incluido el último)
    await Promise.allSettled(inFlightUploads);
  } finally {
    await cancelRecordingNotification();
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
    }).catch(() => {});
  }

  const summary: MeetingStopSummary = {
    meetingId,
    chunksUploaded: state.chunksUploaded,
    chunksTranscribed: state.chunksTranscribed,
    chunksFailed: state.chunksFailed,
  };

  activeConsent = null;
  inFlightUploads = [];
  state = {
    isRecording: false,
    isStopping: false,
    meetingId: null,
    groupId: null,
    meetingTitle: null,
    startedAtMs: null,
    currentChunkIndex: 0,
    chunksUploaded: 0,
    chunksTranscribed: 0,
    chunksFailed: 0,
    lastError: null,
  };
  emit();

  return summary;
}

export function __resetMeetingRecorderForTests(): void {
  if (chunkTimer) {
    clearInterval(chunkTimer);
    chunkTimer = null;
  }
  activeRecording = null;
  isRotatingChunk = false;
  activeRotationPromise = null;
  activeConsent = null;
  inFlightUploads = [];
  listeners.clear();
  state = {
    isRecording: false,
    isStopping: false,
    meetingId: null,
    groupId: null,
    meetingTitle: null,
    startedAtMs: null,
    currentChunkIndex: 0,
    chunksUploaded: 0,
    chunksTranscribed: 0,
    chunksFailed: 0,
    lastError: null,
  };
}
