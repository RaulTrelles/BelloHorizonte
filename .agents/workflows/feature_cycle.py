"""
Dynamic Workflow de Antigravity para el ciclo automatizado de funcionalidades
en Asociación Bello Horizonte.

Uso con la herramienta `run_workflow`:
  run_workflow(
      ScriptPath="c:/Desarrollo/fullstack/Bello Horizonte/.agents/workflows/feature_cycle.py",
      Args={
          "feature": "Descripción de la funcionalidad a implementar",
          "modules": ["backend", "web", "android"],
          "dry_run_only": False
      },
      Description="Ciclo multiagente de funcionalidad Bello Horizonte"
  )
"""

feature = args.get("feature", "")
modules = args.get("modules", ["backend", "web", "android"])
dry_run_only = args.get("dry_run_only", False)

if not feature:
    raise ValueError("Debes pasar 'feature' en Args.")

# ---------------------------------------------------------------------------
# FASE 1: Análisis Técnico (Solution Architect)
# ---------------------------------------------------------------------------
phase("1. Análisis Técnico (Solution Architect)")
arch_plan = await agent(
    prompt=(
        "Actúa siguiendo el perfil `.agents/agents/solution-architect.md` y las reglas en `AGENTS.md`.\n"
        f"Requerimiento: {feature}\n"
        f"Módulos involucrados: {modules}\n\n"
        "Inspecciona el repositorio y `docs/ARCHITECTURE.md`. Devuelve un plan técnico conciso "
        "con contratos API/FCM, dependencias entre módulos, riesgos y tareas por módulo. "
        "NO modifiques código de aplicación en esta fase."
    ),
    schema={
        "type": "object",
        "properties": {
            "summary": {"type": "string"},
            "contracts": {"type": "string"},
            "risks": {"type": "array", "items": {"type": "string"}},
            "module_tasks": {
                "type": "object",
                "additionalProperties": {"type": "string"}
            }
        },
        "required": ["summary", "contracts", "risks", "module_tasks"]
    },
    role="Solution Architect",
    type_name="self",
    workspace="inherit",
)
log("Plan de arquitectura generado:", arch_plan["summary"])

if dry_run_only:
    log("Modo dry_run_only activo. Deteniendo antes de modificar código.")
    print({"status": "PLAN_READY", "architecture": arch_plan})
else:
    # -----------------------------------------------------------------------
    # FASE 2: Desarrollo en Paralelo (worktrees aislados por módulo)
    # -----------------------------------------------------------------------
    phase("2. Desarrollo en Paralelo")

    profile_map = {
        "database": ".agents/agents/database-engineer.md",
        "backend": ".agents/agents/backend-developer.md",
        "web": ".agents/agents/frontend-developer.md",
        "android": ".agents/agents/android-developer.md",
    }

    active_modules = [m for m in modules if m in arch_plan["module_tasks"] and m in profile_map]

    dev_results = await parallel(
        active_modules,
        lambda m: agent(
            prompt=(
                f"Actúa siguiendo el perfil `{profile_map[m]}` y las reglas en `AGENTS.md` y `.agents/rules/`.\n"
                f"Funcionalidad global: {feature}\n"
                f"Contratos acordados:\n{arch_plan['contracts']}\n\n"
                f"Tu tarea específica en el módulo `{m}`:\n{arch_plan['module_tasks'][m]}\n\n"
                "Implementa los cambios en tu directorio asignado y ejecuta las pruebas unitarias de tu módulo."
            ),
            schema={
                "type": "object",
                "properties": {
                    "module": {"type": "string"},
                    "files_changed": {"type": "array", "items": {"type": "string"}},
                    "tests_passed": {"type": "boolean"},
                    "notes": {"type": "string"}
                },
                "required": ["module", "files_changed", "tests_passed", "notes"]
            },
            role=f"Dev ({m})",
            type_name="self",
            workspace="share",
        )
    )
    log(f"Desarrollo completado en {len(dev_results)} módulo(s).")

    # -----------------------------------------------------------------------
    # FASE 3: Validación QA (QA Engineer)
    # -----------------------------------------------------------------------
    phase("3. Validación QA")
    qa_report = await agent(
        prompt=(
            "Actúa siguiendo el perfil `.agents/agents/qa-engineer.md`.\n"
            f"Funcionalidad: {feature}\n"
            f"Resultados de desarrollo: {dev_results}\n\n"
            "Ejecuta las pruebas automatizadas disponibles y valida los criterios de aceptación "
            "(incluyendo las reglas de alarma Android si aplica)."
        ),
        schema={
            "type": "object",
            "properties": {
                "passed": {"type": "boolean"},
                "summary": {"type": "string"},
                "failures": {"type": "array", "items": {"type": "string"}}
            },
            "required": ["passed", "summary", "failures"]
        },
        role="QA Engineer",
        type_name="self",
        workspace="inherit",
    )
    log("QA passed:", qa_report["passed"])

    # -----------------------------------------------------------------------
    # FASE 4: Revisión Independiente (Code Reviewer - Solo Lectura)
    # -----------------------------------------------------------------------
    phase("4. Revisión Independiente (Code Reviewer)")
    review = await agent(
        prompt=(
            "Actúa siguiendo el perfil `.agents/agents/code-reviewer.md` y la skill "
            "`.agents/skills/code-review-audit/SKILL.md`.\n"
            "NO edites ningún archivo (solo lectura).\n"
            f"Funcionalidad: {feature}\n"
            f"Cambios reportados: {dev_results}\n"
            f"Reporte QA: {qa_report}\n\n"
            "Audita seguridad, calidad y cumplimiento de reglas."
        ),
        schema={
            "type": "object",
            "properties": {
                "verdict": {"type": "string", "enum": ["APPROVED", "CHANGES_REQUESTED"]},
                "findings": {"type": "array", "items": {"type": "string"}},
                "risks": {"type": "array", "items": {"type": "string"}}
            },
            "required": ["verdict", "findings", "risks"]
        },
        role="Code Reviewer",
        type_name="research",
        workspace="inherit",
    )
    log("Veredicto Reviewer:", review["verdict"])

    # -----------------------------------------------------------------------
    # FASE 5: Consolidación para Aprobación Humana
    # -----------------------------------------------------------------------
    phase("5. Listo para Aprobación Humana")
    print({
        "status": "READY_FOR_APPROVAL" if (qa_report["passed"] and review["verdict"] == "APPROVED") else "NEEDS_FIXES",
        "architecture": arch_plan["summary"],
        "dev_results": dev_results,
        "qa_report": qa_report,
        "review": review,
    })
