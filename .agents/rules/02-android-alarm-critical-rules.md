# Reglas Críticas: Alarma Comunitaria / Botón de Pánico en Android

La función principal de la app de **Asociación Bello Horizonte** (React Native + TypeScript + Notifee) es la alarma **"Robo en la cuadra"**, que debe sonar fuerte por el **altavoz** en todos los celulares Android activos del grupo incluso con volumen bajo, modo silencio, pantalla bloqueada o modo Doze.

Todo agente que diseñe, implemente o pruebe esta funcionalidad **DEBE** cumplir estas reglas técnicas.

## 1. Transporte de Mensajes (Supabase -> FCM HTTP v1)

- **Obligatorio usar mensajes `data-only` con `android.priority = "high"`** y `ttl` corto (ej. `90s`).
  - No enviar bloque `notification` para alertas de pánico, porque en segundo plano Android intercepta la notificación y no ejecuta el manejador local de alarma.
- El flujo es: `INSERT alerts` (`estado = 'activa'`) → Database Webhook de Supabase → Edge Function / Vercel API → FCM HTTP v1 multicast a todos los miembros activos del grupo **excepto el emisor**.
- Al cerrar la alerta (`resuelta` o `falsa_alarma`), enviar evento `data-only` `type: "STOP_ALARM"` para detener la sirena en todos los celulares.
- Separar estrictamente los canales de notificación Android:
  - **Canal de Emergencia (`panic_alarm_channel`)**: importancia máxima, bypass DND si autorizado, full-screen intent.
  - **Canal Normal (`meetings_and_news_channel`)**: para comunicados y recordatorios de reuniones (Fase 5), sin despertar con sirena.

## 2. Reproducción de Alarma con Volumen Bajo / Silencio

- **Stream obligatorio**: `AudioAttributes.USAGE_ALARM` sobre `AudioManager.STREAM_ALARM` (suena aunque el timbre esté en silencio o vibración).
- **Control de volumen** (mediante módulo nativo corto o `react-native-volume-manager`):
  1. Guardar el volumen actual de `STREAM_ALARM` antes de iniciar la sirena.
  2. Elevar `STREAM_ALARM` al máximo (o ≥ 85% configurable) y reproducir en bucle un archivo local de sirena libre de derechos (nunca depender de red para cargar el audio).
  3. Restaurar el volumen original al detener la alarma o expirar el timeout de seguridad.
- **Notifee + Foreground Service + Full-Screen Intent**:
  - Despertar el dispositivo (`WakeLock` con timeout) y mostrar la pantalla roja completa sobre el bloqueo con:
    - Texto: `"¡ALERTA! Robo en la cuadra – [Nombre] avisó a las [hora]"`
    - Ubicación en mapa (si el emisor dio permiso; si no, nombre de la cuadra).
    - Botones: **"Estoy enterado"** (habilitado tras **10 segundos** para evitar cierres accidentales; registra `alert_acks`), **"Silenciar 1 min"**, y **"Llamar 105"** (Serenazgo / PNP Perú).

## 3. Permisos Guiados y Prevención de Falsas Alarmas

- **Semáforo de permisos (verde/rojo)** en pantalla principal + asistente guiado paso a paso para:
  - `POST_NOTIFICATIONS` (Android 13+)
  - `USE_FULL_SCREEN_INTENT` / mostrar sobre pantalla de bloqueo (Android 14+)
  - **Exclusión de optimización de batería** (guía específica para marcas agresivas: **Xiaomi, Huawei/Honor, Samsung, Oppo, Motorola**)
  - Acceso a **No Molestar (DND)** (opcional, recomendado)
- **Anti-abuso en emisor**:
  - Mantener pulsado el botón ALERTA **2 segundos** + pantalla de confirmación `"¿Robo en tu cuadra?"` con **cuenta regresiva de 5 segundos** (Confirmar / Cancelar).
  - Cooldown en servidor/BD: máximo **1 alerta cada 2 minutos** por usuario.
  - Botón **"Cancelar / falsa alarma"** para el emisor/admin que detiene la alarma en todos.
  - Botón de **"Probar alarma local"** para validar volumen y permisos sin alertar a los vecinos.
- **Deduplicación**: Si un dispositivo recibe dos veces el mismo `alertId`, nunca superponer dos audios.
