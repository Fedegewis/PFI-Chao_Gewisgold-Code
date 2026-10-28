# MenteActiva — detiene cooperativamente el worker de UN perfil.
#
# Uso:
#   scripts\stop-worker.ps1                      # perfil .env.production (default)
#   scripts\stop-worker.ps1 -EnvFile .env.local  # perfil local
#
# Las rutas de lockfile y stop-flag se leen del propio perfil
# (WORKER_LOCK_FILE / WORKER_STOP_FLAG, mismos defaults que src/config.js).
# Del perfil sólo se leen esas dos claves; el token nunca se lee ni muestra.
#
# Estrategia, de más suave a más dura:
#   1. Si el wrapper de ESTE perfil está vivo, se le pide que no relance el
#      worker borrando su lockfile. Un wrapper de otro perfil no se toca.
#   2. Si el worker de este perfil está vivo, se crea su stop-flag. El worker
#      lo detecta a 1 Hz y hace shutdown ordenado: termina el ciclo en curso
#      (incluida una inferencia activa y el envío del resultado).
#   3. Se espera hasta -GracefulWaitSec (default 300 s > timeout de Ollama 180 s).
#   4. Sólo si sigue vivo al vencer el plazo: Stop-Process -Force (último
#      recurso; puede truncar una inferencia).
#
# Garantías:
#   - Nunca borra el lockfile de un proceso vivo.
#   - Nunca mata un PID que no sea `node ... src\index.js` (protege contra PID
#     reutilizado tras un reinicio).
#   - Se niega a actuar si el perfil comparte lockfile o stop-flag con otro
#     perfil existente (no podría distinguir qué worker detiene).
#
# Limitación de Windows: no hay SIGINT portable hacia un proceso de otra
# consola y Node no reacciona a WM_CLOSE; por eso el canal cooperativo es el
# archivo stop-flag.
#
# Exit codes: 0 detenido o nada que detener, 2 perfil inexistente o colisión,
# 3 el lockfile apunta a un proceso vivo que no es el worker,
# 4 se tuvo que forzar la terminación.

[CmdletBinding()]
param(
    [string]$EnvFile = ".env.production",
    [int]$GracefulWaitSec = 300,
    # Salta el shutdown cooperativo. NO recomendado: puede truncar una inferencia.
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$workerDir = Split-Path -Parent $scriptDir
. (Join-Path $scriptDir "WorkerCommon.ps1")

try {
    $paths = Get-WorkerProfilePaths -WorkerDir $workerDir -EnvFile $EnvFile
} catch {
    Write-Host "[stop] perfil $EnvFile no encontrado; no se detiene nada."
    exit 2
}
$collisions = Get-WorkerProfileCollisions -WorkerDir $workerDir -EnvFile $EnvFile
if ($collisions.Count -gt 0) {
    Write-Host ("[stop] el perfil {0} comparte lockfile o stop-flag con: {1}." -f $EnvFile, ($collisions -join ", "))
    Write-Host "[stop] no se puede identificar el worker con seguridad; no se detiene nada."
    exit 2
}

Write-Host "[stop] perfil   : $EnvFile"
Write-Host "[stop] lockfile : $($paths.LockFile)"
Write-Host "[stop] stop-flag: $($paths.StopFlag)"

function Remove-OrphanWorkerLock {
    # Borra el lockfile sólo si su PID ya no existe.
    $p = Read-WorkerLockPid -Path $paths.LockFile
    if ($null -ne $p -and (Test-ProcessAlive -ProcId $p)) { return }
    if (Test-Path -LiteralPath $paths.LockFile) {
        Remove-Item -LiteralPath $paths.LockFile -Force -ErrorAction SilentlyContinue
    }
}

function Remove-StopFlag {
    if (Test-Path -LiteralPath $paths.StopFlag) {
        Remove-Item -LiteralPath $paths.StopFlag -Force -ErrorAction SilentlyContinue
    }
}

# --- Paso 1: wrapper de este perfil ---
$wrapperLockPath = Join-Path $workerDir ".worker-wrapper.lock"
$wrapper = Read-WrapperLock -Path $wrapperLockPath
if ($null -eq $wrapper) {
    Write-Host "[stop] wrapper: sin lockfile."
} elseif (-not (Test-ProcessAlive -ProcId $wrapper.Pid)) {
    Write-Host "[stop] wrapper: lock huerfano (pid=$($wrapper.Pid)); limpiando."
    Remove-Item -LiteralPath $wrapperLockPath -Force -ErrorAction SilentlyContinue
} elseif ($wrapper.EnvFile -ieq $EnvFile) {
    # El wrapper detecta la ausencia de su lockfile: corta la espera de
    # Ollama y no relanza el worker cuando éste termine.
    Write-Host "[stop] wrapper vivo pid=$($wrapper.Pid); pidiendo que no relance el worker."
    Remove-Item -LiteralPath $wrapperLockPath -Force -ErrorAction SilentlyContinue
} else {
    Write-Host "[stop] wrapper vivo pid=$($wrapper.Pid) pertenece al perfil '$($wrapper.EnvFile)'; no se toca."
}

# --- Paso 2: worker de este perfil ---
$workerPid = Read-WorkerLockPid -Path $paths.LockFile
if ($null -eq $workerPid) {
    Write-Host "[stop] worker: sin lockfile; nada que detener."
    exit 0
}
if (-not (Test-ProcessAlive -ProcId $workerPid)) {
    Write-Host "[stop] worker: pid=$workerPid no existe (lock huerfano); limpiando."
    Remove-OrphanWorkerLock
    Remove-StopFlag
    exit 0
}
if (-not (Test-IsWorkerNodeProcess -ProcId $workerPid)) {
    Write-Host "[stop] el lockfile apunta a pid=$workerPid, que esta vivo pero NO es el worker."
    Write-Host "[stop] no se termina ni se borra nada. Verificar a mano y borrar $($paths.LockFile) si corresponde."
    exit 3
}

if (-not $Force) {
    Write-Host "[stop] worker vivo pid=$workerPid; creando stop-flag."
    try {
        Set-Content -LiteralPath $paths.StopFlag -Value "" -Encoding ascii -ErrorAction Stop
    } catch {
        Write-Host "[stop] no se pudo crear el stop-flag; no se fuerza nada. Reintentar o usar -Force."
        exit 2
    }
    Write-Host "[stop] esperando hasta ${GracefulWaitSec}s a que termine el ciclo en curso..."
    $deadline = (Get-Date).AddSeconds($GracefulWaitSec)
    while ((Get-Date) -lt $deadline) {
        if (-not (Test-ProcessAlive -ProcId $workerPid)) {
            Write-Host "[stop] worker pid=$workerPid se detuvo limpiamente."
            Remove-OrphanWorkerLock
            Remove-StopFlag
            exit 0
        }
        Start-Sleep -Seconds 2
    }
    Write-Warning "[stop] el worker no termino en ${GracefulWaitSec}s; terminando forzadamente (puede truncar una inferencia)."
} else {
    Write-Warning "[stop] -Force: se omite el shutdown cooperativo (puede truncar una inferencia)."
}

# --- Último recurso ---
# Re-verificar identidad justo antes de matar.
if ((Test-ProcessAlive -ProcId $workerPid) -and (Test-IsWorkerNodeProcess -ProcId $workerPid)) {
    Stop-Process -Id $workerPid -Force -ErrorAction SilentlyContinue
    for ($i = 0; $i -lt 20; $i++) {
        if (-not (Test-ProcessAlive -ProcId $workerPid)) { break }
        Start-Sleep -Milliseconds 500
    }
}
Remove-OrphanWorkerLock
Remove-StopFlag
if (Test-ProcessAlive -ProcId $workerPid) {
    Write-Warning "[stop] pid=$workerPid sigue vivo; lockfile conservado."
    exit 4
}
Write-Host "[stop] worker pid=$workerPid terminado forzadamente."
exit 4
