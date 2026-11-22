# Supabase Edge Functions — Alarma Comunitaria (Asociación Bello Horizonte)

Este directorio contiene las Edge Functions en **Deno / TypeScript** encargadas del despacho crítico de alertas de pánico ("Robo en la cuadra") mediante **FCM HTTP v1** (`data-only`, `android.priority = "HIGH"`, `ttl = "90s"`).

## Estructura

- `_shared/fcm.ts`: Cliente FCM HTTP v1 puro en Deno (firma JWT RS256 con Web Crypto API `crypto.subtle`, intercambio OAuth2 en Google, envío paralelo con concurrencia controlada y detección de tokens `UNREGISTERED`).
- `_shared/webhookAuth.ts`: Validación de la cabecera `x-webhook-secret` en tiempo constante contra `WEBHOOK_SECRET`.
- `_shared/supabaseAdmin.ts`: Cliente Supabase administrativo y consultas reutilizables de tokens activos / limpieza de tokens inválidos.
- `dispatch-panic-alert/index.ts`: Disparada en `INSERT` de `public.alerts` (`estado = 'activa'`). Envía `PANIC_ALARM` a todos los miembros activos del grupo **excluyendo al emisor**.
- `stop-panic-alert/index.ts`: Disparada en `UPDATE` de `public.alerts` cuando `estado` cambia de `'activa'` a `'resuelta'` o `'falsa_alarma'`. Envía `STOP_ALARM` a todos los miembros activos del grupo.

---

## 1. Configurar secretos en Supabase

> **Seguridad**: Nunca subas `FIREBASE_SERVICE_ACCOUNT_JSON`, `WEBHOOK_SECRET` ni `SUPABASE_SECRET_KEY` al repositorio.

Genera un secreto fuerte para los Database Webhooks (por ejemplo, 32 bytes aleatorios en hexadecimal) y configura los secretos con la CLI de Supabase:

```bash
# 1) Secreto compartido para autenticar los Database Webhooks
supabase secrets set WEBHOOK_SECRET="<GENERAR_SECRETO_ALEATORIO_LARGO>"

# 2) Clave secreta / service_role de Supabase (SUPABASE_URL es inyectada automáticamente por Supabase)
supabase secrets set SUPABASE_SECRET_KEY="<TU_SUPABASE_SECRET_O_SERVICE_ROLE_KEY>"

# 3) Cuenta de servicio de Firebase (JSON minificado en una sola línea)
supabase secrets set FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n","client_email":"..."}'
```

> Nota: `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` suelen estar disponibles automáticamente en el entorno de Supabase Edge Functions. Si configuras `SUPABASE_SECRET_KEY`, tendrá prioridad sobre `SUPABASE_SERVICE_ROLE_KEY`.

---

## 2. Desplegar las Edge Functions

Las funciones son invocadas por **Database Webhooks** de Supabase autenticados con `x-webhook-secret` (no con JWT de usuario), por lo que se despliegan con `--no-verify-jwt`:

```bash
supabase functions deploy dispatch-panic-alert --no-verify-jwt
supabase functions deploy stop-panic-alert --no-verify-jwt
```

---

## 3. Conectar los 2 Database Webhooks en Supabase

En **Supabase Dashboard → Database → Webhooks → Create a new hook**:

### Webhook 1: `dispatch-panic-alert` (Disparo de Alarma)
- **Name**: `on_alert_insert_dispatch_panic`
- **Table**: `public.alerts`
- **Events**: marcar únicamente **`INSERT`**
- **Type**: `HTTP Request`
- **Method**: `POST`
- **URL**: `https://<PROJECT_REF>.supabase.co/functions/v1/dispatch-panic-alert`
- **HTTP Headers**:
  - `Content-Type`: `application/json`
  - `x-webhook-secret`: `<EL_MISMO_VALOR_DE_WEBHOOK_SECRET>`

### Webhook 2: `stop-panic-alert` (Detención / Falsa Alarma)
- **Name**: `on_alert_update_stop_panic`
- **Table**: `public.alerts`
- **Events**: marcar únicamente **`UPDATE`**
- **Type**: `HTTP Request`
- **Method**: `POST`
- **URL**: `https://<PROJECT_REF>.supabase.co/functions/v1/stop-panic-alert`
- **HTTP Headers**:
  - `Content-Type`: `application/json`
  - `x-webhook-secret`: `<EL_MISMO_VALOR_DE_WEBHOOK_SECRET>`

---

## 4. Ejecutar pruebas unitarias (Deno)

Cuando Deno esté instalado en el entorno local o CI:

```bash
deno test supabase/functions/_shared/
```

Para verificación estricta de tipos:

```bash
deno check supabase/functions/dispatch-panic-alert/index.ts supabase/functions/stop-panic-alert/index.ts
```
