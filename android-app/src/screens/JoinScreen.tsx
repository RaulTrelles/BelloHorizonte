import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const BELLO_HORIZONTE_BANNER = require('../../assets/images/bello-horizonte-banner.png');
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  getLastGoogleEmail,
  isSyntheticPhoneEmail,
  joinGroupByCode,
  normalizePeruPhoneDigits,
  resolveAuthEmail,
  signInWithEmail,
  signInWithGoogle,
  signOutUser,
  signUpWithEmail,
} from '../services/belloHorizonteApi';

type AuthMode = 'login' | 'join';

const MIN_PASSWORD_LENGTH = 8;

interface JoinScreenProps {
  /** Si el usuario ya inició sesión (ej. con Google o celular) pero aún no tiene membresía */
  signedInEmail?: string | null;
  /** Nombre prellenado desde el perfil de Google OAuth o perfil existente */
  initialName?: string | null;
  onAuthCompleted: () => Promise<void>;
}

export function JoinScreen({
  signedInEmail,
  initialName,
  onAuthCompleted,
}: JoinScreenProps): React.JSX.Element {
  const isJoinOnly = Boolean(signedInEmail);
  // Pestaña por defecto: "Ya tengo cuenta" (izquierda)
  const [mode, setMode] = useState<AuthMode>('login');

  const [loginIdentifier, setLoginIdentifier] = useState<string>('');
  const [optionalEmail, setOptionalEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [codigo, setCodigo] = useState<string>('');
  const [nombre, setNombre] = useState<string>(initialName?.trim() ?? '');
  const [telefono, setTelefono] = useState<string>('+51 ');
  const [direccionLote, setDireccionLote] = useState<string>('');
  const [consentimiento, setConsentimiento] = useState<boolean>(false);

  const [submitting, setSubmitting] = useState<boolean>(false);
  const [googleLoading, setGoogleLoading] = useState<boolean>(false);
  const [lastGoogleEmail, setLastGoogleEmail] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getLastGoogleEmail().then((saved) => {
      if (active) {
        setLastGoogleEmail(saved);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (initialName && !nombre.trim()) {
      setNombre(initialName.trim());
    }
  }, [initialName, nombre]);

  const handleGoogleSignIn = async (forceSelectAccount = false): Promise<void> => {
    setErrorMsg(null);
    setGoogleLoading(true);
    try {
      const result = await signInWithGoogle({ forceSelectAccount });
      if (!result.cancelled) {
        const updatedEmail = await getLastGoogleEmail();
        setLastGoogleEmail(updatedEmail);
        await onAuthCompleted();
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'No se pudo iniciar sesión con Google. Intenta nuevamente.'
      );
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleSubmit = async (): Promise<void> => {
    setErrorMsg(null);

    if (!isJoinOnly && mode === 'login') {
      if (!loginIdentifier.trim() || !password) {
        setErrorMsg('Ingresa tu correo electrónico o número de celular y tu contraseña.');
        return;
      }
      setSubmitting(true);
      try {
        await signInWithEmail(loginIdentifier, password);
        await onAuthCompleted();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'No se pudo iniciar sesión.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Validaciones para "Unirme con código" / completar ingreso a cuadra
    if (!codigo.trim()) {
      setErrorMsg('Ingresa el código de invitación de tu cuadra (ej. BH-2026).');
      return;
    }
    if (!nombre.trim()) {
      setErrorMsg('Ingresa tu nombre completo (la autoría es visible en alertas).');
      return;
    }

    let normalizedDigits = '';
    try {
      normalizedDigits = normalizePeruPhoneDigits(telefono);
    } catch (phoneErr) {
      setErrorMsg(
        phoneErr instanceof Error
          ? phoneErr.message
          : 'Ingresa un número de celular válido (Perú +51).'
      );
      return;
    }

    const trimmedOptionalEmail = optionalEmail.trim();
    if (!isJoinOnly) {
      if (trimmedOptionalEmail && !trimmedOptionalEmail.includes('@')) {
        setErrorMsg('El correo electrónico ingresado no es válido (o déjalo vacío para entrar con tu celular).');
        return;
      }
      if (password.length < MIN_PASSWORD_LENGTH) {
        setErrorMsg(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
        return;
      }
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
        // Si el vecino dejó vacío el correo, usamos su celular como identificador sintético sin costo SMS
        const authEmail = resolveAuthEmail(trimmedOptionalEmail || normalizedDigits);
        const result = await signUpWithEmail(authEmail, password, nombre);
        if (!result.session) {
          try {
            await signInWithEmail(authEmail, password);
          } catch {
            Alert.alert(
              'Confirma tu cuenta',
              trimmedOptionalEmail
                ? 'Te enviamos un enlace de confirmación a tu correo. Luego inicia sesión e ingresa el código de tu cuadra.'
                : 'No se pudo iniciar sesión automáticamente. Verifica tus datos o inicia sesión con tu celular y contraseña.'
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
        telefono: telefono.trim(),
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

  const isBusy = submitting || googleLoading;
  const visibleAccountLabel =
    signedInEmail && !isSyntheticPhoneEmail(signedInEmail)
      ? signedInEmail
      : 'tu cuenta de vecino';

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.heroCoverCard}>
            <Image
              source={BELLO_HORIZONTE_BANNER}
              style={styles.heroCoverImage}
              resizeMode="cover"
              accessibilityLabel="Vista panorámica de Asociación Bello Horizonte"
            />
            <View style={styles.heroCoverOverlay}>
              <Text style={styles.heroCoverBadge}>ASOCIACIÓN BELLO HORIZONTE</Text>
              <Text style={styles.heroCoverTitle}>
                {isJoinOnly
                  ? 'Completar registro a la cuadra'
                  : mode === 'login'
                    ? 'Bienvenido a tu cuadra segura'
                    : 'Únete a la red vecinal'}
              </Text>
            </View>
          </View>

          <View style={styles.brandHeader}>
            <Text style={styles.subtitle}>
              {isJoinOnly
                ? `Sesión iniciada con ${visibleAccountLabel}. Completa tus datos y el código de tu cuadra para solicitar acceso.`
                : mode === 'login'
                  ? 'Inicia sesión para recibir alertas comunitarias y gestionar reuniones.'
                  : 'Regístrate con el código de tu cuadra para solicitar aprobación de la directiva.'}
            </Text>
          </View>

          {!isJoinOnly && (
            <View style={styles.modeTabs}>
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
              <Pressable
                style={[styles.modeTab, mode === 'join' && styles.modeTabActive]}
                onPress={() => {
                  setMode('join');
                  setErrorMsg(null);
                }}
              >
                <Text style={[styles.modeTabText, mode === 'join' && styles.modeTabTextActive]}>
                  Unirme con código
                </Text>
              </Pressable>
            </View>
          )}

          <View style={styles.card}>
            {/* Botón Continuar con Google disponible tanto en Login como en Registro */}
            {!isJoinOnly && (
              <>
                <Pressable
                  style={[styles.googleButton, isBusy && styles.buttonDisabled]}
                  onPress={() => handleGoogleSignIn(false)}
                  disabled={isBusy}
                >
                  {googleLoading ? (
                    <ActivityIndicator color="#111827" />
                  ) : (
                    <Text style={styles.googleButtonText} numberOfLines={1} ellipsizeMode="middle">
                      {lastGoogleEmail
                        ? `G  Continuar como ${lastGoogleEmail}`
                        : 'G  Continuar con Google'}
                    </Text>
                  )}
                </Pressable>

                {lastGoogleEmail && (
                  <Pressable
                    style={styles.switchGoogleLink}
                    onPress={() => handleGoogleSignIn(true)}
                    disabled={isBusy}
                  >
                    <Text style={styles.switchGoogleLinkText}>Cambiar de cuenta Google</Text>
                  </Pressable>
                )}

                <View style={styles.dividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>o con celular / correo</Text>
                  <View style={styles.dividerLine} />
                </View>
              </>
            )}

            {/* Campos de Login ("Ya tengo cuenta") */}
            {!isJoinOnly && mode === 'login' && (
              <>
                <Text style={styles.label}>Correo electrónico o celular</Text>
                <TextInput
                  style={styles.input}
                  value={loginIdentifier}
                  onChangeText={setLoginIdentifier}
                  placeholder="vecino@correo.com o 987654321"
                  keyboardType="default"
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                <Text style={styles.label}>Contraseña</Text>
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder={`Mínimo ${MIN_PASSWORD_LENGTH} caracteres`}
                  secureTextEntry
                />
              </>
            )}

            {/* Campos de Registro ("Unirme con código" o completar registro tras Google) */}
            {(isJoinOnly || mode === 'join') && (
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

                <Text style={styles.label}>Teléfono celular (Perú +51 — obligatorio)</Text>
                <TextInput
                  style={styles.input}
                  value={telefono}
                  onChangeText={setTelefono}
                  placeholder="+51 987 654 321"
                  keyboardType="phone-pad"
                />

                {!isJoinOnly && (
                  <>
                    <Text style={styles.label}>
                      Correo electrónico (opcional — si no tienes, entrarás con tu celular)
                    </Text>
                    <TextInput
                      style={styles.input}
                      value={optionalEmail}
                      onChangeText={setOptionalEmail}
                      placeholder="vecino@correo.com (opcional)"
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />

                    <Text style={styles.label}>Contraseña</Text>
                    <TextInput
                      style={styles.input}
                      value={password}
                      onChangeText={setPassword}
                      placeholder={`Mínimo ${MIN_PASSWORD_LENGTH} caracteres`}
                      secureTextEntry
                    />
                  </>
                )}

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
              style={[styles.primaryButton, isBusy && styles.buttonDisabled]}
              onPress={handleSubmit}
              disabled={isBusy}
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
              <Pressable style={styles.secondaryLink} onPress={handleSignOut} disabled={isBusy}>
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
  heroCoverCard: {
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#0A6EE1',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  heroCoverImage: {
    width: '100%',
    height: 300,
    backgroundColor: '#0A6EE1',
  },
  heroCoverOverlay: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 4,
  },
  heroCoverBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#B91C1C',
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  heroCoverTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  brandHeader: {
    alignItems: 'center',
    gap: 4,
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
    fontSize: 26,
    fontWeight: '900',
    color: '#111827',
    textAlign: 'center',
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
  googleButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  googleButtonText: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '800',
  },
  switchGoogleLink: {
    alignItems: 'center',
    paddingVertical: 2,
  },
  switchGoogleLinkText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#1D4ED8',
    textDecorationLine: 'underline',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E7EB',
  },
  dividerText: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '600',
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
