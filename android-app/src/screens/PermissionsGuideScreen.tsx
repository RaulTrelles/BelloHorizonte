import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  checkAllPermissions,
  openBatteryOptimizationSettings,
  openDndSettings,
  openFullScreenIntentSettings,
  requestNotificationPermission,
  triggerLocalTestAlarm,
} from '../services/alarmController';
import type { PermissionStatusMap } from '../types/alarm';

type BrandKey = 'OPPO' | 'Samsung' | 'Xiaomi' | 'Motorola' | 'Honor/Huawei';

const BRAND_GUIDES: Record<BrandKey, string[]> = {
  OPPO: [
    '1. Ajustes → Aplicaciones → Gestión de aplicaciones → Bello Horizonte Alarma → Uso de batería: activar "Permitir actividad en segundo plano" y "Permitir inicio automático".',
    '2. Ajustes → Batería → Más ajustes → Optimizar el uso de batería → Bello Horizonte Alarma → "No optimizar".',
    '3. En Recientes (multitarea), toca los 3 puntos de la app y selecciona "Bloquear" para que ColorOS no la cierre.',
    '4. Activa "Notificaciones" y "Mostrar en pantalla de bloqueo".',
  ],
  Samsung: [
    '1. Ajustes → Aplicaciones → Bello Horizonte Alarma → Batería → seleccionar "No restringido".',
    '2. Ajustes → Cuidado del dispositivo → Batería → Límites de uso en segundo plano → "Aplicaciones nunca inactivas" → agregar Bello Horizonte Alarma.',
    '3. Activa Notificaciones y Acceso a No Molestar para que la sirena suene incluso en silencio.',
  ],
  Xiaomi: [
    '1. Ajustes → Aplicaciones → Administrar aplicaciones → Bello Horizonte Alarma → activar "Inicio automático".',
    '2. En Ahorro de batería → seleccionar "Sin restricciones".',
    '3. En Otros permisos → habilitar "Mostrar en pantalla de bloqueo" y "Mostrar ventanas emergentes al ejecutarse en segundo plano".',
  ],
  Motorola: [
    '1. Ajustes → Aplicaciones → Bello Horizonte Alarma → Batería de la app → seleccionar "Sin restricciones".',
    '2. Ajustes → Batería → Batería adaptable → desactivar si retrasa las notificaciones.',
    '3. Activar Notificaciones y Pantalla completa sobre bloqueo.',
  ],
  'Honor/Huawei': [
    '1. Ajustes → Aplicaciones → Inicio de aplicaciones → buscar Bello Horizonte Alarma → desactivar "Gestionar automáticamente".',
    '2. Activar manualmente: "Inicio automático", "Inicio secundario" y "Ejecutar en segundo plano".',
    '3. En Notificaciones → permitir notificaciones, banners y pantalla de bloqueo.',
  ],
};

const BRANDS: BrandKey[] = ['OPPO', 'Samsung', 'Xiaomi', 'Motorola', 'Honor/Huawei'];

const INITIAL_PERMISSIONS: PermissionStatusMap = {
  notifications: false,
  fullScreenIntent: false,
  batteryOptimizationIgnored: false,
  dndAccess: false,
};

export function PermissionsGuideScreen(): React.JSX.Element {
  const [permissions, setPermissions] = useState<PermissionStatusMap>(INITIAL_PERMISSIONS);
  const [selectedBrand, setSelectedBrand] = useState<BrandKey>('OPPO');
  const [testingAlarm, setTestingAlarm] = useState<boolean>(false);
  const testTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshPermissions = useCallback(async () => {
    const status = await checkAllPermissions();
    setPermissions(status);
  }, []);

  useEffect(() => {
    refreshPermissions();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refreshPermissions();
      }
    });
    return () => {
      sub.remove();
      if (testTimerRef.current) {
        clearTimeout(testTimerRef.current);
      }
    };
  }, [refreshPermissions]);

  const handleLocalTest = async (): Promise<void> => {
    if (testingAlarm) {
      return;
    }
    setTestingAlarm(true);
    try {
      await triggerLocalTestAlarm();
      testTimerRef.current = setTimeout(() => {
        testTimerRef.current = null;
        setTestingAlarm(false);
      }, 5200);
    } catch (err) {
      setTestingAlarm(false);
      Alert.alert(
        'Error en prueba',
        err instanceof Error ? err.message : 'No se pudo probar la sirena local.'
      );
    }
  };

  const allCriticalOk =
    permissions.notifications &&
    permissions.fullScreenIntent &&
    permissions.batteryOptimizationIgnored;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Permisos Guiados</Text>
        <Text style={styles.subtitle}>
          Configura estos permisos para que la alarma suene fuerte incluso con pantalla bloqueada,
          silencio o ahorro de batería.
        </Text>
      </View>

      <View style={[styles.summaryBanner, allCriticalOk ? styles.bannerGreen : styles.bannerRed]}>
        <Text style={[styles.summaryText, allCriticalOk ? styles.textGreen : styles.textRed]}>
          {allCriticalOk
            ? '✅ Permisos críticos activos. Tu celular está listo para recibir alarmas.'
            : '⚠️ Faltan permisos críticos. Configura los puntos en rojo debajo.'}
        </Text>
      </View>

      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>1. Semáforo de Permisos</Text>
          <Pressable onPress={refreshPermissions}>
            <Text style={styles.linkText}>Actualizar</Text>
          </Pressable>
        </View>

        <PermissionStep
          title="Notificaciones (Android 13+)"
          detail="Permite recibir el aviso inmediato de robo en la cuadra."
          granted={permissions.notifications}
          actionLabel="Permitir"
          onPress={async () => {
            await requestNotificationPermission();
            await refreshPermissions();
          }}
        />

        <PermissionStep
          title="Pantalla completa sobre bloqueo"
          detail="Muestra la pantalla roja encima del bloqueo al sonar la alarma."
          granted={permissions.fullScreenIntent}
          actionLabel="Abrir ajustes"
          onPress={openFullScreenIntentSettings}
        />

        <PermissionStep
          title="Excluir optimización de batería"
          detail="Evita que Android (modo Doze) retrase o bloquee la alerta."
          granted={permissions.batteryOptimizationIgnored}
          actionLabel="Excluir"
          onPress={openBatteryOptimizationSettings}
        />

        <PermissionStep
          title="No Molestar / DND (recomendado)"
          detail="Asegura volumen máximo de alarma incluso en modo No Molestar."
          granted={permissions.dndAccess}
          actionLabel="Abrir ajustes"
          onPress={openDndSettings}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>2. Guía por Marca de Celular</Text>
        <View style={styles.brandChips}>
          {BRANDS.map((brand) => (
            <Pressable
              key={brand}
              style={[styles.brandChip, selectedBrand === brand && styles.brandChipActive]}
              onPress={() => setSelectedBrand(brand)}
            >
              <Text
                style={[
                  styles.brandChipText,
                  selectedBrand === brand && styles.brandChipTextActive,
                ]}
              >
                {brand}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.stepsList}>
          {BRAND_GUIDES[selectedBrand].map((step) => (
            <Text key={step} style={styles.stepText}>
              {step}
            </Text>
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>3. Verifica tu Altavoz</Text>
        <Text style={styles.stepText}>
          Pon tu celular en silencio o volumen bajo y pulsa el botón: la sirena sonará 5 segundos
          solo en este teléfono y luego restaurará tu volumen anterior.
        </Text>
        <Pressable
          style={[styles.testButton, testingAlarm && styles.testButtonActive]}
          onPress={handleLocalTest}
          disabled={testingAlarm}
        >
          <Text style={styles.testButtonText}>
            {testingAlarm ? 'Sonando prueba local (5s)...' : 'Probar alarma local (5s)'}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

interface PermissionStepProps {
  title: string;
  detail: string;
  granted: boolean;
  actionLabel: string;
  onPress: () => void | Promise<void>;
}

function PermissionStep({
  title,
  detail,
  granted,
  actionLabel,
  onPress,
}: PermissionStepProps): React.JSX.Element {
  return (
    <View style={styles.stepRow}>
      <View style={[styles.dot, granted ? styles.dotGreen : styles.dotRed]} />
      <View style={styles.stepInfo}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepDetail}>{detail}</Text>
      </View>
      <Pressable style={styles.actionBtn} onPress={onPress}>
        <Text style={styles.actionBtnText}>{granted ? 'OK' : actionLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 14,
    paddingBottom: 28,
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
    lineHeight: 19,
  },
  summaryBanner: {
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
  },
  bannerGreen: {
    backgroundColor: '#ECFDF5',
    borderColor: '#10B981',
  },
  bannerRed: {
    backgroundColor: '#FEF2F2',
    borderColor: '#EF4444',
  },
  summaryText: {
    fontSize: 13,
    fontWeight: '700',
  },
  textGreen: { color: '#065F46' },
  textRed: { color: '#991B1B' },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
  },
  linkText: {
    color: '#2563EB',
    fontWeight: '700',
    fontSize: 13,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingTop: 10,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 999,
  },
  dotGreen: { backgroundColor: '#16A34A' },
  dotRed: { backgroundColor: '#DC2626' },
  stepInfo: {
    flex: 1,
    gap: 2,
  },
  stepTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1F2937',
  },
  stepDetail: {
    fontSize: 12,
    color: '#6B7280',
  },
  actionBtn: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  actionBtnText: {
    color: '#1D4ED8',
    fontSize: 12,
    fontWeight: '800',
  },
  brandChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  brandChip: {
    backgroundColor: '#F3F4F6',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#D1D5DB',
  },
  brandChipActive: {
    backgroundColor: '#111827',
    borderColor: '#111827',
  },
  brandChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#374151',
  },
  brandChipTextActive: {
    color: '#FFFFFF',
  },
  stepsList: {
    gap: 8,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 12,
  },
  stepText: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 19,
  },
  testButton: {
    backgroundColor: '#1F2937',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  testButtonActive: {
    backgroundColor: '#D97706',
  },
  testButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
  },
});
