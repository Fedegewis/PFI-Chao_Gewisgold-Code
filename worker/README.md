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
- Validator rechaza con `retriable=true` → UN retry con mismo claim.
- SIGINT / SIGTERM / SIGBREAK → termina el ciclo actual con shutdown
  ordenado; libera el lockfile.

## Autoinicio en Windows (opcional)

Para que arranque con el usuario sin necesidad de abrir una terminal:

```powershell
schtasks /create /tn "MenteActivaWorker" /sc onlogon ^
  /tr "node C:\path\to\worker\src\index.js" /rl HIGHEST
```

Alternativa más robusta: NSSM (`nssm install MenteActivaWorker`).

## Variables de entorno

Ver `.env.example` para la lista completa con defaults.
