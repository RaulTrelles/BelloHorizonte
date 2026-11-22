import type { Session } from '@supabase/supabase-js';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
  getCurrentSession,
  getDeviceBrandLabel,
  getMyMembershipWithGroup,
  getMyProfile,
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

type MainTab = 'home' | 'history' | 'permissions' | 'admin';

export default function App(): React.JSX.Element {
  const [alarmState, setAlarmState] = useState<ActiveAlarmState>(() => getActiveAlarmState());

  const [booting, setBooting] = useState<boolean>(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRecord | null>(null);
  const [membership, setMembership] = useState<MembershipWithGroup | null>(null);
  const [activeTab, setActiveTab] = useState<MainTab>('home');

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
        return;
      }

      const [myProfile, myMembership] = await Promise.all([
        getMyProfile(current.user.id).catch(() => null),
        getMyMembershipWithGroup(current.user.id).catch(() => null),
      ]);

      setProfile(myProfile);
      setMembership(myMembership);
      if (myMembership?.rol !== 'admin' && activeTab === 'admin') {
        setActiveTab('home');
      }
    } catch (err) {
      console.warn('[App] Error cargando contexto Supabase:', err);
    } finally {
      setBooting(false);
    }
  }, [activeTab]);

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

    // Pantalla 1: Bienvenida / Unirse (sin sesión o sin membresía)
    if (!session?.user || !membership) {
      return (
        <JoinScreen
          signedInEmail={session?.user?.email ?? null}
          onAuthCompleted={loadUserContext}
        />
      );
    }

    // Pantalla 2: Pendiente de aprobación (o suspendido)
    if (membership.estado !== 'activo') {
      return (
        <PendingApprovalScreen
          membership={membership}
          userName={profile?.nombre || session.user.email || ''}
          onRefreshStatus={loadUserContext}
          onSignedOut={loadUserContext}
        />
      );
    }

    const isAdmin = membership.rol === 'admin';

    return (
      <SafeAreaView style={styles.mainShell}>
        <View style={styles.screenArea}>
          {activeTab === 'home' && (
            <HomeScreen
              membership={membership}
              profile={profile}
              currentUserId={session.user.id}
              onOpenPermissionsGuide={() => setActiveTab('permissions')}
              onOpenHistory={() => setActiveTab('history')}
              onSignedOut={loadUserContext}
            />
          )}
          {activeTab === 'history' && (
            <HistoryScreen
              membership={membership}
              currentUserId={session.user.id}
            />
          )}
          {activeTab === 'permissions' && <PermissionsGuideScreen />}
          {activeTab === 'admin' && isAdmin && (
            <AdminScreen
              membership={membership}
              currentUserId={session.user.id}
            />
          )}
        </View>

        {/* Barra de navegación inferior 100% JS/TS (sin módulos nativos extra) */}
        <View style={styles.tabBar}>
          <TabItem
            label="Inicio"
            active={activeTab === 'home'}
            onPress={() => setActiveTab('home')}
          />
          <TabItem
            label="Historial"
            active={activeTab === 'history'}
            onPress={() => setActiveTab('history')}
          />
          <TabItem
            label="Permisos"
            active={activeTab === 'permissions'}
            onPress={() => setActiveTab('permissions')}
          />
          {isAdmin && (
            <TabItem
              label="Admin"
              active={activeTab === 'admin'}
              onPress={() => setActiveTab('admin')}
            />
          )}
        </View>
      </SafeAreaView>
    );
  };

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor="#F3F4F6" />
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
    fontSize: 12,
    fontWeight: '700',
    color: '#4B5563',
  },
  tabLabelActive: {
    color: '#991B1B',
    fontWeight: '900',
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
