import type { Session } from '@supabase/supabase-js';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AdminScreen } from './screens/AdminScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { HomeScreen } from './screens/HomeScreen';
import { JoinScreen } from './screens/JoinScreen';
import { MeetingsScreen } from './screens/MeetingsScreen';
import { PanicAlertScreen } from './screens/PanicAlertScreen';
import { PendingApprovalScreen } from './screens/PendingApprovalScreen';
import { PermissionsGuideScreen } from './screens/PermissionsGuideScreen';
import {
  ensureNotificationChannels,
  getActiveAlarmState,
  rehydrateActiveAlarmState,
  subscribeAlarmState,
} from './services/alarmController';
import {
  canUseAdminTestControls,
  getCurrentSession,
  getDeviceBrandLabel,
  getMyMembershipWithGroup,
  getMyProfile,
  isSyntheticPhoneEmail,
  signOutUser,
  updateMyFcmToken,
} from './services/belloHorizonteApi';
import {
  getFcmToken,
  subscribeFcmTokenRefresh,
  subscribeForegroundFcmMessages,
  subscribeForegroundNotifeeEvents,
} from './services/fcmHandler';
import { getSupabaseClient, isSupabaseConfigured } from './services/supabaseClient';
import type { ActiveAlarmState } from './types/alarm';
import type { MembershipWithGroup, ProfileRecord } from './types/database';

type MainTab = 'home' | 'meetings' | 'history' | 'admin';

function extractUserDisplayName(session: Session | null, profile: ProfileRecord | null): string {
  if (profile?.nombre?.trim()) {
    return profile.nombre.trim();
  }
  const meta = session?.user?.user_metadata as Record<string, unknown> | undefined;
  const candidates = [meta?.full_name, meta?.name, meta?.nombre];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) {
      return c.trim();
    }
  }
  return '';
}

function getAuthProviderLabel(session: Session | null): string {
  const provider = session?.user?.app_metadata?.provider;
  if (provider === 'google') {
    return 'Google OAuth';
  }
  if (isSyntheticPhoneEmail(session?.user?.email)) {
    return 'Celular y contraseña';
  }
  return 'Correo y contraseña';
}

function getAccountContactLabel(session: Session | null, profile: ProfileRecord | null): string {
  const email = session?.user?.email;
  if (isSyntheticPhoneEmail(email)) {
    return profile?.telefono?.trim() || 'Celular registrado';
  }
  return email || profile?.telefono?.trim() || 'Sin correo';
}

export default function App(): React.JSX.Element {
  const [alarmState, setAlarmState] = useState<ActiveAlarmState>(() => getActiveAlarmState());

  const [booting, setBooting] = useState<boolean>(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRecord | null>(null);
  const [membership, setMembership] = useState<MembershipWithGroup | null>(null);
  const [activeTab, setActiveTab] = useState<MainTab>('home');
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [showPermissionsScreen, setShowPermissionsScreen] = useState<boolean>(false);
  const [accountMenuVisible, setAccountMenuVisible] = useState<boolean>(false);

  // 1. Motor de alarma crítica (siempre activo independientemente del login)
  useEffect(() => {
    ensureNotificationChannels().catch((err) => {
      console.warn('[App] Error creando canales Notifee:', err);
    });

    const unsubscribeState = subscribeAlarmState(setAlarmState);
    const unsubscribeFcm = subscribeForegroundFcmMessages();
    const unsubscribeNotifee = subscribeForegroundNotifeeEvents();

    rehydrateActiveAlarmState().catch((err) => {
      console.warn('[App] Error rehidratando estado de alarma:', err);
    });

    return () => {
      unsubscribeState();
      unsubscribeFcm();
      unsubscribeNotifee();
    };
  }, []);

  // 2. Carga de sesión, perfil y membresía en Supabase
  const loadUserContext = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setSession(null);
      setProfile(null);
      setMembership(null);
      setBooting(false);
      return;
    }

    try {
      const current = await getCurrentSession();
      setSession(current);

      if (!current?.user) {
        setProfile(null);
        setMembership(null);
        setShowPermissionsScreen(false);
        setAccountMenuVisible(false);
        return;
      }

      const [myProfile, myMembership] = await Promise.all([
        getMyProfile(current.user.id).catch(() => null),
        getMyMembershipWithGroup(current.user.id).catch(() => null),
      ]);

      setProfile(myProfile);
      setMembership(myMembership);
      setActiveTab((prev) =>
        myMembership?.rol !== 'admin' && prev === 'admin' ? 'home' : prev
      );
    } catch (err) {
      console.warn('[App] Error cargando contexto Supabase:', err);
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    loadUserContext();

    if (!isSupabaseConfigured()) {
      return;
    }

    const supabase = getSupabaseClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setProfile(null);
        setMembership(null);
        setActiveTab('home');
        setShowPermissionsScreen(false);
        setAccountMenuVisible(false);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [loadUserContext]);

  // 3. Sincronización automática de fcm_token vía RPC update_my_fcm_token cuando el miembro está activo
  useEffect(() => {
    if (!session?.user || membership?.estado !== 'activo') {
      return;
    }

    const deviceBrand = getDeviceBrandLabel();

    getFcmToken()
      .then(({ token }) => {
        if (token) {
          return updateMyFcmToken(token, deviceBrand);
        }
        return undefined;
      })
      .catch((err) => {
        console.warn('[App] Error registrando fcm_token en Supabase:', err);
      });

    const unsubscribeRefresh = subscribeFcmTokenRefresh((newToken) => {
      updateMyFcmToken(newToken, deviceBrand).catch((err) => {
        console.warn('[App] Error actualizando fcm_token rotado:', err);
      });
    });

    return () => {
      unsubscribeRefresh();
    };
  }, [session?.user?.id, membership?.estado]);

  const handleSignOutFromMenu = async (): Promise<void> => {
    setAccountMenuVisible(false);
    try {
      await signOutUser();
      await loadUserContext();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'No se pudo cerrar sesión.');
    }
  };

  const isPanicActive = alarmState.alert !== null;

  // Pantalla roja de alarma SIEMPRE tiene prioridad absoluta sobre cualquier vista
  if (isPanicActive) {
    return (
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor="#B91C1C" />
        <PanicAlertScreen
          alarmState={alarmState}
          currentUserId={session?.user?.id ?? null}
        />
      </SafeAreaProvider>
    );
  }

  const renderContent = (): React.JSX.Element => {
    if (!isSupabaseConfigured()) {
      return (
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Falta configuración de Supabase</Text>
          <Text style={styles.errorBody}>
            Define EXPO_PUBLIC_SUPABASE_URL y EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY en
            android-app/.env y reinicia Metro.
          </Text>
        </View>
      );
    }

    if (booting) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#DC2626" />
          <Text style={styles.loadingText}>Cargando Asociación Bello Horizonte...</Text>
        </View>
      );
    }

    const displayName = extractUserDisplayName(session, profile);

    // Pantalla 1: Bienvenida / Unirse (sin sesión o con sesión Google/correo aún sin membresía)
    if (!session?.user || !membership) {
      return (
        <JoinScreen
          signedInEmail={session?.user?.email ?? null}
          initialName={displayName || null}
          onAuthCompleted={loadUserContext}
        />
      );
    }

    // Pantalla 2: Pendiente de aprobación (o suspendido)
    if (membership.estado !== 'activo') {
      return (
        <PendingApprovalScreen
          membership={membership}
          userName={displayName || session.user.email || ''}
          onRefreshStatus={loadUserContext}
          onSignedOut={loadUserContext}
        />
      );
    }

    const isAdmin = canUseAdminTestControls(membership.rol);

    return (
      <SafeAreaView style={styles.mainShell}>
        {/* Encabezado superior unificado con botón de menú de cuenta */}
        <View style={styles.topHeader}>
          <View style={styles.topHeaderInfo}>
            <Text style={styles.topHeaderTitle} numberOfLines={1}>
              {membership.group.nombre}
            </Text>
            <Text style={styles.topHeaderSub} numberOfLines={1}>
              {displayName || 'Vecino'} · {membership.rol.toUpperCase()}
            </Text>
          </View>
          <Pressable
            style={styles.accountMenuTrigger}
            onPress={() => setAccountMenuVisible(true)}
          >
            <Text style={styles.accountMenuTriggerText}>Cuenta ▾</Text>
          </Pressable>
        </View>

        <View style={styles.screenArea}>
          {showPermissionsScreen ? (
            <PermissionsGuideScreen
              isAdmin={isAdmin}
              onBack={() => setShowPermissionsScreen(false)}
            />
          ) : (
            <>
              {activeTab === 'home' && (
                <HomeScreen
                  membership={membership}
                  profile={profile}
                  currentUserId={session.user.id}
                  onOpenHistory={() => setActiveTab('history')}
                  onOpenMeetings={(meetingId) => {
                    if (meetingId) {
                      setSelectedMeetingId(meetingId);
                    }
                    setActiveTab('meetings');
                  }}
                  onSignedOut={loadUserContext}
                />
              )}
              {activeTab === 'meetings' && (
                <MeetingsScreen
                  membership={membership}
                  currentUserId={session.user.id}
                  initialMeetingId={selectedMeetingId}
                  onClearInitialMeetingId={() => setSelectedMeetingId(null)}
                />
              )}
              {activeTab === 'history' && (
                <HistoryScreen
                  membership={membership}
                  currentUserId={session.user.id}
                />
              )}
              {activeTab === 'admin' && isAdmin && (
                <AdminScreen
                  membership={membership}
                  currentUserId={session.user.id}
                />
              )}
            </>
          )}
        </View>

        {/* Barra de navegación inferior: Inicio, Reuniones, Historial y (solo admin) Admin */}
        <View style={styles.tabBar}>
          <TabItem
            label="Inicio"
            active={!showPermissionsScreen && activeTab === 'home'}
            onPress={() => {
              setShowPermissionsScreen(false);
              setActiveTab('home');
            }}
          />
          <TabItem
            label="Reuniones"
            active={!showPermissionsScreen && activeTab === 'meetings'}
            onPress={() => {
              setShowPermissionsScreen(false);
              setActiveTab('meetings');
            }}
          />
          <TabItem
            label="Historial"
            active={!showPermissionsScreen && activeTab === 'history'}
            onPress={() => {
              setShowPermissionsScreen(false);
              setActiveTab('history');
            }}
          />
          {isAdmin && (
            <TabItem
              label="Admin"
              active={!showPermissionsScreen && activeTab === 'admin'}
              onPress={() => {
                setShowPermissionsScreen(false);
                setActiveTab('admin');
              }}
            />
          )}
        </View>

        {/* Menú desplegable / modal unificado de Cuenta y Permisos */}
        <Modal
          visible={accountMenuVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setAccountMenuVisible(false)}
        >
          <Pressable
            style={styles.menuBackdrop}
            onPress={() => setAccountMenuVisible(false)}
          >
            <Pressable style={styles.menuCard} onPress={() => {}}>
              <Text style={styles.menuSectionLabel}>ESTADO DE CUENTA</Text>
              <View style={styles.accountStatusBox}>
                <Text style={styles.accountName}>{displayName || 'Vecino'}</Text>
                <Text style={styles.accountEmail}>
                  {getAccountContactLabel(session, profile)}
                </Text>
                <View style={styles.accountMetaRow}>
                  <View style={styles.sessionActivePill}>
                    <Text style={styles.sessionActiveText}>● Sesión activa</Text>
                  </View>
                  <Text style={styles.accountMetaText}>
                    {membership.rol.toUpperCase()} · {getAuthProviderLabel(session)}
                  </Text>
                </View>
              </View>

              <Pressable
                style={styles.menuOption}
                onPress={() => {
                  setAccountMenuVisible(false);
                  setShowPermissionsScreen(true);
                }}
              >
                <Text style={styles.menuOptionTitle}>⚙️ Permisos de Alarma</Text>
                <Text style={styles.menuOptionSub}>
                  Notificaciones, pantalla completa, batería y guía por marca
                </Text>
              </Pressable>

              <Pressable
                style={[styles.menuOption, styles.menuLogoutOption]}
                onPress={handleSignOutFromMenu}
              >
                <Text style={styles.menuLogoutText}>Cerrar sesión (Desconexión)</Text>
              </Pressable>

              <Pressable
                style={styles.menuCloseBtn}
                onPress={() => setAccountMenuVisible(false)}
              >
                <Text style={styles.menuCloseText}>Cerrar menú</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      </SafeAreaView>
    );
  };

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      {renderContent()}
    </SafeAreaProvider>
  );
}

interface TabItemProps {
  label: string;
  active: boolean;
  onPress: () => void;
}

function TabItem({ label, active, onPress }: TabItemProps): React.JSX.Element {
  return (
    <Pressable style={[styles.tabItem, active && styles.tabItemActive]} onPress={onPress}>
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  mainShell: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  topHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  topHeaderInfo: {
    flex: 1,
    paddingRight: 10,
  },
  topHeaderTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: '#111827',
  },
  topHeaderSub: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4B5563',
  },
  accountMenuTrigger: {
    backgroundColor: '#F3F4F6',
    borderColor: '#D1D5DB',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  accountMenuTriggerText: {
    color: '#111827',
    fontWeight: '800',
    fontSize: 13,
  },
  screenArea: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingVertical: 6,
    paddingHorizontal: 8,
    gap: 6,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  tabItemActive: {
    backgroundColor: '#FEE2E2',
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4B5563',
  },
  tabLabelActive: {
    color: '#991B1B',
    fontWeight: '900',
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-start',
    paddingTop: 64,
    paddingHorizontal: 16,
  },
  menuCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    gap: 12,
    elevation: 8,
  },
  menuSectionLabel: {
    fontSize: 11,
    fontWeight: '900',
    color: '#6B7280',
    letterSpacing: 1,
  },
  accountStatusBox: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 4,
  },
  accountName: {
    fontSize: 16,
    fontWeight: '900',
    color: '#111827',
  },
  accountEmail: {
    fontSize: 13,
    color: '#4B5563',
  },
  accountMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  sessionActivePill: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  sessionActiveText: {
    color: '#166534',
    fontSize: 11,
    fontWeight: '800',
  },
  accountMetaText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4B5563',
  },
  menuOption: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 2,
  },
  menuOptionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1E3A8A',
  },
  menuOptionSub: {
    fontSize: 12,
    color: '#3B82F6',
  },
  menuLogoutOption: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
    alignItems: 'center',
  },
  menuLogoutText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#991B1B',
  },
  menuCloseBtn: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  menuCloseText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6B7280',
  },
  centered: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 10,
  },
  loadingText: {
    fontSize: 14,
    color: '#4B5563',
    fontWeight: '600',
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#991B1B',
    textAlign: 'center',
  },
  errorBody: {
    fontSize: 13,
    color: '#4B5563',
    textAlign: 'center',
    lineHeight: 20,
  },
});
