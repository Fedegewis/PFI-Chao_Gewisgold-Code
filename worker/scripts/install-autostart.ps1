# MenteActiva — registra la tarea programada "MenteActivaWorker" que
# ejecuta el wrapper al iniciar sesión en Windows.
#
# La tarea usa SIEMPRE el perfil .env.production (no es configurable).
#
# Ollama: este script SÓLO DETECTA si Ollama ya tiene autostart propio
# (acceso directo en Startup del usuario, HKCU\...\Run o servicio). Nunca
# lo configura ni registra tareas para Ollama.
#
# NO se ejecuta automáticamente desde ningún otro script: tiene que
# invocarlo el usuario a mano una sola vez.
# NO acepta ni muestra tokens. Los argumentos de la tarea no contienen secretos.
# NO crea ni sobrescribe archivos .env.
# Si la tarea "MenteActivaWorker" ya existe, pide confirmación antes
# de reemplazarla.

[CmdletBinding()]
param(
    [string]$TaskName = "MenteActivaWorker",
    [string]$Model = "llama3.2:3b",
    [ValidateRange(0, 3600)][int]$StartDelaySec = 30,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$EnvFile = ".env.production"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$workerDir = Split-Path -Parent $scriptDir
$startScript = Join-Path $scriptDir "start-worker.ps1"
. (Join-Path $scriptDir "WorkerCommon.ps1")

Write-Host "==> MenteActivaWorker — instalación de autoinicio"
Write-Host "    worker dir: $workerDir"
Write-Host "    wrapper   : $startScript"
Write-Host "    env file  : $EnvFile"

# 1) Chequeos previos.
if (-not (Test-Path -LiteralPath $startScript)) {
    Write-Error "No se encuentra start-worker.ps1 en $scriptDir"
    exit 1
}
$envFileAbs = Join-Path $workerDir $EnvFile
if (-not (Test-Path -LiteralPath $envFileAbs)) {
    Write-Warning "No existe $envFileAbs. Creálo a partir de $EnvFile.example antes de habilitar la tarea."
    Write-Host "    (La tarea se puede registrar igualmente, pero fallará hasta que exista.)"
    if (-not $Force) {
        $ans = Read-Host "¿Continuar de todos modos? (s/N)"
        if ($ans -notmatch '^[sSyY]') { exit 1 }
    }
} else {
    $paths = Get-WorkerProfilePaths -WorkerDir $workerDir -EnvFile $EnvFile
    Write-Host "    lockfile  : $($paths.LockFile)"
    Write-Host "    stop-flag : $($paths.StopFlag)"
    $collisions = Get-WorkerProfileCollisions -WorkerDir $workerDir -EnvFile $EnvFile
    if ($collisions.Count -gt 0) {
        Write-Error ("$EnvFile comparte lockfile o stop-flag con: {0}. Definir WORKER_LOCK_FILE y WORKER_STOP_FLAG distintos por perfil antes de instalar." -f ($collisions -join ", "))
        exit 1
    }
}

# 2) ¿Ollama ya tiene autostart?
function Test-OllamaAutostart {
    $hits = @()
    # Shortcut en Startup del usuario
    $startup = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
    if (Test-Path -LiteralPath $startup) {
        Get-ChildItem -LiteralPath $startup -Filter "*ollama*" -ErrorAction SilentlyContinue |
            ForEach-Object { $hits += "Startup: $($_.FullName)" }
    }
    # HKCU\...\Run
    try {
        $runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
        if (Test-Path $runKey) {
            (Get-ItemProperty -Path $runKey).PSObject.Properties |
                Where-Object { $_.Value -match "(?i)ollama" } |
                ForEach-Object { $hits += "HKCU Run: $($_.Name) = $($_.Value)" }
        }
    } catch {}
    # Servicio
    $svc = Get-Service -Name "Ollama*" -ErrorAction SilentlyContinue
    if ($svc) { $hits += "Servicio: $($svc.Name) ($($svc.Status))" }
    return $hits
}

$ollamaHits = Test-OllamaAutostart
if ($ollamaHits.Count -gt 0) {
    Write-Host ""
    Write-Host "==> Ollama ya tiene autostart configurado:"
    $ollamaHits | ForEach-Object { Write-Host "    - $_" }
    Write-Host "    No se registrará tarea adicional para Ollama."
} else {
    Write-Host ""
    Write-Warning "No se detectó autostart de Ollama. El wrapper lo esperará indefinidamente."
    Write-Host "    Opciones:"
    Write-Host "      - Reinstalar Ollama permitiendo que agregue su acceso directo al Startup."
    Write-Host "      - O crear una tarea separada manualmente (fuera del alcance de este script)."
}

# 3) Si la tarea ya existe, pedir confirmación.
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host ""
    Write-Warning "Ya existe una tarea programada llamada '$TaskName'."
    if (-not $Force) {
        $ans = Read-Host "¿Reemplazarla? (s/N)"
        if ($ans -notmatch '^[sSyY]') {
            Write-Host "Cancelado por el usuario. Tarea existente intacta."
            exit 0
        }
    }
}

# 4) Acción. Argumentos sin secretos: sólo ruta del wrapper, nombre del
#    perfil y modelo. El token se lee del .env.production dentro de Node.
#    El wrapper corre bajo `conhost.exe --headless`: una consola sin
#    ventana. Con `powershell.exe -WindowStyle Hidden` a secas, Windows 11
#    entrega la consola a Windows Terminal (terminal predeterminada) antes
#    de que PowerShell pueda ocultarla; queda una ventana vacía y cerrarla
#    mata al wrapper (0xC000013A) dejando al worker sin supervisión.
#    Limitación: conhost --headless no propaga el exit code; el Programador
#    ve siempre 0 y el código real queda en logs\wrapper-*.log.
$conhostExe = Join-Path $env:SystemRoot "System32\conhost.exe"
if (-not (Test-Path -LiteralPath $conhostExe)) {
    Write-Error "No se encuentra $conhostExe"
    exit 1
}
$psExe = (Get-Command powershell.exe).Source
$argLine = "--headless `"$psExe`" -NoProfile -NoLogo -NonInteractive -ExecutionPolicy Bypass -File `"$startScript`" -EnvFile `"$EnvFile`" -Model `"$Model`""
$action = New-ScheduledTaskAction -Execute $conhostExe -Argument $argLine -WorkingDirectory $workerDir

# 5) Trigger: logon del usuario actual + delay en formato ISO 8601 (PT30S),
#    que es el que exige el Programador de tareas.
$taskUser = "$env:USERDOMAIN\$env:USERNAME"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $taskUser
$trigger.Delay = "PT{0}S" -f $StartDelaySec

# 6) Settings: no detener por batería, sin límite de ejecución, reinicio
#    si la tarea falla al arrancar (con conhost --headless sólo aplica si
#    no se pudo lanzar el proceso: los reintentos del worker los maneja el
#    wrapper). La tarea queda VISIBLE en el Programador para poder
#    deshabilitarla desde la interfaz.
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 `
    -RestartInterval ([TimeSpan]::FromMinutes(5))

# 7) Principal: usuario interactivo (sin elevación, sin SYSTEM).
$principal = New-ScheduledTaskPrincipal -UserId $taskUser -LogonType Interactive -RunLevel Limited

# -Force reemplaza la tarea existente en una sola operación: si el registro
# falla, la tarea anterior no se pierde.
Register-ScheduledTask -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "MenteActiva local worker: procesa analisis IA via Ollama. Perfil: $EnvFile." `
    -Force | Out-Null

Write-Host ""
Write-Host "==> Tarea '$TaskName' registrada."
Write-Host "    Usuario : $taskUser"
Write-Host "    Trigger : inicio de sesion + ${StartDelaySec}s (Delay=PT${StartDelaySec}S)"
Write-Host "    Cwd     : $workerDir"
Write-Host "    Env file: $EnvFile"
Write-Host "    Logs    : $workerDir\logs\"
Write-Host ""
Write-Host "Para iniciarla ahora:          Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Para deshabilitarla:           Disable-ScheduledTask -TaskName '$TaskName'"
Write-Host "Para detener el worker:        scripts\stop-worker.ps1"
Write-Host "Para desinstalarla:            scripts\uninstall-autostart.ps1"
