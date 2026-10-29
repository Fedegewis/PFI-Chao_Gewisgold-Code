# MenteActiva — wrapper de arranque del worker local en Windows.
#
# Responsabilidades:
#   1. Fijar el working directory a la carpeta worker/.
#   2. Adoptar un worker de este perfil que ya esté vivo (por ejemplo, uno
#      que quedó huérfano porque un wrapper anterior murió) en lugar de
#      lanzar otro.
#   3. Esperar INDEFINIDAMENTE a que Ollama + modelo estén disponibles.
#   4. Lanzar `node src/index.js --profile <perfil>` sólo cuando ambos
#      están listos.
#   5. AGREGAR stdout+stderr del worker a logs/worker-YYYY-MM-DD.log.
#   6. Reintentar ante crash. El límite cuenta fallos CONSECUTIVOS: una
#      ejecución que duró al menos StableRunSec reinicia el contador.
#   7. Evitar múltiples instancias simultáneas mediante lockfile propio.
#
# Garantías:
# - El worker NO arranca mientras Ollama no responda y el modelo no esté
#   pullado. Nunca reclama sesiones en estado offline.
# - Nunca lanza un worker si el lockfile del perfil pertenece a un proceso
#   vivo que no se pudo descartar. Antes de adoptar verifica PID, línea de
#   comandos (node ... src\index.js), perfil (--profile, si figura) y que el
#   proceso sea anterior al lockfile.
# - Durante la espera sólo se loguean transiciones de estado y un heartbeat
#   cada 10 min.
# - La espera y la supervisión se interrumpen limpiamente si se borra
#   .worker-wrapper.lock (lo hace scripts\stop-worker.ps1).
# - Se niega a arrancar si el perfil comparte lockfile o stop-flag con otro
#   perfil existente (.env, .env.local, .env.production).
#
# NO escribe ni modifica archivos .env. NO loggea el token.
# NO acepta tokens por parámetro.
#
# Exit codes: 0 fin normal/cancelado, 10 ya hay wrapper vivo,
# 11 perfil inexistente, 12 no se pudo escribir lockfile,
# 13 node no encontrado, 14 colisión de lockfile/stop-flag entre perfiles,
# 15 demasiados fallos consecutivos del worker,
# 16 el worker terminó con un error no reintenciable (exit 1 o 2),
# 17 el lockfile del perfil pertenece a un worker de otro perfil.
# Bajo `conhost.exe --headless` (tarea programada) el Programador de tareas
# ve siempre 0: el código real queda en logs/wrapper-*.log.

[CmdletBinding()]
param(
    [string]$EnvFile = ".env.production",
    [string]$OllamaUrl = "http://127.0.0.1:11434",
    [string]$Model = "llama3.2:3b",
    [int]$OllamaPollSec = 10,
    [int]$ModelMissingPollSec = 30,
    [int]$WaitHeartbeatSec = 600,
    [int]$MaxRestarts = 5,
    [int]$RestartDelaySec = 30,
    [int]$StableRunSec = 600,
    [int]$AdoptPollSec = 15
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
        [void](Add-WorkerLogLine -Path (Get-WorkerDailyLog -LogsDir $logsDir -Prefix "wrapper") -Line $line)
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

# Espera interrumpible: devuelve $false si se pidió detener el wrapper.
function Wait-Interruptible {
    param([int]$Seconds)
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-WrapperAbortRequested) { return $false }
        Start-Sleep -Seconds ([Math]::Min(5, [Math]::Max(1, [int]($deadline - (Get-Date)).TotalSeconds)))
    }
    return $true
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

# Supervisa un worker que este wrapper no lanzó. Devuelve $true cuando el
# proceso terminó y $false si se pidió detener el wrapper (el worker sigue
# corriendo; stop-worker.ps1 lo detiene por su stop-flag).
function Wait-AdoptedWorker {
    param([int]$ProcId, $StartTime)
    while (Test-SameProcess -ProcId $ProcId -StartTime $StartTime) {
        if (-not (Wait-Interruptible -Seconds $AdoptPollSec)) { return $false }
    }
    return $true
}

function Invoke-WrapperMain {
    # Perfil: debe existir; NO se crea ni se modifica.
    try {
        $paths = Get-WorkerProfilePaths -WorkerDir $workerDir -EnvFile $EnvFile
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

    # Heredado por cmd.exe y node. Sólo el NOMBRE del perfil, nunca valores.
    $env:WORKER_ENV_FILE = $EnvFile
    $failures = 0
    $launches = 0
    while ($true) {
        if (Test-WrapperAbortRequested) {
            Write-WrapperLog "info" "detencion solicitada; wrapper sale sin lanzar el worker"
            return 0
        }

        # Nota: se usa if/elseif y no switch porque `continue` dentro de un
        # switch de PowerShell no pasa a la siguiente vuelta del while.
        $state = Get-WorkerLockState -LockFile $paths.LockFile -EnvFile $EnvFile
        $runSeconds = $null

        if ($state.Status -eq "mismatch") {
            Write-WrapperLog "error" "el lockfile pertenece a un worker de otro perfil pid=$($state.Pid) ($($state.Reason)); no se lanza otro"
            return 17
        }
        elseif ($state.Status -eq "stale") {
            if (Remove-StaleWorkerLock -LockFile $paths.LockFile -EnvFile $EnvFile -ExpectedPid $state.Pid) {
                Write-WrapperLog "warn" "lockfile del worker vencido pid=$($state.Pid) ($($state.Reason)); eliminado"
            } else {
                # Cambió entre la evaluación y el borrado, o no se pudo borrar:
                # re-evaluar sin girar en vacío.
                Write-WrapperLog "warn" "no se pudo limpiar el lockfile del worker ($($state.Reason)); se re-evalua"
                if (-not (Wait-Interruptible -Seconds $AdoptPollSec)) { return 0 }
            }
            continue
        }
        elseif ($state.Status -eq "alive" -or $state.Status -eq "unverified") {
            if ($state.Status -eq "alive") {
                Write-WrapperLog "info" "adoptando worker existente pid=$($state.Pid); no se lanza otro"
            } else {
                Write-WrapperLog "warn" "lockfile tomado por node.exe pid=$($state.Pid) no verificable ($($state.Reason)); se espera a que termine"
            }
            if (-not (Wait-AdoptedWorker -ProcId $state.Pid -StartTime $state.StartTime)) {
                Write-WrapperLog "info" "detencion solicitada durante la supervision del worker adoptado"
                return 0
            }
            $runSeconds = ((Get-Date) - $state.StartTime).TotalSeconds
            # No se conoce su exit code (no es hijo de este wrapper): se trata
            # como un fallo reintenciable.
            Write-WrapperLog "warn" ("worker adoptado pid={0} termino tras {1:N0}s" -f $state.Pid, $runSeconds)
        }
        else {
            if (-not (Wait-ForOllamaReady)) {
                Write-WrapperLog "info" "wrapper abortado antes de lanzar el worker"
                return 0
            }
            # La espera de Ollama pudo ser larga: re-evaluar el lock por si
            # otro worker lo tomó mientras tanto.
            if ((Get-WorkerLockState -LockFile $paths.LockFile -EnvFile $EnvFile).Status -ne "none") { continue }

            $launches++
            $logFile = Get-WorkerDailyLog -LogsDir $logsDir -Prefix "worker"
            Write-WrapperLog "info" "lanzando node src/index.js (lanzamiento $launches, fallos consecutivos $failures/$MaxRestarts)"
            $started = Get-Date
            $code = Invoke-WorkerNode -WorkerDir $workerDir -LogFile $logFile -NodeExe $nodeExe -ProfileTag $EnvFile
            $runSeconds = ((Get-Date) - $started).TotalSeconds
            Write-WrapperLog "info" ("worker termino con exit_code={0} tras {1:N0}s" -f $code, $runSeconds)

            $action = Get-WorkerExitAction -ExitCode $code
            if ($action -eq "stop") { return 0 }
            if ($action -eq "fatal") {
                Write-WrapperLog "error" "exit_code=$code no reintenciable; revisar config o WORKER_TOKEN"
                return 16
            }
        }

        if (Test-WrapperAbortRequested) {
            Write-WrapperLog "info" "detencion solicitada; no se reintenta"
            return 0
        }
        $failures = Step-WorkerFailureCount -Failures $failures -RunSeconds $runSeconds -StableRunSec $StableRunSec
        if ($failures -gt $MaxRestarts) {
            Write-WrapperLog "error" "superados $MaxRestarts fallos consecutivos (cada uno con menos de ${StableRunSec}s de ejecucion); abortando"
            return 15
        }
        Write-WrapperLog "warn" "reintentando en ${RestartDelaySec}s (fallo consecutivo $failures/$MaxRestarts)"
        if (-not (Wait-Interruptible -Seconds $RestartDelaySec)) {
            Write-WrapperLog "info" "detencion solicitada durante la espera de reintento"
            return 0
        }
    }
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
    Write-WrapperLog "info" "wrapper finalizado exit_code=$exitCode"
}
exit $exitCode
