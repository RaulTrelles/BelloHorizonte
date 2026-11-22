import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  joinGroupByCode,
  signInWithEmail,
  signOutUser,
  signUpWithEmail,
} from '../services/belloHorizonteApi';

type AuthMode = 'register' | 'login';

interface JoinScreenProps {
  /** Si el usuario ya inició sesión pero aún no tiene membresía en ningún grupo */
  signedInEmail?: string | null;
  onAuthCompleted: () => Promise<void>;
}

export function JoinScreen({
  signedInEmail,
  onAuthCompleted,
}: JoinScreenProps): React.JSX.Element {
  const isJoinOnly = Boolean(signedInEmail);
  const [mode, setMode] = useState<AuthMode>('register');

  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [codigo, setCodigo] = useState<string>('BH-2026');
  const [nombre, setNombre] = useState<string>('');
  const [telefono, setTelefono] = useState<string>('+51 ');
  const [direccionLote, setDireccionLote] = useState<string>('');
  const [consentimiento, setConsentimiento] = useState<boolean>(false);

  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (): Promise<void> => {
    setErrorMsg(null);

    if (!isJoinOnly && mode === 'login') {
      if (!email.trim() || !password) {
        setErrorMsg('Ingresa tu correo y contraseña.');
        return;
      }
      setSubmitting(true);
      try {
        await signInWithEmail(email, password);
        await onAuthCompleted();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'No se pudo iniciar sesión.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Validaciones para registro / unirse por código
    if (!isJoinOnly) {
      if (!email.trim() || !email.includes('@')) {
        setErrorMsg('Ingresa un correo electrónico válido.');
        return;
      }
      if (password.length < 6) {
        setErrorMsg('La contraseña debe tener al menos 6 caracteres.');
        return;
      }
    }

    if (!codigo.trim()) {
      setErrorMsg('Ingresa el código de invitación de tu cuadra (ej. BH-2026).');
      return;
    }
    if (!nombre.trim()) {
      setErrorMsg('Ingresa tu nombre completo (la autoría es visible en alertas).');
      return;
    }
    const cleanPhone = telefono.replace(/\s+/g, '');
    if (cleanPhone.length < 9) {
      setErrorMsg('Ingresa un número de teléfono válido (Perú +51).');
      return;
    }
    if (!consentimiento) {
      setErrorMsg(
        'Debes aceptar el consentimiento de protección de datos personales (Ley 29733).'
      );
      return;
    }

    setSubmitting(true);
    try {
      if (!isJoinOnly) {
        const result = await signUpWithEmail(email, password, nombre);
        if (!result.session) {
          // Intentar iniciar sesión automáticamente si el proyecto no exige confirmación de correo
          try {
            await signInWithEmail(email, password);
          } catch {
            Alert.alert(
              'Confirma tu correo',
              'Te enviamos un enlace de confirmación a tu correo. Luego inicia sesión e ingresa el código de tu cuadra.'
            );
            setMode('login');
            setSubmitting(false);
            return;
          }
        }
      }

      await joinGroupByCode({
        codigo,
        nombre,
        telefono,
        consentimiento: true,
        direccionLote,
      });

      await onAuthCompleted();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo completar el registro.';
      if (msg.includes('INVALID_GROUP_CODE')) {
        setErrorMsg('Código de cuadra inválido. Pide el código vigente a un administrador.');
      } else {
        setErrorMsg(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async (): Promise<void> => {
    try {
      await signOutUser();
      await onAuthCompleted();
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'No se pudo cerrar sesión.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.brandHeader}>
            <Text style={styles.brandBadge}>ASOCIACIÓN BELLO HORIZONTE</Text>
            <Text style={styles.title}>Alarma Vecinal</Text>
            <Text style={styles.subtitle}>
              {isJoinOnly
                ? `Sesión activa (${signedInEmail}). Únete a tu cuadra con el código de invitación.`
                : 'Protección comunitaria contra robos en la cuadra (Perú, +51).'}
            </Text>
          </View>

          {!isJoinOnly && (
            <View style={styles.modeTabs}>
              <Pressable
                style={[styles.modeTab, mode === 'register' && styles.modeTabActive]}
                onPress={() => {
                  setMode('register');
                  setErrorMsg(null);
                }}
              >
                <Text style={[styles.modeTabText, mode === 'register' && styles.modeTabTextActive]}>
                  Unirme con código
                </Text>
              </Pressable>
              <Pressable
                style={[styles.modeTab, mode === 'login' && styles.modeTabActive]}
                onPress={() => {
                  setMode('login');
                  setErrorMsg(null);
                }}
              >
                <Text style={[styles.modeTabText, mode === 'login' && styles.modeTabTextActive]}>
                  Ya tengo cuenta
                </Text>
              </Pressable>
            </View>
          )}

          <View style={styles.card}>
            {!isJoinOnly && (
              <>
                <Text style={styles.label}>Correo electrónico</Text>
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="vecino@correo.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                <Text style={styles.label}>Contraseña</Text>
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Mínimo 6 caracteres"
                  secureTextEntry
                />
              </>
            )}

            {(isJoinOnly || mode === 'register') && (
              <>
                <Text style={styles.label}>Código de invitación de cuadra</Text>
                <TextInput
                  style={[styles.input, styles.codeInput]}
                  value={codigo}
                  onChangeText={(t) => setCodigo(t.toUpperCase())}
                  placeholder="Ej. BH-2026"
                  autoCapitalize="characters"
                  autoCorrect={false}
                />

                <Text style={styles.label}>Nombre completo (visible en alertas)</Text>
                <TextInput
                  style={styles.input}
                  value={nombre}
                  onChangeText={setNombre}
                  placeholder="Ej. María Pérez López"
                  autoCapitalize="words"
                />

                <Text style={styles.label}>Teléfono celular (Perú +51)</Text>
                <TextInput
                  style={styles.input}
                  value={telefono}
                  onChangeText={setTelefono}
                  placeholder="+51 999 888 777"
                  keyboardType="phone-pad"
                />

                <Text style={styles.label}>Manzana / Lote o Casa (opcional)</Text>
                <TextInput
                  style={styles.input}
                  value={direccionLote}
                  onChangeText={setDireccionLote}
                  placeholder="Ej. Mz. B Lt. 14"
                />

                <Pressable
                  style={styles.consentRow}
                  onPress={() => setConsentimiento((prev) => !prev)}
                >
                  <View style={[styles.checkbox, consentimiento && styles.checkboxChecked]}>
                    {consentimiento && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                  <Text style={styles.consentText}>
                    Acepto el tratamiento de mis datos personales conforme a la{' '}
                    <Text style={styles.bold}>Ley 29733 (Perú)</Text>: mi nombre se mostrará a mis
                    vecinos al emitir o confirmar una alerta, mi ubicación solo se comparte al
                    alertar, el historial se retiene máx. 90 días y puedo eliminar mi cuenta en
                    cualquier momento.
                  </Text>
                </Pressable>
              </>
            )}

            {errorMsg && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            )}

            <Pressable
              style={[styles.primaryButton, submitting && styles.buttonDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {isJoinOnly
                    ? 'Solicitar ingreso a la cuadra'
                    : mode === 'login'
                    ? 'Iniciar sesión'
                    : 'Registrarme y solicitar ingreso'}
                </Text>
              )}
            </Pressable>

            {isJoinOnly && (
              <Pressable style={styles.secondaryLink} onPress={handleSignOut}>
                <Text style={styles.secondaryLinkText}>Cerrar sesión</Text>
              </Pressable>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  scrollContent: {
    padding: 18,
    gap: 16,
    paddingBottom: 36,
  },
  brandHeader: {
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  brandBadge: {
    backgroundColor: '#FEE2E2',
    color: '#991B1B',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#111827',
  },
  subtitle: {
    fontSize: 13,
    color: '#4B5563',
    textAlign: 'center',
    lineHeight: 19,
  },
  modeTabs: {
    flexDirection: 'row',
    backgroundColor: '#E5E7EB',
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 9,
    alignItems: 'center',
  },
  modeTabActive: {
    backgroundColor: '#FFFFFF',
  },
  modeTabText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4B5563',
  },
  modeTabTextActive: {
    color: '#111827',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    gap: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1F2937',
    marginTop: 4,
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    color: '#111827',
  },
  codeInput: {
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  consentRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
    alignItems: 'flex-start',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#9CA3AF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: '#DC2626',
    borderColor: '#DC2626',
  },
  checkmark: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 14,
  },
  consentText: {
    flex: 1,
    fontSize: 12,
    color: '#374151',
    lineHeight: 17,
  },
  bold: {
    fontWeight: '800',
    color: '#111827',
  },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  errorText: {
    color: '#991B1B',
    fontSize: 13,
    fontWeight: '700',
  },
  primaryButton: {
    backgroundColor: '#DC2626',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 6,
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
  },
  secondaryLink: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  secondaryLinkText: {
    color: '#4B5563',
    fontSize: 13,
    fontWeight: '700',
  },
});
