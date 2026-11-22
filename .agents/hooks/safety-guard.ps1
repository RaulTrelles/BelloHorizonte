<#
.SYNOPSIS
  PreToolUse Safety Guard para el Agent Harness de Asociación Bello Horizonte.
  Lee el payload JSON desde stdin y decide allow / ask / deny.
#>

$rawInput = [Console]::In.ReadToEnd()

try {
    $payload = $rawInput | ConvertFrom-Json
} catch {
    # Si el payload no es parseable, no bloquear por error de formato pero exigir confirmación
    @{
        decision = "ask"
        reason   = "No se pudo parsear el payload del hook de seguridad; se requiere confirmación manual."
    } | ConvertTo-Json -Compress
    exit 0
}

$cmd = ""
if ($payload.toolCall -and $payload.toolCall.args -and $payload.toolCall.args.CommandLine) {
    $cmd = [string]$payload.toolCall.args.CommandLine
}

# 1. Bloqueo estricto (DENY) para operaciones destructivas o fuga de secretos
$denyPatterns = @(
    '(?i)\brm\s+-rf\s+(/|\*|\.\.)',
    '(?i)\bRemove-Item\b.*-Recurse.*-Force.*(\*|\.\.)',
    '(?i)\bgit\s+push\b.*--force',
    '(?i)\bgit\s+reset\s+--hard\b',
    '(?i)\bDROP\s+(DATABASE|TABLE)\b',
    '(?i)\bTRUNCATE\s+TABLE\b'
)

foreach ($pattern in $denyPatterns) {
    if ($cmd -match $pattern) {
        @{
            decision = "deny"
            reason   = "Bloqueado por Harness Safety Guard: comando destructivo detectado ($pattern)."
        } | ConvertTo-Json -Compress
        exit 0
    }
}

# 2. Aprobación obligatoria (FORCE_ASK) para operaciones críticas de Git, BD o Despliegue
$askPatterns = @(
    '(?i)\bgit\s+commit\b',
    '(?i)\bgit\s+push\b',
    '(?i)\bgit\s+merge\b',
    '(?i)\bdocker\s+compose\s+up\b',
    '(?i)\bfirebase\s+deploy\b',
    '(?i)\bssh\b',
    '(?i)\bscp\b',
    '(?i)\bmigrate\b.*(prod|production|deploy)'
)

foreach ($pattern in $askPatterns) {
    if ($cmd -match $pattern) {
        @{
            decision = "force_ask"
            reason   = "Harness Safety Guard: esta operación requiere aprobación explícita del usuario."
        } | ConvertTo-Json -Compress
        exit 0
    }
}

# 3. Permitir el resto de comandos seguros en el workspace
@{
    decision = "allow"
} | ConvertTo-Json -Compress
exit 0
