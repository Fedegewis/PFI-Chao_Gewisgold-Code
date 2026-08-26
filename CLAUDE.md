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
- Ollama es el servidor/entorno de inferencia, NO el modelo.
- Pipeline ML en Python, separado del backend Node.js.

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

Objetivo futuro: ~30-50 preguntas por sección (no es requisito rígido). Las preguntas generadas con IA durante desarrollo ingresan como `is_validated=false`. Solo `is_active=true AND is_validated=true` se usan en sesiones reales.

## Estado actual implementado

### Backend (`/backend`)

- Node.js + Express + Knex + PostgreSQL
- **Tablas:** `sections`, `questions`, `users`, `sessions`, `session_sections`, `session_questions`, `answers`, `session_results`
- **Seed:** 10 secciones cognitivas, 45 preguntas legacy (`is_validated=false`, `source='legacy_seed_v1'`)
- **Endpoints:**
  - `GET /api/health`
  - `GET /api/sections`, `GET /api/sections/:id/questions`
  - `POST /api/users`, `GET /api/users/:id`
  - `POST /api/sessions`, `GET /api/sessions/:id`, `POST /api/sessions/:id/start`
  - `POST /api/sessions/:id/answers`, `POST /api/sessions/:id/complete`, `POST /api/sessions/:id/abandon`
  - `GET /api/sessions/:id/results`
- **Tests:** 76 pasando (node:test + supertest, `--test-concurrency=1`)
- **Config:** `.env.example` con placeholders, `.env` excluido de git

Las 10 secciones actuales son un mapeo provisional de las actividades legacy. Pueden revisarse.

Las 45 preguntas legacy permanecen como `is_validated=false`. Solo preguntas con `is_active=true AND is_validated=true` se asignan en sesiones. Los tests usan fixtures propias con preguntas validadas.

### Frontend (`/src`)

SPA React 19 + Vite + Tailwind v4 existente. Funciona con localStorage y datos hardcodeados. Todavía NO fue migrado al nuevo backend.

### Código legacy reutilizable

- `src/data/activities.js` — 10 actividades, 45 preguntas (seed del backend)
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

## Roadmap

### Completado

- [x] Análisis completo del repositorio existente
- [x] Diseño arquitectónico y decisiones cerradas
- [x] Análisis de hardware e infraestructura
- [x] Backend foundation: Express + PostgreSQL + Knex
- [x] Migración: tablas sections + questions
- [x] Seed: 10 secciones, 45 preguntas legacy
- [x] Endpoints: health, sections, sections/:id/questions
- [x] Tests: 5 pasando
- [x] Modelo de datos: users, sessions, session_sections, session_questions
- [x] Endpoints: users CRUD, sessions (crear, obtener, iniciar)
- [x] Snapshot de preguntas asignadas (prompt, options, correct_answer, response_type)
- [x] Ciclo de vida: created → in_progress (start explícito) → completed/abandoned
- [x] Tests: 28 pasando
- [x] Tablas: answers, session_results
- [x] Endpoints: registrar respuesta, completar sesión, abandonar sesión, obtener resultados
- [x] Cálculo de métricas determinísticas (accuracy, completion_rate, latencia)
- [x] Ciclo completo: created → in_progress → completed/abandoned
- [x] Completar sesión en transacción atómica (session_results + status)
- [x] Tests: 57 pasando
- [x] Selección pseudoaleatoria de preguntas con exclusión de recientes
- [x] Creación de sesión en transacción atómica
- [x] Tests: 76 pasando

### Siguiente

- [ ] Banco ampliado de preguntas (~30-50 por sección)
- [ ] Configuración profesional → paciente (secciones, cantidad)
- [ ] Autenticación (JWT u otra alternativa — sin decidir todavía)
- [ ] Contrato INPUT/OUTPUT de Llama definido formalmente
- [ ] Informe IA bajo demanda del profesional
- [ ] Postprocesamiento y validación de output de Llama
- [ ] Dataset v0
- [ ] Baseline Llama + prompt
- [ ] Entrenamiento QLoRA
- [ ] Evaluación baseline vs adaptado
- [ ] Integración Ollama ↔ backend
- [ ] Migración del frontend al backend (consumir API)
- [ ] Chat del paciente → convertir a panel de ánimo/notas

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

**Branch actual:** `feature/session-results` (parte de `feature/backend-first-step`)

**Archivos preexistentes modificados** (no relacionados con el backend):
- `package-lock.json` (raíz)
- `src/styles.css`

No mezclar con commits del backend.
