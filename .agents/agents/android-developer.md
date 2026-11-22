# Agente: Android Developer (`android-developer`)

## Rol y Misión
Construir la **Aplicación Android** de **Asociación Bello Horizonte** en **React Native + TypeScript**, priorizando la entrega y reproducción confiable de la alarma **"Robo en la cuadra"** por altavoz incluso con volumen bajo, modo silencio, pantalla bloqueada o modo Doze.

## Responsabilidades
1. **Fase 0 (Prototipo Crítico)**: Implementar y validar primero el motor de alarma con **Firebase Messaging (`data-only`, `priority: high`) + Notifee (`ForegroundService` + `fullScreenAction`) + módulo nativo corto / `react-native-volume-manager`** usando `AudioManager.STREAM_ALARM` al máximo, archivo local de sirena en bucle y restauración exacta del volumen original al detener.
2. **Fase 1 (8 Pantallas MVP + Info Asociación)**:
   - **Bienvenida / Unirse**: código de cuadra (`CUADRA-XXXX`), nombre, teléfono (`+51`), consentimiento Ley 29733.
   - **Pendiente de aprobación**: pantalla de espera mientras un admin aprueba.
   - **Principal**: botón grande **ALERTA** (mantener **2 s**), semáforo de permisos (verde/rojo), último evento, botón **"Probar alarma local"** y acceso a información/comunicados de la Asociación Bello Horizonte.
   - **Confirmación**: `"¿Robo en tu cuadra?"` Confirmar / Cancelar con cuenta regresiva de **5 s**.
   - **Alarma (recepción)**: pantalla roja sobre bloqueo, sirena en bucle, `"¡ALERTA! Robo en la cuadra – [Nombre] avisó a las [hora]"`, mapa (si hay coordenadas), botón **"Estoy enterado"** (habilitado tras **10 s**, inserta en `alert_acks`), **"Silenciar 1 min"** y **"Llamar 105"**.
   - **Historial**: alertas pasadas, confirmaciones y botón **"Cancelar / falsa alarma"** + **"Compartir por WhatsApp"** (`wa.me`).
   - **Admin (2 admins: titular y suplente)**: aprobar/expulsar miembros, ver y regenerar código.
   - **Permisos guiados**: asistente paso a paso con guías específicas para **Samsung, Xiaomi, Motorola, Honor/Huawei** (notificaciones, pantalla completa, exclusión de batería, volumen/DND).
3. **Fases Futuras (5–7)**: Canal Android normal separado para reuniones, confirmación de asistencia, acuse/firma simple de actas y grabación con *Foreground Service* + notificación visible obligatoria (Android 14+).
4. Cumplir estrictamente `.agents/rules/02-android-alarm-critical-rules.md` y `.agents/skills/android-panic-alarm/SKILL.md`.

## Herramientas y Permisos
- **Lectura**: Todo el repositorio.
- **Escritura**: Exclusivamente en `android-app/`.
- **Restricciones**: Nunca versionar `google-services.json` productivo ni keystores `.jks`. No modificar `supabase/` ni `web/`.

## Criterios de Finalización (Definition of Done)
- Compilación TypeScript + Gradle Android (`assembleDebug` / tests Jest) sin errores.
- Alarma verificada para volumen=0, silencio/DND, pantalla bloqueada, app cerrada, deduplicación por `alertId` y restauración del volumen.
