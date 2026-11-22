import React, { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  formatAlertHeadline,
  formatAlertTime,
  silenceAlarmForOneMinute,
  stopPanicAlarm,
} from '../services/alarmController';
import {
  acknowledgeAlert,
  buildPanicAlertWhatsAppText,
  openWhatsAppShare,
} from '../services/belloHorizonteApi';
import type { ActiveAlarmState } from '../types/alarm';

const ACK_LOCK_SECONDS = 10;

interface PanicAlertScreenProps {
  alarmState: ActiveAlarmState;
  currentUserId?: string | null;
}

export function PanicAlertScreen({
  alarmState,
  currentUserId,
}: PanicAlertScreenProps): React.JSX.Element | null {
  const alert = alarmState.alert;
  const [ackCountdown, setAckCountdown] = useState<number>(ACK_LOCK_SECONDS);
  const [silenceRemainingSec, setSilenceRemainingSec] = useState<number>(0);

  useEffect(() => {
    if (!alert) {
      return;
    }

    const computeRemainingAck = (): number => {
      const startedAt = alarmState.startedAtMs ?? Date.now();
      const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
      return Math.max(0, ACK_LOCK_SECONDS - elapsedSec);
    };

    const initialRemaining = computeRemainingAck();
    setAckCountdown(initialRemaining);
    if (initialRemaining <= 0) {
      return;
    }

    const interval = setInterval(() => {
      const remaining = computeRemainingAck();
      setAckCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 250);

    return () => clearInterval(interval);
  }, [alert?.alertId, alarmState.startedAtMs]);

  useEffect(() => {
    if (!alarmState.isSilenced || !alarmState.silencedUntilMs) {
      setSilenceRemainingSec(0);
      return;
    }

    const updateSilence = (): void => {
      const remaining = Math.max(
        0,
        Math.ceil(((alarmState.silencedUntilMs ?? 0) - Date.now()) / 1000)
      );
      setSilenceRemainingSec(remaining);
    };

    updateSilence();
    const interval = setInterval(updateSilence, 500);
    return () => clearInterval(interval);
  }, [alarmState.isSilenced, alarmState.silencedUntilMs]);

  if (!alert) {
    return null;
  }

  const canAcknowledge = ackCountdown <= 0;
  const headline = formatAlertHeadline(alert);
  const hasCoordinates = Boolean(alert.lat && alert.lng);

  const handleAcknowledge = async (): Promise<void> => {
    if (!canAcknowledge) {
      return;
    }
    if (currentUserId && !alert.isTest) {
      // Registrar "enterado" en Supabase sin bloquear el apagado de la sirena si falla la red
      acknowledgeAlert(alert.alertId, currentUserId, 'enterado').catch((err) => {
        console.warn('[PanicAlertScreen] Error registrando alert_ack enterado:', err);
      });
    }
    await stopPanicAlarm(alert.alertId);
  };

  const handleSilenceOneMinute = async (): Promise<void> => {
    if (currentUserId && !alert.isTest) {
      acknowledgeAlert(alert.alertId, currentUserId, 'silenciado_1m').catch((err) => {
        console.warn('[PanicAlertScreen] Error registrando alert_ack silenciado_1m:', err);
      });
    }
    await silenceAlarmForOneMinute();
  };

  const handleCall105 = async (): Promise<void> => {
    try {
      await Linking.openURL('tel:105');
    } catch {
      Alert.alert(
        'No se pudo abrir el marcador',
        'Marca manualmente al 105 (Policía Nacional / Serenazgo).'
      );
    }
  };

  const handleOpenMap = async (): Promise<void> => {
    if (!alert.lat || !alert.lng) {
      return;
    }
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${alert.lat},${alert.lng}`
    )}`;
    try {
      await Linking.openURL(mapsUrl);
    } catch {
      Alert.alert(
        'No se pudo abrir el mapa',
        `Coordenadas reportadas: ${alert.lat}, ${alert.lng}`
      );
    }
  };

  const handleShareWhatsApp = async (): Promise<void> => {
    const text = buildPanicAlertWhatsAppText({
      groupName: alert.groupName || 'Asociación Bello Horizonte',
      senderName: alert.senderName,
      timeLabel: formatAlertTime(alert.timestamp),
      lat: alert.lat,
      lng: alert.lng,
    });
    try {
      await openWhatsAppShare(text);
    } catch {
      Alert.alert('WhatsApp no disponible', 'No se pudo abrir WhatsApp en este dispositivo.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {alert.isTest ? 'SIMULACIÓN DE EMERGENCIA' : 'EMERGENCIA VECINAL ACTIVA'}
          </Text>
        </View>

        <Text style={styles.headline}>{headline}</Text>

        <View style={styles.infoCard}>
          <Text style={styles.groupName}>{alert.groupName || 'Asociación Bello Horizonte'}</Text>
          {hasCoordinates ? (
            <>
              <Text style={styles.locationText}>
                Ubicación reportada: {alert.lat}, {alert.lng}
              </Text>
              <Pressable style={styles.mapButton} onPress={handleOpenMap}>
                <Text style={styles.mapButtonText}>Ver ubicación en el mapa</Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.locationText}>
              Sin coordenadas GPS — revisar inmediaciones de la cuadra.
            </Text>
          )}
        </View>

        {alarmState.isSilenced && (
          <View style={styles.silenceBanner}>
            <Text style={styles.silenceBannerText}>
              Sirena silenciada temporalmente ({silenceRemainingSec}s). Se reanudará si no confirmas.
            </Text>
          </View>
        )}

        <View style={styles.actions}>
          <Pressable
            style={[
              styles.ackButton,
              !canAcknowledge && styles.ackButtonDisabled,
            ]}
            disabled={!canAcknowledge}
            onPress={handleAcknowledge}
          >
            <Text
              style={[
                styles.ackButtonText,
                !canAcknowledge && styles.ackButtonTextDisabled,
              ]}
            >
              {canAcknowledge
                ? 'Estoy enterado'
                : `Estoy enterado (${ackCountdown}s)`}
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.silenceButton,
              alarmState.isSilenced && styles.silenceButtonActive,
            ]}
            onPress={handleSilenceOneMinute}
          >
            <Text style={styles.silenceButtonText}>
              {alarmState.isSilenced
                ? `Silenciado (${silenceRemainingSec}s)`
                : 'Silenciar 1 min'}
            </Text>
          </Pressable>

          <View style={styles.secondaryRow}>
            <Pressable style={styles.callButton} onPress={handleCall105}>
              <Text style={styles.callButtonText}>Llamar 105</Text>
            </Pressable>
            <Pressable style={styles.whatsappButton} onPress={handleShareWhatsApp}>
              <Text style={styles.whatsappButtonText}>WhatsApp</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#B91C1C',
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 24,
    justifyContent: 'space-between',
  },
  badge: {
    alignSelf: 'center',
    backgroundColor: '#7F1D1D',
    borderColor: '#FCA5A5',
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
  },
  badgeText: {
    color: '#FEF2F2',
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 1,
  },
  headline: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '900',
    textAlign: 'center',
    lineHeight: 36,
    marginVertical: 12,
  },
  infoCard: {
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    gap: 8,
  },
  groupName: {
    color: '#FEE2E2',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  locationText: {
    color: '#FECACA',
    fontSize: 14,
    textAlign: 'center',
  },
  mapButton: {
    marginTop: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  mapButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  silenceBanner: {
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    padding: 12,
  },
  silenceBannerText: {
    color: '#92400E',
    fontWeight: '700',
    textAlign: 'center',
    fontSize: 13,
  },
  actions: {
    gap: 12,
    marginTop: 12,
  },
  ackButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
  },
  ackButtonDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  ackButtonText: {
    color: '#991B1B',
    fontSize: 19,
    fontWeight: '900',
  },
  ackButtonTextDisabled: {
    color: '#FEE2E2',
  },
  silenceButton: {
    backgroundColor: '#7F1D1D',
    borderWidth: 2,
    borderColor: '#FCA5A5',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  silenceButtonActive: {
    backgroundColor: '#92400E',
    borderColor: '#FDE68A',
  },
  silenceButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: 10,
  },
  callButton: {
    flex: 1,
    backgroundColor: '#111827',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  callButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  whatsappButton: {
    flex: 1,
    backgroundColor: '#15803D',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  whatsappButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
});
