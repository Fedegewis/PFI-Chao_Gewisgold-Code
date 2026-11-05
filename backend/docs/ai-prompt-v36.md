# Prompt 3.6 — recuperar profundidad del análisis sin perder seguridad

Rama `feature/ai-analysis-quality-v36` (2026-11-05). Sin migraciones. Contrato
de salida persistido: sigue siendo `schema_version: "3"` (`summary` +
`aspects_to_review`), así que la API, el panel y los análisis anteriores no
cambian. `PROMPT_VERSION` 3.5 → **3.6**.

## 1. Diagnóstico: por qué 3.5 perdió profundidad

Se recuperó el 3.4 real desde git (`scripts/eval/legacyPromptV34.js`) y se
comparó con 3.5 (`scripts/eval/legacyPromptV35.js`, copia congelada en esta
rama).

| | 3.4 | 3.5 |
|---|---|---|
| Datos que recibe el modelo | nombre de la actividad + observaciones determinísticas | lo mismo |
| Estado de ánimo, nivel, tipos de pregunta, tiempos, antecedentes | no | no |
| Pide | summary de 1–2 oraciones + 0–5 `aspects_to_review` | sólo summary de 1–2 oraciones |
| Aspectos | validados todo-o-nada | descartados (`aspectsPolicy: "discard"`) |

Las dos versiones recibían lo mismo: dos o tres frases ya escritas por
`observationsBuilder`. Con eso el modelo sólo podía parafrasearlas. En 3.4 la
"profundidad" venía de los aspectos inventados (recomendaciones, eficacia,
capacidades), que el validador vigente rechaza. Por eso 3.5 los dejó de pedir
y quedó en una paráfrasis de las observaciones.

**Conclusión:** el problema no era sólo el modelo. Al modelo no le llegaba la
información necesaria para describir más.

## 2. Diseño 3.6

1. **`sessionFacts.js` (determinístico, sin cifras).** Arma los hechos que se
   pueden afirmar sin interpretación, a partir de `session_questions` +
   `answers`:
   - Descripción de la actividad.
   - Nivel de dificultad (más accesible / intermedio / más exigente).
   - Estado de ánimo informado al iniciar.
   - Resultado por tipo de pregunta (`subdimension`): todas correctas,
     todas incorrectas o mixto.
   - Presentación de cada tipo: con información previa que luego se oculta, o
     con la información a la vista.
   - Comparación de resultados entre preguntas con información previa y
     preguntas con la información a la vista.
   - Tiempo de las respuestas correctas frente a las incorrectas, con umbral
     de ruido de 150 ms.
   - Tipo de pregunta con el mayor tiempo.
   - Existencia de sesiones anteriores de la misma actividad.

   Produce también una ficha estructurada (`facts_sheet`) para el validador y
   **temas de seguimiento** determinísticos: cada tema nombra un dato
   registrado.
2. **Prompt por bloques.** Los datos llegan repartidos por párrafo:
   - PÁRRAFO 1: actividad, nivel, ánimo.
   - PÁRRAFO 2: resultados, tipos, tiempos.
   - PÁRRAFO 3: antecedentes, si existen.
   - TEMAS PARA SEGUIMIENTO.

   El modelo redacta un párrafo por bloque y un aspecto por tema. No hay
   ejemplo de estilo. La plantilla JSON muestra exactamente tantos párrafos
   y puntos como bloques y temas hay. La pauta del estado de ánimo aparece
   sólo si hay un ánimo registrado.
3. **Aspectos filtrados uno por uno** (`aspectsPolicy: "filter"`). Cada
   aspecto pasa las mismas reglas que el summary: familias, cifras, anclaje,
   contradicción con los hechos, repetición del seguimiento automático y
   duplicados. Un aspecto que no cumple se descarta sin rechazar el resto del
   análisis.
4. **Validación ampliada, sin desactivar protecciones.** Ninguna regla
   existente se quitó. Las excepciones nuevas sólo se habilitan cuando la
   ficha de hechos respalda la frase:
   - El estado de ánimo se puede nombrar como lo informado, sin conectores
     causales ni especulativos, y sólo con el valor registrado.
   - Se pueden mencionar sesiones anteriores si existen y no se comparan
     resultados.
   - Los tiempos dentro de la sesión no se toman como comparación entre
     sesiones.
   - Los resultados de un tipo de pregunta se verifican contra ese tipo.
5. **Contradicciones nuevas detectadas:**
   - tiempos correctas/incorrectas invertidos
   - tipo con mayor tiempo equivocado
   - resultado de un tipo invertido
   - presentación equivocada
   - comparación información previa / a la vista invertida
   - nivel equivocado
   - ánimo sin registro

   **Patrones nuevos:**
   - eco del ejemplo
   - "falta de comprensión"
   - objetivos de mejora ("mejorar la precisión", "áreas de mejora")
   - relaciones causales no medidas ("el impacto del tiempo en la precisión")
   - párrafo que es la lista de aspectos volcada en el texto
6. **Lectura de análisis 3.6 persistidos.** `reviewStoredAnalysis` vuelve a
   evaluar el summary con los `context_facts` y la `facts_sheet` guardados
   junto al análisis y filtra los aspectos. Si el summary no cumple, se
   ocultan summary y aspectos (`ai_text_withheld`).
7. **Inferencia.** `num_predict` 700 → 900 (el JSON 3.6 ocupa ~600–700
   tokens). El backend envía `generation_options` en el claim y el worker los
   aplica (ver `worker/README.md`).

## 3. Evaluación (Ollama local, datos sintéticos)

`npm run eval:prompts -- --reps 3` (`scripts/eval/eval-prompts.js`). Las tres
variantes usaron los mismos 10 casos sintéticos (C01–C10: ánimo presente o
ausente, nivel conocido o no, sesión incompleta, comparaciones que suben,
bajan o no son comparables, información previa frente a información a la
vista) y los mismos parámetros. Todas se juzgaron con el **validador vigente**
de 3.6: 3.4 con validación de aspectos todo-o-nada, 3.5 con aspectos
descartados y 3.6 con filtro.

- Modelo `llama3.2:3b`, CPU (Ryzen 5 3600), `temperature 0.2`,
  `num_predict 900`, `seed` = número de repetición (1–3).
- 30 generaciones por variante.
- Se mide **aceptación por intento**: sin reintentos (en producción hay
  2 intentos in-process y 3 claims en el worker).

| Métrica (sólo aceptadas) | 3.4 | 3.5 | 3.6 |
|---|---|---|---|
| Aceptadas por intento | 0/30 (0%) | 21/30 (70%) | **22/30 (73%)** |
| Caracteres del summary (media) | — | 223 | **1015** |
| Párrafos / oraciones (media) | — | 1 / 2.2 | **3 / 10.9** |
| Proporción de oraciones que repiten las observaciones automáticas | — | 0.36 | **0.29** |
| Aspectos conservados (media) | — | 0 | **3.2** |
| Análisis con ≥ 3 aspectos | — | 0% | **77%** |
| Cubre estado de ánimo* | — | 0% | 86% |
| Cubre nivel* | — | 0% | 86% |
| Cubre tipos de pregunta / tiempos / información previa* | — | 0% / 19% / 0% | 100% / 100% / 100% |
| Cubre antecedentes* | — | 100% | 100% |
| Latencia media | 35 s | 11 s | 59 s |
| Tokens generados (media) | 209 | 65 | 424 |

\* Sobre las aceptadas de los casos donde el dato existe.

**Rechazos por variante:**
- **3.4:** mejora o eficacia 22, recomendación clínica 4, juicio evaluativo 2,
  descarte clínico 1, estado de ánimo 1.
- **3.5:** contradicción con los datos 3, especulación 3, juicio evaluativo 2,
  mejora 1.
- **3.6:** forma 7 (párrafos de más 3, aspectos volcados como párrafo 3,
  JSON truncado por un bucle de repetición 1) y contenido 1 ("evaluar el
  progreso").

**Aspectos descartados por el filtro en las 22 aceptadas de 3.6:**
- largo excesivo 7
- mejora 4
- estado de ánimo vinculado a resultados 3
- duplicados 3
- especulación 2
- recomendación 2
- contradicción 1
- juicio evaluativo 1

Todos se descartaron sin llegar al profesional.

**Por caso** (aceptadas sobre 3 en 3.5 / 3.6):

| C01 | C02 | C03 | C04 | C05 | C06 | C07 | C08 | C09 | C10 |
|---|---|---|---|---|---|---|---|---|---|
| 1 / 3 | 3 / 2 | 0 / 3 | 3 / 3 | 1 / 1 | 3 / 1 | 3 / 3 | 1 / 0 | 3 / 3 | 3 / 3 |

### Ejemplo completo (C10: más incorrectas, información previa frente a información a la vista, ánimo "bien", sin sesiones comparables, seed 1)

**3.4 — rechazado** (`therapeutic_or_improvement_claim`: "efectividad de la
actividad"). Aspectos generados: "Evaluar la efectividad de la actividad…",
"Revisar la necesidad de ajustar la actividad para mejorar los resultados".

**3.5 — aceptado:**
> La sesión de Objetos de la casa se completó en su totalidad, pero se
> registraron más respuestas incorrectas que correctas. No existen todavía
> sesiones comparables para describir una tendencia.

**3.6 — aceptado:**
> La persona realizó la actividad Objetos de la casa, que propone preguntas
> sobre objetos de uso cotidiano, su función y su ubicación en el hogar. Las
> preguntas correspondieron al nivel de dificultad más exigente. Al comenzar,
> la persona informó sentir bien.
>
> La sesión fue completada en su totalidad. Se registraron más respuestas
> incorrectas que correctas. La única pregunta de asociación entre objetos y
> lugares, con la información a la vista, fue respondida correctamente. La
> única pregunta de agrupamiento de objetos por su función, con la
> información a la vista, fue respondida correctamente. La única pregunta de
> distinción entre elementos parecidos, con la información a la vista, fue
> respondida de forma incorrecta. En las preguntas de recuerdo de la ubicación
> de objetos, que presentaban información previa que luego se ocultaba,
> todas las respuestas fueron incorrectas. En las preguntas con información
> previa que luego se oculta la proporción de respuestas correctas fue menor
> que en las preguntas con la información a la vista. Las respuestas
> incorrectas llevaron en promedio más tiempo que las correctas. El mayor
> tiempo de respuesta de la sesión se registró en una pregunta de recuerdo de
> la ubicación de objetos.
>
> No existen todavía sesiones comparables para describir una tendencia.
>
> Aspectos sugeridos:
> - Observar las preguntas de distinción entre elementos parecidos con la
>   información a la vista, donde la única pregunta de este tipo fue
>   respondida de forma incorrecta.
> - Observar las preguntas de recuerdo de la ubicación de objetos con
>   información previa que luego se oculta, donde todas las respuestas fueron
>   incorrectas.
> - Comparar los resultados de las preguntas con información previa que luego
>   se oculta frente a los de las preguntas con la información a la vista.
> - Revisar el tiempo de las respuestas incorrectas, que fue en promedio
>   mayor que el de las correctas.
> - Revisar el tiempo de respuesta en las preguntas de recuerdo de la
>   ubicación de objetos.

("informó sentir bien" se corrigió después de la medición: el bloque ahora
dice "informó sentirse bien". No cambia el resto del prompt.)

### Lectura honesta de los resultados

- La aceptación por intento de 3.6 es **similar** a la de 3.5 (73% frente a
  70%), no superior. La mejora está en el contenido aceptado: cada análisis
  describe cerca de cinco veces más hechos de la sesión y trae en promedio
  tres aspectos de seguimiento concretos, contra ninguno en 3.5.
- Casi todos los rechazos de 3.6 son de forma y no de contenido. Con los
  reintentos de producción la probabilidad de terminar sin síntesis es menor
  que la tasa por intento, pero eso **no se midió**.
- **La profundidad viene sobre todo de los datos determinísticos, no del
  modelo.** El 3B redacta los bloques casi literalmente: el texto es fiel
  pero de estilo enumerativo, y la conexión narrativa es limitada. Los
  aspectos siguen de cerca los temas determinísticos. Esto es coherente con
  el rol definido para Llama (contextualizar sin inventar), pero no debe
  presentarse como "interpretación" del modelo.
- Muestra chica, un solo modelo y casos sintéticos. La aceptación no mide
  utilidad clínica: la revisión de las aceptadas fue manual y no encontró
  afirmaciones fuera de los datos.
- Latencia: ~59 s por intento en CPU, contra ~11 s de 3.5.

## 4. Riesgos y límites conocidos

- El anclaje léxico (raíces de 5 caracteres) y las familias son patrones: una
  paráfrasis no prevista puede pasar. Los chequeos de tipo y presentación
  son por cláusula y sólo cubren lo que la ficha enumera.
- Algunos aspectos aceptados son genéricos ("Revisar el tiempo de respuesta
  en las preguntas de X") o terminan en propósitos vagos ("para identificar
  patrones de dificultad"). No afirman nada clínico, pero aportan poco.
- **Orden de despliegue:** el worker debe actualizarse junto con el backend o
  antes. Un worker viejo genera con `num_predict 300`, trunca el JSON 3.6 y
  sólo produce intentos fallidos.
- La lectura de un análisis 3.6 persistido depende de `context_facts` y
  `facts_sheet` guardados en el propio análisis. Si faltan, la revisión
  vuelve a la ficha básica: más estricta, así que podría ocultar texto válido.
- No se regeneró ningún análisis real. Los análisis existentes (3.4/3.5)
  siguen con su lógica de lectura.

## 5. Ajuste final de 3.6 (calidad, formato y rendimiento)

Mismo `PROMPT_VERSION` "3.6" y mismo schema de salida "3". Cambios sobre la
primera versión de 3.6 (congelada para comparar en
`scripts/eval/legacyPromptV36a.js` + `legacySessionFactsV36a.js`).

### 5.1 Diseño

- **Las observaciones automáticas ya no se envían al modelo.** El panel ya
  las muestra como bloque determinístico; en 3.6 inicial el 100% de las
  síntesis aceptadas repetía al menos una de forma literal (28% de las
  oraciones). Ahora el prompt sólo recibe los hechos de `sessionFacts`.
  Las observaciones quedan como respaldo si faltan los hechos.
- **Hechos en prosa, no tarjetas.** Se probó pasar los datos como fichas
  etiquetadas ("Resultado: …"). El 3B empezó a interpretar ("sugiere una
  buena capacidad"), así que se volvió a oraciones completas y neutras.
- **Hechos nuevos:** balance general de la sesión, preguntas sin responder,
  y la comparación con la sesión anterior, que dice explícitamente si es
  comparable (mismo nivel) o no. Con niveles distintos sólo se dice que la
  diferencia "no es directamente comparable" (corrige el caso C04). La
  dirección de la precisión y del tiempo sale de `comparison_metrics`
  (corrige C02).
- **Temas de seguimiento:** redacción singular cuando el tipo tuvo una sola
  pregunta, ánimo en presente ("informado al comenzar cada sesión"), sin un
  tema genérico de historial, y relleno con tipos todo-correcto hasta tres.
- **Extensión proporcional:** 1 a 3 párrafos según los datos (contexto,
  resultados, sesiones anteriores). Sin historial no se pide un párrafo de
  historial.
- **Salida estructurada (JSON Schema).** Ollama recibe en `format` un schema
  con `paragraphs` de cantidad fija (minItems = maxItems), largo 20-1000
  por párrafo y `aspects_to_review` de 0 a min(5, temas), sin campos extra.
  Un `maxLength` más chico (700) cortaba oraciones a la mitad. El worker lo
  recibe en `generation_options.format` (un objeto de hasta 8 KB; si no,
  usa `"json"`). **El validador posterior se mantiene completo**: el schema
  sólo restringe la forma.
- **Datos insuficientes:** si ningún tipo de pregunta tuvo respuestas
  puntuadas, no se llama a Ollama. Se persiste un `ok` con
  `synthesis_source: "deterministic"`, `summary: ""`, `aspects_to_review: []`
  y `synthesis_skipped_reason: "insufficient_data"`. El panel muestra
  «Síntesis no generada» sin ícono ni rótulo de IA; los bloques
  determinísticos siguen visibles. En lectura, un contenido así se devuelve
  siempre sin texto (aunque se hubiera alterado la fila).
- **Validador (ajustes, sin quitar protecciones):**
  - falso positivo de C02 en oraciones con dos grupos ("en las de X …
    mientras que en las de Y …");
  - aspectos que comparan con sesiones anteriores sin base comparable
    (`non_comparable_sessions`) o que no nombran ningún dato de la sesión
    (`generic_aspect`);
  - "impacto/efecto de X en las preguntas de Y" pasa a
    `speculative_interpretation`;
  - `duplicate_aspect` ahora tiene en cuenta el tipo de pregunta y si el
    aspecto habla del tiempo: dos temas parecidos sobre tipos distintos no
    son duplicados (11 descartes falsos en la evaluación).

### 5.2 Evaluación

llama3.2:3b local en CPU (Ollama 0.40.13), temperature 0.2, num_predict 900,
seeds 1-3, 10 casos sintéticos × 3. Mismo validador vigente para las dos
variantes. `npm run eval:prompts` (por defecto `3.6-pre` vs `3.6`).

| Métrica | 3.6 inicial (`format: "json"`) | 3.6 ajustada (JSON Schema) |
|---|---|---|
| Aceptadas por intento | 25/30 (83%) | 27/27 (100%) + 3 determinísticas (C08, sin llamar al modelo) |
| Rechazos de formato | 4 (3 `malformed_summary`, 1 `SCHEMA_INVALID`) | 0 |
| Rechazos de contenido | 1 (`therapeutic_or_improvement_claim`) | 0 |
| Caracteres (media, mín-máx) | 1034 (784-1299) | 983 (724-1204) |
| Párrafos (media) | 3 | 2.56 |
| Aceptadas con alguna observación copiada literal | 100% | 0% |
| Aspectos válidos por análisis (media) | 3.44 | 4.15 |
| Análisis con ≥ 3 aspectos válidos | 76% | 100% |
| Aspectos descartados | 27 (8 sesiones no comparables, 5 mejora, 4 ánimo, …) | 2 (especulativos) |
| Latencia por intento (media / máx) | 64 s / 82.5 s | 59.2 s / 84 s |
| Tokens generados (media / máx) | 395 / 532 | 376 / 459 |
| Tokens de prompt | ~908 | ~912 |
| Casos con resultado tomando las 3 seeds como reintentos sucesivos | 9/10 (C08 falla los 3) | 10/10 |
| Tiempo total estimado con reintentos | 755.9 s (75.6 s por caso) | 572.2 s (57.2 s por caso) |

La comparación de tiempo es sobre esta muestra y esta máquina. La latencia
por intento es parecida; la ganancia total viene de no reintentar y de no
llamar al modelo cuando no hay datos.

### 5.3 Límites

- El texto sigue siendo, en gran parte, una reformulación de los hechos del
  prompt (todas las aceptadas contienen oraciones literales de esos datos).
  Es seguro, pero poco narrativo: la profundidad la aportan los hechos
  determinísticos, no el modelo.
- Las sesiones antiguas cuyas preguntas no tienen `subdimension` no tienen
  tipos y, al regenerarse, quedan como «Síntesis no generada».
- Muestra chica, un solo modelo, casos sintéticos. La aceptación no mide
  utilidad clínica.
- El worker debe desplegarse con el backend o antes (`num_predict` 900 y
  `format`). Un worker viejo ignora el schema y usa `"json"`.

## 6. Rendimiento (Ollama local)

Máquina del worker: Intel i7-1255U (2 núcleos P + 8 E, 12 hilos), 15,6 GB de
RAM (~0,7-1,6 GB libres), Ollama 0.40.13, llama3.2:3b Q4_K_M. `ollama ps`:
100% CPU. La GPU integrada (Iris Xe, Vulkan) aparece pero Ollama la descarta
("dropping integrated GPU; to enable, set OLLAMA_IGPU_ENABLE=1"). No hay GPU
dedicada en esta máquina.

### 6.1 Dónde se va el tiempo (prompt 3.6, sin caché del prompt)

Medido con las duraciones que devuelve Ollama, 7 casos sintéticos, seed 1:

| Parte | Tiempo | Velocidad |
|---|---|---|
| Carga del modelo (`load_duration`) | ~8 s sólo en frío; 0 con `keep_alive` 30m | — |
| Lectura del prompt (`prompt_eval`), ~850-1000 tokens | 13-28 s | 30-80 tokens/s |
| Generación (`eval`), ~330-450 tokens | 38-60 s | 7,5-10 tokens/s |

La generación es ~70% del tiempo y es proporcional a la extensión del
informe. El prompt de la guía es un prefijo común: el runner reutiliza su
caché entre pedidos, por eso el primer análisis tras cargar el modelo es el
más lento.

### 6.2 Opciones evaluadas

| Opción | Resultado | Decisión |
|---|---|---|
| `num_thread` 8 (default de Ollama: 6) | 7/7 casos más rápidos, −12,6% (62,5 → 54,6 s), salida idéntica | Adoptada como configuración local opcional (`WORKER_OLLAMA_NUM_THREAD`, `OLLAMA_NUM_THREAD`) |
| `num_thread` 4 | +7,6% (más lento) | Descartada |
| `num_thread` 10 | igual que 8 | Descartada |
| `num_batch` 1024 | lectura del prompt sin cambio (14,6 vs 15,0 s) | Descartada |
| `num_ctx` 2048 | sin cambio de velocidad y con riesgo de truncar el prompt en sesiones largas | Descartada |
| Espacios del JSON | ≤ 11 tokens por respuesta (~1 s) | No vale el cambio |
| `keep_alive` | ya en 30m en backend y worker | Sin cambio |
| Acortar el informe o quitar aspectos | bajaría el tiempo, pero pierde contenido | Fuera de alcance (pedido explícito) |

No se pudieron probar sin autorización (configuración global de Ollama o
descarga de modelos): GPU integrada por Vulkan (`OLLAMA_IGPU_ENABLE=1`),
flash attention / caché KV cuantizada (`OLLAMA_FLASH_ATTENTION`,
`OLLAMA_KV_CACHE_TYPE`) y un modelo más chico (llama3.2:1b), que además
exigiría repetir la evaluación de calidad completa.

### 6.3 Conclusión

Con opciones por pedido no se llega a 30-40 s en esta máquina: la generación
de ~400 tokens a ~9 tokens/s ya ocupa 35-50 s. La única mejora consistente
y sin costo de calidad es `num_thread` 8 (~−13%). La calidad y la aceptación
no cambian porque el texto generado es el mismo. Aparte de la inferencia, el
worker espera hasta `WORKER_IDLE_POLL_MS` (30 s) para tomar una sesión nueva
con la cola vacía: eso suma latencia percibida, no tiempo de generación.
