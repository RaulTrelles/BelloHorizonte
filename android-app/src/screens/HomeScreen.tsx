import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  checkAllPermissions,
  isNativeAlarmAvailable,
  openBatteryOptimizationSettings,
  openDndSettings,
  openFullScreenIntentSettings,
  requestNotificationPermission,
  triggerLocalTestAlarm,
  triggerPanicAlarm,
} from '../services/alarmController';
import { getFcmToken, subscribeFcmTokenRefresh } from '../services/fcmHandler';
import type { PermissionStatusMap } from '../types/alarm';

const HOLD_DURATION_MS = 2_000;
const CONFIRM_COUNTDOWN_SECONDS = 5;

const INITIAL_PERMISSIONS: PermissionStatusMap = {
  notifications: false,
  fullScreenIntent: false,
  batteryOptimizationIgnored: false,
  dndAccess: false,
};

export function HomeScreen(): React.JSX.Element {
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  const [fcmError, setFcmError] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<PermissionStatusMap>(INITIAL_PERMISSIONS);
  const [testingLocalAlarm, setTestingLocalAlarm] = useState<boolean>(false);

  // Estado del botón grande ALERTA (mantener 2s)
  const [holdProgress, setHoldProgress] = useState<number>(0);
  const [isHolding, setIsHolding] = useState<boolean>(false);
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdStartRef = useRef<number>(0);
  const testAlarmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Estado del modal de confirmación (5s)
  const [confirmModalVisible, setConfirmModalVisible] = useState<boolean>(false);
  const [confirmCountdown, setConfirmCountdown] = useState<number>(CONFIRM_COUNTDOWN_SECONDS);
  const confirmDispatchedRef = useRef<boolean>(false);
  const [lastDispatchedInfo, setLastDispatchedInfo] = useState<string | null>(null);

  const refreshPermissions = useCallback(async () => {
    const status = await checkAllPermissions();
    setPermissions(status);
  }, []);

  const refreshFcmToken = useCallback(async () => {
    const result = await getFcmToken();
    setFcmToken(result.token);
    setFcmError(result.error ?? null);
  }, []);

  useEffect(() => {
    refreshPermissions();
    refreshFcmToken();

    const unsubscribeRefresh = subscribeFcmTokenRefresh((newToken) => {
      setFcmToken(newToken);
      setFcmError(null);
    });

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        refreshPermissions();
      }
    });

    return () => {
      unsubscribeRefresh();
      appStateSub.remove();
    };
  }, [refreshFcmToken, refreshPermissions]);

  const handleConfirmPanicDispatch = useCallback((): void => {
    if (confirmDispatchedRef.current) {
      return;
    }
    confirmDispatchedRef.current = true;
    setConfirmModalVisible(false);
    const nowLabel = new Date().toLocaleTimeString('es-PE', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    setLastDispatchedInfo(
      `Alerta confirmada a las ${nowLabel} (Fase 0: lista para conectar a Supabase INSERT alerts en Fase 1).`
    );
    Alert.alert(
      'Alerta confirmada (Fase 0)',
      'Flujo emisor validado (mantener 2s + confirmación 5s). En Fase 1 esto insertará en Supabase alerts y notificará a la cuadra vía FCM HTTP v1.'
    );
  }, []);

  // Limpieza de timers al desmontar HomeScreen
  useEffect(() => {
    return () => {
      if (holdIntervalRef.current) {
        clearInterval(holdIntervalRef.current);
        holdIntervalRef.current = null;
      }
      if (testAlarmTimeoutRef.current) {
        clearTimeout(testAlarmTimeoutRef.current);
        testAlarmTimeoutRef.current = null;
      }
    };
  }, []);

  // Cuenta regresiva del modal de confirmación (5s) sin side-effects dentro del updater
  useEffect(() => {
    if (!confirmModalVisible) {
      return;
    }

    confirmDispatchedRef.current = false;
    setConfirmCountdown(CONFIRM_COUNTDOWN_SECONDS);

    const interval = setInterval(() => {
      setConfirmCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [confirmModalVisible]);

  useEffect(() => {
    if (confirmModalVisible && confirmCountdown === 0) {
      handleConfirmPanicDispatch();
    }
  }, [confirmModalVisible, confirmCountdown, handleConfirmPanicDispatch]);

  const stopHoldTracking = useCallback(() => {
    if (holdIntervalRef.current) {
      clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
    setIsHolding(false);
    setHoldProgress(0);
  }, []);

  const handleAlertPressIn = (): void => {
    stopHoldTracking();
    setIsHolding(true);
    holdStartRef.current = Date.now();

    holdIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - holdStartRef.current;
      const ratio = Math.min(1, elapsed / HOLD_DURATION_MS);
      setHoldProgress(ratio);

      if (ratio >= 1) {
        stopHoldTracking();
        setConfirmModalVisible(true);
      }
    }, 50);
  };

  const handleAlertPressOut = (): void => {
    stopHoldTracking();
  };

  const handleLocalTestAlarm = async (): Promise<void> => {
    if (testingLocalAlarm) {
      return;
    }
    setTestingLocalAlarm(true);
    try {
      await triggerLocalTestAlarm();
      if (testAlarmTimeoutRef.current) {
        clearTimeout(testAlarmTimeoutRef.current);
      }
      testAlarmTimeoutRef.current = setTimeout(() => {
        testAlarmTimeoutRef.current = null;
        setTestingLocalAlarm(false);
      }, 5200);
    } catch (error) {
      setTestingLocalAlarm(false);
      Alert.alert(
        'Error en prueba local',
        error instanceof Error ? error.message : 'No se pudo iniciar la alarma local.'
      );
    }
  };

  const handleSimulateIncomingAlert = async (): Promise<void> => {
    await triggerPanicAlarm(
      {
        type: 'PANIC_ALARM',
        alertId: `sim-${Date.now()}`,
        groupName: 'Asociación Bello Horizonte',
        senderName: 'María Pérez (Prueba)',
        timestamp: new Date().toISOString(),
        lat: '-12.0464',
        lng: '-77.0428',
        message: '¡ALERTA! Robo en la cuadra',
        isTest: true,
      },
      { isTest: true }
    );
  };

  const allCriticalPermissionsOk =
    permissions.notifications &&
    permissions.fullScreenIntent &&
    permissions.batteryOptimizationIgnored;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Cabecera */}
        <View style={styles.header}>
          <Text style={styles.title}>Asociación Bello Horizonte</Text>
          <Text style={styles.subtitle}>Fase 0 — Prototipo de Alarma Crítica Android</Text>
          {!isNativeAlarmAvailable() && (
            <View style={styles.warningPill}>
              <Text style={styles.warningPillText}>
                Módulo nativo no detectado — compila con Expo Development Build (expo run:android)
              </Text>
            </View>
          )}
        </View>

        {/* Botón grande ALERTA (mantener 2s) */}
        <View style={styles.panicSection}>
          <Pressable
            onPressIn={handleAlertPressIn}
            onPressOut={handleAlertPressOut}
            style={[styles.panicButton, isHolding && styles.panicButtonPressed]}
          >
            <Text style={styles.panicButtonTitle}>ALERTA</Text>
            <Text style={styles.panicButtonSubtitle}>
              {isHolding ? 'Mantén presionado...' : 'Mantener presionado 2 segundos'}
            </Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round(holdProgress * 100)}%` }]} />
            </View>
          </Pressable>

          {lastDispatchedInfo && (
            <View style={styles.dispatchBanner}>
              <Text style={styles.dispatchBannerText}>{lastDispatchedInfo}</Text>
            </View>
          )}
        </View>

        {/* Botones de prueba Fase 0 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Pruebas de Alarma (Fase 0)</Text>
          <View style={styles.testButtonsRow}>
            <Pressable
              style={[styles.secondaryButton, testingLocalAlarm && styles.secondaryButtonActive]}
              onPress={handleLocalTestAlarm}
              disabled={testingLocalAlarm}
            >
              <Text style={styles.secondaryButtonText}>
                {testingLocalAlarm ? 'Sonando prueba (5s)...' : 'Probar alarma local (5s)'}
              </Text>
            </Pressable>

            <Pressable style={styles.simulateButton} onPress={handleSimulateIncomingAlert}>
              <Text style={styles.simulateButtonText}>Simular alerta recibida</Text>
            </Pressable>
          </View>
        </View>

        {/* Semáforo de Permisos */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <View style={styles.trafficLightHeader}>
              <View
                style={[
                  styles.statusDotLarge,
                  allCriticalPermissionsOk ? styles.dotGreen : styles.dotRed,
                ]}
              />
              <Text style={styles.cardTitle}>Semáforo de Permisos</Text>
            </View>
            <Pressable onPress={refreshPermissions} style={styles.smallLinkButton}>
              <Text style={styles.smallLinkText}>Actualizar</Text>
            </Pressable>
          </View>

          <PermissionRow
            label="Notificaciones (Android 13+)"
            granted={permissions.notifications}
            actionLabel="Permitir"
            onPress={async () => {
              await requestNotificationPermission();
              await refreshPermissions();
            }}
          />

          <PermissionRow
            label="Pantalla completa sobre bloqueo"
            granted={permissions.fullScreenIntent}
            actionLabel="Ajustes"
            onPress={openFullScreenIntentSettings}
          />

          <PermissionRow
            label="Batería sin restricciones (Doze)"
            granted={permissions.batteryOptimizationIgnored}
            actionLabel="Excluir"
            onPress={openBatteryOptimizationSettings}
          />

          <PermissionRow
            label="No Molestar / DND (recomendado)"
            granted={permissions.dndAccess}
            actionLabel="Ajustes"
            onPress={openDndSettings}
          />
        </View>

        {/* Token FCM para pruebas de push */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>Token FCM del Dispositivo</Text>
            <Pressable onPress={refreshFcmToken} style={styles.smallLinkButton}>
              <Text style={styles.smallLinkText}>Refrescar</Text>
            </Pressable>
          </View>
          {fcmToken ? (
            <Text selectable style={styles.tokenBox}>
              {fcmToken}
            </Text>
          ) : (
            <Text style={styles.tokenPlaceholder}>
              {fcmError ||
                'Sin token FCM todavía. Coloca android-app/google-services.json y ejecuta npx expo prebuild.'}
            </Text>
          )}
        </View>
      </ScrollView>

      {/* Modal de Confirmación de 5 segundos */}
      <Modal
        visible={confirmModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>¿Robo en tu cuadra?</Text>
            <Text style={styles.modalDescription}>
              Se enviará una alarma sonora a todos los vecinos activos de Asociación Bello Horizonte.
            </Text>
            <Text style={styles.modalCountdown}>Enviando en {confirmCountdown}s...</Text>

            <View style={styles.modalActions}>
              <Pressable style={styles.modalConfirmButton} onPress={handleConfirmPanicDispatch}>
                <Text style={styles.modalConfirmText}>Confirmar ahora</Text>
              </Pressable>

              <Pressable
                style={styles.modalCancelButton}
                onPress={() => setConfirmModalVisible(false)}
              >
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

interface PermissionRowProps {
  label: string;
  granted: boolean;
  actionLabel: string;
  onPress: () => void | Promise<void>;
}

function PermissionRow({
  label,
  granted,
  actionLabel,
  onPress,
}: PermissionRowProps): React.JSX.Element {
  return (
    <View style={styles.permissionRow}>
      <View style={styles.permissionLabelGroup}>
        <View style={[styles.statusDot, granted ? styles.dotGreen : styles.dotRed]} />
        <Text style={styles.permissionLabel}>{label}</Text>
      </View>
      <Pressable style={styles.permissionButton} onPress={onPress}>
        <Text style={styles.permissionButtonText}>{granted ? 'OK' : actionLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  scrollContent: {
    padding: 16,
    gap: 16,
    paddingBottom: 32,
  },
  header: {
    gap: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    color: '#111827',
  },
  subtitle: {
    fontSize: 13,
    color: '#4B5563',
    fontWeight: '600',
  },
  warningPill: {
    marginTop: 8,
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  warningPillText: {
    color: '#92400E',
    fontSize: 12,
    fontWeight: '700',
  },
  panicSection: {
    gap: 10,
  },
  panicButton: {
    backgroundColor: '#DC2626',
    borderRadius: 20,
    paddingVertical: 28,
    paddingHorizontal: 20,
    alignItems: 'center',
    elevation: 4,
    gap: 8,
  },
  panicButtonPressed: {
    backgroundColor: '#991B1B',
    transform: [{ scale: 0.98 }],
  },
  panicButtonTitle: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 2,
  },
  panicButtonSubtitle: {
    color: '#FEE2E2',
    fontSize: 14,
    fontWeight: '700',
  },
  progressTrack: {
    width: '100%',
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    overflow: 'hidden',
    marginTop: 6,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#FFFFFF',
  },
  dispatchBanner: {
    backgroundColor: '#ECFDF5',
    borderColor: '#10B981',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  dispatchBannerText: {
    color: '#065F46',
    fontSize: 12,
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  trafficLightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
  },
  testButtonsRow: {
    gap: 10,
  },
  secondaryButton: {
    backgroundColor: '#1F2937',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonActive: {
    backgroundColor: '#D97706',
  },
  secondaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
  },
  simulateButton: {
    backgroundColor: '#FEE2E2',
    borderColor: '#EF4444',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  simulateButtonText: {
    color: '#991B1B',
    fontWeight: '800',
    fontSize: 14,
  },
  permissionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  permissionLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    paddingRight: 8,
  },
  permissionLabel: {
    fontSize: 13,
    color: '#1F2937',
    fontWeight: '600',
    flexShrink: 1,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  statusDotLarge: {
    width: 14,
    height: 14,
    borderRadius: 999,
  },
  dotGreen: {
    backgroundColor: '#16A34A',
  },
  dotRed: {
    backgroundColor: '#DC2626',
  },
  permissionButton: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  permissionButtonText: {
    color: '#1D4ED8',
    fontWeight: '700',
    fontSize: 12,
  },
  smallLinkButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  smallLinkText: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '700',
  },
  tokenBox: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#111827',
    backgroundColor: '#F9FAFB',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  tokenPlaceholder: {
    fontSize: 12,
    color: '#6B7280',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    gap: 14,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#991B1B',
    textAlign: 'center',
  },
  modalDescription: {
    fontSize: 14,
    color: '#374151',
    textAlign: 'center',
    lineHeight: 20,
  },
  modalCountdown: {
    fontSize: 18,
    fontWeight: '800',
    color: '#DC2626',
    textAlign: 'center',
  },
  modalActions: {
    gap: 10,
    marginTop: 6,
  },
  modalConfirmButton: {
    backgroundColor: '#DC2626',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalConfirmText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 16,
  },
  modalCancelButton: {
    backgroundColor: '#E5E7EB',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalCancelText: {
    color: '#1F2937',
    fontWeight: '800',
    fontSize: 15,
  },
});
