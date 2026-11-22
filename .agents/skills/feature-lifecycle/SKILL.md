---
name: feature-lifecycle
description: >-
  Orquesta el ciclo completo de desarrollo de una funcionalidad o corrección en
  Asociación Bello Horizonte (análisis, planificación, desarrollo paralelo, QA,
  revisión independiente y solicitud de aprobación humana). Usar cuando el
  usuario solicite construir un módulo o funcionalidad completa.
---

# Skill: Ciclo Automatizado de Desarrollo (`feature-lifecycle`)

Sigue este procedimiento paso a paso para ejecutar cualquier funcionalidad con control del Agent Harness.

## Pasos

1. **Diagnóstico y Contexto**
   - Leer `docs/TASK_BOARD.md` y `docs/ARCHITECTURE.md` para verificar dependencias y estado actual.
   - Confirmar si la funcionalidad afecta el flujo crítico del Botón de Pánico (si es así, activar también la skill `android-panic-alarm`).

2. **Análisis Técnico (`solution-architect`)**
   - Delegar a `solution-architect` (`.agents/agents/solution-architect.md`) la definición o verificación de contratos API/FCM, esquema de BD y riesgos.

3. **Planificación (`project-manager`)**
   - Actualizar `docs/TASK_BOARD.md` dividiendo el requerimiento en tareas independientes por módulo (`database`, `backend`, `web`, `android`).
   - Identificar qué tareas pueden correr en paralelo.

4. **Implementación Paralela**
   - Delegar cada módulo a su agente correspondiente (`database-engineer`, `backend-developer`, `frontend-developer`, `android-developer`).
   - Cuando varios agentes editen código al mismo tiempo, aislar con `workspace: "share"` (en `/swarm` o `run_workflow`).

5. **Validación Automatizada (`qa-engineer`)**
   - Ejecutar pruebas unitarias, de integración y la matriz de validación aplicable.
   - Si hay fallos, devolver al desarrollador correspondiente (máximo 3 iteraciones antes de escalar al usuario).

6. **Revisión Independiente (`code-reviewer`)**
   - Delegar a `code-reviewer` (solo lectura) usando la skill `code-review-audit`.
   - Cualquier hallazgo `CRITICAL` o `HIGH` obliga a corrección y revalidación por `qa-engineer`.

7. **Aprobación Humana e Integración**
   - Presentar al usuario:
     - Resumen de archivos modificados.
     - Resultados de pruebas (`PASS`/`FAIL`).
     - Veredicto de `code-reviewer` y riesgos conocidos.
   - Esperar aprobación explícita antes de ejecutar `git commit`, `git push` o despliegue.

## Verificación
- `docs/TASK_BOARD.md` refleja el estado actualizado de todas las tareas.
- No hay pruebas rotas ni hallazgos críticos sin resolver.
