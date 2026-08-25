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
