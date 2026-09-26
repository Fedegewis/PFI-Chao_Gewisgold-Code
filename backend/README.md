# MenteActiva — Backend

API REST para el sistema de seguimiento cognitivo MenteActiva.

## Requisitos previos

- **Node.js** >= 20 (probado con v24.18; cualquier versión LTS >= 20 debería funcionar)
- **PostgreSQL** >= 15 (probado con 17.11)

## Setup desde cero (Windows)

### 1. Instalar PostgreSQL

Descargar el instalador desde https://www.postgresql.org/download/windows/ e instalarlo con las opciones por defecto. Anotar la contraseña elegida para el usuario `postgres`.

Si `psql` no se reconoce como comando después de instalar, agregar el directorio `bin` al PATH. Ejemplo para PostgreSQL 17:

```
set PATH=%PATH%;C:\Program Files\PostgreSQL\17\bin
```

Para hacerlo permanente, agregarlo desde: Sistema → Variables de entorno → Path.

### 2. Crear la base de datos

```bash
psql -U postgres -c "CREATE DATABASE menteactiva;"
```

Ingresará la contraseña del usuario `postgres`.

### 3. Clonar e instalar dependencias

```bash
cd backend
npm ci
```

(`npm ci` instala exactamente las versiones del lockfile. Usar `npm install` si no existe `package-lock.json`.)

### 4. Configurar variables de entorno

```bash
copy .env.example .env
```

Editar `.env` y poner la contraseña real de PostgreSQL en `DB_PASSWORD`.

### 5. Ejecutar migraciones

```bash
npm run migrate
```

### 6. Ejecutar seed (datos iniciales)

```bash
npm run seed
```

Carga 10 secciones cognitivas y 45 preguntas del banco legacy.

### 7. Verificar con tests

```bash
npm test
```

Esperado: 5 tests pasando.

### 8. Iniciar el servidor en desarrollo

```bash
npm run dev
```

El servidor queda escuchando en `http://localhost:3001`. Verificar con:

- `http://localhost:3001/api/health`
- `http://localhost:3001/api/sections`
- `http://localhost:3001/api/sections/1/questions`

## Después de `git pull` / cambio de rama / cambio de PC

Git trae los archivos de migración pero **no** los aplica a PostgreSQL. Después de cualquier actualización que traiga migraciones nuevas:

```bash
cd backend
npm install
npm run migrate
npx knex migrate:status --knexfile src/db/knexfile.js
```

`migrate:status` debe mostrar todas las migraciones en columna `Completed`. Si alguna aparece como `Pending`, volver a correr `npm run migrate`.

Si nunca corriste migraciones en esta PC, la primera vez usar `npm run db:reset` (rollback total + migrate + seed) o correr `migrate` + `seed` por separado.

## Antes de correr tests

Los backend tests usan la MISMA base de datos que la app (`menteactiva`), no una DB separada. El schema debe estar migrado antes de correr los tests, o fallarán con errores de columna faltante.

```bash
npm run migrate
npm test
```

Si aparece un error tipo `column "..." does not exist` o `relation "..." does not exist`, corré `npm run migrate` primero.

## Scripts disponibles

| Script | Comando | Qué hace |
|---|---|---|
| `dev` | `npm run dev` | Inicia el servidor con --watch (reinicia ante cambios) |
| `start` | `npm start` | Inicia el servidor sin watch |
| `migrate` | `npm run migrate` | Ejecuta migraciones pendientes |
| `migrate:rollback` | `npm run migrate:rollback` | Revierte la última migración |
| `seed` | `npm run seed` | Ejecuta los seeds (borra datos existentes de sections/questions) |
| `test` | `npm test` | Ejecuta los tests con node:test |
| `db:reset` | `npm run db:reset` | Rollback completo + migrate + seed |

## Variables de entorno

Definidas en `.env` (no comiteado). Copiar `.env.example` como base.

| Variable | Default | Descripción |
|---|---|---|
| `DB_HOST` | `localhost` | Host de PostgreSQL |
| `DB_PORT` | `5432` | Puerto de PostgreSQL |
| `DB_NAME` | `menteactiva` | Nombre de la base de datos |
| `DB_USER` | `postgres` | Usuario de PostgreSQL |
| `DB_PASSWORD` | `postgres` | Contraseña de PostgreSQL |
| `PORT` | `3001` | Puerto del servidor Express |
| `FRONTEND_URL` | `http://localhost:5179` | URL pública del frontend, usada para construir el link en emails de invitación. Sin slash final. |
| `RESEND_API_KEY` | (opcional) | Clave del proveedor Resend. Si falta, el envío por email responde 503 y sólo funciona "Copiar enlace". |
| `EMAIL_FROM` | (opcional) | Dirección remitente (ej. `MenteActiva <no-reply@dominio.com>`). Obligatoria si se activa el envío por email. |
| `EMAIL_REPLY_TO` | (opcional) | Dirección Reply-To para el email de invitación. |

## Envío de invitación por email (opcional)

El envío por email vía Resend es **opcional**. Sin `RESEND_API_KEY` + `EMAIL_FROM` configuradas:
- `POST /api/invitations` (crear invitación) sigue funcionando.
- El botón "Copiar enlace" del frontend sigue funcionando.
- `POST /api/invitations/:id/send-email` responde `503 email_not_configured`.

En producción (Render) hay que configurar `RESEND_API_KEY`, `EMAIL_FROM` y `FRONTEND_URL`. La API key **nunca** debe estar en el frontend (Vercel) ni en variables `VITE_*`.

Detalle de seguridad: el backend nunca persiste el token plaintext. El endpoint de envío por email requiere que el frontend le pase el token temporal (obtenido al crear la invitación) y el backend lo valida por SHA-256 contra `token_hash`. Las invitaciones pendientes recuperadas después de un reload (`GET /api/invitations`) no incluyen el token — por eso el botón "Enviar por email" sólo se ofrece justo después de crear la invitación.
