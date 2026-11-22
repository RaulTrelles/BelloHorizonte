import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  checkAllPermissions,
  isNativeAlarmAvailable,
  triggerLocalTestAlarm,
  triggerPanicAlarm,
} from '../services/alarmController';
import {
  buildPanicAlertWhatsAppText,
  closePanicAlert,
  createPanicAlert,
  deleteMyAccount,
  getAnnouncements,
  getAssociationInfo,
  getGroupAlertsHistory,
  isCooldownError,
  openWhatsAppShare,
  signOutUser,
  subscribeToGroupAlertsRealtime,
} from '../services/belloHorizonteApi';
import type { PermissionStatusMap } from '../types/alarm';
import type {
  AlertWithDetails,
  AnnouncementRecord,
  AssociationInfoRecord,
  MembershipWithGroup,
  ProfileRecord,
} from '../types/database';

const HOLD_DURATION_MS = 2_000;
const CONFIRM_COUNTDOWN_SECONDS = 5;

const INITIAL_PERMISSIONS: PermissionStatusMap = {
  notifications: false,
  fullScreenIntent: false,
  batteryOptimizationIgnored: false,
  dndAccess: false,
};

interface HomeScreenProps {
  membership: MembershipWithGroup;
  profile: ProfileRecord | null;
  currentUserId: string;
  onOpenPermissionsGuide: () => void;
  onOpenHistory: () => void;
  onSignedOut: () => Promise<void>;
}

export function HomeScreen({
  membership,
  profile,
  currentUserId,
  onOpenPermissionsGuide,
  onOpenHistory,
  onSignedOut,
}: HomeScreenProps): React.JSX.Element {
  const [permissions, setPermissions] = useState<PermissionStatusMap>(INITIAL_PERMISSIONS);
  const [testingLocalAlarm, setTestingLocalAlarm] = useState<boolean>(false);

  // Botón grande ALERTA (mantener 2s)
  const [holdProgress, setHoldProgress] = useState<number>(0);
  const [isHolding, setIsHolding] = useState<boolean>(false);
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdStartRef = useRef<number>(0);
  const testAlarmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Modal de confirmación (5s)
  const [confirmModalVisible, setConfirmModalVisible] = useState<boolean>(false);
  const [confirmCountdown, setConfirmCountdown] = useState<number>(CONFIRM_COUNTDOWN_SECONDS);
  const confirmDispatchedRef = useRef<boolean>(false);
  const [dispatching, setDispatching] = useState<boolean>(false);
  const [closingActive, setClosingActive] = useState<boolean>(false);

  // Datos en vivo de Supabase
  const [latestAlert, setLatestAlert] = useState<AlertWithDetails | null>(null);
  const [activeAlert, setActiveAlert] = useState<AlertWithDetails | null>(null);
  const [assocInfo, setAssocInfo] = useState<AssociationInfoRecord | null>(null);
  const [announcements, setAnnouncements] = useState<AnnouncementRecord[]>([]);
  const [infoExpanded, setInfoExpanded] = useState<boolean>(false);

  const refreshPermissions = useCallback(async () => {
    const status = await checkAllPermissions();
    setPermissions(status);
  }, []);

  const refreshAlerts = useCallback(async () => {
    try {
      const list = await getGroupAlertsHistory(membership.group_id, 5);
      setLatestAlert(list[0] ?? null);
      const live = list.find((a) => a.estado === 'activa') ?? null;
      setActiveAlert(live);
    } catch (err) {
      console.warn('[HomeScreen] Error cargando alertas:', err);
    }
  }, [membership.group_id]);

  const refreshPortalData = useCallback(async () => {
    try {
      const [info, comms] = await Promise.all([
        getAssociationInfo(membership.group_id),
        getAnnouncements(membership.group_id, 5),
      ]);
      setAssocInfo(info);
      setAnnouncements(comms);
    } catch (err) {
      console.warn('[HomeScreen] Error cargando info de asociación:', err);
    }
  }, [membership.group_id]);

  useEffect(() => {
    refreshPermissions();
    refreshAlerts();
    refreshPortalData();

    const unsubscribeRealtime = subscribeToGroupAlertsRealtime(membership.group_id, () => {
      refreshAlerts().catch(() => {});
    });

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        refreshPermissions();
        refreshAlerts().catch(() => {});
      }
    });

    return () => {
      unsubscribeRealtime();
      appStateSub.remove();
      if (holdIntervalRef.current) {
        clearInterval(holdIntervalRef.current);
        holdIntervalRef.current = null;
      }
      if (testAlarmTimeoutRef.current) {
        clearTimeout(testAlarmTimeoutRef.current);
        testAlarmTimeoutRef.current = null;
      }
    };
  }, [membership.group_id, refreshAlerts, refreshPermissions, refreshPortalData]);

  const handleConfirmPanicDispatch = useCallback(async (): Promise<void> => {
    if (confirmDispatchedRef.current) {
      return;
    }
    confirmDispatchedRef.current = true;
    setConfirmModalVisible(false);
    setDispatching(true);

    try {
      await createPanicAlert({
        groupId: membership.group_id,
        userId: currentUserId,
        mensaje: '¡ALERTA! Robo en la cuadra',
        lat: membership.group.lat,
        lng: membership.group.lng,
      });
      await refreshAlerts();
    } catch (err) {
      if (isCooldownError(err)) {
        Alert.alert(
          'Espera 2 minutos',
          'Ya enviaste una alerta recientemente. Por prevención anti-abuso, espera 2 minutos antes de enviar otra.'
        );
      } else {
        Alert.alert(
          'Error al enviar alerta',
          err instanceof Error ? err.message : 'Verifica tu conexión a internet e intenta de nuevo.'
        );
      }
    } finally {
      setDispatching(false);
    }
  }, [currentUserId, membership.group.lat, membership.group.lng, membership.group_id, refreshAlerts]);

  // Cuenta regresiva del modal de confirmación (5s) sin side-effects en updater
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
      handleConfirmPanicDispatch().catch(() => {});
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
    if (dispatching) {
      return;
    }
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

  const handleCloseActiveAlert = (estado: 'resuelta' | 'falsa_alarma'): void => {
    if (!activeAlert) {
      return;
    }
    const label = estado === 'falsa_alarma' ? 'Cancelar / Falsa alarma' : 'Marcar como resuelta';
    Alert.alert(
      label,
      'Se enviará señal de detención a todos los celulares de la cuadra.',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Sí, detener alarma',
          style: estado === 'falsa_alarma' ? 'destructive' : 'default',
          onPress: async () => {
            setClosingActive(true);
            try {
              await closePanicAlert(activeAlert.id, estado);
              await refreshAlerts();
            } catch (err) {
              Alert.alert(
                'Error',
                err instanceof Error ? err.message : 'No se pudo cerrar la alerta.'
              );
            } finally {
              setClosingActive(false);
            }
          },
        },
      ]
    );
  };

  const handleShareWhatsApp = async (targetAlert?: AlertWithDetails | null): Promise<void> => {
    const timeLabel = new Date(targetAlert?.created_at ?? Date.now()).toLocaleTimeString('es-PE', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const text = buildPanicAlertWhatsAppText({
      groupName: membership.group.nombre,
      senderName: targetAlert?.authorName || profile?.nombre || 'Un vecino',
      timeLabel,
      lat: targetAlert?.lat ?? membership.group.lat,
      lng: targetAlert?.lng ?? membership.group.lng,
    });
    try {
      await openWhatsAppShare(text);
    } catch {
      Alert.alert('WhatsApp no disponible', 'No se pudo abrir WhatsApp en este dispositivo.');
    }
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
        groupName: membership.group.nombre,
        senderName: `${profile?.nombre || 'Vecino'} (Simulación)`,
        timestamp: new Date().toISOString(),
        lat: membership.group.lat !== null ? String(membership.group.lat) : '-12.0464',
        lng: membership.group.lng !== null ? String(membership.group.lng) : '-77.0428',
        message: '¡ALERTA! Robo en la cuadra',
        isTest: true,
      },
      { isTest: true }
    );
  };

  const handleSignOut = async (): Promise<void> => {
    try {
      await signOutUser();
      await onSignedOut();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'No se pudo cerrar sesión.');
    }
  };

  const handleDeleteAccount = (): void => {
    Alert.alert(
      'Eliminar mi cuenta (Ley 29733)',
      'Se eliminará permanentemente tu perfil, membresía e historial asociado. Esta acción es irreversible.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar definitivamente',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteMyAccount();
              await onSignedOut();
            } catch (err) {
              Alert.alert(
                'Error',
                err instanceof Error ? err.message : 'No se pudo eliminar la cuenta.'
              );
            }
          },
        },
      ]
    );
  };

  const allCriticalPermissionsOk =
    permissions.notifications &&
    permissions.fullScreenIntent &&
    permissions.batteryOptimizationIgnored;

  const activeEnterados = activeAlert
    ? activeAlert.acks.filter((a) => a.tipo_ack === 'enterado')
    : [];
  const canCloseActive =
    Boolean(activeAlert) &&
    (activeAlert?.user_id === currentUserId || membership.rol === 'admin');

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      {/* Cabecera */}
      <View style={styles.headerRow}>
        <View style={styles.headerInfo}>
          <Text style={styles.title}>{membership.group.nombre}</Text>
          <Text style={styles.subtitle}>
            {profile?.nombre || 'Vecino'} · {membership.rol.toUpperCase()}
          </Text>
        </View>
        <Pressable style={styles.signOutBtn} onPress={handleSignOut}>
          <Text style={styles.signOutText}>Salir</Text>
        </Pressable>
      </View>

      {!isNativeAlarmAvailable() && (
        <View style={styles.warningPill}>
          <Text style={styles.warningPillText}>
            Módulo nativo no detectado — usa el Expo Development Build instalado en tu Android.
          </Text>
        </View>
      )}

      {/* Alerta activa enviada en curso (conteo en vivo de "Estoy enterado") */}
      {activeAlert && (
        <View style={styles.liveAlertCard}>
          <Text style={styles.liveAlertBadge}>🚨 ALERTA ACTIVA EN TU CUADRA</Text>
          <Text style={styles.liveAlertTitle}>
            Emitida por {activeAlert.authorName} a las{' '}
            {new Date(activeAlert.created_at).toLocaleTimeString('es-PE', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
          <View style={styles.liveAckBox}>
            <Text style={styles.liveAckCount}>
              Vecinos enterados: {activeEnterados.length}
            </Text>
            {activeEnterados.length > 0 && (
              <Text style={styles.liveAckNames}>
                {activeEnterados.map((a) => a.userName).join(', ')}
              </Text>
            )}
          </View>

          <View style={styles.liveActions}>
            {canCloseActive && (
              <>
                <Pressable
                  style={styles.falseAlarmBtn}
                  disabled={closingActive}
                  onPress={() => handleCloseActiveAlert('falsa_alarma')}
                >
                  <Text style={styles.falseAlarmBtnText}>Cancelar / falsa alarma</Text>
                </Pressable>
                <Pressable
                  style={styles.resolveBtn}
                  disabled={closingActive}
                  onPress={() => handleCloseActiveAlert('resuelta')}
                >
                  <Text style={styles.resolveBtnText}>Marcar resuelta</Text>
                </Pressable>
              </>
            )}
            <Pressable
              style={styles.whatsappBtn}
              onPress={() => handleShareWhatsApp(activeAlert)}
            >
              <Text style={styles.whatsappBtnText}>Compartir alerta por WhatsApp</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Botón grande ALERTA (mantener 2s) */}
      <View style={styles.panicSection}>
        <Pressable
          onPressIn={handleAlertPressIn}
          onPressOut={handleAlertPressOut}
          disabled={dispatching}
          style={[styles.panicButton, isHolding && styles.panicButtonPressed]}
        >
          {dispatching ? (
            <ActivityIndicator color="#FFFFFF" size="large" />
          ) : (
            <>
              <Text style={styles.panicButtonTitle}>ALERTA</Text>
              <Text style={styles.panicButtonSubtitle}>
                {isHolding ? 'Mantén presionado...' : 'Mantener presionado 2 segundos'}
              </Text>
              <View style={styles.progressTrack}>
                <View
                  style={[styles.progressFill, { width: `${Math.round(holdProgress * 100)}%` }]}
                />
              </View>
            </>
          )}
        </Pressable>
      </View>

      {/* Semáforo de Permisos (resumen con acceso directo a Permisos Guiados) */}
      <Pressable style={styles.card} onPress={onOpenPermissionsGuide}>
        <View style={styles.cardHeaderRow}>
          <View style={styles.trafficLightHeader}>
            <View
              style={[
                styles.statusDotLarge,
                allCriticalPermissionsOk ? styles.dotGreen : styles.dotRed,
              ]}
            />
            <Text style={styles.cardTitle}>
              {allCriticalPermissionsOk ? 'Permisos de Alarma: OK' : 'Permisos Incompletos'}
            </Text>
          </View>
          <Text style={styles.smallLinkText}>Configurar →</Text>
        </View>
        <Text style={styles.helperText}>
          {allCriticalPermissionsOk
            ? 'Notificaciones, pantalla completa y batería listos para recibir sirena fuerte.'
            : 'Toca aquí para activar los permisos guiados por marca (OPPO, Samsung, Xiaomi, etc.).'}
        </Text>
      </Pressable>

      {/* Último evento */}
      <Pressable style={styles.card} onPress={onOpenHistory}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardTitle}>Último Evento</Text>
          <Text style={styles.smallLinkText}>Ver historial →</Text>
        </View>
        {latestAlert ? (
          <View style={styles.lastEventBox}>
            <Text style={styles.lastEventText}>
              {latestAlert.authorName} · {latestAlert.estado.toUpperCase()}
            </Text>
            <Text style={styles.helperText}>
              {new Date(latestAlert.created_at).toLocaleString('es-PE')} ·{' '}
              {latestAlert.acks.filter((a) => a.tipo_ack === 'enterado').length} enterados
            </Text>
          </View>
        ) : (
          <Text style={styles.helperText}>Sin alertas registradas todavía en tu cuadra.</Text>
        )}
      </Pressable>

      {/* Información y Comunicados de Asociación Bello Horizonte */}
      <View style={styles.card}>
        <Pressable
          style={styles.cardHeaderRow}
          onPress={() => setInfoExpanded((prev) => !prev)}
        >
          <Text style={styles.cardTitle}>Info y Comunicados de la Asociación</Text>
          <Text style={styles.smallLinkText}>{infoExpanded ? 'Ocultar' : 'Ver todo'}</Text>
        </Pressable>

        {announcements.length > 0 && (
          <View style={styles.announcementItem}>
            <Text style={styles.announcementTitle}>
              📢 {announcements[0].titulo}
            </Text>
            <Text style={styles.helperText} numberOfLines={infoExpanded ? undefined : 2}>
              {announcements[0].contenido}
            </Text>
          </View>
        )}

        {infoExpanded && (
          <View style={styles.infoExpandedBox}>
            {assocInfo?.descripcion && (
              <Text style={styles.helperText}>{assocInfo.descripcion}</Text>
            )}
            {assocInfo?.direccion && (
              <Text style={styles.helperText}>📍 {assocInfo.direccion}</Text>
            )}
            {assocInfo && assocInfo.telefonos_emergencia.length > 0 && (
              <View style={styles.subSection}>
                <Text style={styles.subTitle}>Teléfonos de Emergencia</Text>
                {assocInfo.telefonos_emergencia.map((item) => (
                  <Pressable
                    key={`${item.nombre}-${item.numero}`}
                    onPress={() => Linking.openURL(`tel:${item.numero}`).catch(() => {})}
                  >
                    <Text style={styles.phoneLink}>
                      📞 {item.nombre}: {item.numero}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
            {assocInfo && assocInfo.directiva.length > 0 && (
              <View style={styles.subSection}>
                <Text style={styles.subTitle}>Directiva</Text>
                {assocInfo.directiva.map((d) => (
                  <Text key={`${d.cargo}-${d.nombre}`} style={styles.helperText}>
                    • {d.cargo}: {d.nombre}
                  </Text>
                ))}
              </View>
            )}
            {announcements.slice(1).map((a) => (
              <View key={a.id} style={styles.announcementItem}>
                <Text style={styles.announcementTitle}>📢 {a.titulo}</Text>
                <Text style={styles.helperText}>{a.contenido}</Text>
              </View>
            ))}
            {assocInfo?.politica_privacidad_url && (
              <Pressable
                onPress={() =>
                  Linking.openURL(assocInfo.politica_privacidad_url!).catch(() => {})
                }
              >
                <Text style={styles.smallLinkText}>Ver Política de Privacidad (Ley 29733)</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>

      {/* Herramientas de Prueba y WhatsApp */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Pruebas y Difusión</Text>
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

          <Pressable style={styles.whatsappBtn} onPress={() => handleShareWhatsApp(latestAlert)}>
            <Text style={styles.whatsappBtnText}>Compartir por WhatsApp (wa.me)</Text>
          </Pressable>

          <Pressable style={styles.simulateButton} onPress={handleSimulateIncomingAlert}>
            <Text style={styles.simulateButtonText}>Simular alerta recibida (demo local)</Text>
          </Pressable>
        </View>
      </View>

      <Pressable style={styles.deleteAccountBtn} onPress={handleDeleteAccount}>
        <Text style={styles.deleteAccountText}>Eliminar mi cuenta (Ley 29733)</Text>
      </Pressable>

      {/* Modal de Confirmación de 5 segundos (Pantalla 4) */}
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
              Se enviará una alarma sonora inmediata a todos los vecinos activos de{' '}
              {membership.group.nombre}. Tu nombre será visible.
            </Text>
            <Text style={styles.modalCountdown}>Enviando en {confirmCountdown}s...</Text>

            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalConfirmButton}
                onPress={() => {
                  handleConfirmPanicDispatch().catch(() => {});
                }}
              >
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    padding: 16,
    gap: 14,
    paddingBottom: 28,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerInfo: {
    flex: 1,
    paddingRight: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '900',
    color: '#111827',
  },
  subtitle: {
    fontSize: 12,
    color: '#4B5563',
    fontWeight: '700',
  },
  signOutBtn: {
    backgroundColor: '#E5E7EB',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  signOutText: {
    color: '#1F2937',
    fontWeight: '700',
    fontSize: 12,
  },
  warningPill: {
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
  liveAlertCard: {
    backgroundColor: '#FEF2F2',
    borderColor: '#DC2626',
    borderWidth: 2,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  liveAlertBadge: {
    color: '#991B1B',
    fontWeight: '900',
    fontSize: 13,
  },
  liveAlertTitle: {
    color: '#111827',
    fontWeight: '800',
    fontSize: 14,
  },
  liveAckBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 10,
    gap: 4,
  },
  liveAckCount: {
    fontSize: 14,
    fontWeight: '900',
    color: '#065F46',
  },
  liveAckNames: {
    fontSize: 12,
    color: '#374151',
  },
  liveActions: {
    gap: 8,
  },
  falseAlarmBtn: {
    backgroundColor: '#DC2626',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  falseAlarmBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },
  resolveBtn: {
    backgroundColor: '#1F2937',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  resolveBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },
  panicSection: {
    gap: 10,
  },
  panicButton: {
    backgroundColor: '#DC2626',
    borderRadius: 20,
    paddingVertical: 30,
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
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 15,
    gap: 10,
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
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
  },
  helperText: {
    fontSize: 12,
    color: '#4B5563',
    lineHeight: 18,
  },
  statusDotLarge: {
    width: 14,
    height: 14,
    borderRadius: 999,
  },
  dotGreen: { backgroundColor: '#16A34A' },
  dotRed: { backgroundColor: '#DC2626' },
  smallLinkText: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '700',
  },
  lastEventBox: {
    gap: 2,
  },
  lastEventText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#111827',
  },
  infoExpandedBox: {
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingTop: 10,
  },
  subSection: {
    gap: 4,
  },
  subTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#111827',
  },
  phoneLink: {
    fontSize: 13,
    color: '#1D4ED8',
    fontWeight: '700',
    paddingVertical: 2,
  },
  announcementItem: {
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    padding: 10,
    gap: 4,
  },
  announcementTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#111827',
  },
  testButtonsRow: {
    gap: 9,
  },
  secondaryButton: {
    backgroundColor: '#1F2937',
    borderRadius: 12,
    paddingVertical: 13,
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
  whatsappBtn: {
    backgroundColor: '#16A34A',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  whatsappBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
  },
  simulateButton: {
    backgroundColor: '#FEE2E2',
    borderColor: '#EF4444',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  simulateButtonText: {
    color: '#991B1B',
    fontWeight: '800',
    fontSize: 13,
  },
  deleteAccountBtn: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  deleteAccountText: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '700',
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
