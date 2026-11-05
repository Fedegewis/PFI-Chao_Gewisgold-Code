# F2 + F3 — Acceso sin contraseña de pacientes y sesiones persistentes

Rama: `feature/patient-passwordless-auth`. Depende de F0 (proxy same-origin
`/api`) y F1 (`users.allow_passwordless`).

## 1. Qué hace

1. El paciente toca **«Ingresar con un enlace a mi correo»** en la pantalla de
   ingreso y escribe su correo.
2. El backend responde siempre lo mismo («Si el correo corresponde a una cuenta
   habilitada, te enviamos un enlace»). Sólo si el correo es de un paciente
   activo con `allow_passwordless=true` emite un enlace y lo manda por Resend.
3. El correo contiene `https://<frontend>/#/enlace/<token>`. El token va en el
   **fragmento**: el navegador no lo envía al servidor al abrir la página ni en
   el `Referer`.
4. La app saca el token de la URL (`history.replaceState`) antes del primer
   render, lo guarda sólo en memoria y muestra un botón **«Ingresar»**. Al
   tocarlo, lo envía en el **body** de `POST /api/auth/patient-link/consume`.
   No se canjea automáticamente: los antivirus de correo que abren enlaces no
   lo consumen.
5. El backend consume el enlace (un solo uso, atómico), crea una sesión
   persistente y responde con una **cookie HttpOnly** + un token anti-CSRF que
   el frontend guarda en memoria.
6. Al recargar, la app llama `GET /api/auth/patient-session` y recupera la
   sesión sin pedir nada. «Salir» la revoca en el backend.

Los métodos existentes (paciente con contraseña, profesional con contraseña,
Google) **no cambian**: siguen usando JWT en `Authorization: Bearer`.

## 2. Modelo de datos (migraciones aditivas 019–021)

| Migración | Tabla | Contenido |
|---|---|---|
| `20261104_019_create_patient_login_links` | `patient_login_links` | `token_hash` (SHA-256, único), `expires_at` (CHECK ≤ created_at + 30 min), `consumed_at`, `invalidated_at`, FK `users` ON DELETE CASCADE |
| `20261104_020_create_patient_auth_sessions` | `patient_auth_sessions` | `token_hash` (único), `previous_token_hash` + `rotated_at` (gracia de rotación), `expires_at` (CHECK ≤ created_at + 30 días), `last_used_at`, `revoked_at`, `revoked_reason` (CHECK), FK CASCADE |
| `20261104_021_create_auth_rate_limits` | `auth_rate_limits` | `(scope, key_hash, window_start)` PK, `count`. `key_hash` = HMAC del email/IP con clave del servidor |

- Ningún token se guarda en claro. No se guardan IP ni user-agent.
- No se modifican `users`, contraseñas ni sesiones de entrenamiento existentes.
- `down` de cada migración sólo elimina su tabla.

## 3. Endpoints

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/auth/passwordless/config` | — | `{enabled}`: flag + Resend + `FRONTEND_URL` |
| POST | `/api/auth/patient-link/request` | — | `{email}` → 202 genérico / 400 email inválido / 429 / 503 deshabilitado |
| POST | `/api/auth/patient-link/consume` | — | `{token}` → 200 `{user, csrf_token, expires_at}` + `Set-Cookie` / 410 `invalid_link` / 429 / 503 |
| GET | `/api/auth/patient-session` | cookie | restaura sesión (rota el token cada 24 h) / 401 |
| POST | `/api/auth/patient-session/logout` | cookie + CSRF | revoca esta sesión, borra cookie (204) |
| POST | `/api/auth/patient-session/logout-all` | cookie + CSRF | revoca todas las sesiones del paciente |
| GET | `/api/patients/:id/access` | profesional dueño | + `has_password`, `active_sessions`, `passwordless_login_available` |
| PATCH | `/api/patients/:id/access` | profesional dueño | `{allow_passwordless, confirm_revoke_sessions?}` — D5/E2 |
| POST | `/api/patients/:id/access/revoke-sessions` | profesional dueño | revoca todas las sesiones sin cambiar el permiso |

`requireAuth` acepta, **sólo si no hay `Authorization: Bearer`**, la cookie de
sesión de paciente. Con Bearer el comportamiento es idéntico al anterior.

## 4. Seguridad

### Enlaces
- Token: 32 bytes de `crypto.randomBytes` (base64url, 256 bits).
- Vence a los **30 minutos**; un solo uso: `UPDATE … SET consumed_at WHERE
  token_hash=? AND consumed_at IS NULL AND invalidated_at IS NULL AND
  expires_at > now() RETURNING` — PostgreSQL serializa el acceso a la fila,
  así que dos canjes simultáneos producen exactamente una sesión (test con 5
  requests concurrentes).
- Pedir un enlace nuevo invalida los pendientes. Canjear uno invalida el resto.
- Si Resend falla, el enlace recién creado se invalida (no queda un token vivo
  que nadie recibió).
- La búsqueda del paciente, la emisión y el envío se hacen **después** de
  responder: el tiempo de respuesta no depende de si el correo existe.
- Respuestas idénticas para email desconocido, sin permiso, inactivo o de
  profesional. Los contadores de rate limit se incrementan igual para todos.
- Logs: sólo códigos de evento (`link_sent`, `email_failed`, …). Nunca email,
  token, enlace ni id de enlace.
- `Cache-Control: no-store` y `Referrer-Policy: no-referrer` en estos endpoints.

### Rate limiting (ventana fija, persistido en PostgreSQL)
| Scope | Default | Variable |
|---|---|---|
| pedidos por email / 15 min | 3 | `PASSWORDLESS_EMAIL_LIMIT_15MIN` |
| pedidos por email / día | 10 | `PASSWORDLESS_EMAIL_LIMIT_DAY` |
| pedidos por IP / 15 min | 20 | `PASSWORDLESS_IP_LIMIT_15MIN` |
| canjes por IP / 15 min | 30 | `PASSWORDLESS_CONSUME_IP_LIMIT_15MIN` |

### Cookie de sesión
```
__Host-ma_patient_session=<token>; Path=/; HttpOnly; SameSite=Strict; Max-Age=<≤ 2592000>; Secure
```
- `__Host-` + `Secure` cuando `NODE_ENV=production` (o `AUTH_COOKIE_SECURE=true`).
  En desarrollo por http: `ma_patient_session` sin `Secure`.
- Sin `Domain`: la cookie queda atada al host del frontend (Vercel), porque el
  navegador sólo habla con `/api` del mismo origen (F0).
- `SameSite=Strict`: el enlace del correo es una navegación cross-site, pero la
  cookie se crea después, con el `fetch` same-origin del canje; los requests
  siguientes de la SPA son same-site y la incluyen.
- Vencimiento **absoluto** de 30 días (CHECK en DB). La rotación diaria cambia
  el token pero no extiende el vencimiento. El token anterior sirve 2 minutos
  más (dos pestañas que recargan a la vez no se desloguean).
- La sesión deja de valer si: se revoca, vence, el paciente queda inactivo, se
  le quita `allow_passwordless`, o se apaga el kill switch.

### CSRF
- Toda request no-GET autenticada por cookie exige `X-CSRF-Token` =
  `HMAC(clave derivada de JWT_SECRET, id de sesión)`. El frontend lo recibe en
  el body de consume/restore y lo guarda sólo en memoria.
- Un sitio ajeno no puede leerlo (CORS sin `credentials`, allowlist) ni
  calcularlo. Además `SameSite=Strict` evita que la cookie viaje en requests
  iniciados desde otro sitio.
- Requests con Bearer no requieren CSRF (no usan cookies).

### Frontend
- localStorage: sólo `ma_patient_session_hint = "1"` (indica que hay que
  intentar restaurar). Sin tokens, CSRF, enlaces ni datos del paciente.
- El token del enlace nunca aparece en URLs de requests (va en el body).
- El script de Google Identity Services sólo se carga en `LoginScreen`, que no
  se renderiza en `#/enlace`; además el token ya se quitó de la URL.
- La opción sólo se muestra si la API es same-origin (`isSameOriginApi`) y el
  backend la reporta disponible.

### Enlace abierto en otro navegador o dispositivo
Funciona: la posesión del correo es el factor. La sesión queda en el navegador
donde se tocó «Ingresar»; el que pidió el enlace no recibe nada. Es el
comportamiento esperado (p. ej. pedir desde la PC y abrir en el celular).
Riesgo asociado: quien controle el correo del paciente puede ingresar. Es el
mismo modelo que «olvidé mi contraseña».

## 5. Reglas F1

- **D5** — No se puede desactivar el último método de acceso. Hoy: un paciente
  sin `password_hash` y con `allow_passwordless=true` → `PATCH … false` responde
  `409 last_access_method`. La UI deshabilita el switch y lo explica.
- **E2** — Desactivar `allow_passwordless`:
  1. Si hay sesiones abiertas y no llega `confirm_revoke_sessions: true` →
     `409 confirmation_required` con `active_sessions` (la UI muestra el aviso
     antes de enviar nada).
  2. Con confirmación (o sin sesiones): en una transacción, revoca las sesiones
     (`passwordless_disabled`), invalida enlaces pendientes y guarda el permiso.

## 5b. Invitación aceptada sin contraseña (2026-11-05)

La invitación por correo (`#/invite/<token>`) deja entrar directo, sin crear
una contraseña:

- `GET /api/invitations/lookup` agrega `passwordless_available`: kill switch
  encendido + correo configurado + `FRONTEND_URL` (sin correo el paciente no
  podría volver a entrar cuando la sesión venza).
- `POST /api/invitations/:token/accept` con `{passwordless: true}` (booleano
  estricto) crea al paciente con `password_hash = NULL` y
  `allow_passwordless = true`, y en la MISMA transacción abre una sesión F3:
  responde 201 con `{user, csrf_token, expires_at}` + `Set-Cookie` (sin JWT),
  `Cache-Control: no-store`. Flujo apagado o sin correo → 503
  `passwordless_unavailable` sin consumir la invitación. Vencida, revocada o
  usada → mismos códigos que con contraseña.
- Frontend: si `passwordless_available` y la API es same-origin, la pantalla
  muestra «Ingresar» (no acepta sola al abrir el enlace, por los antivirus de
  correo) y la opción «Prefiero crear una contraseña». Si no, el formulario
  con contraseña de siempre.
- Volver a entrar: la sesión dura 30 días; después, «Ingresar con un enlace a
  mi correo» en la pantalla de ingreso. D5 impide que el profesional le quite
  el enlace mientras no tenga contraseña.
- Sin migraciones: usa columnas y tablas existentes (017, 020).

## 6. Despliegue (NO ejecutado — pasos manuales)

### 6.1 Orden
1. **Backup / branch de Neon** antes de migrar (Neon branching o `pg_dump`).
2. **Migrar Neon ANTES de mergear** (Render despliega al mergear y no migra):
   ```bash
   DATABASE_URL=<neon> npm --prefix backend run migrate
   ```
   Aplica 019, 020, 021 (sólo `CREATE TABLE` / índices / CHECK; sin locks
   largos sobre tablas existentes). Verificar con
   `npx knex migrate:list --knexfile backend/src/db/knexfile.js`.
3. Configurar variables (6.2) con el flag **apagado**.
4. Mergear el PR → Render y Vercel despliegan.
5. Smoke tests con el flag apagado (login profesional, paciente con contraseña,
   Google, invitaciones): deben comportarse igual que antes.
6. Activación controlada (6.5).

### 6.2 Render (backend)
| Variable | Valor |
|---|---|
| `PATIENT_PASSWORDLESS_ENABLED` | `false` al desplegar; `true` para activar |
| `FRONTEND_URL` | URL pública de Vercel (ya existe) |
| `RESEND_API_KEY`, `EMAIL_FROM` | ya existen (invitaciones) |
| `NODE_ENV` | `production` (activa `Secure` + `__Host-`) |
| `TRUST_PROXY` | saltos de proxy hasta el cliente (ver 6.3) |
| `PASSWORDLESS_*_LIMIT_*` | opcionales |

`JWT_SECRET` también deriva la clave de CSRF y de los hashes de rate limit:
rotarlo invalida los CSRF vigentes (los pacientes recargan y listo).

### 6.3 Vercel y proxy same-origin
- `vercel.json` ya reescribe `/api/*` a Render (F0). El frontend debe tener
  `VITE_API_URL=/api` (si apunta a la URL absoluta de Render, la opción no se
  muestra porque las cookies no viajarían).
- Las rewrites externas de Vercel reenvían `Cookie` y devuelven `Set-Cookie`;
  la cookie queda en el dominio de Vercel. **Verificar en el preview** que
  `Set-Cookie` llega al navegador con `__Host-` y que `GET
  /api/auth/patient-session` la recibe.
- IP real: browser → Vercel → balanceador de Render → Express. Sin
  `TRUST_PROXY`, `req.ip` es la IP del balanceador y el límite por IP pasa a
  ser **global**. Probar con `TRUST_PROXY=2` en el preview y confirmar (log
  temporal o endpoint de diagnóstico) que `req.ip` es la IP pública del
  cliente antes de dejarlo fijo. Mientras no esté verificado, subir
  `PASSWORDLESS_IP_LIMIT_15MIN` (p. ej. 200): el límite por email sigue
  protegiendo cada cuenta.
- `CORS_ORIGINS` debe seguir incluyendo el dominio de Vercel (los POST
  same-origin llevan `Origin`).

### 6.4 Pruebas con Resend real (preview, cuenta de prueba propia)
1. Crear un paciente de prueba con un correo propio y activar el permiso.
2. Pedir el enlace; verificar remitente, asunto, que el enlace sea
   `https://<vercel>/#/enlace/…` y que **Resend no tenga activado el
   seguimiento de clics** (Resend → Domains → Click tracking OFF): si lo
   estuviera, el enlace pasaría por un dominio de Resend con el token adentro.
3. Abrir el enlace en el celular (otro dispositivo) → Ingresar → recargar →
   Salir. Repetir el mismo enlace → «Este enlace ya no sirve».
4. Pedir 4 veces seguidas → el 4.º responde «Esperá unos minutos».
5. En Neon: `SELECT count(*) FROM patient_login_links WHERE token_hash ~ '^[0-9a-f]{64}$'`
   y confirmar que no hay tokens en claro; revisar logs de Render: sólo
   eventos `[patient-passwordless] …` sin datos.
6. Nota: Resend conserva el contenido de los correos enviados en su panel.
   Es inherente a usar un proveedor de correo; lo mitigan el vencimiento de
   30 minutos y el uso único.

### 6.5 Activación controlada
1. `PATIENT_PASSWORDLESS_ENABLED=true` en Render (sin redeploy de frontend:
   el botón aparece cuando `/auth/passwordless/config` devuelve `enabled`).
2. Habilitar el permiso sólo a 1–2 pacientes piloto desde el panel profesional.
3. Monitorear logs (`email_failed`, `consume_rejected`) y la tabla
   `patient_auth_sessions` durante unos días antes de ampliar.

### 6.6 Rollback
- **Rápido (sin deploy):** `PATIENT_PASSWORDLESS_ENABLED=false`. Efecto
  inmediato: se oculta la opción, `request/consume` → 503 y **las cookies dejan
  de autenticar** (kill switch). Los JWT no se ven afectados.
- **Revocar todo:** `UPDATE patient_auth_sessions SET revoked_at = now(),
  revoked_reason = 'logout_all' WHERE revoked_at IS NULL;`
- **Código:** revertir el merge. Las tablas nuevas pueden quedar (nadie las
  usa); si se quieren quitar, `npm --prefix backend run migrate:rollback` sólo
  después de revertir el código, y verificando que el último batch sea el de
  019–021.

### 6.7 Conservar la autenticación tradicional ante una falla
- Login con contraseña, Google y la aceptación de invitaciones no pasan por
  este módulo: `requireAuth` con Bearer es idéntico al anterior.
- Mientras el flujo no esté probado, **no quitar contraseñas** a pacientes.
  D5 impide además desactivar el enlace a quien no tiene contraseña.
- Riesgo: un paciente **sin contraseña** depende del enlace. Si se apaga el
  kill switch, ese paciente no puede ingresar hasta que se reactive. Hoy todos
  los pacientes creados por invitación tienen contraseña.

## 7. Riesgos y pendientes conocidos
- `TRUST_PROXY` no verificado en Vercel → Render (ver 6.3).
- Comportamiento de `Set-Cookie` a través de la rewrite de Vercel: probado
  localmente con el proxy de Vite (mismo esquema), falta confirmarlo en preview.
- Sin UI para que el paciente cierre sesión en todos sus dispositivos (el
  endpoint existe; el profesional sí tiene el botón).
- El rate limit es de ventana fija (ráfagas en el borde de dos ventanas).
- Un antivirus de correo que ejecute JS y haga clic en botones podría
  consumir el enlace; el paciente vería «Este enlace ya no sirve» y puede
  pedir otro.
