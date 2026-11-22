# Task Board — Asociación Bello Horizonte

> **Regla del Harness**: Ninguna tarea de desarrollo comienza sin un responsable único y criterios de aceptación claros. Mantener actualizado por `project-manager` y el Orquestador.

## Fase Harness — Entorno Multiagente y Diseño Unificado

| ID | Tarea | Responsable | Estado | Dependencias |
| :--- | :--- | :--- | :--- | :--- |
| BH-001 | Crear `AGENTS.md`, reglas (`.agents/rules/`), 9 agentes, skills, hooks y workflow | Orquestador | `DONE` | - |
| BH-002 | Unificar `plan_viabilidad.md` (v3.1) con Portal Web, Supabase y Harness en `docs/` y `.agents/` | `solution-architect` | `DONE` | BH-001 |
| BH-003 | Inicializar Git + `.gitignore` (protegiendo `.env`, `google-services.json`, `*.jks`, `.agents/logs/`) | `devops-engineer` | `DONE` | Aprobación usuario |

---

## Fase 0 — Prototipo Técnico Crítico (Alarma por Altavoz Android)

| ID | Tarea | Responsable | Estado | Dependencias |
| :--- | :--- | :--- | :--- | :--- |
| BH-010 | Crear proyecto base React Native + TypeScript (`android-app/`) con Firebase Messaging y Notifee | `android-developer` | `DONE` | BH-003 + datos Firebase |
| BH-011 | Implementar motor de alarma (`STREAM_ALARM` al máximo, `ForegroundService`, `FullScreenIntent`, `WakeLock`, restauración volumen) | `android-developer` | `DONE` | BH-010 |
| BH-012 | Probar entrega FCM `data-only` `high` en 2 teléfonos Android reales (volumen=0, silencio, pantalla bloqueada, app cerrada) | `qa-engineer` | `TODO` | BH-011 |

---

## Fase 1 — MVP (Supabase + App Android + Portal Web)

| ID | Tarea | Responsable | Estado | Dependencias |
| :--- | :--- | :--- | :--- | :--- |
| BH-020 | Crear migraciones SQL Supabase (`profiles`, `groups`, `memberships`, `alerts`, `alert_acks`, `association_info`, `announcements`) + políticas RLS + trigger cooldown 2 min | `database-engineer` | `DONE` | BH-012 + proyecto Supabase |
| BH-021 | Implementar Edge Functions (`dispatch-panic-alert` y `stop-panic-alert`) + Database Webhooks + limpieza tokens inválidos | `backend-developer` | `DONE` | BH-020 |
| BH-022 | Implementar 8 pantallas MVP en App Android (Unirse por código + Ley 29733, Pendiente, Principal 2s + semáforo permisos, Confirmación 5s, Alarma roja + 105 + "Estoy enterado" 10s, Historial, Admin 2 admins, Permisos guiados) | `android-developer` | `DONE` | BH-020, BH-021 |
| BH-023 | Implementar Portal Web en Vercel/Next.js (Info Asociación Bello Horizonte, comunicados, política de privacidad pública Ley 29733 y consola admin) | `frontend-developer` | `DONE` | BH-020 |
| BH-024 | Añadir botón gratuito "Compartir alerta por WhatsApp" (`wa.me`) y prueba local de alarma en App Android | `android-developer` | `DONE` | BH-022 |
| BH-025 | Ajustes UX/Roles Android: restringir "Probar alarma local" y "Simular alerta" solo a `admin`; menú superior unificado (Login / Permisos / Salir) | `android-developer` | `DONE` | BH-024 |
| BH-026 | Login dual (Correo + Google OAuth) en App Android y Portal Web vía Supabase Auth (`pe.bellohorizonte.alarma://auth-callback`) | `android-developer` + `frontend-developer` | `DONE` | Credenciales Google OAuth en Supabase |

---

## Fase 2 — Robustez, QA en 4 Marcas y Piloto

| ID | Tarea | Responsable | Estado | Dependencias |
| :--- | :--- | :--- | :--- | :--- |
| BH-030 | Ejecutar matriz QA en ≥ 4 marcas (Samsung, Xiaomi, Motorola, Honor/Huawei; Android 11–15): ≥ 90 % entrega < 10 s y 0 falsas alarmas accidentales | `qa-engineer` | `TODO` | BH-022, BH-023 |
| BH-031 | Auditoría independiente de seguridad (RLS, credenciales, Ley 29733, permisos Android) | `code-reviewer` | `TODO` | BH-030 |

---

## Fases 3 a 7 — Expansión y Publicación (Post-MVP)

| ID | Tarea | Responsable | Estado | Dependencias |
| :--- | :--- | :--- | :--- | :--- |
| BH-040 | Fase 3: WhatsApp Cloud API (Meta Business + plantilla Utility) y OTP opcional | `backend-developer` | `TODO` | BH-031 |
| BH-041 | Fase 4: Prueba cerrada Google Play (12 testers × 14 días), ficha y publicación | `devops-engineer` | `TODO` | BH-031 + Aprobación usuario |
| BH-050 | Fase 5: Módulo de Reuniones (convocatoria, recordatorios `pg_cron` en canal normal, asistencia) | `backend-developer` + `android-developer` | `DONE` | BH-041 |
| BH-060 | Fase 6: Actas manuales + PDF imprimible libro legalizado + SHA-256 + conformidades simples | `frontend-developer` + `android-developer` | `DONE` | BH-050 |
| BH-070 | Fase 7: Grabación con consentimiento/notificación visible + transcripción + borrador IA (Faster-Whisper VPS + DeepSeek-V3) | `android-developer` + `backend-developer` | `DONE` | BH-060 |
