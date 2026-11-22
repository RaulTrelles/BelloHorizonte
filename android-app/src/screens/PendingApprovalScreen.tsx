import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { deleteMyAccount, signOutUser } from '../services/belloHorizonteApi';
import type { MembershipWithGroup } from '../types/database';

interface PendingApprovalScreenProps {
  membership: MembershipWithGroup;
  userName: string;
  onRefreshStatus: () => Promise<void>;
  onSignedOut: () => Promise<void>;
}

export function PendingApprovalScreen({
  membership,
  userName,
  onRefreshStatus,
  onSignedOut,
}: PendingApprovalScreenProps): React.JSX.Element {
  const [checking, setChecking] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);

  const isSuspended = membership.estado === 'suspendido';

  const handleCheckStatus = async (): Promise<void> => {
    setChecking(true);
    try {
      await onRefreshStatus();
    } finally {
      setChecking(false);
    }
  };

  const handleSignOut = async (): Promise<void> => {
    setBusy(true);
    try {
      await signOutUser();
      await onSignedOut();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'No se pudo cerrar sesión.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteAccount = (): void => {
    Alert.alert(
      'Eliminar mi cuenta (Ley 29733)',
      'Se eliminará permanentemente tu cuenta, perfil y solicitud de membresía. Esta acción no se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar definitivamente',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await deleteMyAccount();
              await onSignedOut();
            } catch (err) {
              Alert.alert(
                'Error',
                err instanceof Error ? err.message : 'No se pudo eliminar la cuenta.'
              );
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <View style={[styles.badge, isSuspended ? styles.badgeRed : styles.badgeAmber]}>
          <Text style={[styles.badgeText, isSuspended ? styles.badgeTextRed : styles.badgeTextAmber]}>
            {isSuspended ? 'ACCESO SUSPENDIDO' : 'PENDIENTE DE APROBACIÓN'}
          </Text>
        </View>

        <Text style={styles.title}>
          {isSuspended ? 'Tu acceso fue suspendido' : `Hola, ${userName || 'vecino'}`}
        </Text>

        <Text style={styles.description}>
          {isSuspended
            ? `Un administrador de ${membership.group.nombre} suspendió tu membresía. Comunícate con la directiva de tu cuadra si crees que es un error.`
            : `Tu solicitud para unirte a ${membership.group.nombre} fue enviada correctamente. Uno de los administradores de tu cuadra verificará tus datos y aprobará tu ingreso.`}
        </Text>

        <Pressable
          style={[styles.primaryButton, checking && styles.disabled]}
          onPress={handleCheckStatus}
          disabled={checking || busy}
        >
          {checking ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryButtonText}>Verificar estado ahora</Text>
          )}
        </Pressable>

        <Pressable
          style={styles.secondaryButton}
          onPress={handleSignOut}
          disabled={busy}
        >
          <Text style={styles.secondaryButtonText}>Cerrar sesión</Text>
        </Pressable>

        <Pressable
          style={styles.dangerLink}
          onPress={handleDeleteAccount}
          disabled={busy}
        >
          <Text style={styles.dangerLinkText}>Eliminar mi cuenta (Ley 29733)</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    gap: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  badge: {
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
  },
  badgeAmber: {
    backgroundColor: '#FEF3C7',
  },
  badgeRed: {
    backgroundColor: '#FEE2E2',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  badgeTextAmber: {
    color: '#92400E',
  },
  badgeTextRed: {
    color: '#991B1B',
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    color: '#111827',
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    color: '#4B5563',
    textAlign: 'center',
    lineHeight: 21,
  },
  primaryButton: {
    backgroundColor: '#1D4ED8',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  disabled: {
    opacity: 0.65,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
  },
  secondaryButton: {
    backgroundColor: '#E5E7EB',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#1F2937',
    fontWeight: '800',
    fontSize: 14,
  },
  dangerLink: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  dangerLinkText: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '700',
  },
});
