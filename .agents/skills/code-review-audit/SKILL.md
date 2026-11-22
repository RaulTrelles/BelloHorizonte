---
name: code-review-audit
description: >-
  Checklist de auditoría de seguridad, calidad y cumplimiento de reglas para el
  agente code-reviewer (solo lectura) antes de aprobar cambios en Asociación
  Bello Horizonte.
---

# Skill: Auditoría de Revisión de Código (`code-review-audit`)

Usar esta lista de verificación en toda revisión independiente de cambios antes de la aprobación del usuario.

## 1. Seguridad y Privacidad
- [ ] No hay credenciales, tokens FCM, `google-services.json` productivos, llaves `.jks` ni `.env` en el diff.
- [ ] Todos los endpoints de disparo de pánico y administración verifican autenticación y autorización por rol.
- [ ] Existe protección anti-spam / cooldown en el endpoint de Botón de Pánico.
- [ ] Entradas de usuario validadas y sanitizadas (prevención de SQLi, XSS, payload oversized).

## 2. Reglas Críticas de Alarma Android (si hay cambios en `android/` o despacho FCM)
- [ ] El mensaje FCM es `data-only` con `android.priority = "high"` y `ttl` definido.
- [ ] El audio usa `AudioAttributes.USAGE_ALARM` y `AudioManager.STREAM_ALARM`.
- [ ] El volumen original de `STREAM_ALARM` se guarda y se restaura en `finally` / `onDestroy`.
- [ ] `WakeLock` siempre tiene timeout y se libera al detener el servicio (sin fugas de batería).
- [ ] Hay deduplicación por `alertId` y prevención de disparo accidental en UI (long-press / confirmación).

## 3. Calidad, Pruebas y Mantenibilidad
- [ ] Existen pruebas unitarias o de integración que cubren la nueva lógica y pasan sin errores.
- [ ] Manejo explícito de errores de red, tokens FCM inválidos y estados vacíos.
- [ ] Cambios limitados al alcance de la tarea en `docs/TASK_BOARD.md`.

## Formato de Salida del Reviewer
Devolver siempre:
- **Veredicto**: `APPROVED` o `CHANGES_REQUESTED`
- **Hallazgos**: lista con `[SEVERIDAD] archivo:línea — descripción y corrección sugerida` (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`).
- **Riesgos residuales**: cualquier limitación o prueba manual pendiente en dispositivo físico Android.
