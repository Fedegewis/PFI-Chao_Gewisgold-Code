# Mecanismo adaptativo de dificultad (v1)

Documento técnico del mecanismo implementado en `src/services/adaptiveDifficulty.js`.
Es una herramienta operativa de la aplicación: decide qué mezcla de preguntas
(dificultad interna 1/2/3 del banco) recibe la próxima sesión de una actividad.
**No diagnostica, no mide capacidades cognitivas y sus umbrales no son criterios
clínicos.** La dificultad 1/2/3 es una escala interna de MenteActiva, no validada
clínicamente.

## Dónde y cuándo se decide

- Unidad de adaptación: **paciente × actividad** (`sections`). Las actividades
  son independientes entre sí.
- Momento: al crear la sesión del paciente (`POST /api/patient/sessions`),
  dentro de la misma transacción que crea la sesión, sus actividades y sus
  preguntas. El servidor nunca acepta un nivel enviado por el cliente.
- El nivel se **deriva del historial persistido** en PostgreSQL. No hay
  contador mutable que actualizar al completar, por lo que completar dos veces,
  reiniciar el backend o tener Ollama apagado no alteran la decisión.
- Un `pg_advisory_xact_lock` por (paciente, actividad) serializa creaciones
  simultáneas: la segunda lee la sesión ya confirmada por la primera.
- Ollama no participa: sigue generando sólo el análisis narrativo posterior.

## Reglas (configurables en `ADAPTIVE_CONFIG`)

| Parámetro | Valor |
|---|---|
| Niveles | 1, 2, 3 |
| Nivel inicial | 2 |
| Mínimo de sesiones completas | 2 |
| Mínimo de respuestas puntuadas | 6 |
| Máximo de sesiones examinadas | 4 |
| Subir | precisión agrupada ≥ 0,80 |
| Bajar | precisión agrupada ≤ 0,40 |
| Mantener | intermedia o evidencia insuficiente |
| Cambio máximo | un nivel por sesión |
| Latencia | no participa en la versión 1 |

1. **Nivel actual** = nivel de la sesión adaptativa más reciente de la
   actividad, en cualquier estado. Si no hay ninguna → nivel inicial.
2. **Ventana de evidencia**: se recorren las sesiones desde la más reciente
   mientras tengan el nivel actual (la ventana se reinicia al cambiar de nivel).
   Sólo aportan las **completadas** con respuestas puntuables. Las abandonadas,
   en curso o creadas se saltan. Las sesiones históricas sin nivel se ignoran.
3. Se acumulan sesiones hasta reunir ≥ 2 sesiones y ≥ 6 respuestas puntuadas,
   examinando como máximo 4.
4. Con evidencia suficiente: ≥ 0,80 sube, ≤ 0,40 baja, si no se mantiene.
   En los topes (1 y 3) se mantiene (`max_level_reached` / `min_level_reached`).

Como el nivel actual se toma de la sesión más reciente aunque esté sin
completar, crear otra sesión sin evidencia nueva no puede repetir un cambio
(evita oscilaciones y saltos de dos niveles).

Con 4 preguntas por sesión, la evidencia típica son las 2 últimas sesiones (8
respuestas): sube con 7 u 8 correctas, baja con 3 o menos.

## Mezcla de dificultades

| Nivel | Fácil (1) | Media (2) | Difícil (3) | Con 4 preguntas |
|---|---|---|---|---|
| 1 | 75 % | 25 % | — | 3 / 1 / 0 |
| 2 | 25 % | 50 % | 25 % | 1 / 2 / 1 |
| 3 | — | 25 % | 75 % | 0 / 1 / 3 |

Las cuotas se calculan por el método del resto mayor (`buildDifficultyTargets`),
determinístico para cualquier cantidad: ante restos iguales gana la dificultad
más cercana al nivel y, si persiste el empate, la más baja.

## Selección y fallback

Se conservan todos los filtros previos: actividad, dominios activos del
paciente, elegibilidad (`is_active` y `is_validated` o `validation_level`),
cantidad configurada por el profesional y preferencia por preguntas no vistas en
las últimas 3 sesiones de la actividad. Para cada dificultad objetivo, en orden
de cuota:

1. preguntas de esa dificultad no recientes;
2. no recientes de la dificultad más cercana (distancia 1 y luego 2; empate →
   la más cercana al nivel de la sesión);
3. recientes de esa dificultad;
4. recientes de las dificultades cercanas;
5. cualquier elegible restante.

Nunca se duplican preguntas. Si el total elegible no alcanza la cantidad
pedida se mantiene el error 400 previo (no se reduce la sesión en silencio).
La mezcla real obtenida queda registrada en la decisión.

## Persistencia (migración 018)

- `session_sections.adaptive_level` (1-3, CHECK), `adaptive_decision` (jsonb),
  `adaptive_version` (texto).
- `session_questions.difficulty_snapshot` (1-3, CHECK).
- Todas nullable; las sesiones históricas quedan en NULL.

`adaptive_decision` guarda: versión, nivel, nivel previo, cambio, regla,
evidencia (ids de sesiones, correctas, puntuadas, precisión), umbrales, cuotas
objetivo, mezcla real, cantidad de preguntas tomadas por fallback y de
preguntas recientes reutilizadas. Toda decisión es auditable y reproducible.

## Comparaciones entre sesiones (P1)

`comparison_metrics.difficulty_level = { current, previous, same }` indica el
nivel de ambas sesiones. Si difieren (o una no tiene nivel), las observaciones
automáticas aclaran que la diferencia de precisión no es directamente
comparable en lugar de describirla como subida o bajada, y el panel lo muestra
junto a la comparación. Las métricas aritméticas no cambian. Si ninguna de las
dos tiene nivel (todo histórico), la salida es idéntica a la anterior.

## Limitaciones conocidas

- El banco tiene pocas preguntas difíciles (en la base local de desarrollo:
  77 de 549, entre 6 y 12 por actividad, y 0 o 1 en algunas combinaciones de
  actividad y dominio). En nivel 3 la rotación puede agotarlas y el fallback
  completa con dificultad media; queda registrado en la decisión.
- La precisión agrupada con pocas preguntas es una señal gruesa; por eso se
  exige evidencia mínima y se limita el cambio a un nivel.
- Las sesiones creadas por el endpoint profesional (`POST /api/sessions`) no
  usan el mecanismo (nivel NULL) y no cuentan como evidencia.

## Evidencia reproducible

- Tests unitarios: `tests/adaptive-difficulty.test.js`, `tests/adaptive-comparison.test.js`.
- Tests de integración con la API: `tests/adaptive-difficulty-integration.test.js`.
- Simulación sintética: `npm run simulate:adaptive` (ver abajo).

### Simulación sintética (semilla 2026, 10 sesiones, 4 preguntas)

> **Datos generados por programa.** Cada perfil tiene probabilidades de acierto
> por dificultad elegidas a mano para ilustrar las reglas. No provienen de
> usuarios reales y no tienen interpretación clínica.

| Perfil sintético | Trayectoria de niveles |
|---|---|
| Desempeño alto | 2 → 2 → 3 → 3 → 3 → 3 → 3 → 3 → 3 → 3 |
| Desempeño bajo | 2 → 2 → 1 → 1 → 1 → 1 → 1 → 1 → 1 → 1 |
| Desempeño mixto | 2 → 2 → 2 → 1 → 1 → 2 → 2 → 2 → 2 → 2 |
| Mejora gradual (con una sesión abandonada) | 2 → 2 → 1 → 1 → 1 → 1 → 1 → 1 → 2 → 2 |

Lectura técnica de la simulación (sobre las reglas, no sobre personas): ningún
cambio ocurre con una sola sesión de evidencia; nunca hay saltos de más de un
nivel; después de cada cambio la ventana se reinicia; la sesión abandonada no
aporta evidencia. El detalle sesión por sesión (regla, evidencia y mezcla) se
obtiene ejecutando el script.
