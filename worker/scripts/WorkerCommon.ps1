# MenteActiva — funciones compartidas por los scripts del worker.
# Se carga con dot-sourcing (. "$PSScriptRoot\WorkerCommon.ps1").
# No ejecuta nada al cargarse: sólo define funciones.
# Compatible con Windows PowerShell 5.1.

$script:WorkerKnownProfiles = @(".env", ".env.local", ".env.production")

# Resuelve una ruta como lo hace Node (path.resolve contra el cwd = worker/).
function Resolve-WorkerPath {
    param(
        [Parameter(Mandatory = $true)][string]$WorkerDir,
        [Parameter(Mandatory = $true)][string]$Value
    )
    if ([System.IO.Path]::IsPathRooted($Value)) {
        return [System.IO.Path]::GetFullPath($Value)
    }
    return [System.IO.Path]::GetFullPath((Join-Path $WorkerDir $Value))
}

# Lee de un perfil .env SOLO WORKER_LOCK_FILE y WORKER_STOP_FLAG.
# Nunca lee, devuelve ni imprime otras claves (en particular WORKER_TOKEN).
# Defaults idénticos a src/config.js.
function Get-WorkerProfilePaths {
    param(
        [Parameter(Mandatory = $true)][string]$WorkerDir,
        [Parameter(Mandatory = $true)][string]$EnvFile
    )
    $envPath = Join-Path $WorkerDir $EnvFile
    if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
        throw "perfil no encontrado: $EnvFile"
    }
    $values = @{ WORKER_LOCK_FILE = ".worker.lock"; WORKER_STOP_FLAG = ".worker.stop" }
    foreach ($line in (Get-Content -LiteralPath $envPath -Encoding UTF8)) {
        if ($line -notmatch '^\s*(WORKER_LOCK_FILE|WORKER_STOP_FLAG)\s*=(.*)$') { continue }
        $key = $Matches[1]
        $raw = $Matches[2].Trim()
        if ($raw -match '^"(.*)"$') {
            $raw = $Matches[1]
        } elseif ($raw -match "^'(.*)'$") {
            $raw = $Matches[1]
        } else {
            $raw = ($raw -replace '\s+#.*$', '').Trim()
        }
        if ($raw.Length -gt 0) { $values[$key] = $raw }
    }
    return [pscustomobject]@{
        EnvFile  = $EnvFile
        EnvPath  = [System.IO.Path]::GetFullPath($envPath)
        LockFile = Resolve-WorkerPath -WorkerDir $WorkerDir -Value $values.WORKER_LOCK_FILE
        StopFlag = Resolve-WorkerPath -WorkerDir $WorkerDir -Value $values.WORKER_STOP_FLAG
    }
}

# Devuelve los perfiles existentes que comparten lockfile o stop-flag con
# el perfil indicado. Si hay colisión, un stop podría afectar al worker de
# otro perfil, y dos workers no se excluirían entre sí por lockfile.
function Get-WorkerProfileCollisions {
    param(
        [Parameter(Mandatory = $true)][string]$WorkerDir,
        [Parameter(Mandatory = $true)][string]$EnvFile
    )
    $target = Get-WorkerProfilePaths -WorkerDir $WorkerDir -EnvFile $EnvFile
    $collisions = @()
    foreach ($other in $script:WorkerKnownProfiles) {
        if ($other -eq $EnvFile) { continue }
        if (-not (Test-Path -LiteralPath (Join-Path $WorkerDir $other) -PathType Leaf)) { continue }
        $p = Get-WorkerProfilePaths -WorkerDir $WorkerDir -EnvFile $other
        if ($p.LockFile -ieq $target.LockFile -or $p.StopFlag -ieq $target.StopFlag) {
            $collisions += $other
        }
    }
    return ,$collisions
}

# Lockfile del wrapper: línea 1 = PID, línea 2 = perfil (.env.*).
function Read-WrapperLock {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try {
        $lines = @(Get-Content -LiteralPath $Path -ErrorAction Stop)
        $procId = [int]($lines[0].Trim())
        $profileName = $null
        if ($lines.Count -ge 2) { $profileName = $lines[1].Trim() }
        return [pscustomobject]@{ Pid = $procId; EnvFile = $profileName }
    } catch {
        return [pscustomobject]@{ Pid = $null; EnvFile = $null }
    }
}

function Read-WorkerLockPid {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try {
        return [int]((Get-Content -LiteralPath $Path -Raw -ErrorAction Stop).Trim())
    } catch {
        return $null
    }
}

function Test-ProcessAlive {
    param($ProcId)
    if ($null -eq $ProcId -or $ProcId -le 0) { return $false }
    return $null -ne (Get-Process -Id $ProcId -ErrorAction SilentlyContinue)
}

# Verifica que el PID corresponda a `node ... src\index.js` (el worker) y no
# a otro proceso que reutilizó el PID de un lockfile viejo.
function Test-IsWorkerNodeProcess {
    param([Parameter(Mandatory = $true)][int]$ProcId)
    try {
        $p = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $ProcId" -ErrorAction Stop
    } catch {
        return $false
    }
    if ($null -eq $p) { return $false }
    if ($p.Name -ine "node.exe") { return $false }
    return ($p.CommandLine -match 'src[\\/]index\.js')
}

# Perfil con el que el wrapper lanzó al worker (`--profile <archivo>` al
# final de la línea de comandos). $null si no figura: workers lanzados a
# mano o por versiones anteriores del wrapper.
function Get-WorkerProfileTag {
    param([string]$CommandLine)
    if ([string]::IsNullOrEmpty($CommandLine)) { return $null }
    if ($CommandLine -match '--profile\s+"?([^"\s]+)"?') { return $Matches[1] }
    return $null
}

# Estado del lockfile del worker de un perfil. Decide si el wrapper puede
# adoptar un worker existente, limpiar un lock vencido o lanzar uno nuevo.
#   none       sin lockfile.
#   stale      el lock no corresponde a ningún worker vivo: PID inexistente,
#              lock ilegible, PID reutilizado por otro programa o por un
#              proceso creado DESPUÉS de escribirse el lock (típico tras
#              reiniciar Windows: el lock sobrevive y su PID se reasigna).
#   alive      `node ... src\index.js` vivo, anterior al lock y, si tiene
#              --profile, del mismo perfil. Se puede adoptar.
#   unverified node.exe vivo cuya línea de comandos no se puede leer (p. ej.
#              proceso elevado). No se adopta ni se borra su lock.
#   mismatch   worker vivo que declara OTRO perfil sobre este lockfile.
# Que el lockfile sea exclusivo del perfil lo garantiza
# Get-WorkerProfileCollisions; --profile es una verificación adicional.
function Get-WorkerLockState {
    param(
        [Parameter(Mandatory = $true)][string]$LockFile,
        [Parameter(Mandatory = $true)][string]$EnvFile,
        [int]$ClockSkewSec = 2
    )
    function New-State([string]$Status, $ProcId, $StartTime, [string]$Reason) {
        return [pscustomobject]@{ Status = $Status; Pid = $ProcId; StartTime = $StartTime; Reason = $Reason }
    }
    if (-not (Test-Path -LiteralPath $LockFile -PathType Leaf)) {
        return New-State "none" $null $null "sin lockfile"
    }
    $lockPid = Read-WorkerLockPid -Path $LockFile
    if ($null -eq $lockPid -or $lockPid -le 0) {
        return New-State "stale" $null $null "lockfile ilegible"
    }
    $p = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $lockPid" -ErrorAction SilentlyContinue
    if ($null -eq $p) {
        return New-State "stale" $lockPid $null "pid inexistente"
    }
    if ($p.Name -ine "node.exe") {
        return New-State "stale" $lockPid $null "pid reutilizado por $($p.Name)"
    }
    if ([string]::IsNullOrEmpty($p.CommandLine)) {
        return New-State "unverified" $lockPid $p.CreationDate "linea de comandos ilegible"
    }
    if ($p.CommandLine -notmatch 'src[\\/]index\.js') {
        return New-State "stale" $lockPid $null "pid reutilizado por otro programa node"
    }
    $lockWritten = (Get-Item -LiteralPath $LockFile).LastWriteTime
    if ($p.CreationDate -gt $lockWritten.AddSeconds($ClockSkewSec)) {
        return New-State "stale" $lockPid $null "proceso posterior al lockfile (pid reutilizado)"
    }
    $tag = Get-WorkerProfileTag -CommandLine $p.CommandLine
    if ($null -ne $tag -and $tag -ine $EnvFile) {
        return New-State "mismatch" $lockPid $p.CreationDate "worker del perfil $tag"
    }
    return New-State "alive" $lockPid $p.CreationDate "worker verificado"
}

# Borra el lockfile sólo si, re-evaluado en este instante, sigue vencido y
# con el mismo PID. Devuelve $true si lo borró.
function Remove-StaleWorkerLock {
    param(
        [Parameter(Mandatory = $true)][string]$LockFile,
        [Parameter(Mandatory = $true)][string]$EnvFile,
        $ExpectedPid
    )
    $again = Get-WorkerLockState -LockFile $LockFile -EnvFile $EnvFile
    if ($again.Status -ne "stale" -or $again.Pid -ne $ExpectedPid) { return $false }
    Remove-Item -LiteralPath $LockFile -Force -ErrorAction SilentlyContinue
    return -not (Test-Path -LiteralPath $LockFile)
}

# $true mientras exista el proceso con ese PID y esa fecha de inicio
# (protege contra un PID reutilizado durante la supervisión).
function Test-SameProcess {
    param([Parameter(Mandatory = $true)][int]$ProcId, $StartTime)
    $p = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $ProcId" -ErrorAction SilentlyContinue
    if ($null -eq $p) { return $false }
    if ($null -eq $StartTime) { return $true }
    return ($p.CreationDate -eq $StartTime)
}

# Qué hacer según el exit code del worker:
#   stop  0: shutdown pedido (stop-flag o señal).
#   fatal 1 (auth rechazada / excepción del loop) y 2 (config inválida):
#         reintentar no lo arregla.
#   retry cualquier otro (3 lock tomado, crash, proceso terminado).
function Get-WorkerExitAction {
    param([Parameter(Mandatory = $true)][long]$ExitCode)
    if ($ExitCode -eq 0) { return "stop" }
    if ($ExitCode -eq 1 -or $ExitCode -eq 2) { return "fatal" }
    return "retry"
}

# Fallos consecutivos tras un nuevo fallo. Si la ejecución que acaba de
# terminar duró al menos StableRunSec se considera estable: el contador
# vuelve a empezar y este fallo cuenta como el primero.
function Step-WorkerFailureCount {
    param(
        [Parameter(Mandatory = $true)][int]$Failures,
        [Parameter(Mandatory = $true)][double]$RunSeconds,
        [Parameter(Mandatory = $true)][int]$StableRunSec
    )
    if ($RunSeconds -ge $StableRunSec) { return 1 }
    return $Failures + 1
}

# Ruta del log diario del worker, calculada en el momento de cada lanzamiento.
function Get-WorkerDailyLog {
    param(
        [Parameter(Mandatory = $true)][string]$LogsDir,
        [Parameter(Mandatory = $true)][string]$Prefix
    )
    return Join-Path $LogsDir ("{0}-{1}.log" -f $Prefix, (Get-Date -Format "yyyy-MM-dd"))
}

# Agrega una línea a un log compartiendo el archivo con lectores y otros
# escritores (FileShare.ReadWrite). Add-Content no lo hace: falla con
# violación de uso compartido si alguien está leyendo el log en ese momento
# (y quien lee también puede recibir EBUSY). Reintenta brevemente y devuelve
# $false si no pudo escribir. UTF-8 sin BOM.
function Add-WorkerLogLine {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Line,
        [int]$Attempts = 5
    )
    $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($Line + "`r`n")
    for ($i = 1; $i -le $Attempts; $i++) {
        try {
            $fs = New-Object System.IO.FileStream($Path, [System.IO.FileMode]::Append,
                [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite)
            try { $fs.Write($bytes, 0, $bytes.Length) } finally { $fs.Dispose() }
            return $true
        } catch {
            if ($i -lt $Attempts) { Start-Sleep -Milliseconds (20 * $i) }
        }
    }
    return $false
}

# Lanza Node vía cmd.exe para poder AGREGAR (>>) stdout y stderr (2>&1) al
# mismo archivo: Start-Process no admite el mismo archivo en
# -RedirectStandardOutput y -RedirectStandardError, y además sobrescribe.
# Ventana oculta propia: no depende de una consola interactiva.
# Devuelve el exit code de Node (cmd /c lo propaga).
# -ProfileTag agrega `--profile <archivo>` a la línea de comandos de Node
# (Node lo ignora); Get-WorkerLockState lo usa para verificar el perfil.
function Invoke-WorkerNode {
    param(
        [Parameter(Mandatory = $true)][string]$WorkerDir,
        [Parameter(Mandatory = $true)][string]$LogFile,
        [Parameter(Mandatory = $true)][string]$NodeExe,
        [string]$EntryScript = "src\index.js",
        [string]$ProfileTag
    )
    $tagArg = ""
    if (-not [string]::IsNullOrEmpty($ProfileTag)) { $tagArg = ' --profile "{0}"' -f $ProfileTag }
    $cmdArgs = '/d /s /c ""{0}" "{1}"{2} >> "{3}" 2>&1"' -f $NodeExe, $EntryScript, $tagArg, $LogFile
    $proc = Start-Process -FilePath $env:ComSpec `
        -ArgumentList $cmdArgs `
        -WorkingDirectory $WorkerDir `
        -WindowStyle Hidden `
        -PassThru `
        -Wait
    return $proc.ExitCode
}
