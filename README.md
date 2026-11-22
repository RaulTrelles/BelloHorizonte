# Asociación Bello Horizonte — Portal Web + App Android (Alarma Vecinal)

Solución integral para la **Asociación Bello Horizonte** (Perú, `+51`):

1. **App Android (React Native + TypeScript + Notifee + FCM HTTP v1)**: Información de la asociación y **Botón de Pánico Comunitario ("Robo en la cuadra")** con sirena fuerte por altavoz (`STREAM_ALARM`) incluso con volumen bajo, silencio o pantalla bloqueada.
2. **Backend y Base de Datos (100% Supabase)**: PostgreSQL con Row Level Security (RLS), Auth, Realtime, Storage, Database Webhooks y Edge Functions.
3. **Portal Web (Next.js / Vercel)**: Información institucional, comunicados, política de privacidad pública (Ley 29733 / Google Play) y panel administrativo.

## Estructura del Repositorio

- [AGENTS.md](./AGENTS.md) — Orquestador y reglas del Agent Harness (Antigravity).
- `.agents/` — Perfiles de agentes especializados, reglas, skills, hooks de seguridad y workflows.
- `docs/` — Arquitectura ([ARCHITECTURE.md](./docs/ARCHITECTURE.md)), Base de Datos ([DATABASE.md](./docs/DATABASE.md)), Desarrollo ([DEVELOPMENT.md](./docs/DEVELOPMENT.md)), Operación del Harness ([HARNESS_OPERATIONS.md](./docs/HARNESS_OPERATIONS.md)) y Tablero de Tareas ([TASK_BOARD.md](./docs/TASK_BOARD.md)).
- [plan_viabilidad.md](./plan_viabilidad.md) — Plan de viabilidad v3.1 y hoja de ruta (Fases 0 a 7).

## Seguridad

Las credenciales reales nunca se versionan. Copiar `.env.example` a `.env.local` (ignorado por `.gitignore`) y completar las variables localmente.
