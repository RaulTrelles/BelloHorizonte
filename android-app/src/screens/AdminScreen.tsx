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
  buildInviteWhatsAppText,
  getGroupInviteCode,
  getGroupMembersForAdmin,
  openWhatsAppShare,
  regenerateGroupInviteCode,
  updateMembershipStatus,
} from '../services/belloHorizonteApi';
import type { MembershipWithGroup, MembershipWithProfile } from '../types/database';

interface AdminScreenProps {
  membership: MembershipWithGroup;
  currentUserId: string;
}

export function AdminScreen({
  membership,
  currentUserId,
}: AdminScreenProps): React.JSX.Element {
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [members, setMembers] = useState<MembershipWithProfile[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadAdminData = useCallback(async (isPull = false) => {
    if (isPull) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setErrorMsg(null);
    try {
      const [code, membersList] = await Promise.all([
        getGroupInviteCode(membership.group_id),
        getGroupMembersForAdmin(membership.group_id),
      ]);
      setInviteCode(code);
      setMembers(membersList);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'No se pudieron cargar los datos de administración.'
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [membership.group_id]);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData]);

  const handleRegenerateCode = (): void => {
    Alert.alert(
      'Regenerar código de invitación',
      'El código anterior dejará de funcionar para nuevos registros. Los vecinos ya aprobados no se verán afectados.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Regenerar',
          style: 'destructive',
          onPress: async () => {
            setRegenerating(true);
            try {
              const newCode = await regenerateGroupInviteCode(membership.group_id);
              setInviteCode(newCode);
            } catch (err) {
              Alert.alert(
                'Error',
                err instanceof Error ? err.message : 'No se pudo regenerar el código.'
              );
            } finally {
              setRegenerating(false);
            }
          },
        },
      ]
    );
  };

  const handleShareInviteWhatsApp = async (): Promise<void> => {
    if (!inviteCode) {
      return;
    }
    const text = buildInviteWhatsAppText({
      groupName: membership.group.nombre,
      inviteCode,
    });
    try {
      await openWhatsAppShare(text);
    } catch {
      Alert.alert('WhatsApp no disponible', 'No se pudo abrir WhatsApp en este dispositivo.');
    }
  };

  const handleChangeMemberStatus = async (
    member: MembershipWithProfile,
    nextStatus: 'activo' | 'suspendido'
  ): Promise<void> => {
    if (member.user_id === currentUserId) {
      Alert.alert('Acción no permitida', 'No puedes modificar tu propio estado de administrador.');
      return;
    }
    setBusyId(member.id);
    try {
      await updateMembershipStatus(member.id, nextStatus, currentUserId);
      await loadAdminData(true);
    } catch (err) {
      Alert.alert(
        'Error',
        err instanceof Error ? err.message : 'No se pudo actualizar la membresía.'
      );
    } finally {
      setBusyId(null);
    }
  };

  const pendingMembers = members.filter((m) => m.estado === 'pendiente');
  const otherMembers = members.filter((m) => m.estado !== 'pendiente');

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => loadAdminData(true)} />
      }
    >
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Panel de Administración</Text>
          <Text style={styles.subtitle}>{membership.group.nombre}</Text>
        </View>
        <Pressable style={styles.refreshBtn} onPress={() => loadAdminData(true)}>
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
      ) : (
        <>
          {/* Código de invitación */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Código de Invitación de la Cuadra</Text>
            <Text selectable style={styles.codeDisplay}>
              {inviteCode || '---'}
            </Text>
            <View style={styles.codeActions}>
              <Pressable
                style={styles.whatsappBtn}
                onPress={handleShareInviteWhatsApp}
                disabled={!inviteCode}
              >
                <Text style={styles.whatsappBtnText}>Compartir por WhatsApp</Text>
              </Pressable>
              <Pressable
                style={[styles.regenBtn, regenerating && styles.disabled]}
                onPress={handleRegenerateCode}
                disabled={regenerating}
              >
                <Text style={styles.regenBtnText}>
                  {regenerating ? 'Regenerando...' : 'Regenerar código'}
                </Text>
              </Pressable>
            </View>
          </View>

          {/* Solicitudes pendientes */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              Solicitudes Pendientes ({pendingMembers.length})
            </Text>
            {pendingMembers.length === 0 ? (
              <Text style={styles.emptyText}>No hay solicitudes pendientes de aprobación.</Text>
            ) : (
              pendingMembers.map((member) => (
                <View key={member.id} style={styles.memberRow}>
                  <View style={styles.memberInfo}>
                    <Text style={styles.memberName}>
                      {member.profile?.nombre || 'Vecino sin nombre'}
                    </Text>
                    <Text style={styles.memberMeta}>
                      Tel: {member.profile?.telefono || 'N/A'}
                      {member.profile?.direccion_lote
                        ? ` · ${member.profile.direccion_lote}`
                        : ''}
                    </Text>
                  </View>
                  <View style={styles.memberBtns}>
                    <Pressable
                      style={styles.approveBtn}
                      disabled={busyId === member.id}
                      onPress={() => handleChangeMemberStatus(member, 'activo')}
                    >
                      <Text style={styles.approveBtnText}>Aprobar</Text>
                    </Pressable>
                    <Pressable
                      style={styles.suspendBtn}
                      disabled={busyId === member.id}
                      onPress={() => handleChangeMemberStatus(member, 'suspendido')}
                    >
                      <Text style={styles.suspendBtnText}>Rechazar</Text>
                    </Pressable>
                  </View>
                </View>
              ))
            )}
          </View>

          {/* Miembros activos / suspendidos */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              Miembros del Grupo ({otherMembers.length})
            </Text>
            {otherMembers.map((member) => {
              const isSelf = member.user_id === currentUserId;
              const isActive = member.estado === 'activo';
              return (
                <View key={member.id} style={styles.memberRow}>
                  <View style={styles.memberInfo}>
                    <Text style={styles.memberName}>
                      {member.profile?.nombre || 'Vecino'} {isSelf ? '(Tú)' : ''}
                    </Text>
                    <Text style={styles.memberMeta}>
                      Rol: {member.rol} · Estado: {member.estado}
                      {member.profile?.telefono ? ` · ${member.profile.telefono}` : ''}
                    </Text>
                  </View>
                  {!isSelf && (
                    <Pressable
                      style={isActive ? styles.suspendBtn : styles.approveBtn}
                      disabled={busyId === member.id}
                      onPress={() =>
                        handleChangeMemberStatus(member, isActive ? 'suspendido' : 'activo')
                      }
                    >
                      <Text style={isActive ? styles.suspendBtnText : styles.approveBtnText}>
                        {isActive ? 'Suspender' : 'Reactivar'}
                      </Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 14,
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
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
  },
  codeDisplay: {
    fontSize: 28,
    fontWeight: '900',
    color: '#991B1B',
    textAlign: 'center',
    letterSpacing: 3,
    backgroundColor: '#FEF2F2',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  codeActions: {
    flexDirection: 'row',
    gap: 10,
  },
  whatsappBtn: {
    flex: 1,
    backgroundColor: '#16A34A',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  whatsappBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },
  regenBtn: {
    flex: 1,
    backgroundColor: '#1F2937',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  regenBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },
  disabled: {
    opacity: 0.6,
  },
  emptyText: {
    fontSize: 13,
    color: '#6B7280',
  },
  memberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingTop: 10,
    gap: 8,
  },
  memberInfo: {
    flex: 1,
    gap: 2,
  },
  memberName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
  },
  memberMeta: {
    fontSize: 12,
    color: '#6B7280',
  },
  memberBtns: {
    flexDirection: 'row',
    gap: 6,
  },
  approveBtn: {
    backgroundColor: '#DCFCE7',
    borderColor: '#16A34A',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  approveBtnText: {
    color: '#166534',
    fontSize: 12,
    fontWeight: '800',
  },
  suspendBtn: {
    backgroundColor: '#FEE2E2',
    borderColor: '#EF4444',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  suspendBtnText: {
    color: '#991B1B',
    fontSize: 12,
    fontWeight: '800',
  },
});
