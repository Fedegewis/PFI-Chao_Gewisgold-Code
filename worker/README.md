# MenteActiva — Worker local de análisis IA

Procesa análisis pendientes (schema v3) consultando al backend productivo
y ejecutando inferencias con Ollama local (llama3.2:3b).

## Requisitos

- Node.js ≥ 18 (fetch nativo).
- Ollama instalado y escuchando en `http://127.0.0.1:11434` con el modelo
  `llama3.2:3b` pullado:
  ```powershell
  ollama pull llama3.2:3b
  ```
- Backend MenteActiva accesible con `AI_PROVIDER=deferred` y
  `WORKER_TOKEN` configurado del lado del backend.

## Setup

```powershell
cd worker
copy .env.example .env
# Editar .env — pegar WORKER_TOKEN (el mismo que configuraste en el backend).
npm install
```

Generar un token nuevo si hace falta:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Correr

```powershell
npm start
```

El worker loggea en formato JSON a stdout. Nunca imprime el token, el
prompt completo ni la salida del modelo.

## Tests

```powershell
npm test
```

Los tests NO contactan backend ni Ollama reales: todos usan mocks.

## Garantías de concurrencia

1. **Local — lockfile.** Al arrancar, el worker crea un archivo
   `.worker.lock` con su PID. Si ya existe uno con un PID vivo,
   el proceso aborta con exit code 3. Si el PID está muerto (crash
   previo), lo recicla.
2. **Local — concurrencia 1.** El loop corre UNA sesión por vez.
   Sólo una fetch a Ollama en vuelo.
3. **Entre sesiones.** Espera `WORKER_DELAY_MS` (default 10 s) antes
   de pedir el próximo claim.
4. **Backend — advisory lock global.** El backend emite a lo sumo
   `WORKER_GLOBAL_CONCURRENCY` claims activos simultáneos (default 1).
   Si dos procesos worker arrancan por accidente, el segundo recibe 204
   hasta que el primero libere su lease.

## Verificar que Ollama procesa UNA sesión por vez

Durante operación:

- Logs: cada ciclo imprime `claim recibido` seguido de `resultado
  persistido` o `ollama falló` o `claim perdido`. No hay solapamiento
  entre dos `claim recibido` consecutivos sin un terminal del anterior.
- DB (lado backend): sólo una fila `session_analyses` con
  `status='generating' AND lease_expires_at > NOW()` existe en cualquier
  momento. Verificable con:
  ```sql
  SELECT id, session_id, lease_expires_at
  FROM session_analyses
  WHERE status='generating' AND lease_expires_at > NOW();
  ```
- Ollama: `GET http://127.0.0.1:11434/api/ps` muestra UN modelo
  cargado activo durante la inferencia.

## Comportamiento ante fallos

- Ollama apagado → `OLLAMA_OFFLINE` → `/failed` → siguiente ciclo.
- Backend inaccesible → backoff exponencial 15 s..120 s hasta recuperar.
- 401 del backend → fatal (exit 1), hay que revisar WORKER_TOKEN.
- Claim perdido mid-inferencia → aborta Ollama (via AbortController), no
  envía resultado obsoleto.
- `/result` responde 422 (validator rechazó la salida, `retriable` true
  o false) → el ciclo termina como `failed` sin nueva inferencia y sin
  `/failed`. El backend ya registró el fallo y cerró el claim; la cola
  puede ofrecer la sesión otra vez con un claim nuevo, sujeto a
  `MAX_GENERATION_ATTEMPTS` (3) y al cooldown. Cada inferencia corre
  siempre bajo un lease vigente.
- SIGINT / SIGTERM / SIGBREAK → termina el ciclo actual con shutdown
  ordenado; libera el lockfile.

## Perfiles de configuración (local vs. producción)

El worker soporta la variable `WORKER_ENV_FILE` para elegir qué archivo
`.env` cargar al arrancar. Ruta relativa al cwd del proceso.

- Sin `WORKER_ENV_FILE` → carga `.env` (comportamiento legado).
- `WORKER_ENV_FILE=.env.local` → carga `.env.local`.
- `WORKER_ENV_FILE=.env.production` → carga `.env.production`.

Si `WORKER_ENV_FILE` apunta a un archivo inexistente, el worker falla
con exit code 2 (nunca cae silenciosamente al `.env` legado).

### Migración desde el `.env` único (manual)

**No** hay scripts que muevan secretos automáticamente. Procedimiento
recomendado para pasar al modelo de dos perfiles:

1. Copiar `.env.local.example` a `.env.local` y pegar los valores
   actuales que apuntan a `http://localhost:3001`.
2. Copiar `.env.production.example` a `.env.production` y pegar los
   valores de Render (URL HTTPS + `WORKER_TOKEN` de producción).
3. Verificar que ambos archivos usan **lockfile y stop-flag distintos**
   (`.worker.local.lock` / `.worker.local.stop` vs.
   `.worker.production.lock` / `.worker.production.stop`). Los scripts
   se niegan a arrancar, detener o instalar si dos perfiles comparten
   alguna de esas rutas, porque no podrían distinguir qué worker es cuál.
4. Eliminar o renombrar el `.env` legado una vez que corroboraste que
   los dos nuevos funcionan.

Los tres archivos (`.env`, `.env.local`, `.env.production`) están
ignorados por git.

## Autoinicio en Windows 10

Flujo recomendado: Programador de tareas de Windows + wrapper
PowerShell que espera a Ollama antes de lanzar el worker.

### Instalar

```powershell
cd worker
scripts\install-autostart.ps1
```

El script:
- Usa **siempre** el perfil `.env.production` (no es configurable).
- Verifica que exista `worker/.env.production` (sólo advierte si falta)
  y que no comparta lockfile ni stop-flag con otro perfil.
- **Sólo detecta** si Ollama ya tiene autostart propio (acceso directo
  en la carpeta Startup del usuario, `HKCU\...\Run` o un servicio
  `Ollama*`). Nunca configura Ollama ni registra tareas para él. Si no
  detecta nada, advierte: el wrapper esperará a Ollama indefinidamente.
- Registra la tarea `MenteActivaWorker`: inicio de sesión del usuario
  actual + 30 s (`Delay=PT30S`, formato ISO 8601), usuario interactivo
  (`-RunLevel Limited`, sin elevación, sin SYSTEM), cwd = `worker/`,
  PowerShell con `-WindowStyle Hidden`. La tarea queda visible en el
  Programador para poder deshabilitarla desde la interfaz.
- Los argumentos de la tarea sólo contienen la ruta del wrapper, el
  nombre del perfil y el modelo. El token sólo vive en `.env.production`.
- Si la tarea ya existe, pide confirmación y la reemplaza en una sola
  operación (`Register-ScheduledTask -Force`).

### Qué hace el wrapper (`scripts/start-worker.ps1`)

1. Fija el cwd a la carpeta `worker/`.
2. Verifica que el `.env.production` exista (error 11 si falta).
3. **Espera indefinidamente** a que Ollama responda `/api/version`
   Y a que `llama3.2:3b` aparezca en `/api/tags`. Mientras tanto:
   - polea cada 10 s para Ollama caído, cada 30 s para modelo faltante.
   - loguea sólo transiciones de estado (offline↔online, modelo
     ausente↔presente), más un heartbeat cada 10 min para evidenciar
     actividad. No satura el log.
   - respeta cancelación cooperativa: si alguien borra
     `.worker-wrapper.lock`, el wrapper sale limpio sin arrancar el
     worker. `stop-worker.ps1` usa este canal.
4. Sólo cuando Ollama + modelo están OK, setea
   `WORKER_ENV_FILE=.env.production` y lanza `node src/index.js`.
5. Lanza Node vía `cmd.exe /c ... >> log 2>&1` en una ventana oculta
   propia: stdout y stderr se **agregan** a `logs/worker-YYYY-MM-DD.log`
   sin sobrescribir entre reinicios. La fecha del archivo es la del
   lanzamiento; si un mismo proceso corre varios días, sigue escribiendo
   en el archivo del día en que arrancó.
6. Si el worker muere con exit code != 0, 1 o 2, re-verifica Ollama
   antes de reintentar; luego sleep de 30 s hasta `MaxRestarts=5`.
   Exit 1 (auth del backend) y exit 2 (config inválida) son no
   reintenciables.
7. Mantiene su propio lockfile `.worker-wrapper.lock` separado del
   lockfile interno del worker.

### Detener (cooperativamente)

```powershell
scripts\stop-worker.ps1                       # perfil .env.production (default)
scripts\stop-worker.ps1 -EnvFile .env.local   # perfil local
```

Las rutas de lockfile y stop-flag se leen del propio perfil
(`WORKER_LOCK_FILE` / `WORKER_STOP_FLAG`); del archivo sólo se leen esas
dos claves. Estrategia en orden de agresividad creciente:

1. Si el wrapper vivo pertenece a **este** perfil, se le pide que no
   relance el worker (se borra su lockfile). Un wrapper de otro perfil
   no se toca.
2. Si el worker de este perfil está vivo **y** su PID corresponde a
   `node ... src\index.js`, se crea su stop-flag. El worker lo observa a
   1 Hz, lo elimina y hace shutdown ordenado: **el ciclo actual se
   completa antes de salir**, incluida una inferencia en curso y el
   envío de su resultado. Si el PID está vivo pero no es el worker
   (PID reutilizado), el script no mata ni borra nada (exit 3).
3. Se espera hasta 300 s (ajustable con `-GracefulWaitSec`) a que el
   worker libere su lockfile por su cuenta. 300 s cubre con margen el
   timeout máximo de Ollama (180 s) + overhead.
4. **Sólo si al vencer ese plazo el proceso sigue vivo**, se usa
   `Stop-Process -Force` con warning explícito; puede truncar una
   inferencia. Se activa también con `-Force` como override explícito.

El script **nunca** borra un lockfile mientras su PID siga activo.
No desinstala la tarea programada.

#### Limitaciones de Windows

- No existe un `SIGINT` portable para procesos de otra consola. Node
  no reacciona a `WM_CLOSE`/`CloseMainWindow` para procesos de consola.
  Por eso el canal cooperativo es el archivo-centinela: es el único
  mecanismo cross-shell confiable sin P/Invoke frágil.
- `Stop-Process -Force` equivale a `TerminateProcess` — no corre el
  `finally` que libera el lockfile. Si tuvo que usarse, el script
  limpia los locks huérfanos antes de salir.

### Desinstalar

```powershell
scripts\uninstall-autostart.ps1
```

Pide confirmación, detiene cooperativamente el worker de producción
(`stop-worker.ps1 -EnvFile .env.production`), recién después ejecuta
`Stop-ScheduledTask` y elimina la tarea del Programador. **No** toca
Ollama, `.env`, logs, código ni workers del perfil local.

Para desactivar el autoinicio sin desinstalarlo:
`Disable-ScheduledTask -TaskName MenteActivaWorker`.

### ⚠ No ejecutar local y producción al mismo tiempo

Los workers local y de producción **comparten la misma instancia de
Ollama** y **no existe ninguna protección global entre ambos**:

- sus lockfiles son distintos por diseño (uno por perfil);
- el límite de concurrencia del backend es por base de datos, y la base
  local y Neon son independientes;
- el lockfile del wrapper impide dos wrappers, pero un `npm start`
  manual no pasa por el wrapper.

Con ambos activos, Ollama recibe inferencias simultáneas: en CPU se
duplican las latencias y aumentan los `OLLAMA_TIMEOUT`, lo que produce
análisis fallidos en producción. **Antes de correr el worker local,
detener el de producción**:

```powershell
scripts\stop-worker.ps1                 # detiene producción
$env:WORKER_ENV_FILE = ".env.local"; npm start
# al terminar, Ctrl+C y volver a iniciar la tarea:
Start-ScheduledTask -TaskName MenteActivaWorker
```

### Ejecución manual durante desarrollo

```powershell
# Perfil local — carga .env.local
$env:WORKER_ENV_FILE = ".env.local"
npm start
```

El `.env.production` **nunca** se carga desde una ejecución manual
mientras no setees `WORKER_ENV_FILE=.env.production` explícitamente.
La tarea programada es el único consumidor automático de ese perfil.

### Encoding de los scripts

Los `.ps1` se guardan en UTF-8 **con BOM**. Windows PowerShell 5.1 lee
los archivos sin BOM como ANSI, y algunos caracteres (por ejemplo `—`)
se convierten en comillas que rompen el parseo. Un test lo verifica.

### Logs y diagnóstico

- `worker/logs/worker-YYYY-MM-DD.log` — stdout del worker Node (JSON
  structured; nunca contiene el token, prompt completo ni respuesta
  del modelo).
- `worker/logs/wrapper-YYYY-MM-DD.log` — eventos del wrapper
  PowerShell (inicio, espera a Ollama, reinicios).

Para ver la tarea:

```powershell
Get-ScheduledTask -TaskName MenteActivaWorker | Get-ScheduledTaskInfo
```

## Variables de entorno

Ver `.env.example` (perfil genérico), `.env.local.example` (dev) y
`.env.production.example` (prod/Render) para la lista completa con
defaults.
