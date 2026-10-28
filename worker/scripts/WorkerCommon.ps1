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

# Ruta del log diario del worker, calculada en el momento de cada lanzamiento.
function Get-WorkerDailyLog {
    param(
        [Parameter(Mandatory = $true)][string]$LogsDir,
        [Parameter(Mandatory = $true)][string]$Prefix
    )
    return Join-Path $LogsDir ("{0}-{1}.log" -f $Prefix, (Get-Date -Format "yyyy-MM-dd"))
}

# Lanza Node vía cmd.exe para poder AGREGAR (>>) stdout y stderr (2>&1) al
# mismo archivo: Start-Process no admite el mismo archivo en
# -RedirectStandardOutput y -RedirectStandardError, y además sobrescribe.
# Ventana oculta propia: no depende de una consola interactiva.
# Devuelve el exit code de Node (cmd /c lo propaga).
function Invoke-WorkerNode {
    param(
        [Parameter(Mandatory = $true)][string]$WorkerDir,
        [Parameter(Mandatory = $true)][string]$LogFile,
        [Parameter(Mandatory = $true)][string]$NodeExe,
        [string]$EntryScript = "src\index.js"
    )
    $cmdArgs = '/d /s /c ""{0}" "{1}" >> "{2}" 2>&1"' -f $NodeExe, $EntryScript, $LogFile
    $proc = Start-Process -FilePath $env:ComSpec `
        -ArgumentList $cmdArgs `
        -WorkingDirectory $WorkerDir `
        -WindowStyle Hidden `
        -PassThru `
        -Wait
    return $proc.ExitCode
}
