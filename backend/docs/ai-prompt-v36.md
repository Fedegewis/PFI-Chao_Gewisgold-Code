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
