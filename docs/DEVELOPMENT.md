# Guía de Desarrollo y Roadmap por Fases — Asociación Bello Horizonte

## 1. Estructura Objetivo del Repositorio

```text
Bello Horizonte/
├── AGENTS.md                        # Orquestador y reglas globales (Antigravity)
├── plan_viabilidad.md               # Plan v3.1 de referencia (origen de requerimientos)
├── .agents/
│   ├── hooks.json                   # Hooks de seguridad y auditoría
│   ├── hooks/                       # Scripts PowerShell de control
│   ├── rules/                       # Reglas obligatorias (seguridad, alarma Android, Git)
│   ├── agents/                      # 9 perfiles de subagentes especializados
│   ├── skills/                      # Skills on-demand (progressive disclosure)
│   └── workflows/                   # Dynamic workflows Python (run_workflow)
├── docs/                            # Arquitectura, BD Supabase, operación Harness y Task Board
├── supabase/                        # Migraciones SQL, políticas RLS, Edge Functions (FCM/WA)
├── web/                             # Portal Web Asociación Bello Horizonte (Next.js / Vercel)
├── android-app/                     # App Android (React Native + TypeScript + Notifee)
└── tests/                           # Pruebas de integración, RLS y matriz de alarma
```

---

## 2. Roadmap Unificado por Fases

### Fase 0 — Prototipo de Riesgo Crítico *(1 semana)*
> **Regla de oro**: Reducir el mayor riesgo técnico primero antes de construir pantallas administrativas.
- Prototipo mínimo en **React Native + TypeScript + Notifee + FCM HTTP v1** (`data-only` `high`).
- Validar en **2 teléfonos Android reales** que la sirena suena fuerte por `STREAM_ALARM` con volumen bajo/silencio, pantalla bloqueada y app cerrada.

### Fase 1 — MVP Funcional (App Android + Supabase + Portal Web Base) *(3–4 semanas)*
- Esquema **Supabase** (`profiles`, `groups`, `memberships`, `alerts`, `alert_acks`, `association_info`, `announcements`) + **RLS** + cooldown 2 min.
- Database Webhooks + Edge Functions (`dispatch-panic-alert`, `stop-panic-alert`).
- **App Android (8 pantallas)**: Bienvenida/Unirse por código + consentimiento Ley 29733, Pendiente de aprobación, Principal (botón ALERTA 2s + semáforo permisos + info asociación), Confirmación (5s), Alarma pantalla roja completa ("Estoy enterado" tras 10s, silenciar 1 min, Llamar 105), Historial, Admin (2 admins: titular y suplente), Permisos guiados.
- **Portal Web (Vercel)**: Información institucional de Asociación Bello Horizonte, comunicados, **Política de Privacidad pública** (obligatoria para Google Play / Ley 29733) y consola web de administración.

### Fase 2 — Robustez y Piloto Real *(2 semanas)*
- Guías de exclusión de batería por marca (**Samsung, Xiaomi, Motorola, Honor/Huawei**).
- Matriz de pruebas en Android 11–15 (meta: **≥ 90 % de entrega en < 10 s** con pantalla bloqueada; **0 alertas accidentales** en 1 semana de piloto).
- Piloto con 5–10 vecinos y luego los ~50 de la cuadra/asociación.

### Fase 3 — WhatsApp Cloud API y OTP *(2 semanas)*
- Integración Meta Business + plantilla categoría Utility para vecinos sin la app.
- Opcional: OTP por WhatsApp/SMS en reemplazo o complemento del código de invitación.

### Fase 4 — Publicación en Google Play *(3 semanas — en paralelo al piloto)*
- Pruebas cerradas obligatorias: **12 testers durante 14 días** en cuenta Google Play (ya pagada).
- Revisión de ficha, permisos declarados (`USE_FULL_SCREEN_INTENT`), política de privacidad y eliminación de cuenta.

### Fases 5 a 7 — Módulos Futuros de Asociación (Post-MVP)
- **Fase 5 (2 sem)**: Convocatoria y recordatorios de reuniones (`pg_cron`, canal de notificación normal separado del de alarma) + confirmación de asistencia.
- **Fase 6 (3 sem)**: Editor de actas, exportación PDF imprimible para libro legalizado con hash SHA-256, acuse de recibido y conformidad/firma simple.
- **Fase 7 (4–5 sem)**: Grabación de reunión con *Foreground Service* + notificación visible + consentimiento Ley 29733 + transcripción (Whisper/Google STT) + borrador de acta con IA (Gemini) + borrado automático de audio.

---

## 3. Convenciones de Calidad y Gobernanza
- **Cero código sin diseño aprobado**: toda fase inicia con verificación en `docs/TASK_BOARD.md`.
- **Pruebas obligatorias**: ningún cambio se propone para `git commit` sin validación de `qa-engineer` y veredicto `APPROVED` de `code-reviewer`.
- **Privacidad (Perú — Ley 29733)**: minimizar datos (ubicación solo al disparar alerta), consentimiento explícito, retención limitada (90 días) y derecho a eliminar cuenta.
