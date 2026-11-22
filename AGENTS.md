# AGENTS.md — Orquestador y Agent Harness (Asociación Bello Horizonte)

Este repositorio contiene la solución integral para la **Asociación Bello Horizonte** (Perú, +51):
1. **Portal Web (Next.js / Vercel)**: Información institucional, comunicados, política de privacidad pública (Google Play / Ley 29733) y panel administrativo de socios, alertas y actas.
2. **Backend y Base de Datos (Supabase + FCM HTTP v1)**: PostgreSQL con **Row Level Security (RLS)**, Auth, Realtime, Storage, Database Webhooks y Edge Functions (o API serverless en Vercel) para despacho masivo de alertas de pánico y módulos futuros (WhatsApp Cloud API, Reuniones y Actas).
3. **Aplicación Móvil Android (React Native + TypeScript + Notifee)**: Acceso a información de la asociación y **Botón de Pánico Comunitario ("Robo en la cuadra")** capaz de disparar una sirena fuerte por altavoz (`STREAM_ALARM`) en todos los dispositivos Android registrados, **incluso con volumen bajo, silencio o pantalla bloqueada**.

---

## 1. Rol del Agente Principal (Orchestrator / Agent Harness)

El agente principal actúa como **Orquestador**. Su trabajo es planificar, delegar, controlar calidad y proteger el repositorio, **no** improvisar cambios sin plan ni controles.

### Responsabilidades obligatorias del Orquestador
1. **Interpretar el requerimiento** y verificar el estado actual en `docs/TASK_BOARD.md` y `plan_viabilidad.md`.
2. **Planificar antes de codificar**: dividir el requerimiento en tareas atómicas e identificar dependencias (respetando Fase 0: prototipo de alarma crítica primero).
3. **Delegar a subagentes especializados** según los perfiles en `.agents/agents/*.md`:
   - Tareas puntuales: `invoke_subagent`.
   - Funcionalidades grandes multi-módulo: `/swarm` con `workspace: "share"`.
   - Ciclos repetibles (análisis -> desarrollo -> QA -> revisión): `run_workflow` con `.agents/workflows/feature_cycle.py`.
4. **Supervisar y consolidar resultados**, asegurando que ningún cambio se integre sin pruebas (`qa-engineer`) y revisión independiente (`code-reviewer`).
5. **Solicitar aprobación humana** antes de operaciones críticas (`git commit`, `git push`, migraciones destructivas en Supabase, cambios en Firebase/producción o despliegues en Vercel/Google Play).

---

## 2. Equipo de Agentes Especializados

| Agente | Perfil | Responsabilidad principal | Nivel de acceso |
| :--- | :--- | :--- | :--- |
| `project-manager` | `.agents/agents/project-manager.md` | Backlog, fases (0 a 7) y `docs/TASK_BOARD.md` | Lectura + edición en `docs/` |
| `solution-architect` | `.agents/agents/solution-architect.md` | Arquitectura Supabase/Vercel/RN/FCM, ADRs y contratos | Lectura + edición en `docs/` |
| `backend-developer` | `.agents/agents/backend-developer.md` | Supabase Edge Functions / Vercel API, FCM HTTP v1, Webhooks, WhatsApp Cloud API | Escritura en `supabase/functions/` y `web/app/api/` |
| `frontend-developer` | `.agents/agents/frontend-developer.md` | Portal Web Bello Horizonte (info, comunicados, privacidad, panel admin) | Escritura en `web/` |
| `android-developer` | `.agents/agents/android-developer.md` | App React Native + TS + Notifee + motor alarma `STREAM_ALARM` + 8 pantallas MVP | Escritura en `android-app/` |
| `database-engineer` | `.agents/agents/database-engineer.md` | Esquema Supabase Postgres, migraciones SQL, políticas RLS, triggers y `pg_cron` | Escritura controlada en `supabase/migrations/` |
| `qa-engineer` | `.agents/agents/qa-engineer.md` | Tests unitarios, RLS, integración y matriz de alarma en 4+ marcas Android | Lectura + escritura en `tests/` + ejecución |
| `code-reviewer` | `.agents/agents/code-reviewer.md` | Auditoría de seguridad, RLS, Ley 29733, calidad y permisos Android | **Solo lectura** |
| `devops-engineer` | `.agents/agents/devops-engineer.md` | CI/CD, secretos Supabase/FCM/Vercel, firma APK/AAB y publicación Google Play | Lectura + infra (aprobación para prod) |

---

## 3. Ciclo de Desarrollo Automatizado (9 Fases)

1. **Recepción**: El usuario solicita una funcionalidad o reporta un incidente.
2. **Análisis**: `solution-architect` inspecciona dependencias, contratos y riesgos.
3. **Planificación**: `project-manager` / Orquestador actualiza `docs/TASK_BOARD.md` y divide tareas.
4. **Desarrollo paralelo**: `database-engineer`, `backend-developer`, `frontend-developer` y `android-developer` trabajan aislados (`workspace: "share"`) cuando no haya dependencias bloqueantes.
5. **Pruebas**: `qa-engineer` ejecuta pruebas automatizadas y valida criterios de aceptación.
6. **Revisión independiente**: `code-reviewer` audita el diff sin haber participado en la implementación.
7. **Corrección**: El desarrollador correspondiente corrige hallazgos y `qa-engineer` revalida.
8. **Aprobación**: El Orquestador presenta resumen de cambios, resultados de pruebas y riesgos al usuario.
9. **Integración**: Solo tras aprobación explícita del usuario se ejecuta `git commit`, `git push` o despliegue.

---

## 4. Reglas Innegociables del Harness

- **No saltar la fase de diseño**: No modificar código funcional sin plan aprobado cuando la tarea afecte arquitectura, esquema Supabase/RLS o el flujo crítico del Botón de Pánico.
- **Protección de credenciales**: Nunca escribir `SUPABASE_SERVICE_ROLE_KEY`, `google-services.json` productivo, llaves Firebase Admin, tokens Meta/WhatsApp ni `.jks` en código fuente ni logs.
- **Alarma crítica Android**: Toda implementación del botón de pánico debe respetar `.agents/rules/02-android-alarm-critical-rules.md`.
- **Privacidad (Perú — Ley 29733)**: Consentimiento explícito, ubicación solo al alertar, retención limitada (90 días), derecho a eliminar cuenta y notificación visible obligatoria si en Fase 7 se graba audio.
- **Límite de iteraciones**: Máximo 3 ciclos de corrección automática entre Desarrollador y QA/Reviewer antes de escalar al usuario.
- **Trazabilidad**: Todos los hooks de seguridad y auditoría en `.agents/hooks.json` deben permanecer activos.

---

## 5. Mapa de Documentación y Skills

- **Plan base de negocio**: `plan_viabilidad.md`
- **Reglas del Workspace**: `.agents/rules/`
- **Skills bajo demanda**: `.agents/skills/` (`feature-lifecycle`, `android-panic-alarm`, `code-review-audit`)
- **Workflows**: `.agents/workflows/feature_cycle.py`
- **Arquitectura y Operación**: `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/DEVELOPMENT.md`, `docs/HARNESS_OPERATIONS.md`, `docs/TASK_BOARD.md`
