<#
.SYNOPSIS
  PostToolUse Audit Logger para el Agent Harness de Asociación Bello Horizonte.
  Registra trazabilidad de herramientas ejecutadas sin almacenar secretos.
#>

$rawInput = [Console]::In.ReadToEnd()

try {
    $payload = $rawInput | ConvertFrom-Json
    $logDir = Join-Path $PSScriptRoot "..\logs"
    if (-not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }

    $logFile = Join-Path $logDir "execution.jsonl"
    $toolName = if ($payload.toolCall) { $payload.toolCall.name } else { "unknown" }
    $status = if ($payload.error) { "ERROR" } else { "OK" }

    $entry = [ordered]@{
        timestamp      = (Get-Date).ToString("o")
        conversationId = $payload.conversationId
        stepIdx        = $payload.stepIdx
        tool           = $toolName
        status         = $status
        error          = $payload.error
    } | ConvertTo-Json -Compress

    Add-Content -Path $logFile -Value $entry -Encoding UTF8
} catch {
    # Nunca romper el ciclo del agente por un fallo de logging
}

Write-Output "{}"
exit 0
