import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  buildPanicAlertWhatsAppText,
  closePanicAlert,
  getGroupAlertsHistory,
  openWhatsAppShare,
  subscribeToGroupAlertsRealtime,
} from '../services/belloHorizonteApi';
import type { AlertWithDetails, MembershipWithGroup } from '../types/database';

interface HistoryScreenProps {
  membership: MembershipWithGroup;
  currentUserId: string;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusLabel(estado: AlertWithDetails['estado']): string {
  if (estado === 'activa') {
    return 'ACTIVA';
  }
  if (estado === 'falsa_alarma') {
    return 'FALSA ALARMA';
  }
  return 'RESUELTA';
}

export function HistoryScreen({
  membership,
  currentUserId,
}: HistoryScreenProps): React.JSX.Element {
  const [alerts, setAlerts] = useState<AlertWithDetails[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadHistory = useCallback(async (isPullRefresh = false) => {
    if (isPullRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setErrorMsg(null);
    try {
      const list = await getGroupAlertsHistory(membership.group_id, 30);
      setAlerts(list);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo cargar el historial.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [membership.group_id]);

  useEffect(() => {
    loadHistory();
    const unsubscribe = subscribeToGroupAlertsRealtime(membership.group_id, () => {
      loadHistory(true).catch(() => {});
    });
    return () => unsubscribe();
  }, [loadHistory, membership.group_id]);

  const handleCloseAlert = (
    alert: AlertWithDetails,
    estado: 'resuelta' | 'falsa_alarma'
  ): void => {
    const title =
      estado === 'falsa_alarma' ? 'Cancelar / Falsa alarma' : 'Marcar alerta como resuelta';
    const message =
      estado === 'falsa_alarma'
        ? 'Se detendrá la sirena en todos los celulares de la cuadra y se marcará como falsa alarma.'
        : 'Se detendrá la sirena en todos los celulares y se marcará como resuelta.';

    Alert.alert(title, message, [
      { text: 'No', style: 'cancel' },
      {
        text: 'Confirmar',
        style: estado === 'falsa_alarma' ? 'destructive' : 'default',
        onPress: async () => {
          setClosingId(alert.id);
          try {
            await closePanicAlert(alert.id, estado);
            await loadHistory(true);
          } catch (err) {
            Alert.alert(
              'Error',
              err instanceof Error ? err.message : 'No se pudo cerrar la alerta.'
            );
          } finally {
            setClosingId(null);
          }
        },
      },
    ]);
  };

  const handleShareWhatsApp = async (alert: AlertWithDetails): Promise<void> => {
    const timeLabel = new Date(alert.created_at).toLocaleTimeString('es-PE', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const text = buildPanicAlertWhatsAppText({
      groupName: membership.group.nombre,
      senderName: alert.authorName,
      timeLabel,
      lat: alert.lat,
      lng: alert.lng,
    });
    try {
      await openWhatsAppShare(text);
    } catch {
      Alert.alert('WhatsApp no disponible', 'No se pudo abrir WhatsApp en este dispositivo.');
    }
  };

  const isAdmin = membership.rol === 'admin';

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => loadHistory(true)} />
      }
    >
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Historial de Alertas</Text>
          <Text style={styles.subtitle}>
            Retención máx. 90 días (Ley 29733) — {membership.group.nombre}
          </Text>
        </View>
        <Pressable style={styles.refreshBtn} onPress={() => loadHistory(true)}>
          <Text style={styles.refreshBtnText}>Actualizar</Text>
        </Pressable>
      </View>

      {errorMsg && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{errorMsg}</Text>
        </View>
      )}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#DC2626" />
        </View>
      ) : alerts.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Sin alertas registradas</Text>
          <Text style={styles.emptyText}>
            Cuando un vecino active el botón de pánico, aquí aparecerá el evento y quién confirmó
            recepción.
          </Text>
        </View>
      ) : (
        alerts.map((alert) => {
          const enterados = alert.acks.filter((a) => a.tipo_ack === 'enterado');
          const canClose =
            alert.estado === 'activa' && (alert.user_id === currentUserId || isAdmin);

          return (
            <View
              key={alert.id}
              style={[styles.card, alert.estado === 'activa' && styles.cardActive]}
            >
              <View style={styles.rowBetween}>
                <View
                  style={[
                    styles.statusBadge,
                    alert.estado === 'activa'
                      ? styles.badgeRed
                      : alert.estado === 'falsa_alarma'
                      ? styles.badgeAmber
                      : styles.badgeGreen,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusText,
                      alert.estado === 'activa'
                        ? styles.textRed
                        : alert.estado === 'falsa_alarma'
                        ? styles.textAmber
                        : styles.textGreen,
                    ]}
                  >
                    {statusLabel(alert.estado)}
                  </Text>
                </View>
                <Text style={styles.dateText}>{formatDateTime(alert.created_at)}</Text>
              </View>

              <Text style={styles.authorText}>Emitida por: {alert.authorName}</Text>
              <Text style={styles.messageText}>
                {alert.mensaje || '¡ALERTA! Robo en la cuadra'}
              </Text>

              <View style={styles.acksBox}>
                <Text style={styles.acksTitle}>
                  Vecinos enterados ({enterados.length}):
                </Text>
                {enterados.length === 0 ? (
                  <Text style={styles.acksEmpty}>Aún sin confirmaciones "Estoy enterado".</Text>
                ) : (
                  <Text style={styles.acksNames}>
                    {enterados.map((a) => a.userName).join(', ')}
                  </Text>
                )}
              </View>

              <View style={styles.actionsRow}>
                {canClose && (
                  <>
                    <Pressable
                      style={styles.falseAlarmBtn}
                      disabled={closingId === alert.id}
                      onPress={() => handleCloseAlert(alert, 'falsa_alarma')}
                    >
                      <Text style={styles.falseAlarmText}>Cancelar / falsa alarma</Text>
                    </Pressable>
                    <Pressable
                      style={styles.resolveBtn}
                      disabled={closingId === alert.id}
                      onPress={() => handleCloseAlert(alert, 'resuelta')}
                    >
                      <Text style={styles.resolveText}>Marcar resuelta</Text>
                    </Pressable>
                  </>
                )}

                <Pressable
                  style={styles.whatsappBtn}
                  onPress={() => handleShareWhatsApp(alert)}
                >
                  <Text style={styles.whatsappText}>Compartir WhatsApp</Text>
                </Pressable>
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
    paddingBottom: 28,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    color: '#111827',
  },
  subtitle: {
    fontSize: 12,
    color: '#6B7280',
  },
  refreshBtn: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  refreshBtnText: {
    color: '#1D4ED8',
    fontWeight: '700',
    fontSize: 12,
  },
  centered: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  errorText: {
    color: '#991B1B',
    fontSize: 13,
    fontWeight: '700',
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
  },
  emptyText: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardActive: {
    borderColor: '#DC2626',
    borderWidth: 2,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeRed: { backgroundColor: '#FEE2E2' },
  badgeAmber: { backgroundColor: '#FEF3C7' },
  badgeGreen: { backgroundColor: '#DCFCE7' },
  statusText: { fontSize: 11, fontWeight: '900' },
  textRed: { color: '#991B1B' },
  textAmber: { color: '#92400E' },
  textGreen: { color: '#166534' },
  dateText: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '600',
  },
  authorText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
  },
  messageText: {
    fontSize: 13,
    color: '#374151',
  },
  acksBox: {
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    padding: 10,
    gap: 4,
  },
  acksTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1F2937',
  },
  acksEmpty: {
    fontSize: 12,
    color: '#6B7280',
  },
  acksNames: {
    fontSize: 12,
    color: '#065F46',
    fontWeight: '600',
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  falseAlarmBtn: {
    backgroundColor: '#FEE2E2',
    borderColor: '#EF4444',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  falseAlarmText: {
    color: '#991B1B',
    fontSize: 12,
    fontWeight: '800',
  },
  resolveBtn: {
    backgroundColor: '#DCFCE7',
    borderColor: '#16A34A',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  resolveText: {
    color: '#166534',
    fontSize: 12,
    fontWeight: '800',
  },
  whatsappBtn: {
    backgroundColor: '#16A34A',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  whatsappText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
});
