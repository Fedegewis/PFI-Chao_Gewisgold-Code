# MenteActiva

## Proyecto

**Título:** "MenteActiva: Sistema gamificado de seguimiento cognitivo para adultos mayores en el Área Metropolitana de Buenos Aires"

Sistema orientado al seguimiento y estimulación cognitiva de adultos mayores, con apoyo al profesional mediante IA. NO es un sistema de diagnóstico clínico autónomo. Evitar infantilización del adulto mayor en contenido y UX.

Tesis universitaria. Deadline aproximado: finales de octubre 2026. Entregables: documento escrito, demo funcional, defensa oral.

## Arquitectura decidida

### Aplicación

```
React 19 + Vite + Tailwind v4
  → Node.js + Express
    → PostgreSQL (Knex como query builder + migraciones)
```

### Inferencia IA

```
Node.js → HTTP → Ollama → modelo Llama → Node.js → validación → PostgreSQL / frontend
```

### Pipeline ML (separado del backend)

```
/ml (Python)
  → dataset
  → baseline (Llama base + prompt)
  → entrenamiento LoRA/QLoRA
  → evaluación
  → exportación/conversión a GGUF
```

### Decisiones cerradas

- Backend: Node.js + Express. NO migrar a FastAPI.
- Base de datos: PostgreSQL. NO migrar a SQLite.
- Query builder: Knex (con migraciones explícitas).
- Frontend: React 19 + Vite + Tailwind v4.
- Frontend y backend todavía NO están integrados. La integración será en Etapa 9.
- Ollama es el servidor/entorno de inferencia, NO el modelo.
- Pipeline ML en Python, separado del backend Node.js.
- Los mocks/localStorage del frontend todavía NO deben eliminarse. Se reemplazarán progresivamente durante frontend integration (Etapa 9).
- Las 43 preguntas legacy permanecen como `is_validated=false`. Solo preguntas con `is_active=true AND is_validated=true` se asignan en sesiones.
- Los tests usan fixtures propias con preguntas validadas; no dependen del seed.
- Llama NO seleccionará preguntas. La selección es responsabilidad del backend.
- Llama NO calculará métricas determinísticas. Accuracy, completion rate, latencias y métricas matemáticas son responsabilidad de Node.js.
- Llama se utilizará para interpretación/contextualización destinada al profesional. Siempre en lenguaje descriptivo, no diagnóstico.
- Llama NO debe diagnosticar, recomendar tratamiento, reemplazar al profesional, conversar con el paciente, ni inventar datos.
- No habrá interacción conversacional Llama ↔ paciente en el diseño final. El chat IA simulado actual (`AiChatPanel.jsx`) no representa la arquitectura final.
- Los pacientes y métricas mock del frontend se reemplazarán posteriormente durante frontend integration.
- Un profesional gestiona solamente sus propios pacientes. Professional A NO accede a datos de Professional B.
- La autorización de ownership se resolverá en backend cuando se implemente auth (Etapa 5).
- NO se confiará en `professional_id` enviado libremente por frontend una vez implementada autenticación.
- No se reescribirá el frontend desde cero; la integración será incremental (Etapa 9).

## Hardware del desarrollador

- CPU: AMD Ryzen 5 3600 (6c/12t)
- RAM: 32 GB
- GPU: AMD Radeon RX 5500 XT, 8 GB VRAM (RDNA 1, NO CUDA)
- SSD: ~1 TB
- OS: Windows 10

**Estrategia:** Fine-tuning local NO es objetivo. Entrenamiento/adaptación en cloud (Colab/Kaggle). Inferencia/demo local mediante Ollama en CPU.

**Modelo candidato inicial:** Llama 3.1 8B Instruct cuantizado (GGUF). Plan B: Llama más pequeño si 8B resulta demasiado lento en mediciones reales. Los tiempos de inferencia son estimaciones hasta medirlos experimentalmente.

## Rol de Llama

Llama tiene UNA responsabilidad principal: recibir información estructurada de sesiones y generar un informe/contexto estructurado para el profesional.

**Input:** resultados por sección, métricas, respuestas relevantes, latencias, histórico, evolución, instrucciones del profesional.

**Output:** resumen, resultados relevantes, patrones observables, evolución, puntos de atención/profundización. Siempre en lenguaje descriptivo, no diagnóstico.

### Llama NO debe

- Diagnosticar ni afirmar deterioro/demencia
- Recomendar medicación ni tratamiento
- Reemplazar al profesional
- Generar preguntas en tiempo real
- Seleccionar preguntas
- Determinar arbitrariamente respuestas correctas
- Conversar libremente con el paciente
- Inventar datos ni resultados

## ⚠ WIP — ESTADO DE QUESTION-BANK (2026-08-31)

**ATENCIÓN: hay cambios WIP no commiteados que fueron creados bajo una interpretación conceptual incorrecta. NO tomarlos como fuente de verdad. Leer esta sección completa antes de continuar.**

### Contexto

`feature/question-bank` ya integró `origin/main`. La rama contiene:
- Backend heredado de `feature/session-results`
- Frontend actualizado de `main` (incluye `COGNITIVE_DOMAINS`, `activeDomains`, `AiConfigPanel` con chips toggle)

### Interpretación incorrecta (OBSOLETA)

Se asumió erróneamente que la jerarquía era: DOMINIO → SECCIÓN → PREGUNTA (las secciones como subdivisiones de los dominios). Esto generó una migración 005 que renombró secciones, desactivó `atencion_visual`, y creó secciones nuevas (`atencion_selectiva`, `razonamiento_practico`). **Esa migración es incorrecta.**

### Modelo conceptual CORRECTO (aprobado por el usuario)

Las ACTIVIDADES/SECCIONES y los DOMINIOS COGNITIVOS son dimensiones diferentes:

```
ACTIVIDAD/SECCIÓN (contexto temático: "supermercado", "receta", etc.)
  └── tiene muchas PREGUNTAS

PREGUNTA
  ├── pertenece a una ACTIVIDAD/SECCIÓN
  └── trabaja uno o más DOMINIOS COGNITIVOS (relación N:M)

PACIENTE
  ├── activeDomains: subset de los 5 dominios (configura el psicólogo)
  └── maxQuestions: cantidad total (configura el psicólogo)
```

**NO es:** DOMINIO → SECCIÓN → PREGUNTA.

### Las 10 actividades/secciones del frontend

| id | Título visible | skill (subtítulo) |
|---|---|---|
| `market` | Lista del supermercado | Memoria de trabajo |
| `bus` | Pagar el boleto | Atención y cálculo |
| `recipe` | Ordenar una receta | Funciones ejecutivas |
| `calendar` | Agenda de turnos | Orientación temporal |
| `names` | Caras y nombres | Memoria asociativa |
| `wellbeing` | Cómo me siento hoy | Autorreporte y metacognición |
| `medication` | Tomar la medicación | Rutina y memoria prospectiva |
| `home` | Objetos de la casa | Atención visual |
| `phone` | Mensajes y llamadas | Comprensión funcional |
| `orientation` | Camino al barrio | Orientación y decisión |

Definidas en `src/data/activities.js`. Son contextos temáticos cotidianos, NO categorías cognitivas.

### Los 5 dominios cognitivos

Definidos en `src/constants/appConfig.js:65-71` como `COGNITIVE_DOMAINS`: Memoria, Atención, Funciones ejecutivas, Orientación, Comprensión y lenguaje.

Implementado en el frontend:
- `AiConfigPanel.jsx`: chips toggle para activar/desactivar dominios por paciente
- `patient.activeDomains`: array almacenado en localStorage, default = todos activos
- `patient.maxQuestions`: cantidad total configurable (1-10)
- Validación: `resolveActiveDomains()` requiere al menos 1 dominio

Actualmente los dominios activos **no afectan** la selección de preguntas — son metadata almacenada para uso futuro en Etapa 9.

### Modelo de datos pendiente de implementar

Relación pregunta ↔ dominio: tabla normalizada `cognitive_domains` + tabla pivote `question_cognitive_domains`. Todavía NO implementado.

`questions.subdimension VARCHAR(120) NULLABLE`: metadata interna útil, migración 004 creada y probablemente correcta.

### Cambios WIP no commiteados — clasificación

| Archivo | Estado | Acción próxima sesión |
|---|---|---|
| Migración 004 (`add_question_subdimension`) | Probablemente correcto | CONSERVAR |
| Migración 005 (`reorganize_sections`) | **INCORRECTO** — basado en modelo obsoleto | DESCARTAR/REEMPLAZAR |
| Seed (`001_sections_and_questions.js`) | Estrategia idempotente útil, pero tiene slugs renombrados incorrectos | MODIFICAR — volver a 10 secciones originales |
| `sections.test.js` | Adaptado al modelo incorrecto | MODIFICAR — volver a 10 secciones originales |
| `CLAUDE.md` | Este documento — marcado como WIP | MODIFICAR — actualizar después de corregir |

### ⚠ Migración 005 ya ejecutada localmente

La migración 005 incorrecta YA FUE EJECUTADA en la DB local de esta computadora. La próxima sesión debe:
1. Inspeccionar `knex_migrations` para ver qué migraciones corrieron
2. En otra computadora la DB local puede tener estado diferente
3. Resolver el rollback o reemplazo de 005 antes de continuar

### Próximos pasos (NO implementados)

1. Corregir el checkpoint: descartar 005, restaurar secciones originales, crear migración correcta con `cognitive_domains` table + `question_cognitive_domains` pivote
2. Diseñar matriz ACTIVIDAD × DOMINIO COGNITIVO para determinar qué combinaciones tienen sentido
3. Recién entonces definir tamaño y contenido del banco de preguntas
4. Las 43 preguntas legacy NO deben reclasificarse, reformularse, ni recibir dominios hasta resolver el modelo

### Selección futura de preguntas (diseño conceptual, NO implementado)

```
Paciente elige actividad → banco de esa actividad
  + dominios activos del paciente (activeDomains)
  + cantidad (maxQuestions)
  + is_active=true AND is_validated=true
  + filtro: pregunta trabaja al menos un dominio activo
  + prevención de repetición (ventana 3 sesiones)
  + dificultad (futuro)
  → N preguntas seleccionadas
```

## Estrategia de preguntas

Banco controlado por sección en PostgreSQL. El profesional selecciona usuario, sección/es y cantidad. El backend toma preguntas activas+validadas, evita recientes cuando sea posible, selecciona pseudoaleatoriamente, y registra exactamente qué preguntas se asignaron.

Selección implementada en `POST /api/sessions`:
- Elegibles: `is_active = true AND is_validated = true`
- Historial: últimas 3 sesiones del paciente para esa sección (status IN `in_progress`, `completed`, `abandoned`; `created` no cuenta)
- Prioridad: primero no recientes (pseudoaleatorio), fallback a recientes si no alcanzan
- Error si `eligible < requested` (no reduce silenciosamente)
- Constante: `RECENT_SESSION_WINDOW = 3`
- Shuffle: Fisher-Yates con `rng` inyectable para tests
- Creación de sesión en transacción atómica

Objetivo futuro: banco amplio por actividad/sección (cantidad por definir después de la matriz ACTIVIDAD × DOMINIO). Las preguntas generadas con IA durante desarrollo ingresan como `is_validated=false, source='ai_assisted_v1'`. Solo `is_active=true AND is_validated=true` se usan en sesiones reales.

## Estado actual implementado

### Backend (`/backend`)

- Node.js + Express + Knex + PostgreSQL
- **Tablas:** `sections`, `questions`, `users`, `sessions`, `session_sections`, `session_questions`, `answers`, `session_results`
- **Seed:** ⚠ WIP — actualmente modificado con secciones incorrectas (ver sección WIP arriba). Originalmente: 10 secciones, 43 preguntas legacy (`is_validated=false`, `source='legacy_seed_v1'`). La estrategia idempotente del WIP es correcta en concepto pero debe restaurar las 10 secciones originales.
- **Endpoints:**
  - `GET /api/health`
  - `GET /api/sections`, `GET /api/sections/:id/questions`
  - `POST /api/users`, `GET /api/users/:id`
  - `POST /api/sessions`, `GET /api/sessions/:id`, `POST /api/sessions/:id/start`
  - `POST /api/sessions/:id/answers`, `POST /api/sessions/:id/complete`, `POST /api/sessions/:id/abandon`
  - `GET /api/sessions/:id/results`
- **Tests:** 76 pasando (node:test + supertest, `--test-concurrency=1`)
- **Config:** `.env.example` con placeholders, `.env` excluido de git

Las 43 preguntas legacy permanecen como `is_validated=false`. Solo preguntas con `is_active=true AND is_validated=true` se asignan en sesiones. Los tests usan fixtures propias con preguntas validadas.

### Frontend (`/src`)

SPA React 19 + Vite + Tailwind v4 existente. Funciona con localStorage y datos hardcodeados. Todavía NO fue migrado al nuevo backend.

### Código legacy reutilizable

- `src/data/activities.js` — 10 actividades, 43 preguntas (fuente original del seed del backend)
- `src/services/sessionService.js` — lógica de accuracy, latencia, estadísticas (referencia para backend)
- `src/services/patientService.js` — estructura de pacientes (referencia para modelo User)
- `src/ai.js` — integración Ollama anterior + heurísticas de fallback. `recommendDifficulty()` es código muerto (exportado pero nunca importado)
- `src/components/patient/AiChatPanel.jsx` — chat 100% simulado. NO conectar a Llama
- `src/storage/appStorage.js` — toda la persistencia actual es localStorage
- `src/hooks/useAppController.js` — "god hook" con todo el estado de la app

## Scoring y variables

Implementado: `multiple_choice` objetiva con scoring automático. `is_correct` se calcula usando `correct_answer_snapshot`, no la pregunta original.

Preparado en schema: `likert`, `open_short` — sin scoring automático hasta definir comportamiento. Las consultas de accuracy filtran por `is_correct IS NOT NULL` para excluir futuras respuestas no puntuables.

Variables numéricas implementadas en `session_results` (persistidas al completar sesión):
- total_questions, answered_questions, correct_count, incorrect_count, unanswered_count
- accuracy = correct_count / scored_answers (NULL si scored_answers = 0, donde scored_answers = count de answers con is_correct IS NOT NULL)
- completion_rate = answered_questions / total_questions
- mean_latency_ms, min_latency_ms, max_latency_ms, latency_std_ms (STDDEV_POP, N=1 → std=0, N=0 → NULL)
- Métricas por sección + globales (accuracy global ponderada por respuestas, no promedio de secciones)
- Tipos PostgreSQL: accuracy/completion_rate → NUMERIC(5,4), latencias → NUMERIC(10,2)/INTEGER

Node.js calcula las operaciones determinísticas. NO interpretar automáticamente estos números de forma clínica. Llama NO calcula métricas.

## Estrategia ML

**Problema:** datos estructurados de seguimiento cognitivo → informe estructurado para profesional.

**Experimento:** BASELINE (Llama base + prompt) vs ADAPTADO (mismo modelo + LoRA/QLoRA). Ambos reciben exactamente los mismos casos de test. No asumir de antemano que QLoRA será mejor.

**Dataset:**
- Ejemplos manuales (gold)
- Sintéticos controlados (generados programáticamente)
- Outputs asistidos por IA (con metadata de procedencia/validación)
- Variantes de un mismo caso NO pueden quedar repartidas entre train y test
- Test final prioriza casos revisados manualmente
- No afirmar que una cantidad específica de ejemplos garantiza mejora

**Evaluación:** JSON válido, estructura, cobertura de secciones, fidelidad a input, ausencia de alucinaciones, lenguaje no diagnóstico, seguridad, utilidad para profesional. Métricas textuales (ROUGE, BERTScore) solo como secundarias.

## Relación profesional-paciente

La aplicación funciona por profesional. Cada profesional registra y gestiona únicamente sus pacientes. Professional A NO accede a datos de Professional B.

La autorización se resuelve en backend. Una vez que exista autenticación, NO se debe confiar en `professional_id` enviado desde frontend.

## Conceptos UI pendientes de decisión

La UI actual del frontend contiene conceptos como "riesgo bajo/medio/alto", "rendimiento óptimo" y clasificaciones similares. Estos conceptos NO deben asumirse como definitivos para producción:

- NO queremos que Llama invente o determine automáticamente un riesgo clínico.
- NO queremos crear thresholds arbitrarios en Node.js sin justificación metodológica/bibliográfica.
- Durante Etapa 6 (feature/ai-contract) se decidirá si estos conceptos se eliminan, se renombran, o se reemplazan por descripciones no diagnósticas (ej: "aspectos a revisar", "variaciones observadas", "evolución respecto de sesiones anteriores").

## Decisiones pendientes por etapa

Las siguientes cuestiones se resolverán en sus respectivas etapas. NO están cerradas:

**Etapa 4 (question-bank):**
- Actividades/secciones: las 10 del frontend se mantienen como unidad de actividad
- Relación pregunta ↔ dominio cognitivo (N:M): pendiente de implementar
- Matriz ACTIVIDAD × DOMINIO: pendiente de diseñar
- Scoring de futuros `response_type` no objetivos (`likert`, `open_short`)
- Dificultad: 1=fácil, 2=media, 3=difícil (interna a MenteActiva, no validada clínicamente)

**Etapa 5 (auth-patient-management):**
- Mecanismo exacto de acceso/autenticación del paciente
- Campos definitivos del perfil profesional (matrícula, especialidad, etc.)

**Etapa 6 (ai-contract):**
- Persistencia y modelo exacto de mood/estado emocional
- Estructura definitiva de notas/instrucciones del profesional
- Estructura definitiva de AI Input v1
- Estructura definitiva de AI Output v1
- Cantidad de sesiones históricas que recibirá Llama
- Estructura definitiva del informe IA
- Thresholds o clasificación de riesgo (ver "Conceptos UI pendientes de decisión")

**Etapa 7 (ml-pipeline):**
- Estructura definitiva del dataset QLoRA

## Deuda técnica

### PRIORITARIA — resolver en feature/question-bank (Etapa 4)

- **Seed destructivo:** ⚠ WIP parcial. Se diseñó una estrategia idempotente (secciones por slug, preguntas por source count) pero el seed WIP tiene secciones renombradas incorrectamente. Debe restaurarse a las 10 secciones originales con la estrategia idempotente. El seed commiteado (`HEAD`) todavía es destructivo.

### Para feature/auth-patient-management (Etapa 5)

- **`sessions.js` concentra toda la lógica:** un solo archivo de 539 líneas con `calculateMetrics`, selección pseudoaleatoria y todos los handlers. Funcional con tests pasando, pero se complicará al agregar auth middleware. Considerar refactor incremental antes o durante auth.

### Para feature/frontend-integration (Etapa 9)

- **Sin CORS:** el backend no tiene middleware CORS. Configurar cuando frontend intente conectarse al backend.

### Limpieza general

- **`cambios.txt` trackeado:** archivo suelto en raíz del repo. Revisar si tiene contenido útil; si no, eliminar y agregar a `.gitignore`.

## Roadmap

### ETAPA 1 — Frontend base
Estado: implementado, con mocks/localStorage.

### ETAPA 2 — Backend foundation
Estado: implementado (Node.js, Express, PostgreSQL, Knex, sections, questions).

### ETAPA 3 — feature/session-results
Estado: **CERRADA.**

**Commit A:** users, sessions, session_sections, session_questions, ciclo de vida (created → in_progress), snapshots de preguntas.

**Commit B:** answers, session_results, métricas determinísticas (accuracy, completion_rate, latencias con STDDEV_POP), complete, abandon, results. Transacción atómica al completar.

**Commit C:** selección pseudoaleatoria (Fisher-Yates con rng inyectable), filtro `is_active=true AND is_validated=true`, prevención de preguntas recientes (ventana de últimas 3 sesiones relevantes por paciente y sección), fallback cuando no alcanzan preguntas no recientes, aislamiento por paciente, aislamiento por sección, `created` excluida del historial de preguntas vistas, creación atómica mediante transacción.

Tests: 76 pasando (0 fail).

### ETAPA 4 — feature/question-bank
Estado: **EN PROGRESO — con cambios WIP pendientes de corrección.**

**Completado:**
- Auditoría del banco existente (43 preguntas legacy, 10 actividades/secciones)
- Descubrimiento: actividades y dominios son dimensiones ortogonales (no jerárquicas)
- Identificación del modelo correcto: pregunta ↔ dominio es N:M
- Migración 004: `questions.subdimension` columna (probablemente correcta)

**WIP incorrecto (ver sección ⚠ WIP arriba):**
- Migración 005: reorganización basada en modelo DOMINIO→SECCIÓN incorrecto — DESCARTAR
- Seed: tiene secciones renombradas incorrectamente — RESTAURAR a originales
- Tests: adaptados al modelo incorrecto — RESTAURAR

**Siguiente (después de corregir WIP):**
- Implementar relación N:M pregunta ↔ dominio (`cognitive_domains` + `question_cognitive_domains`)
- Diseñar matriz ACTIVIDAD × DOMINIO
- Definir tamaño del banco de preguntas
- Generar preguntas piloto
- Reclasificación de legacy: KEEP/REFORMULATE/MOVE/DISCARD

### CHECKPOINT GIT

Después de finalizar Etapa 4 (question-bank) se realizará el primer gran merge:

1. `feature/backend-first-step` → `main`
2. `feature/session-results` → `main`
3. `feature/question-bank` → `main`

Respetando dependencias y orden de PRs.

Después de ese checkpoint, las siguientes features se crearán desde `main` actualizado, salvo dependencia que justifique otra estrategia.

### ETAPA 5 — feature/auth-patient-management

Incluye: registro de profesionales, login, autenticación, relación Professional → Patient, alta/gestión de pacientes, ownership, autorización, aislamiento entre profesionales, adaptar endpoints para no confiar en IDs manipulables desde frontend.

### ETAPA 6 — feature/ai-contract

Incluye: auditoría del panel profesional, clasificación de cada dato visible (DB / Node.js / Llama / eliminar / decidir), definir AI Input v1, definir AI Output v1, definir guardrails, definir qué información histórica recibe Llama, resolver conceptos UI pendientes (riesgo, status, etc.).

### ETAPA 7 — feature/ml-pipeline

Incluye: baseline Llama sin adaptación, dataset, ejemplos sintéticos/controlados, QLoRA, evaluación baseline vs adaptado, exportación/merge/conversión para Ollama.

### ETAPA 8 — feature/ai-backend

Incluye: Node.js → Ollama → Llama adaptado → validación estructurada → AiReport → PostgreSQL.

### ETAPA 9 — feature/frontend-integration

Incluye: conectar frontend con backend, reemplazo de pacientes mock, reemplazo de métricas mock cuando exista equivalente real, reemplazo progresivo de localStorage, pacientes/sesiones/resultados reales, informes IA reales, panel profesional alimentado por backend.

### ETAPA 10 — End-to-end / hardening

Incluye: tests, seguridad, permisos, errores, fallback de IA, performance, accesibilidad, preparación de demo, documentación de tesis.

## Reglas de trabajo

- Inspeccionar archivos antes de modificarlos
- No hacer refactors no solicitados
- Cambios pequeños y fáciles de revisar
- Ejecutar tests después de cada etapa
- No avanzar a siguiente etapa sin aprobación en cambios arquitectónicos
- No introducir FastAPI ni SQLite
- No introducir APIs comerciales de IA sin aprobación explícita
- No subir `.env` ni secretos a git. Mantener `.env.example` actualizado
- No considerar contenido generado por IA como validado automáticamente
- Explicar cambios importantes para que puedan defenderse académicamente
- No documentar estimaciones como resultados reales

## Git

**Branch actual:** `feature/question-bank`

**Estado:** ⚠ WIP con cambios no commiteados que requieren corrección. Ver sección "⚠ WIP — ESTADO DE QUESTION-BANK" arriba. La migración 005 es incorrecta y debe descartarse. `origin/main` ya fue integrado en esta rama.

**Estrategia de branches:**

```
main
└── feature/backend-first-step
      └── feature/session-results  ← CERRADA
            └── feature/question-bank  ← EN PROGRESO
```

Los PRs actuales permanecen sin mergear. El primer gran merge será después de completar `feature/question-bank`:

1. `feature/backend-first-step` → `main`
2. `feature/session-results` → `main`
3. `feature/question-bank` → `main`

NO hacer merges prematuros. Después del checkpoint, nuevas features desde `main` actualizado.
