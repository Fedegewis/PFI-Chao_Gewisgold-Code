# Contrato del worker local — MenteActiva

Documento de referencia para la implementación del worker (W-4) que
procesa análisis IA vía Ollama local, invocando los endpoints definidos
por W-1 / W-2 / W-3 del backend.

## Contexto

- El backend corre en Render; PostgreSQL en Neon.
- El worker corre en la PC del desarrollador; Ollama local con
  `llama3.2:3b` (CPU, 60–120 s por inferencia).
- Cuando `AI_PROVIDER=deferred` en el backend, el pipeline in-process NO
  llama a Ollama. Las sesiones completadas quedan pendientes en la cola.
- El worker toma trabajo vía `POST /api/worker/analysis/*` autenticado
  con `WORKER_TOKEN`.

## Reglas obligatorias del worker (W-4)

### Concurrencia

1. **Concurrencia máxima 1.** El worker ejecuta UNA inferencia Ollama por
   vez. No lanza `generate()` paralelos.
2. **No reclamar en paralelo.** Entre llamadas a `/claim` solo puede haber
   una fetch en vuelo.
3. **Backend como defensa adicional.** `WORKER_GLOBAL_CONCURRENCY=1`
   (default) hace que el backend emita a lo sumo UN claim activo por
   instalación. Si por error se lanzan dos procesos worker, el segundo
   recibe 204 hasta que el primero libere su lease. **El worker no puede
   confiar sólo en esto**: también debe respetar su propia concurrencia 1.

### Loop principal

```
loop {
  // 1) Verificar Ollama local
  if ollama_not_healthy:
     sleep 30s; continue

  // 2) Reclamar trabajo
  claim = POST /api/worker/analysis/claim
          Authorization: Bearer $WORKER_TOKEN
  if claim == 204 No Content:
     sleep 10s; continue
  if claim == 5xx or network error:
     exponential backoff (15s..120s); continue
  if claim == 401:
     fatal (log, exit non-zero)

  // 3) Correr Ollama (con heartbeats si tarda > LEASE_DURATION / 2)
  startInference(claim.prompt, claim.model)
  startHeartbeatTicker(every LEASE_DURATION / 3)

  try {
    raw_text = await ollama.generate({ prompt, model, format: "json" })
    stopHeartbeatTicker()

    // 4) Entregar resultado
    res = POST /api/worker/analysis/result
          { claim_id, claim_token, raw_text, latency_ms }
    if res == 200: ok, continue
    if res == 409: lease perdido (crash/reclaimed); dropear, continue
    if res == 422: el backend ya persistió failed y cerró el claim;
                   NO reintentar con este claim, NO enviar /failed; continue
  } catch (ollamaErr) {
    stopHeartbeatTicker()
    POST /api/worker/analysis/failed
         { claim_id, claim_token, error_code: <OLLAMA_*>, error_message, latency_ms }
    // ignorar 409
  }

  // 5) Pausa entre sesiones
  sleep 10s
}
```

### FIFO global

El orden `completed_at ASC` lo decide el backend. El worker no re-ordena:
procesa lo que `/claim` le devuelve. La cola NO filtra por profesional.

### Fallo de una sesión

Si una sesión falla, el worker **sigue con la siguiente**. No "ataca"
nunca a la misma sesión en bucle:
- 409 (CLAIM_LOST) → el claim ya no es suyo; no reintentar.
- 422 (con `retriable` true o false) → al responder, el backend ya
  marcó la fila como `failed` con un `error_code` de generación
  (`ANALYSIS_*`) y anuló `claim_token` y `lease_expires_at`. El worker
  NO reintenta con ese claim ni envía `/failed`: pide el próximo claim.
  La cola puede volver a ofrecer la sesión con un claim nuevo (token y
  lease nuevos), sujeto a `MAX_GENERATION_ATTEMPTS` y al cooldown.
  `retriable` es informativo: indica si otra generación podría pasar el
  validador, no que el claim siga abierto.
- `OLLAMA_OFFLINE/TIMEOUT` → reportar `/failed`, el backend aplica
  cooldown + bucket transient. El próximo `/claim` puede devolver la
  misma sesión u otra; el worker trata ambos casos igual.

### Heartbeats

- **Cuándo:** si la inferencia tarda más que `LEASE_DURATION / 2` (por
  default 2.5 min), enviar un `POST /api/worker/analysis/heartbeat`.
- **Qué:** `{ claim_id, claim_token }`.
- **Respuestas:**
  - 200 → `lease_expires_at` actualizado; seguir trabajando.
  - 409 → el lease ya no es tuyo (expiró, lo reclamó otro worker, o la
    fila ya está en ok/failed). **Abortar la inferencia en curso**; no
    enviar el resultado cuando termine (sería rechazado con 409 igual).
  - 401 → fatal.

### Sin análisis masivos al iniciar

El worker **no corre batch al arranque**. Entra directamente al loop con
`sleep 10s` entre vueltas y confía en el polling. Si al arrancar hay 50
sesiones esperando, se procesan secuencialmente a razón de ~1 cada
(inferencia + 10 s), **no en paralelo**.

### Seguridad

- `WORKER_TOKEN` ≥ 32 chars, nunca commitear, nunca loggear.
- El worker **NO** se conecta a Neon directamente — toda la DB va por el
  backend.
- El worker **NO** expone Ollama (localhost 11434 queda local).
- El prompt que recibe en `/claim` ya es seguro por diseño: lo armó
  `promptBuilder` sin PII, sin `patient_id`, sin emails ni nombres.
- Logs del worker deben truncar `raw_text` y evitar imprimir el prompt
  completo.

### Arranque automático (Windows)

- Ollama: ya trae servicio tray oficial, se autoinicia al login.
- Worker:
  - Opción A (recomendada para empezar): Task Scheduler
    - Trigger: At log on + At startup
    - Action: `C:\...\node.exe D:\...\worker\index.js`
    - "Run whether user is logged on or not" NO necesario
  - Opción B: NSSM `nssm install MenteActivaWorker`

### Variables de entorno del worker

```
WORKER_BACKEND_URL=https://api.menteactiva.ar   # URL pública de Render
WORKER_TOKEN=<same secret as backend>
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b
POLL_INTERVAL_IDLE_MS=10000
POLL_INTERVAL_WAIT_MS=10000
HEARTBEAT_INTERVAL_MS=100000
LOG_FILE=C:/MenteActiva/worker.log
```

## Contratos de los endpoints (recordatorio)

### POST /api/worker/analysis/claim

- Headers: `Authorization: Bearer <WORKER_TOKEN>`
- Body: `{}`
- 200: `{ claim_id, claim_token, session_id, model, schema_version, prompt_version, lease_expires_at, prompt }`
- 204: no hay trabajo
- 401 / 503: auth / token no configurado

### POST /api/worker/analysis/heartbeat

- Headers: `Authorization: Bearer <WORKER_TOKEN>`
- Body: `{ claim_id, claim_token }`
- 200: `{ ok, analysis_id, session_id, lease_expires_at }`
- 400: shape inválido
- 409: claim no vigente

### POST /api/worker/analysis/result

- Body: `{ claim_id, claim_token, raw_text, latency_ms? }`
- 200: `{ ok, analysis_id, session_id }`
- 400 / 409 / 422: ver código `validation_code` y `retriable`

### POST /api/worker/analysis/failed

- Body: `{ claim_id, claim_token, error_code, error_message?, latency_ms? }`
- `error_code` whitelisteado: `OLLAMA_OFFLINE`, `OLLAMA_TIMEOUT`,
  `OLLAMA_HTTP_ERROR`, `OLLAMA_MODEL_NOT_FOUND`, `OLLAMA_EMPTY_RESPONSE`,
  `OLLAMA_INVALID_JSON`, `OLLAMA_CONFIG_INVALID`.
- 200 / 400 / 409 según corresponda.
