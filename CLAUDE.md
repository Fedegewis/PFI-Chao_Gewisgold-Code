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

## Modelo de actividades, preguntas y dominios cognitivos

### Arquitectura conceptual

Las ACTIVIDADES/SECCIONES y los DOMINIOS COGNITIVOS son dimensiones diferentes:

```
ACTIVIDAD/SECCIÓN (contexto temático cotidiano)
        ↓
     PREGUNTA
        ↕ N:M
DOMINIO COGNITIVO

PACIENTE
  ├── activeDomains: subset de los 5 dominios (configura el psicólogo)
  └── maxQuestions: cantidad total (configura el psicólogo)
```

**NO es:** DOMINIO → SECCIÓN → PREGUNTA. Las secciones NO son subdivisiones jerárquicas de los dominios.

### Las 10 actividades/secciones

| slug (backend) | id (frontend) | Título visible |
|---|---|---|
| `memoria_de_trabajo` | `market` | Lista del supermercado |
| `atencion_y_calculo` | `bus` | Pagar el boleto |
| `funciones_ejecutivas` | `recipe` | Ordenar una receta |
| `orientacion_temporal` | `calendar` | Agenda de turnos |
| `memoria_asociativa` | `names` | Caras y nombres |
| `metacognicion` | `wellbeing` | Cómo me siento hoy |
| `memoria_prospectiva` | `medication` | Tomar la medicación |
| `atencion_visual` | `home` | Objetos de la casa |
| `comprension_funcional` | `phone` | Mensajes y llamadas |
| `orientacion_espacial` | `orientation` | Camino al barrio |

Frontend: `src/data/activities.js`. Backend: tabla `sections`. Son contextos temáticos cotidianos, NO categorías cognitivas.

### Los 5 dominios cognitivos

| slug | name |
|---|---|
| `memoria` | Memoria |
| `atencion` | Atención |
| `funciones_ejecutivas` | Funciones ejecutivas |
| `orientacion` | Orientación |
| `comprension_lenguaje` | Comprensión y lenguaje |

Backend: tabla `cognitive_domains` (fuente de verdad). Frontend: `src/constants/appConfig.js:65-71` como `COGNITIVE_DOMAINS`.

Frontend implementado:
- `AiConfigPanel.jsx`: chips toggle para activar/desactivar dominios por paciente
- `patient.activeDomains`: array almacenado en localStorage, default = todos activos
- `patient.maxQuestions`: cantidad total configurable (1-10)
- Validación: `resolveActiveDomains()` requiere al menos 1 dominio

Actualmente los dominios activos **no afectan** la selección de preguntas — son metadata almacenada para uso futuro en Etapa 9.

### Relación pregunta ↔ dominio (N:M)

Implementado mediante tabla pivote `question_cognitive_domains` con FK a `questions` y `cognitive_domains`, PK compuesta `(question_id, cognitive_domain_id)`.

Una pregunta puede trabajar múltiples dominios. Temporalmente las 43 preguntas legacy no tienen dominios asignados — serán auditadas y asignadas en el próximo paso.

### Subdimension

`questions.subdimension VARCHAR(120) NULLABLE`: metadata interna de la pregunta, no configurable por el psicólogo inicialmente.

### Stimulus (fase de presentación previa)

`questions.stimulus TEXT NULLABLE`: información que se muestra al paciente antes de la pregunta y que luego se oculta. Permite que las preguntas de Memoria exijan retención real y no simple relectura.

`session_questions.stimulus_snapshot TEXT NULLABLE`: copia inmutable del stimulus al momento de crear la sesión. La sesión usa el snapshot, no el campo original.

**Flujo frontend (ActivityScreen.jsx):**
- `stimulus = null` → comportamiento actual (prompt + opciones simultáneos).
- `stimulus` con contenido → Fase 1: muestra stimulus + "Continuar". Fase 2: oculta stimulus, muestra prompt + opciones.

**Latencia:** se mide desde que aparecen prompt + opciones (Fase 2), no desde el stimulus. El tiempo de lectura del stimulus no se incluye en la latencia de respuesta.

**Retrocompatibilidad:** las 43 preguntas legacy tienen `stimulus = null` y funcionan idénticamente a antes.

**Banco piloto HOME:** 34 preguntas para `atencion_visual` cargadas en el seed (`source='ai_assisted_v1'`, `is_active=true`, `is_validated=false`). Incluyen stimulus cuando corresponde, subdimension, difficulty 1/2/3, 4 opciones y asociaciones N:M con `cognitive_domains`.

### Selección futura de preguntas (diseño conceptual, NO implementado)

```
Paciente elige actividad → banco de esa actividad
  + section_id
  + activeDomains del paciente
  + maxQuestions
  + is_active=true AND is_validated=true
  + filtro: pregunta trabaja al menos un dominio activo
  + prevención de repetición (ventana 3 sesiones)
  + dificultad (futuro)
  + balanceo suave de dominios cuando sea posible
  → N preguntas seleccionadas
```

NO implementado todavía. `sessions.js` no se modificará hasta que se decida el alcance completo.

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
- **Tablas:** `sections`, `questions`, `cognitive_domains`, `question_cognitive_domains`, `users`, `sessions`, `session_sections`, `session_questions`, `answers`, `session_results`
- **Seed:** idempotente y no destructivo. 10 secciones originales, 5 dominios cognitivos, 43 preguntas legacy (`is_validated=false`, `source='legacy_seed_v1'`), 34 preguntas HOME piloto (`is_validated=false`, `source='ai_assisted_v1'`). 77 preguntas totales. Re-ejecutar no borra ni sobrescribe datos existentes.
- **Endpoints:**
  - `GET /api/health`
  - `GET /api/sections`, `GET /api/sections/:id/questions`
  - `POST /api/users`, `GET /api/users/:id`
  - `POST /api/sessions`, `GET /api/sessions/:id`, `POST /api/sessions/:id/start`
  - `POST /api/sessions/:id/answers`, `POST /api/sessions/:id/complete`, `POST /api/sessions/:id/abandon`
  - `GET /api/sessions/:id/results`
- **Tests:** 95 pasando (node:test + supertest, `--test-concurrency=1`)
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
- Actividades/secciones: las 10 del frontend se mantienen como unidad de actividad ✓
- Relación pregunta ↔ dominio cognitivo (N:M): implementada (`cognitive_domains` + `question_cognitive_domains`) ✓
- Tabla `sections.cognitive_domain` eliminada (era incorrecta — una sección no pertenece a un solo dominio) ✓
- Matriz ACTIVIDAD × DOMINIO: pendiente de diseñar
- Asignación de dominios a las 43 preguntas legacy: pendiente
- Tamaño y contenido del banco ampliado: pendiente (cantidad por definir después de la matriz)
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
Estado: **EN PROGRESO.**

**Completado:**
- Auditoría del banco existente (43 preguntas legacy, 10 actividades/secciones)
- Descubrimiento: actividades y dominios son dimensiones ortogonales (no jerárquicas)
- Identificación del modelo correcto: pregunta ↔ dominio es N:M
- Migración 004: `questions.subdimension` columna
- Migración 005: tabla `cognitive_domains` (5 dominios) + tabla pivote `question_cognitive_domains` (N:M)
- Migración 006: eliminación de `sections.cognitive_domain` (columna incorrecta del modelo anterior)
- Corrección del checkpoint WIP anterior (migración 005 incorrecta eliminada, secciones restauradas)
- Seed idempotente no destructivo con 10 secciones originales y 5 dominios cognitivos
- Tests actualizados para modelo correcto
- Migración 007: `questions.stimulus` (TEXT NULLABLE) + `session_questions.stimulus_snapshot` (TEXT NULLABLE)
- Frontend: ActivityScreen con fase de stimulus (stimulus → Continuar → ocultar → prompt + opciones)
- Latencia de respuesta comienza al mostrar prompt+opciones, no al mostrar stimulus
- Snapshot de stimulus al crear sesión (inmutable, igual que prompt_snapshot)
- Banco piloto HOME (Objetos de la casa): 34 preguntas incorporadas al seed
- Distribución de dificultad: 12 fácil / 14 media / 8 difícil
- Distribución de correct_answer: 9/8/9/8 (índices 0/1/2/3)
- Stimulus: 19 preguntas con stimulus, 15 sin stimulus
- Dominios N:M: 39 asociaciones (20 atención, 19 memoria) vía `question_cognitive_domains`
- 13 subdimensiones definidas (reconocimiento_funcional, asociacion_objeto_lugar, categorizacion_funcional, atencion_selectiva, discriminacion_funcional, deteccion_de_anomalia, atencion_sostenida, rastreo_de_atributos, retencion_de_escena, memoria_de_ubicacion, memoria_de_secuencia, deteccion_de_cambio, discriminacion_entre_similares)
- Idempotencia del seed verificada (doble ejecución sin errores ni duplicados)
- Tests backend: 95 pasando (0 fallos)

**Piloto HOME — validación E2E completada:**
- Las 34 HOME fueron probadas mediante el flujo real del backend (REST API)
- Creación de sesión, inicio, respuestas, finalización: funcionaron correctamente
- Snapshots (prompt, options, correct_answer, stimulus) verificados
- Métricas (accuracy, completion_rate, latencias) verificadas
- Datos temporales usados para la prueba fueron eliminados
- Las HOME quedaron nuevamente como `is_validated=false`

**43 legacy — diseño corregido congelado, implementación pendiente:**
- Se realizó auditoría conceptual de las 43 preguntas legacy
- Se diseñó una versión corregida completa, aprobada conceptualmente
- La versión corregida TODAVÍA NO fue implementada en seed ni PostgreSQL
- Decisiones de la versión congelada:
  - 4 opciones por pregunta (eran 3)
  - correct_answer 0-based
  - difficulty 1/2/3
  - stimulus cuando corresponde
  - dominios N:M asignados
  - subdimensiones normalizadas
  - distractores plausibles (sin opciones absurdas)
  - L-03 y L-42 reemplazadas completamente
  - L-32 reemplazada para evitar duplicación con HOME-002
  - Preguntas de medicación (L-28 a L-31) reformuladas: trabajan comprensión/retención de instrucciones previamente proporcionadas, no generan recomendaciones sanitarias
  - Lenguaje adulto y respetuoso, sin infantilización ni gamificación
  - Sin afirmaciones diagnósticas ni absolutas innecesarias
  - `source = legacy_seed_v1` (sin cambio)
  - `is_validated = false` (sin cambio)
- Distribución final del diseño corregido: difficulty 17/21/5, correct_answer 11/11/11/10, stimulus 18 con / 25 sin
- Estas cifras corresponden al DISEÑO congelado, no al estado actual de PostgreSQL

**Vocabulario de subdimensiones consolidado (21 total):**
- 13 de HOME: reconocimiento_funcional, asociacion_objeto_lugar, categorizacion_funcional, atencion_selectiva, discriminacion_funcional, deteccion_de_anomalia, atencion_sostenida, rastreo_de_atributos, retencion_de_escena, memoria_de_ubicacion, memoria_de_secuencia, deteccion_de_cambio, discriminacion_entre_similares
- 8 nuevas para legacy: retencion_y_evocacion, calculo_funcional, comprension_funcional, planificacion_secuencial, juicio_y_resolucion, estrategia_y_autorregulacion, orientacion_temporal, orientacion_espacial

**Estado actual:**
- Rama: `feature/question-bank`
- Infraestructura implementada: stimulus, subdimension, cognitive_domains, N:M pivot
- 77 preguntas en PostgreSQL (43 legacy original + 34 HOME piloto)
- Las 43 legacy permanecen con su versión original en seed/DB (`source='legacy_seed_v1'`, `is_validated=false`)
- Las 34 HOME cargadas (`source='ai_assisted_v1'`, `is_active=true`, `is_validated=false`)
- Las 43 legacy todavía NO tienen asociaciones definitivas a `cognitive_domains`
- 95 tests backend passing
- Matriz ACTIVIDAD × DOMINIO: pendiente de congelar
- Banco grande (~306 preguntas): pendiente

**Siguiente:**
1. Congelar matriz ACTIVIDAD × DOMINIO
2. Definir distribución del banco final por actividad, dominio, subdimensión, dificultad y stimulus
3. Construir banco final de ~306 preguntas
4. Auditar banco completo (duplicados, ambigüedad, distractores, difficulty, dominios, subdimensiones, stimulus, balance de correct_answer, lenguaje adulto/respetuoso, seguridad)
5. Implementar en seed/PostgreSQL únicamente el banco aprobado (incluye las 43 legacy corregidas)
6. Verificar idempotencia
7. Ejecutar tests y validaciones de distribución
8. Cerrar Etapa 4

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

## Posicionamiento de MenteActiva (decisión metodológica)

MenteActiva es una herramienta de estimulación/entrenamiento cognitivo y seguimiento del desempeño.

**NO debe presentarse como:**
- Instrumento diagnóstico
- Evaluación neuropsicológica validada
- Sustituto de criterio profesional

Evitar lenguaje infantilizante o gamificación dirigida a adultos mayores. En contenido de preguntas, feedbacks y notas internas: describir qué demanda cognitiva trabaja cada pregunta, sin afirmar capacidad diagnóstica. Las preguntas que involucran medicación deben trabajar sobre instrucciones previamente proporcionadas, no generar recomendaciones sanitarias propias.

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

**Estado:** EN PROGRESO. Modelo de datos corregido. `origin/main` ya fue integrado en esta rama.

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

## Roadmap inmediato · Question Bank

1. ~~**Terminar y auditar las 34 preguntas piloto HOME.**~~ ✓ COMPLETADO
   - 34 preguntas HOME-001 a HOME-034 incorporadas al seed.
   - Distribución 12/14/8, correct_answer 9/8/9/8, stimulus 19/15, dominios N:M 39 asociaciones.

2. ~~**Probar stimulus end-to-end con preguntas reales del piloto.**~~ ✓ COMPLETADO
   - Validación E2E via REST API exitosa.
   - Snapshots, métricas y ciclo de vida verificados.

3. ~~**Auditar y corregir las 43 preguntas legacy.**~~ ✓ DISEÑO CONGELADO
   - Auditoría conceptual completada.
   - Versión corregida de las 43 aprobada (implementación pendiente).
   - Vocabulario de subdimensiones consolidado: 21 totales.

4. **Congelar matriz ACTIVIDAD × DOMINIO.**

5. **Definir distribución del banco final** por actividad, dominio, subdimensión, dificultad y stimulus.

6. **Construir banco final de ~306 preguntas.**

7. **Auditar banco completo:**
   - Duplicados, ambigüedad, distractores.
   - Difficulty, dominios, subdimensiones, stimulus.
   - Balance de correct_answer.
   - Lenguaje adulto/respetuoso, seguridad.

8. **Implementar en seed/PostgreSQL únicamente el banco aprobado** (incluye las 43 legacy corregidas).

9. **Verificar idempotencia, ejecutar tests y validaciones de distribución.**

10. **Cerrar Etapa 4.**

NO avanzar todavía a frontend integration. La integración React ↔ backend sigue correspondiendo a Etapa 9.

---

**PRÓXIMO PASO AL RETOMAR:** Congelar la matriz ACTIVIDAD × DOMINIO y definir la distribución del banco final de ~306 preguntas.
