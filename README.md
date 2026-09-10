# MenteActiva

Sistema de seguimiento y estimulación cognitiva para adultos mayores, con apoyo al profesional mediante IA.

Proyecto de tesis universitaria.

## Requisitos previos

- [Node.js](https://nodejs.org/) (v18 o superior)
- npm (incluido con Node.js)
- [PostgreSQL](https://www.postgresql.org/download/windows/) (v14 o superior)
- pgAdmin (opcional, se instala junto con PostgreSQL y facilita la administración visual de la base de datos)

## Clonar el repositorio

```bash
git clone https://github.com/Fedegewis/Tesis_Code.git
cd Tesis_Code
```

## Instalar dependencias

### Frontend (raíz del proyecto)

```bash
npm install
```

### Backend

```bash
cd backend
npm install
```

## Configurar PostgreSQL

Necesitás crear una base de datos local para el proyecto.

### Opción A: desde la terminal (psql)

Abrir una terminal y ejecutar:

```bash
psql -U postgres
```

Dentro de psql:

```sql
CREATE DATABASE menteactiva;
\q
```

### Opción B: desde pgAdmin

1. Abrir pgAdmin y conectarse al servidor local (por defecto `localhost:5432`, usuario `postgres`).
2. Click derecho en **Databases** → **Create** → **Database...**
3. En **Database** escribir `menteactiva`.
4. Click en **Save**.

## Configurar el backend

Desde la carpeta `backend`, copiar el archivo de ejemplo y editarlo con tus credenciales locales:

```bash
copy .env.example .env
```

Abrir `backend/.env` y ajustar los valores. Las variables disponibles son:

| Variable      | Descripción                        | Valor por defecto |
|---------------|------------------------------------|-------------------|
| `DB_HOST`     | Host de PostgreSQL                 | `localhost`       |
| `DB_PORT`     | Puerto de PostgreSQL               | `5432`            |
| `DB_NAME`     | Nombre de la base de datos         | `menteactiva`     |
| `DB_USER`     | Usuario de PostgreSQL              | `postgres`        |
| `DB_PASSWORD` | Contraseña del usuario de PostgreSQL | *(configurar)*  |
| `PORT`        | Puerto del servidor backend        | `3001`            |

**Importante:** no subir el archivo `.env` al repositorio. Ya está incluido en `.gitignore`.

## Ejecutar migraciones

Desde la carpeta `backend`:

```bash
npm run migrate
```

Esto crea todas las tablas necesarias en la base de datos (`sections`, `questions`, `cognitive_domains`, `users`, `sessions`, `answers`, `session_results`, etc.).

## Ejecutar seed inicial

Desde la carpeta `backend`:

```bash
npm run seed
```

El seed carga los datos iniciales:

- 10 secciones/actividades (Lista del supermercado, Pagar el boleto, etc.)
- 5 dominios cognitivos (Memoria, Atención, Funciones ejecutivas, Orientación, Comprensión y lenguaje)
- 77 preguntas (43 legacy + 34 del banco piloto "Objetos de la casa")
- Asociaciones pregunta-dominio (N:M)

El seed es idempotente: ejecutarlo más de una vez no duplica datos.

**Nota:** las preguntas del banco están marcadas como `is_validated=false`. Esto es intencional: no deben presentarse como contenido clínicamente validado. Solo preguntas con `is_active=true` e `is_validated=true` se asignan en sesiones reales.

## Levantar el backend

Desde la carpeta `backend`:

```bash
npm run dev
```

El servidor queda escuchando en `http://localhost:3001` (o el puerto configurado en `.env`).

## Levantar el frontend

Desde la raíz del proyecto:

```bash
npm run dev
```

La aplicación queda disponible en `http://localhost:5179`.

**Nota:** frontend y backend todavía no están integrados. El frontend funciona de forma independiente con datos locales (localStorage/mocks). La integración se realizará en una etapa posterior.

## Verificar que funciona

Con el backend corriendo, abrir en el navegador o ejecutar:

```bash
curl http://localhost:3001/api/health
```

Debería responder con status `200` y un JSON confirmando que la conexión a la base de datos está activa.

## Tests del backend

Desde la carpeta `backend`:

```bash
npm test
```

Ejecuta la suite completa de tests (node:test + supertest). Los tests requieren una base de datos PostgreSQL accesible con las migraciones aplicadas.

## Accesos demo del frontend

| Rol       | Email                    | Clave         |
|-----------|--------------------------|---------------|
| Paciente  | `elena.rios@demo.com`    | `menteactiva` |
| Paciente  | `lucia.herrera@demo.com` | `jardin`      |
| Paciente  | `hector.ramos@demo.com`  | `jardin`      |
| Psicólogo | `psicologa@demo.com`     | `jardin2`     |

Estos accesos son del frontend local (localStorage). No están conectados al backend.

## Scripts disponibles

### Frontend (raíz)

| Comando             | Descripción                        |
|---------------------|------------------------------------|
| `npm run dev`       | Inicia el servidor de desarrollo   |
| `npm run build`     | Genera el build de producción      |
| `npm run preview`   | Sirve el build de producción       |
| `npm test`          | Ejecuta tests (vitest)             |
| `npm run lint`      | Ejecuta ESLint                     |
| `npm run typecheck` | Chequeo de tipos con TypeScript    |

### Backend (`backend/`)

| Comando                  | Descripción                                        |
|--------------------------|----------------------------------------------------|
| `npm run dev`            | Inicia el servidor con watch (reinicio automático)  |
| `npm start`              | Inicia el servidor sin watch                        |
| `npm run migrate`        | Ejecuta migraciones pendientes                      |
| `npm run migrate:rollback` | Revierte la última migración                      |
| `npm run seed`           | Ejecuta el seed de datos iniciales                  |
| `npm run db:reset`       | Rollback completo + migraciones + seed              |
| `npm test`               | Ejecuta la suite de tests                           |

## Solución de problemas

### PostgreSQL no está iniciado

En Windows, PostgreSQL corre como servicio. Si no arranca:

1. Abrir **Servicios** (buscar `services.msc` en el menú inicio).
2. Buscar el servicio `postgresql-x64-XX` (donde XX es la versión).
3. Click derecho → **Iniciar**.

### `psql` o `createdb` no reconocido en Windows

PostgreSQL no agrega sus binarios al PATH automáticamente. Opciones:

- Usar pgAdmin (interfaz gráfica) en lugar de la terminal.
- Agregar manualmente al PATH del sistema: `C:\Program Files\PostgreSQL\XX\bin` (reemplazar XX con tu versión).

### Error de conexión a la base de datos

- Verificar que PostgreSQL esté corriendo.
- Verificar que la base de datos `menteactiva` exista.
- Verificar que los valores en `backend/.env` coincidan con tu instalación local (usuario, contraseña, puerto).

### Migraciones pendientes

Si al levantar el backend o correr tests hay errores de tablas faltantes:

```bash
cd backend
npm run migrate
```

### Puerto ocupado

Si el puerto 3001 o 5179 ya está en uso, verificar qué proceso lo ocupa:

```bash
netstat -ano | findstr :3001
```

También se puede cambiar el puerto del backend modificando `PORT` en `backend/.env`.
