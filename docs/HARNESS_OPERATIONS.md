# Manual de Operación del Agent Harness — Asociación Bello Horizonte

Este documento explica cómo operar el entorno multiagente en **Antigravity** de forma controlada, repetible y segura.

---

## 1. Los 5 Mecanismos de Antigravity y Cuándo Usar Cada Uno

| Mecanismo | Cuándo usarlo en Bello Horizonte |
| :--- | :--- |
| **Orchestrator (`AGENTS.md`)** | Siempre activo. Interpreta requerimientos, planifica y exige controles. |
| **Subagentes (`invoke_subagent`)** | Tareas focalizadas de un solo especialista (ej. diseñar migración con `database-engineer` o auditar un diff con `code-reviewer`). |
| **`/swarm`** | Funcionalidades grandes donde `backend-developer`, `frontend-developer` y `android-developer` trabajan simultáneamente en `workspace: "share"`. |
| **`run_workflow`** | Ejecutar el ciclo estandarizado completo mediante `.agents/workflows/feature_cycle.py` (Arquitectura -> Dev paralelo -> QA -> Code Review -> Consolidación). |
| **Hooks (`.agents/hooks.json`)** | Siempre activos. `safety-guard.ps1` bloquea comandos destructivos y exige aprobación en `git commit/push`/deploy; `audit-log.ps1` registra trazabilidad en `.agents/logs/execution.jsonl`. |

---

## 2. Controles Técnicos del Harness (6 Capas)

1. **Task Manager**: `docs/TASK_BOARD.md` evita tareas duplicadas o sin responsable.
2. **Git Worktrees / `workspace: "share"`**: evita conflictos cuando Backend, Web y Android se editan en paralelo.
3. **Hooks (`PreToolUse` / `PostToolUse`)**: validación determinística antes/después de ejecutar comandos.
4. **Automated Tests**: ejecutados por `qa-engineer` antes de cualquier integración.
5. **Permission Rules**: `.agents/rules/01-security-and-permissions.md` + configuración Default/Auto en Antigravity (nunca Turbo en ramas productivas).
6. **Execution Logs**: `.agents/logs/execution.jsonl` guarda fecha, herramienta, paso y estado sin almacenar secretos.

---

## 3. Prompts Listos para Operar

### A. Iniciar diseño de un módulo sin tocar código todavía (Dry-Run)
> "Usa el perfil de `solution-architect` y `project-manager`. Analiza el requerimiento del módulo de Botón de Pánico (Backend FCM + App Android con alarma sobre volumen bajo), actualiza `docs/TASK_BOARD.md` y preséntame el plan técnico y stack definitivo para mi aprobación antes de escribir código."

### B. Ejecutar un ciclo completo de funcionalidad con Workflow
> "Ejecuta el workflow `.agents/workflows/feature_cycle.py` para implementar el módulo de registro de dispositivos Android y envío de prueba FCM de alta prioridad. Presenta resultados de QA y Code Reviewer para mi aprobación antes de hacer commit."

### C. Auditoría independiente de seguridad y alarma Android
> "Invoca al agente `code-reviewer` (solo lectura) aplicando la skill `code-review-audit` y `.agents/rules/02-android-alarm-critical-rules.md` sobre los cambios actuales de `android/` y `backend/`."

---

## 4. Plan de Pruebas del Entorno Multiagente (Verificación del Harness)

Antes de construir funcionalidades complejas, verificar que el Harness responde correctamente:

| # | Prueba del Harness | Resultado Esperado |
| :--- | :--- | :--- |
| 1 | **Descubrimiento de reglas**: Iniciar nueva conversación y preguntar por las reglas de alarma Android. | El agente cita `AGENTS.md` y `.agents/rules/02-android-alarm-critical-rules.md` (`USAGE_ALARM`, `data-only`, `high priority`). |
| 2 | **Progressive Disclosure de Skills**: Pedir implementar el botón de pánico en Android. | El agente activa `.agents/skills/android-panic-alarm/SKILL.md` bajo demanda. |
| 3 | **Hook `safety-guard.ps1` (DENY)**: Simular un comando `git push --force` o `DROP TABLE`. | El hook devuelve `decision: "deny"` y bloquea la ejecución. |
| 4 | **Hook `safety-guard.ps1` (FORCE_ASK)**: Solicitar un `git commit`. | El hook devuelve `decision: "force_ask"` y solicita confirmación del usuario. |
| 5 | **Hook `audit-log.ps1`**: Ejecutar cualquier comando seguro y revisar `.agents/logs/execution.jsonl`. | Se registra la línea JSON con timestamp, herramienta y estado `OK`. |
| 6 | **Workflow Dry-Run**: Ejecutar `feature_cycle.py` con `dry_run_only: true`. | `solution-architect` genera el plan estructurado sin modificar código. |
