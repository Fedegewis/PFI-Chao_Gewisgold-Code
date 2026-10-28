# MenteActiva — wrapper de arranque del worker local en Windows.
#
# Responsabilidades:
#   1. Fijar el working directory a la carpeta worker/.
#   2. Esperar INDEFINIDAMENTE a que Ollama + modelo estén disponibles.
#   3. Lanzar `node src/index.js` sólo cuando ambos están listos.
#   4. AGREGAR stdout+stderr del worker a logs/worker-YYYY-MM-DD.log.
#   5. Reintentar ante crash con límite y demora.
#   6. Evitar múltiples instancias simultáneas mediante lockfile propio.
#
# Garantías:
# - El worker NO arranca mientras Ollama no responda y el modelo no esté
#   pullado. Nunca reclama sesiones en estado offline.
# - Durante la espera sólo se loguean transiciones de estado y un heartbeat
#   cada 10 min.
# - La espera se interrumpe limpiamente si se borra .worker-wrapper.lock
#   (lo hace scripts\stop-worker.ps1).
# - Se niega a arrancar si el perfil comparte lockfile o stop-flag con otro
#   perfil existente (.env, .env.local, .env.production).
#
# NO escribe ni modifica archivos .env. NO loggea el token.
# NO acepta tokens por parámetro.
#
# Exit codes: 0 fin normal/cancelado, 10 ya hay wrapper vivo,
# 11 perfil inexistente, 12 no se pudo escribir lockfile,
# 13 node no encontrado, 14 colisión de lockfile/stop-flag entre perfiles.

[CmdletBinding()]
param(
    [string]$EnvFile = ".env.production",
    [string]$OllamaUrl = "http://127.0.0.1:11434",
    [string]$Model = "llama3.2:3b",
    [int]$OllamaPollSec = 10,
    [int]$ModelMissingPollSec = 30,
    [int]$WaitHeartbeatSec = 600,
    [int]$MaxRestarts = 5,
    [int]$RestartDelaySec = 30
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$workerDir = Split-Path -Parent $scriptDir
. (Join-Path $scriptDir "WorkerCommon.ps1")
Set-Location -LiteralPath $workerDir

$logsDir = Join-Path $workerDir "logs"
if (-not (Test-Path -LiteralPath $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
}

function Write-WrapperLog {
    param([string]$Level, [string]$Message)
    $ts = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    $msg = $Message -replace '\\', '\\' -replace '"', '\"'
    $line = '{{"ts":"{0}","level":"{1}","src":"wrapper","profile":"{2}","msg":"{3}"}}' -f $ts, $Level, $EnvFile, $msg
    try {
        Add-Content -LiteralPath (Get-WorkerDailyLog -LogsDir $logsDir -Prefix "wrapper") -Value $line -Encoding utf8
    } catch {}
}

# --- Lockfile del wrapper (único para todos los perfiles) ---
$wrapperLock = Join-Path $workerDir ".worker-wrapper.lock"
$existing = Read-WrapperLock -Path $wrapperLock
if ($null -ne $existing) {
    if (Test-ProcessAlive -ProcId $existing.Pid) {
        Write-WrapperLog "error" "ya hay un wrapper vivo pid=$($existing.Pid) perfil=$($existing.EnvFile); abortando"
        exit 10
    }
    Write-WrapperLog "warn" "lock de wrapper huerfano pid=$($existing.Pid); reciclando"
}
try {
    Set-Content -LiteralPath $wrapperLock -Value @("$PID", $EnvFile) -Encoding ascii -ErrorAction Stop
} catch {
    Write-WrapperLog "error" "no se pudo escribir lockfile del wrapper"
    exit 12
}

function Test-WrapperAbortRequested {
    $current = Read-WrapperLock -Path $wrapperLock
    if ($null -eq $current) { return $true }
    return ($current.Pid -ne $PID)
}

function Wait-ForOllamaReady {
    $reachableState = $null
    $modelState = $null
    $lastHeartbeat = Get-Date

    while ($true) {
        if (Test-WrapperAbortRequested) {
            Write-WrapperLog "info" "espera cancelada (lockfile removido)"
            return $false
        }

        $reachable = $false
        try {
            $resp = Invoke-WebRequest -Uri "$OllamaUrl/api/version" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
            $reachable = ($resp.StatusCode -eq 200)
        } catch { $reachable = $false }

        if ($reachable -ne $reachableState) {
            if ($reachable) { Write-WrapperLog "info" "Ollama disponible en $OllamaUrl" }
            else { Write-WrapperLog "warn" "Ollama no responde en $OllamaUrl" }
            $reachableState = $reachable
            $modelState = $null
        }

        if (-not $reachable) {
            if (((Get-Date) - $lastHeartbeat).TotalSeconds -ge $WaitHeartbeatSec) {
                Write-WrapperLog "info" "aun esperando a Ollama"
                $lastHeartbeat = Get-Date
            }
            Start-Sleep -Seconds $OllamaPollSec
            continue
        }

        $modelPresent = $false
        try {
            $tags = Invoke-RestMethod -Uri "$OllamaUrl/api/tags" -TimeoutSec 10 -ErrorAction Stop
            $names = @($tags.models | ForEach-Object { $_.name })
            $modelPresent = ($names -contains $Model)
        } catch { $modelPresent = $false }

        if ($modelPresent -ne $modelState) {
            if ($modelPresent) { Write-WrapperLog "info" "modelo $Model disponible" }
            else { Write-WrapperLog "warn" "modelo $Model no esta pullado; esperando" }
            $modelState = $modelPresent
        }

        if ($modelPresent) { return $true }

        if (((Get-Date) - $lastHeartbeat).TotalSeconds -ge $WaitHeartbeatSec) {
            Write-WrapperLog "info" "aun esperando al modelo $Model"
            $lastHeartbeat = Get-Date
        }
        Start-Sleep -Seconds $ModelMissingPollSec
    }
}

function Invoke-WrapperMain {
    # Perfil: debe existir; NO se crea ni se modifica.
    try {
        $null = Get-WorkerProfilePaths -WorkerDir $workerDir -EnvFile $EnvFile
    } catch {
        Write-WrapperLog "error" "archivo env no encontrado: $EnvFile"
        return 11
    }
    $collisions = Get-WorkerProfileCollisions -WorkerDir $workerDir -EnvFile $EnvFile
    if ($collisions.Count -gt 0) {
        Write-WrapperLog "error" ("el perfil comparte lockfile o stop-flag con: {0}. Definir WORKER_LOCK_FILE y WORKER_STOP_FLAG distintos por perfil." -f ($collisions -join ", "))
        return 14
    }
    Write-WrapperLog "info" "perfil env: $EnvFile"

    $nodeCmd = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $nodeCmd) {
        Write-WrapperLog "error" "node no encontrado en PATH"
        return 13
    }
    $nodeExe = $nodeCmd.Source

    if (-not (Wait-ForOllamaReady)) {
        Write-WrapperLog "info" "wrapper abortado antes de arrancar el worker"
        return 0
    }

    # Heredado por cmd.exe y node. Sólo el NOMBRE del perfil, nunca valores.
    $env:WORKER_ENV_FILE = $EnvFile
    $restart = 0
    while ($true) {
        if (Test-WrapperAbortRequested) {
            Write-WrapperLog "info" "wrapper abortado antes de lanzar node"
            break
        }
        $logFile = Get-WorkerDailyLog -LogsDir $logsDir -Prefix "worker"
        Write-WrapperLog "info" "lanzando node src/index.js (intento $($restart + 1)/$($MaxRestarts + 1))"
        $code = Invoke-WorkerNode -WorkerDir $workerDir -LogFile $logFile -NodeExe $nodeExe
        Write-WrapperLog "info" "worker termino con exit_code=$code"

        if ($code -eq 0) { break }
        if ($code -eq 1 -or $code -eq 2) {
            Write-WrapperLog "error" "exit_code=$code no reintenciable"
            break
        }
        if (Test-WrapperAbortRequested) {
            Write-WrapperLog "info" "detencion solicitada; no se reintenta"
            break
        }
        $restart++
        if ($restart -gt $MaxRestarts) {
            Write-WrapperLog "error" "superado MaxRestarts=$MaxRestarts; abortando"
            break
        }
        Write-WrapperLog "warn" "re-verificando Ollama antes de reintentar"
        if (-not (Wait-ForOllamaReady)) {
            Write-WrapperLog "info" "wrapper abortado durante re-verificacion"
            break
        }
        Write-WrapperLog "warn" "reintentando en ${RestartDelaySec}s"
        Start-Sleep -Seconds $RestartDelaySec
    }
    return 0
}

$exitCode = 0
try {
    $exitCode = Invoke-WrapperMain
}
catch {
    Write-WrapperLog "error" ("error inesperado del wrapper: {0}" -f $_.Exception.Message)
    $exitCode = 1
}
finally {
    # Sólo borrar el lockfile si sigue siendo nuestro.
    $current = Read-WrapperLock -Path $wrapperLock
    if ($null -ne $current -and $current.Pid -eq $PID) {
        Remove-Item -LiteralPath $wrapperLock -Force -ErrorAction SilentlyContinue
    }
    Write-WrapperLog "info" "wrapper finalizado"
}
exit $exitCode
