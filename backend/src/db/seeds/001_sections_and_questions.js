// Idempotent seed: safe to run multiple times without destroying existing data.
//
// Sections: ON CONFLICT (slug) DO NOTHING — existing sections are never overwritten.
// Questions: only inserted if zero legacy_seed_v1 questions exist in the database.
// Cognitive domains: ON CONFLICT (slug) DO NOTHING — existing domains are never overwritten.

const SECTIONS = [
  {
    slug: "memoria_de_trabajo",
    name: "Memoria de trabajo",
    description:
      "Mantenimiento, actualización y reconocimiento de ítems en memoria a corto plazo.",
    is_active: true,
    display_order: 1,
  },
  {
    slug: "atencion_y_calculo",
    name: "Atención y cálculo",
    description:
      "Cálculo funcional, atención selectiva y toma de decisión numérica.",
    is_active: true,
    display_order: 2,
  },
  {
    slug: "funciones_ejecutivas",
    name: "Funciones ejecutivas",
    description:
      "Planificación, secuenciación, flexibilidad cognitiva y resolución de problemas.",
    is_active: true,
    display_order: 3,
  },
  {
    slug: "orientacion_temporal",
    name: "Orientación temporal",
    description:
      "Manejo de fechas, horarios, orientación en el tiempo y memoria prospectiva temporal.",
    is_active: true,
    display_order: 4,
  },
  {
    slug: "memoria_asociativa",
    name: "Memoria asociativa",
    description:
      "Asociación nombre-atributo, recuperación contextual y discriminación entre pares.",
    is_active: true,
    display_order: 5,
  },
  {
    slug: "metacognicion",
    name: "Metacognición",
    description:
      "Autorreporte subjetivo, autorregulación, reconocimiento de fatiga y adherencia.",
    is_active: true,
    display_order: 6,
  },
  {
    slug: "memoria_prospectiva",
    name: "Memoria prospectiva",
    description:
      "Recordar realizar acciones futuras, seguimiento de instrucciones y rutinas.",
    is_active: true,
    display_order: 7,
  },
  {
    slug: "atencion_visual",
    name: "Atención visual",
    description:
      "Atención selectiva visual, reconocimiento funcional de objetos y asociación objeto-lugar.",
    is_active: true,
    display_order: 8,
  },
  {
    slug: "comprension_funcional",
    name: "Comprensión funcional",
    description:
      "Comprensión de mensajes breves, extracción de información y toma de decisión comunicacional.",
    is_active: true,
    display_order: 9,
  },
  {
    slug: "orientacion_espacial",
    name: "Orientación espacial",
    description:
      "Orientación espacial básica, lectura de señalética y navegación en entornos conocidos.",
    is_active: true,
    display_order: 10,
  },
];

const COGNITIVE_DOMAINS = [
  { slug: "memoria", name: "Memoria" },
  { slug: "atencion", name: "Atención" },
  { slug: "funciones_ejecutivas", name: "Funciones ejecutivas" },
  { slug: "orientacion", name: "Orientación" },
  { slug: "comprension_lenguaje", name: "Comprensión y lenguaje" },
];

// [section_slug, prompt, options, correct_answer, feedback_correct, feedback_incorrect, clinician_note]
const QUESTIONS = [
  // --- memoria_de_trabajo (5) ---
  ["memoria_de_trabajo", "La lista original tenía pan, leche y manzanas. ¿Cuál opción coincide?", ["Pan, leche y manzanas", "Café, arroz y jabón", "Tomates, queso y pilas"], 0, "Correcto. Recuperaste la lista completa.", "Revisemos. Probemos mirando de nuevo los productos.", "Reconocimiento verbal simple y mantenimiento de tres ítems."],
  ["memoria_de_trabajo", "Antes de salir, Elena quería comprar leche, arroz y jabón. ¿Qué producto NO estaba en la lista?", ["Arroz", "Pilas", "Jabón"], 1, "Correcto. Detectaste el elemento intruso.", "Revisemos. La idea era encontrar lo que sobra.", "Control inhibitorio ante distractor semántico."],
  ["memoria_de_trabajo", "Si primero puso leche en el chango y después pan, ¿qué producto falta?", ["Café", "Detergente", "Manzanas"], 2, "Correcto. Recordaste el ítem pendiente.", "Revisemos. Quedaba un producto por recuperar.", "Actualización de memoria de trabajo."],
  ["memoria_de_trabajo", "El cartel decía: 2 yogures y 1 queso. ¿Qué debe llevar?", ["Dos yogures y un queso", "Un yogur y dos quesos", "Dos quesos y una leche"], 0, "Correcto. Leíste cantidad y producto.", "Conviene mirar cantidad y producto por separado.", "Atención sostenida a doble atributo."],
  ["memoria_de_trabajo", "La receta pide tomate, queso y albahaca. ¿Qué grupo sirve para preparar la comida?", ["Pan, mermelada y café", "Tomate, queso y albahaca", "Jabón, arroz y pilas"], 1, "Correcto. Agrupaste elementos relacionados.", "La próxima puede resolverse buscando qué cosas van juntas.", "Asociación semántica por contexto cotidiano."],

  // --- atencion_y_calculo (5) ---
  ["atencion_y_calculo", "El boleto cuesta $480. ¿Qué combinación paga justo?", ["$500 + $100", "$100 + $100 + $100", "$200 + $200 + $80"], 2, "Correcto. Calculaste el monto exacto.", "Revisamos la suma y seguimos.", "Cálculo monetario funcional."],
  ["atencion_y_calculo", "El colectivo sale a las 10:30 y tarda 20 minutos. ¿A qué hora llega?", ["10:50", "10:40", "11:10"], 0, "Correcto. Sumaste el tiempo de viaje.", "Estas tareas entrenan orientación temporal.", "Orientación temporal y adición de intervalo."],
  ["atencion_y_calculo", "Si tiene $600 y paga $480, ¿cuánto cambio debería recibir?", ["$80", "$120", "$180"], 1, "Correcto. Resolviste el cambio esperado.", "La respuesta sale restando el costo a lo que entregaste.", "Resta funcional y monitoreo de transacción."],
  ["atencion_y_calculo", "Línea 15 al centro y línea 21 al hospital. ¿Cuál toma para ir al hospital?", ["Línea 15", "Cualquiera de las dos", "Línea 21"], 2, "Correcto. Elegiste usando la información importante.", "Había que buscar la palabra hospital.", "Atención selectiva guiada por destino."],
  ["atencion_y_calculo", "El chofer pide apoyar la tarjeta una vez. ¿Qué acción corresponde?", ["Apoyar la tarjeta una vez", "Apoyarla tres veces", "Guardar la tarjeta sin usarla"], 0, "Correcto. Seguiste una instrucción simple.", "Estas consignas practican acciones cotidianas.", "Comprensión instruccional y control de respuesta."],

  // --- funciones_ejecutivas (5) ---
  ["funciones_ejecutivas", "Para preparar té, ¿cuál paso va primero?", ["Servir el té en la taza", "Calentar agua", "Guardar la taza"], 1, "Correcto. Identificaste el primer paso.", "Pensemos qué acción necesita ocurrir antes.", "Inicio de secuencia y planificación básica."],
  ["funciones_ejecutivas", "Ya calentaste agua y pusiste el saquito. ¿Qué sigue?", ["Esperar unos minutos", "Comprar una tetera", "Lavar la ropa"], 0, "Correcto. Mantuviste la continuidad.", "La clave es elegir el paso que continúa.", "Continuidad secuencial y descarte de distractores."],
  ["funciones_ejecutivas", "Si falta leche para la receta, ¿qué decisión ayuda más?", ["Apagar la luz", "Cambiar de canal", "Anotarla para comprar"], 2, "Correcto. Elegiste una acción útil.", "La pregunta buscaba una solución práctica.", "Resolución de problemas cotidianos."],
  ["funciones_ejecutivas", "La receta dice mezclar, hornear y dejar enfriar. ¿Qué va último?", ["Mezclar", "Dejar enfriar", "Hornear"], 1, "Correcto. Ubicaste el cierre.", "Puede ayudar imaginar la acción completa.", "Ordenamiento temporal y cierre de tarea."],
  ["funciones_ejecutivas", "Si el horno está muy caliente, ¿qué conviene hacer?", ["Tocarlo con la mano", "Dejar la puerta abierta todo el día", "Usar agarradera o pedir ayuda"], 2, "Correcto. Elegiste una acción segura.", "La prioridad era elegir la opción más segura.", "Juicio práctico y seguridad doméstica."],

  // --- orientacion_temporal (4) ---
  ["orientacion_temporal", "El turno con la doctora es el martes a las 16:00. ¿Qué dato es importante recordar?", ["Jueves a las 10:00", "Domingo a la noche", "Martes a las 16:00"], 2, "Correcto. Recordaste día y horario juntos.", "En la agenda conviene unir siempre día y hora.", "Memoria prospectiva con asociación día-horario."],
  ["orientacion_temporal", "Si hoy es lunes y el turno es mañana, ¿qué día es el turno?", ["Martes", "Miércoles", "Viernes"], 0, "Correcto. Ubicaste mañana dentro de la semana.", "Estas preguntas practican orientación semanal.", "Orientación temporal relativa."],
  ["orientacion_temporal", "Para no olvidarse del turno, ¿qué acción ayuda más?", ["Cambiarlo de lugar sin avisar", "Anotarlo en la agenda", "No mirar el horario"], 1, "Correcto. Elegiste una estrategia de apoyo.", "La opción más útil era usar una ayuda externa.", "Uso de estrategia compensatoria."],
  ["orientacion_temporal", "Si una cita pasa del martes al viernes, ¿qué conviene actualizar?", ["Solo el color del papel", "Nada", "El día en la agenda y el recordatorio"], 2, "Bien. Actualizaste la información importante.", "Cuando cambia una cita, se actualiza agenda y aviso.", "Actualización de información."],

  // --- memoria_asociativa (4) ---
  ["memoria_asociativa", "Ana usa lentes y trae una carpeta azul. ¿Quién trae la carpeta azul?", ["Ana", "Luis", "Marta"], 0, "Correcto. Uniste el nombre con la pista visual.", "La pista era la carpeta azul.", "Codificación asociativa nombre-atributo."],
  ["memoria_asociativa", "Luis dijo que vive cerca de la plaza. ¿Quién vive cerca de la plaza?", ["Luis", "Ana", "Elena"], 0, "Correcto. Recuperaste el dato asociado.", "Lo importante es volver a buscar la asociación.", "Recuperación de información contextual."],
  ["memoria_asociativa", "Marta pidió té y Ana pidió café. ¿Quién pidió café?", ["Marta", "Ana", "Luis"], 1, "Correcto. Diferenciaste asociaciones parecidas.", "Estas consignas entrenan comparación de pares.", "Discriminación entre asociaciones competidoras."],
  ["memoria_asociativa", "Rosa vive en el piso 2, Pedro en el 5 y Ana en el 3. ¿Quién vive más alto?", ["Ana", "Rosa", "Pedro"], 2, "Correcto. Comparaste números asociados a personas.", "El piso más alto era el número mayor.", "Comparación numérica en memoria asociativa."],

  // --- metacognicion (4) ---
  ["metacognicion", "Si hoy sentís poca energía, ¿qué opción ayuda a continuar?", ["Abandonar toda la semana", "Elegir una actividad breve", "Hacer todo más rápido"], 1, "Correcto. Adaptar la rutina también es avanzar.", "La idea es encontrar una forma amable de continuar.", "Autorregulación y selección de carga apropiada."],
  ["metacognicion", "Después de una pregunta difícil, ¿qué conviene hacer?", ["Respirar y probar la siguiente", "Pensar que ya no sirve", "Cerrar sin registrar nada"], 0, "Correcto. Mantener la participación es parte del entrenamiento.", "Una pregunta difícil no define toda la sesión.", "Tolerancia a frustración y persistencia."],
  ["metacognicion", "¿Qué dato puede ayudar al profesional a acompañarte mejor?", ["El color de la pared", "La marca del teléfono", "Cómo te sentiste durante la actividad"], 2, "Correcto. Ese registro ayuda a ajustar sesiones.", "El profesional necesita saber cómo viviste la actividad.", "Metacognición y reporte subjetivo."],
  ["metacognicion", "Si notás que te fue mejor al principio que al final, ¿qué podría estar apareciendo?", ["Cansancio o fatiga", "Mejora del clima", "Un error del calendario"], 0, "Correcto. Identificaste una posible señal de fatiga.", "Cambiar al final puede relacionarse con cansancio.", "Reconocimiento subjetivo de fatiga cognitiva."],

  // --- memoria_prospectiva (4) ---
  ["memoria_prospectiva", "La pastilla azul se toma después del desayuno. ¿Cuándo conviene tomarla?", ["Después del desayuno", "Antes de dormir", "En cualquier momento"], 0, "Correcto. Ubicaste el momento correcto.", "La clave era mirar en qué parte del día aparece la toma.", "Memoria prospectiva ligada a rutina diaria."],
  ["memoria_prospectiva", "Si hoy ya tomaste la medicación de la mañana, ¿qué ayuda a no repetirla?", ["Tomarla otra vez por las dudas", "Marcarla en el pastillero o agenda", "No mirar ningún registro"], 1, "Correcto. Elegiste una estrategia segura.", "Estas consignas practican chequeo antes de actuar.", "Monitoreo de rutina y prevención de duplicados."],
  ["memoria_prospectiva", "El médico indicó agua y no jugo para una toma. ¿Qué corresponde hacer?", ["Tomarla con cualquier bebida", "Esperar una semana", "Tomarla con agua"], 2, "Correcto. Seguiste la indicación principal.", "Había que elegir la opción más cercana a la consigna.", "Comprensión de instrucción funcional."],
  ["memoria_prospectiva", "Si se termina una caja y quedan dos comprimidos sueltos, ¿qué conviene anotar?", ["Que hace falta pedir una nueva caja", "El color de la mesa", "Nada porque ya alcanza"], 0, "Correcto. Pensaste en la continuidad del tratamiento.", "La idea era anticiparse a la falta del medicamento.", "Planificación y continuidad de tratamiento."],

  // --- atencion_visual (4) ---
  ["atencion_visual", "¿Cuál de estos objetos se usa para barrer el piso?", ["Almohada", "Escoba", "Toalla"], 1, "Correcto. Identificaste el objeto correcto.", "Pensemos para qué sirve cada elemento en la vida diaria.", "Reconocimiento funcional de objetos."],
  ["atencion_visual", "Si querés guardar comida en la heladera, ¿qué conviene usar?", ["Una revista", "Un control remoto", "Un recipiente con tapa"], 2, "Correcto. Elegiste la opción más útil.", "La consigna buscaba una solución práctica y segura.", "Decisión funcional en contexto doméstico."],
  ["atencion_visual", "¿Qué objeto suele estar en el baño para secarse las manos?", ["Toalla", "Lámpara", "Cuaderno"], 0, "Correcto. Recuperaste una asociación cotidiana.", "Estas preguntas entrenan atención a contextos conocidos.", "Asociación objeto-lugar."],
  ["atencion_visual", "Si se corta la luz de noche, ¿qué ayuda más a moverse seguro?", ["Anteojos de sol", "Linterna", "Florero"], 1, "Correcto. Priorizaste seguridad y orientación.", "La opción correcta era la que ayuda a ver mejor.", "Juicio práctico en el hogar."],

  // --- comprension_funcional (4) ---
  ["comprension_funcional", "Tu hija escribe: 'Llego a las 18'. ¿Qué dato importante conviene recordar?", ["Que llega a las 18", "Que sale mañana", "Que cambia de teléfono"], 0, "Correcto. Recuperaste la información central.", "Lo importante era quedarse con el horario del mensaje.", "Comprensión de mensaje breve."],
  ["comprension_funcional", "Si escuchás una llamada perdida del médico, ¿qué acción ayuda más?", ["Borrar el número", "Apagar el teléfono", "Devolver la llamada o anotarla"], 2, "Correcto. Elegiste una respuesta útil.", "La consigna buscaba continuidad y seguimiento.", "Toma de decisión ante aviso relevante."],
  ["comprension_funcional", "Te mandan 'Traé carné y estudios'. ¿Qué deberías preparar?", ["Solo la billetera", "El carné y los estudios", "Nada"], 1, "Correcto. Seguiste la consigna completa.", "Había que conservar los dos elementos pedidos.", "Memoria inmediata de dos ítems."],
  ["comprension_funcional", "Si no entendés un audio, ¿qué opción ayuda más?", ["Inventar el contenido", "Ignorarlo", "Pedir que lo repitan o escribirlo"], 2, "Correcto. Elegiste una estrategia compensatoria.", "La mejor opción era buscar apoyo para comprender bien.", "Compensación y monitoreo de comprensión."],

  // --- orientacion_espacial (4) ---
  ["orientacion_espacial", "La farmacia está después de la plaza y antes del banco. ¿Dónde queda?", ["Antes de la plaza", "Entre la plaza y el banco", "Detrás del banco"], 1, "Correcto. Ordenaste las referencias del camino.", "La pista estaba en mirar qué lugar va antes y después.", "Orientación espacial verbal."],
  ["orientacion_espacial", "Si el cartel dice 'Salida' con una flecha a la derecha, ¿para dónde conviene ir?", ["Hacia la derecha", "Hacia la izquierda", "Quedarse quieto"], 0, "Correcto. Seguiste la señal principal.", "Estas tareas entrenan lectura funcional del entorno.", "Lectura de señalética."],
  ["orientacion_espacial", "Vas a la panadería y ves primero el kiosco y después la verdulería. ¿Qué lugar aparece en el medio?", ["La verdulería antes del kiosco", "No se puede saber", "El kiosco antes de la verdulería"], 2, "Correcto. Ubicaste el orden del trayecto.", "La idea era sostener dos referencias en secuencia.", "Secuenciación espacial."],
  ["orientacion_espacial", "Si una calle está cerrada, ¿qué conviene hacer?", ["Cruzar igual", "Buscar otra opción segura o pedir ayuda", "Volver sin mirar"], 1, "Correcto. Elegiste una decisión segura.", "La opción correcta priorizaba seguridad y ayuda.", "Flexibilidad y juicio práctico."],
];

export async function seed(knex) {
  // --- Cognitive domains: insert only if slug does not exist ---
  for (const domain of COGNITIVE_DOMAINS) {
    const exists = await knex("cognitive_domains").where("slug", domain.slug).first();
    if (!exists) {
      await knex("cognitive_domains").insert(domain);
    }
  }

  // --- Sections: insert only if slug does not exist ---
  for (const section of SECTIONS) {
    const exists = await knex("sections").where("slug", section.slug).first();
    if (!exists) {
      await knex("sections").insert(section);
    }
  }

  // --- Questions: only insert if no legacy questions exist yet ---
  const [{ count }] = await knex("questions")
    .where("source", "legacy_seed_v1")
    .count("id as count");

  if (Number(count) > 0) {
    return;
  }

  const sectionRows = await knex("sections").select("id", "slug");
  const slugToId = Object.fromEntries(sectionRows.map((r) => [r.slug, r.id]));

  const questionRows = QUESTIONS.map(
    ([
      slug,
      prompt,
      options,
      correct_answer,
      feedback_correct,
      feedback_incorrect,
      clinician_note,
    ]) => ({
      section_id: slugToId[slug],
      prompt,
      response_type: "multiple_choice",
      options: JSON.stringify(options),
      correct_answer,
      scoring_value: 1,
      difficulty: 1,
      feedback_correct,
      feedback_incorrect,
      clinician_note,
      source: "legacy_seed_v1",
      is_active: true,
      is_validated: false,
    })
  );

  await knex("questions").insert(questionRows);
}
