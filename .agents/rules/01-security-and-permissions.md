# Reglas de Seguridad, Permisos y Protección de Credenciales

Estas reglas definen la política de control del **Agent Harness** para **Asociación Bello Horizonte** (Supabase + Vercel + FCM + React Native Android).

## 1. Matriz de Permisos (Allow / Ask / Deny)

| Operación | Política | Observaciones |
| :--- | :--- | :--- |
| Lectura de archivos del repositorio | **ALLOW** | Automático para todos los agentes. |
| Escritura en archivos de desarrollo (`supabase/`, `web/`, `android-app/`, `docs/`, `tests/`) | **ALLOW** (por alcance de rol) | Cada agente solo escribe en su directorio asignado. |
| Ejecución de linters y pruebas locales | **ALLOW** | Automático en sandbox. |
| Modificaciones de esquema Supabase / políticas RLS / migraciones | **ASK** | Requiere revisión de `database-engineer` + aprobación humana. |
| `git commit` | **ASK** | Solo tras pasar `qa-engineer` y `code-reviewer`. |
| `git push` / merge a `main` | **ASK** | Aprobación obligatoria del usuario. |
| Despliegue a Supabase producción / Vercel / Firebase / Google Play | **ASK** (estricto) | Prohibido ejecutar sin autorización expresa. |
| Eliminación masiva de archivos (`rm -rf`, `Remove-Item -Recurse -Force` fuera de caches) | **DENY** | Bloqueado por `.agents/hooks/safety-guard.ps1`. |
| Exposición o commit de `.env`, `SUPABASE_SERVICE_ROLE_KEY`, `*.jks`, `google-services.json` productivo, `serviceAccountKey.json` | **DENY** | Bloqueado por reglas y hooks. |

## 2. Política de Presets de Antigravity

- **Recomendado**: Modo **Default** o **Auto** con reglas explícitas y hooks activos.
- **Prohibido en ramas productivas**: Modo **Turbo** sin supervisión.

## 3. Protección de Credenciales, RLS y Ley 29733 (Perú)

1. Usar siempre `.env.example` con valores ficticios; nunca versionar `.env`.
2. La clave `SUPABASE_SERVICE_ROLE_KEY` y la cuenta de servicio de **Firebase (FCM HTTP v1)** SOLO pueden existir en secretos de Supabase Edge Functions o variables de entorno privadas de Vercel — **jamás** en la app React Native ni en el bundle cliente de Next.js.
3. Toda tabla expuesta al cliente debe tener **Row Level Security (RLS) habilitado**; nunca dejar tablas públicas sin política explícita.
4. En el Botón de Pánico, aplicar validación en servidor/BD: miembro `activo`, cooldown de **1 alerta cada 2 minutos** por usuario y autoría siempre visible (sin anonimato).
5. Cumplir **Ley 29733 (Perú)**: consentimiento informado al registrarse, política de privacidad pública en el portal web, minimización de datos (ubicación solo al alertar), retención de historial (90 días) y opción de eliminación de cuenta.
