export type PanicMessageType = 'PANIC_ALARM' | 'STOP_ALARM';

export interface PanicAlertPayload {
  type: PanicMessageType;
  alertId: string;
  groupName: string;
  senderName: string;
  timestamp: string;
  lat?: string;
  lng?: string;
  message?: string;
  isTest?: boolean;
}

export interface ActiveAlarmState {
  alert: PanicAlertPayload | null;
  isSilenced: boolean;
  silencedUntilMs: number | null;
  startedAtMs: number | null;
}

export interface PermissionStatusMap {
  notifications: boolean;
  fullScreenIntent: boolean;
  batteryOptimizationIgnored: boolean;
  dndAccess: boolean;
}

export interface PanicAlarmNativeBridge {
  startAlarm(alertId: string, volumePercent: number, maxDurationMs: number): Promise<boolean>;
  stopAlarm(): Promise<boolean>;
  isAlarmPlaying(): Promise<boolean>;
  getActiveAlertId(): Promise<string | null>;
  isBatteryOptimizationIgnored(): Promise<boolean>;
  openBatteryOptimizationSettings(): Promise<boolean>;
  hasDndAccess(): Promise<boolean>;
  openDndSettings(): Promise<boolean>;
  canUseFullScreenIntent(): Promise<boolean>;
  openFullScreenIntentSettings(): Promise<boolean>;
}
