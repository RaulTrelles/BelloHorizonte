# Guía de Publicación en Google Play Console — Asociación Bello Horizonte

Esta guía reúne todos los datos, textos y pasos para publicar **`pe.bellohorizonte.alarma`** en **Google Play Console** (Fase 4).

---

## 1. Artefacto de Producción (AAB Firmado)

- **Archivo a subir**: `android-app/android/app/build/outputs/bundle/release/app-release.aab`
- **ID de paquete**: `pe.bellohorizonte.alarma`
- **Versión inicial de producción**: `versionName = "1.0.0"`, `versionCode = 4`, `targetSdkVersion = 36` (Android 16)
- **Arquitecturas incluidas**: `arm64-v8a` y `armeabi-v7a` (requerido por Google Play 64-bit).

### Respaldo OBLIGATORIO del Upload Keystore
El archivo de firma local **`android-app/keystore/bello-horizonte-upload.jks`** y **`android-app/keystore/key.properties`** están **excluidos de Git** (`.gitignore`).
- **Haz una copia de seguridad inmediata** de ambos archivos en tu almacenamiento privado seguro (ej. Drive privado cifrado o USB de respaldo).
- Toda actualización futura de la app deberá firmarse con este mismo keystore.

---

## 2. Enlaces Públicos Requeridos por Google Play

| Campo en Play Console | URL oficial |
| :--- | :--- |
| **Sitio web** | `https://bellohorizonte.vercel.app` |
| **Política de Privacidad** | `https://bellohorizonte.vercel.app/privacidad` |
| **Condiciones del Servicio** | `https://bellohorizonte.vercel.app/condiciones` |
| **Eliminación de cuenta** | `https://bellohorizonte.vercel.app/privacidad#eliminar-cuenta` |

---

## 3. Declaración de Permisos Sensibles

### A. `USE_FULL_SCREEN_INTENT` (Android 14+)
En **Contenido de la app → Declaración de intent de pantalla completa**:
- **Categoría**: Alarma / alerta de seguridad comunitaria crítica.
- **Justificación (Español)**:
  > *"La función principal de la aplicación es una alarma comunitaria vecinal ('Robo en la cuadra') para los socios de la Asociación Bello Horizonte. Cuando un vecino confirma una emergencia, se envía una alerta de prioridad alta para despertar la pantalla de los demás vecinos registrados y mostrar una pantalla de emergencia con botones para confirmar recepción ('Estoy enterado') y llamar a la Policía Nacional del Perú (105)."*
- **Justification (English — recomendado para revisión más rápida)**:
  > *"The core functionality of this app is a neighborhood emergency panic alarm for verified members of Asociación Bello Horizonte (Peru). When a verified member triggers a confirmed emergency alert, a high-priority alarm wakes other members' devices with a full-screen alert showing who triggered the alarm, a button to acknowledge/stop the siren, and a one-tap button to call Peru's Police emergency line (105)."*

### B. `RECORD_AUDIO` (Grabación voluntaria de actas)
- **Uso**: Exclusivamente cuando un miembro de la directiva (`admin`, `presidente` o `secretario`) pulsa manualmente **"Grabar reunión"** tras aceptar el aviso de consentimiento (Ley N.° 29733), mostrando siempre una notificación visible permanente mientras graba. Nunca graba en segundo plano sin acción explícita ni consentimiento.

---

## 4. Seguridad de los Datos (Data Safety)

| Tipo de dato | ¿Se recopila? | ¿Se comparte con terceros? | Finalidad |
| :--- | :---: | :---: | :--- |
| **Nombre** | Sí (obligatorio) | No se vende ni comparte con anunciantes | Identificación del socio en alertas y actas |
| **Correo electrónico** | Sí (opcional) | No | Inicio de sesión (Correo o Google OAuth) |
| **Número de teléfono** | Sí (obligatorio) | No | Contacto vecinal y acceso sin correo |
| **Ubicación aproximada/precisa** | Opcional (solo al disparar alerta) | No | Mostrar ubicación de la emergencia a los vecinos del grupo |
| **Audio** | Opcional (solo directiva al grabar reunión) | No (se elimina al aprobar acta) | Transcripción y borrador de acta comunitaria |
| **ID de dispositivo (FCM token)** | Sí | Solo transporte push (Firebase FCM) | Entrega de alertas de emergencia en tiempo real |

- **Cifrado en tránsito**: Sí (HTTPS / TLS).
- **Eliminación de cuenta y datos**: Sí, disponible dentro de la app y en `https://bellohorizonte.vercel.app/privacidad`.

---

## 5. Prueba Cerrada (Cuentas Personales Nuevas)

Google Play exige para cuentas personales nuevas:
1. Crear pista **Prueba cerrada (Closed testing)**.
2. Agregar al menos **12 testers** (vecinos con cuenta Google/Android) mediante lista de correos o Google Group.
3. Mantener los **12 testers activos durante 14 días continuos** antes de solicitar acceso a **Producción**.

---

## 6. Cómo Publicar Futuras Actualizaciones

1. En `android-app/app.config.ts`, incrementar `versionCode` en +1 (`2` → `3` → `4`...) y actualizar `version` (`"1.0.1"`, `"1.1.0"`...).
2. Compilar el nuevo bundle firmado desde PowerShell:
   ```powershell
   $env:GRADLE_USER_HOME = "C:\Desarrollo\.gradle"
   cd "c:\Desarrollo\fullstack\Bello Horizonte\android-app"
   npx expo prebuild --platform android --no-install
   cd android
   .\gradlew.bat bundleRelease --no-daemon
   ```
3. Subir `android-app/android/app/build/outputs/bundle/release/app-release.aab` en **Google Play Console → Producción → Crear nueva versión**.
