# MenteActiva — elimina la tarea programada MenteActivaWorker.
#
# Orden:
#   1. Detiene cooperativamente el worker del perfil de PRODUCCIÓN
#      (stop-worker.ps1 -EnvFile .env.production). Una inferencia en curso
#      termina y su resultado se envía antes de salir.
#   2. Recién después ejecuta Stop-ScheduledTask (que termina el proceso de
#      la tarea sin aviso) por si algo quedó colgado.
#   3. Desregistra la tarea.
#
# NO toca Ollama, .env, logs ni código. No afecta workers del perfil local.

[CmdletBinding()]
param(
    [string]$TaskName = "MenteActivaWorker",
    [switch]$Force
)

$ErrorActionPreference = "Continue"

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Host "No existe la tarea '$TaskName'. Nada que hacer."
    exit 0
}

if (-not $Force) {
    $ans = Read-Host "¿Eliminar la tarea programada '$TaskName'? (s/N)"
    if ($ans -notmatch '^[sSyY]') {
        Write-Host "Cancelado."
        exit 0
    }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$stop = Join-Path $scriptDir "stop-worker.ps1"
& $stop -EnvFile ".env.production"
$stopCode = $LASTEXITCODE
if ($stopCode -ne 0) {
    Write-Warning "stop-worker.ps1 termino con exit_code=$stopCode; revisar su salida."
}

try {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
} catch {}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Write-Host "Tarea '$TaskName' eliminada."
