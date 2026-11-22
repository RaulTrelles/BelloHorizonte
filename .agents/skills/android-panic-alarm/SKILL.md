---
name: android-panic-alarm
description: >-
  Procedimiento técnico especializado para implementar y verificar la alarma
  vecinal "Robo en la cuadra" en Android (React Native + TypeScript + Notifee +
  FCM HTTP v1 + Supabase) asegurando que suene fuerte por altavoz incluso con
  volumen bajo, silencio, pantalla bloqueada o modo Doze. Usar siempre que se
  trabaje en notificaciones de pánico, audio de alarma o permisos Android.
---

# Skill: Alarma Crítica "Robo en la cuadra" en Android (`android-panic-alarm`)

## Objetivo
Garantizar que al confirmar una alerta en la app de **Asociación Bello Horizonte**, al menos el **90 % de los teléfonos Android activos** del grupo reciban el evento en **< 10 segundos** y reproduzcan una sirena fuerte por altavoz (`STREAM_ALARM`) incluso con volumen bajo, timbre en silencio o pantalla bloqueada.

## Requisitos Técnicos Obligatorios

### 1. Despacho desde Backend (Supabase Edge Function / Vercel API -> FCM HTTP v1)
- Disparo mediante Database Webhook en `INSERT` de `alerts` (`estado = 'activa'`).
- Enviar mensajes **exclusivamente `data-only`** (sin bloque `notification`) con `android.priority = "high"` y `ttl = "90s"`.
- Excluir al emisor de la lista de tokens destinatarios.
- Payload mínimo:
  ```json
  {
    "type": "PANIC_ALARM",
    "alertId": "uuid-v4",
    "groupName": "Asociación Bello Horizonte",
    "senderName": "Nombre del Vecino",
    "timestamp": "2026-11-21T22:00:00Z",
    "lat": "-12.0464",
    "lng": "-77.0428",
    "message": "¡ALERTA! Robo en la cuadra"
  }
  ```
- Al actualizar `alerts.estado` a `resuelta` o `falsa_alarma`, enviar evento `data-only` `type: "STOP_ALARM"` con `alertId`.

### 2. Recepción y Foreground Service (React Native + Notifee)
- Registrar `messaging().setBackgroundMessageHandler(...)` en el punto de entrada (`index.js`) para recibir mensajes con la app en segundo plano o cerrada.
- Al recibir `PANIC_ALARM`:
  1. Deduplicar por `alertId` y verificar que no haya expirado su TTL.
  2. Iniciar **Foreground Service** con **Notifee** en canal `panic_alarm_channel` (`AndroidImportance.HIGH`, `AndroidCategory.ALARM`, `fullScreenAction` apuntando a la pantalla de alarma roja).
  3. Mantener `WakeLock` con timeout de seguridad.

### 3. Reproducción de Sirena sobre Volumen Bajo / Silencio
- Reproducir archivo local de sirena libre de derechos en bucle por **`AudioManager.STREAM_ALARM`** (`AudioAttributes.USAGE_ALARM`).
- Mediante módulo nativo corto (Kotlin/Java bridge en `android/`) o `react-native-volume-manager`:
  1. Guardar el volumen actual de `STREAM_ALARM`.
  2. Subir `STREAM_ALARM` al máximo (100% o ≥ 85%).
  3. Al pulsar **"Estoy enterado"** (habilitado tras **10 s**), **"Silenciar 1 min"** o recibir `STOP_ALARM`: detener bucle, **restaurar volumen original**, cerrar Foreground Service y liberar `WakeLock`.

### 4. Pantalla de Alerta y Flujo del Emisor
- **Emisor**: Mantener botón ALERTA **2 s** → pantalla de confirmación `"¿Robo en tu cuadra?"` con cuenta regresiva **5 s** → botón posterior **"Cancelar / falsa alarma"** y **"Compartir por WhatsApp"** (`wa.me`).
- **Receptor**: Pantalla roja sobre bloqueo con texto `"¡ALERTA! Robo en la cuadra – [Nombre] avisó a las [hora]"`, mapa (si hay coordenadas), **"Estoy enterado"** (tras 10 s, inserta en `alert_acks`), **"Silenciar 1 min"** y **"Llamar 105"**.

### 5. Permisos Guiados y Matriz de Pruebas
- Semáforo de permisos verde/rojo + guía por marca (**Samsung, Xiaomi, Motorola, Honor/Huawei**) para:
  - Notificaciones (`POST_NOTIFICATIONS`)
  - Pantalla completa (`USE_FULL_SCREEN_INTENT`)
  - Exclusión de optimización de batería (Doze)
  - Acceso a No Molestar (DND)
  - Botón **"Probar alarma local"** (suena 5 s solo en ese celular).

## Verificación Obligatoria (Fase 0 y Fase 2)
1. Probar en **≥ 4 marcas** (Samsung, Xiaomi, Motorola, Honor/Huawei; Android 11–15).
2. Validar escenarios: app abierta, background, cerrada por el usuario, pantalla bloqueada, ahorro de batería, silencio, DND y sin internet breve.
3. Confirmar latencia < 10 s, tasa de entrega ≥ 90 %, cero superposición de audio y restauración exacta del volumen original.
