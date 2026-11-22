# Reglas de Git, Ramas y Worktrees Paralelos

## 1. Protección de Ramas

- `main`: Rama estable y desplegable. **Prohibido** hacer commits o push directos sin aprobación explícita del usuario.
- `develop`: Rama de integración (opcional si el equipo trabaja por feature branches).
- Ramas de trabajo:
  - `feat/<modulo>-<descripcion>` (ej. `feat/android-panic-alarm`)
  - `fix/<modulo>-<descripcion>`
  - `docs/<descripcion>`
  - `chore/<descripcion>`

## 2. Uso de Git Worktrees para Agentes en Paralelo

Cuando el Orquestador delegue tareas simultáneas a varios agentes que modifican código (por ejemplo, `backend-developer` + `frontend-developer` + `android-developer`):
- Utilizar `workspace: "share"` en `/swarm` o `run_workflow` (o worktrees Git separados) para que cada agente trabaje aislado sin sobrescribir archivos de otro.
- Cada subagente debe reportar la lista exacta de archivos modificados y el resultado de sus pruebas antes de consolidar cambios.

## 3. Criterios antes de Commit

Antes de proponer un `git commit` al usuario:
1. Verificar `git status` y `git diff` para confirmar que no hay archivos temporales ni secretos.
2. Confirmar que `qa-engineer` ejecutó las pruebas pertinentes sin errores.
3. Confirmar que `code-reviewer` aprobó los cambios (sin hallazgos críticos o altos pendientes).
4. Usar mensajes en formato Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`).
