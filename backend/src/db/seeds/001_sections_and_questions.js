// Idempotent seed: safe to run multiple times without destroying existing data.
//
// Sections: insert only if slug does not exist.
// Cognitive domains: insert only if slug does not exist.
// Legacy questions: only inserted if zero legacy_seed_v1 questions exist.
// HOME pilot questions: only inserted if zero ai_assisted_v1 questions exist for atencion_visual.
// Bank questions (bank_v1): only inserted if zero bank_v1 questions exist for each section.

import ATENCION_Y_CALCULO_QUESTIONS from "./questions/atencion_y_calculo.js";
import FUNCIONES_EJECUTIVAS_QUESTIONS from "./questions/funciones_ejecutivas.js";
import ORIENTACION_TEMPORAL_QUESTIONS from "./questions/orientacion_temporal.js";
import MEMORIA_ASOCIATIVA_QUESTIONS from "./questions/memoria_asociativa.js";
import METACOGNICION_QUESTIONS from "./questions/metacognicion.js";
import MEMORIA_PROSPECTIVA_QUESTIONS from "./questions/memoria_prospectiva.js";
import COMPRENSION_FUNCIONAL_QUESTIONS from "./questions/comprension_funcional.js";
import ORIENTACION_ESPACIAL_QUESTIONS from "./questions/orientacion_espacial.js";
import { BANK_V2 } from "./questions/bank_v2.js";

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

// HOME pilot: 34 questions for atencion_visual ("Objetos de la casa")
// Each entry: { prompt, options, correct_answer, difficulty, stimulus, subdimension,
//               feedback_correct, feedback_incorrect, clinician_note, domains[] }
const HOME_QUESTIONS = [
  // HOME-001
  {
    prompt: "¿Cuál de estos objetos se usa habitualmente para secar los platos después de lavarlos?",
    options: ["Repasador", "Sartén", "Florero", "Destornillador"],
    correct_answer: 0,
    difficulty: 1,
    stimulus: null,
    subdimension: "reconocimiento_funcional",
    feedback_correct: "Correcto. Identificó el objeto adecuado para esa tarea.",
    feedback_incorrect: "El repasador es el que se usa para secar los platos.",
    clinician_note: "Reconocimiento funcional de un objeto doméstico a partir de su uso. Demanda baja: un solo objeto, función cotidiana, distractores de categorías distintas.",
    domains: ["atencion"],
  },
  // HOME-002
  {
    prompt: "Si necesita barrer las migas que quedaron en el piso de la cocina, ¿qué objeto le resulta más útil?",
    options: ["Escoba", "Almohada", "Toalla", "Cuchara"],
    correct_answer: 0,
    difficulty: 1,
    stimulus: null,
    subdimension: "reconocimiento_funcional",
    feedback_correct: "Correcto. La escoba es la herramienta adecuada para esa tarea.",
    feedback_incorrect: "Para barrer migas del piso, la escoba es el objeto indicado.",
    clinician_note: "Selección de objeto por función práctica. Demanda baja: un solo objeto, tarea doméstica familiar, distractores funcionalmente distantes.",
    domains: ["atencion"],
  },
  // HOME-003
  {
    prompt: "¿En qué ambiente de la casa se encuentra habitualmente la ducha?",
    options: ["Baño", "Cocina", "Dormitorio", "Comedor"],
    correct_answer: 0,
    difficulty: 1,
    stimulus: null,
    subdimension: "asociacion_objeto_lugar",
    feedback_correct: "Correcto. La ducha se encuentra en el baño.",
    feedback_incorrect: "La ducha es un elemento típico del baño.",
    clinician_note: "Asociación objeto-lugar convencional. Demanda baja: un objeto, un ambiente, vínculo ampliamente compartido.",
    domains: ["atencion"],
  },
  // HOME-004
  {
    prompt: "¿Cuál de estos objetos es más habitual encontrar en la cocina?",
    options: ["Almohada", "Espejo", "Olla", "Perchero"],
    correct_answer: 2,
    difficulty: 1,
    stimulus: null,
    subdimension: "asociacion_objeto_lugar",
    feedback_correct: "Correcto. La olla es un objeto típico de la cocina.",
    feedback_incorrect: "La olla se usa para cocinar y se guarda habitualmente en la cocina.",
    clinician_note: "Asociación lugar-objeto: dado un ambiente, identificar el objeto típico. Demanda baja: un lugar, distractores de otros ambientes.",
    domains: ["atencion"],
  },
  // HOME-005
  {
    prompt: "De este grupo de objetos — tenedor, cuchillo y almohada — ¿cuál no se usa para comer?",
    options: ["Almohada", "Los tres se usan para comer", "Tenedor", "Cuchillo"],
    correct_answer: 0,
    difficulty: 1,
    stimulus: null,
    subdimension: "categorizacion_funcional",
    feedback_correct: "Correcto. La almohada no forma parte de los utensilios de mesa.",
    feedback_incorrect: "El tenedor y el cuchillo se usan para comer; la almohada pertenece a otra categoría.",
    clinician_note: "Categorización funcional con detección de intruso. Demanda baja: 3 objetos, el elemento fuera de categoría es evidente.",
    domains: ["atencion"],
  },
  // HOME-006
  {
    prompt: "Busco un objeto de la cocina que sirve para calentar agua y tiene mango. ¿Cuál es?",
    options: ["Pava", "Plato", "Tabla de picar", "Vaso"],
    correct_answer: 0,
    difficulty: 1,
    stimulus: null,
    subdimension: "atencion_selectiva",
    feedback_correct: "Correcto. La pava reúne esas dos características.",
    feedback_incorrect: "La pava es el objeto de cocina que sirve para calentar agua y tiene mango.",
    clinician_note: "Atención selectiva guiada por dos pistas descriptivas (función + rasgo físico). Demanda baja: pistas directas, sin ambigüedad entre opciones.",
    domains: ["atencion"],
  },
  // HOME-007
  {
    prompt: "Silla, banqueta y heladera: ¿cuál tiene una función diferente de las otras dos?",
    options: ["Heladera", "Silla", "Banqueta", "Las tres tienen la misma función"],
    correct_answer: 0,
    difficulty: 1,
    stimulus: null,
    subdimension: "discriminacion_funcional",
    feedback_correct: "Correcto. La silla y la banqueta son para sentarse; la heladera conserva alimentos.",
    feedback_incorrect: "La silla y la banqueta sirven para sentarse. La heladera cumple otra función.",
    clinician_note: "Discriminación funcional entre objetos: identificar cuál cumple un rol diferente. Demanda baja: 3 objetos, la diferencia funcional es clara.",
    domains: ["atencion"],
  },
  // HOME-008
  {
    prompt: "En un baño hay un espejo, un jabón y una sartén. ¿Cuál no corresponde a ese ambiente?",
    options: ["Espejo", "Jabón", "Todos corresponden al baño", "Sartén"],
    correct_answer: 3,
    difficulty: 1,
    stimulus: null,
    subdimension: "deteccion_de_anomalia",
    feedback_correct: "Correcto. La sartén pertenece a la cocina, no al baño.",
    feedback_incorrect: "El espejo y el jabón son habituales en el baño. La sartén no corresponde a ese ambiente.",
    clinician_note: "Detección de anomalía contextual: identificar qué objeto no pertenece al ambiente nombrado. Demanda baja: 3 objetos, la anomalía es evidente.",
    domains: ["atencion"],
  },
  // HOME-009
  {
    prompt: "¿Qué objetos había sobre la mesa de la cocina?",
    options: ["Un vaso y una taza", "Un plato y una jarra", "Un vaso y un plato", "Una taza y una jarra"],
    correct_answer: 2,
    difficulty: 1,
    stimulus: "Sobre la mesa de la cocina hay un vaso y un plato.",
    subdimension: "retencion_de_escena",
    feedback_correct: "Correcto. Recordó los dos objetos mencionados.",
    feedback_incorrect: "Los objetos eran un vaso y un plato.",
    clinician_note: "Retención de escena breve: recuperar 2 objetos concretos presentados previamente. Demanda baja: pocos elementos, sin atributos adicionales.",
    domains: ["memoria"],
  },
  // HOME-010
  {
    prompt: "¿Qué había en la mesada del baño?",
    options: ["Un cepillo de dientes y un jabón", "Una toalla y un jabón", "Un cepillo de dientes y una toalla", "Un peine y un jabón"],
    correct_answer: 0,
    difficulty: 1,
    stimulus: "En la mesada del baño hay un cepillo de dientes y un jabón.",
    subdimension: "retencion_de_escena",
    feedback_correct: "Correcto. Recordó ambos objetos.",
    feedback_incorrect: "Los objetos eran un cepillo de dientes y un jabón.",
    clinician_note: "Retención de escena breve: 2 objetos en contexto doméstico. Distractores incluyen objetos plausibles del mismo ambiente para evitar que el conocimiento general reemplace la retención.",
    domains: ["memoria"],
  },
  // HOME-011
  {
    prompt: "¿Dónde fueron dejadas las llaves?",
    options: ["En el cajón de la cocina", "Arriba de la heladera", "En la repisa del baño", "Sobre la mesa del comedor"],
    correct_answer: 3,
    difficulty: 1,
    stimulus: "Las llaves fueron dejadas sobre la mesa del comedor.",
    subdimension: "memoria_de_ubicacion",
    feedback_correct: "Correcto. Recordó dónde fueron dejadas.",
    feedback_incorrect: "Las llaves fueron dejadas sobre la mesa del comedor.",
    clinician_note: "Memoria de ubicación: retener la asociación entre un objeto y el lugar donde fue colocado. Demanda baja: 1 objeto, 1 ubicación, sin interferencia.",
    domains: ["memoria"],
  },
  // HOME-012
  {
    prompt: "¿En qué ambiente de la casa quedaron los anteojos?",
    options: ["En el dormitorio", "En la cocina", "En el baño", "En el living"],
    correct_answer: 0,
    difficulty: 1,
    stimulus: "Los anteojos quedaron en la mesita de luz del dormitorio.",
    subdimension: "memoria_de_ubicacion",
    feedback_correct: "Correcto. Los anteojos estaban en el dormitorio.",
    feedback_incorrect: "Los anteojos habían quedado en el dormitorio, sobre la mesita de luz.",
    clinician_note: "Memoria de ubicación a nivel de ambiente: retener en qué habitación fue mencionado un objeto. Demanda baja: 1 objeto, asociación directa.",
    domains: ["memoria"],
  },
  // HOME-013
  {
    prompt: "En la cocina hay una olla sobre la hornalla, un trapo colgado del horno, una frutera con bananas y un salero junto a la cocina. ¿Dónde está el trapo?",
    options: ["Sobre la hornalla", "Dentro de la frutera", "Colgado del horno", "Junto a la cocina"],
    correct_answer: 2,
    difficulty: 2,
    stimulus: null,
    subdimension: "atencion_selectiva",
    feedback_correct: "Correcto. Localizó el trapo entre los demás elementos.",
    feedback_incorrect: "El trapo estaba colgado del horno.",
    clinician_note: "Atención selectiva en escena con 4 objetos: localizar un elemento específico entre varios, cada uno con ubicación propia.",
    domains: ["atencion"],
  },
  // HOME-014
  {
    prompt: "Tenedor, cuchara, espátula y cucharón: tres de estos se usan principalmente para revolver o servir comida. ¿Cuál tiene una función diferente?",
    options: ["Cuchara", "Tenedor", "Espátula", "Cucharón"],
    correct_answer: 1,
    difficulty: 2,
    stimulus: null,
    subdimension: "discriminacion_funcional",
    feedback_correct: "Correcto. El tenedor se usa para pinchar y llevar a la boca, no para revolver o servir.",
    feedback_incorrect: "La cuchara, la espátula y el cucharón sirven para revolver o servir. El tenedor cumple otra función.",
    clinician_note: "Discriminación funcional entre objetos con funciones cercanas: todos son utensilios de cocina, pero uno cumple un rol diferente. Mayor proximidad semántica que en dificultad 1.",
    domains: ["atencion"],
  },
  // HOME-015
  {
    prompt: "Lámpara, velador, linterna y sábana: ¿cuál no pertenece al grupo de objetos que dan luz?",
    options: ["Lámpara", "Sábana", "Velador", "Linterna"],
    correct_answer: 1,
    difficulty: 2,
    stimulus: null,
    subdimension: "categorizacion_funcional",
    feedback_correct: "Correcto. La sábana no cumple función de iluminación.",
    feedback_incorrect: "Lámpara, velador y linterna dan luz. La sábana pertenece a otra categoría.",
    clinician_note: "Categorización funcional con 4 objetos: el intruso comparte contexto (dormitorio) pero no función (iluminación). Categoría menos obvia que en dificultad 1.",
    domains: ["atencion"],
  },
  // HOME-016
  {
    prompt: "En un dormitorio hay una cama, una mesita de luz, un pilón de cocina y una lámpara. ¿Cuál no corresponde a ese ambiente?",
    options: ["Pilón de cocina", "Cama", "Mesita de luz", "Lámpara"],
    correct_answer: 0,
    difficulty: 2,
    stimulus: null,
    subdimension: "deteccion_de_anomalia",
    feedback_correct: "Correcto. El pilón es un elemento de la cocina, no del dormitorio.",
    feedback_incorrect: "La cama, la mesita de luz y la lámpara son habituales en un dormitorio. El pilón pertenece a la cocina.",
    clinician_note: "Detección de anomalía con 4 objetos: 3 pertenecen al ambiente y 1 es de otro contexto. Mayor cantidad de elementos que en dificultad 1.",
    domains: ["atencion"],
  },
  // HOME-017
  {
    prompt: "Toalla, olla y almohada: si hay que guardar cada uno en su lugar habitual, ¿cuál va en la cocina?",
    options: ["Toalla", "Almohada", "Ninguno va en la cocina", "Olla"],
    correct_answer: 3,
    difficulty: 2,
    stimulus: null,
    subdimension: "asociacion_objeto_lugar",
    feedback_correct: "Correcto. La olla se guarda en la cocina.",
    feedback_incorrect: "La toalla va en el baño, la almohada en el dormitorio, y la olla en la cocina.",
    clinician_note: "Asociación objeto-lugar con 3 objetos: requiere considerar el destino habitual de cada uno para responder sobre uno específico. Demanda de comparación múltiple.",
    domains: ["atencion"],
  },
  // HOME-018
  {
    prompt: "¿Cuáles eran los tres objetos mencionados en el living?",
    options: ["Sillón, control remoto y diario", "Sillón, teléfono y revista", "Sillón, control remoto y revista", "Mesa ratona, control remoto y libro"],
    correct_answer: 2,
    difficulty: 2,
    stimulus: "En el living hay un sillón, un control remoto y una revista sobre la mesa ratona.",
    subdimension: "retencion_de_escena",
    feedback_correct: "Correcto. Recordó los tres objetos.",
    feedback_incorrect: "Los objetos eran un sillón, un control remoto y una revista.",
    clinician_note: "Retención de escena: recuperar 3 objetos presentados en contexto doméstico. Distractores sustituyen uno de los objetos por otro plausible del mismo ambiente.",
    domains: ["memoria"],
  },
  // HOME-019
  {
    prompt: "¿Cuál de estos objetos NO fue mencionado entre los que estaban en la cocina?",
    options: ["Pava", "Cafetera", "Repasador", "Tostador"],
    correct_answer: 1,
    difficulty: 2,
    stimulus: "En la cocina hay una pava, un tostador y un repasador.",
    subdimension: "retencion_de_escena",
    feedback_correct: "Correcto. La cafetera no fue mencionada.",
    feedback_incorrect: "Los objetos mencionados eran pava, tostador y repasador. La cafetera no estaba en la lista.",
    clinician_note: "Retención con reconocimiento del ausente: retener 3 objetos e identificar cuál no fue presentado. Requiere inhibir la familiaridad del distractor (cafetera es plausible en cocina).",
    domains: ["memoria"],
  },
  // HOME-020
  {
    prompt: "¿Dónde estaba el teléfono?",
    options: ["Sobre el sillón", "En la mesa del comedor", "En la mesita de luz", "Junto a la heladera"],
    correct_answer: 1,
    difficulty: 2,
    stimulus: "El control remoto está sobre el sillón y el teléfono está en la mesa del comedor.",
    subdimension: "memoria_de_ubicacion",
    feedback_correct: "Correcto. Recordó la ubicación del teléfono.",
    feedback_incorrect: "El teléfono estaba en la mesa del comedor.",
    clinician_note: "Memoria de ubicación con 2 bindings objeto-lugar. Pregunta sobre uno de ellos; la presencia del otro genera interferencia. Demanda moderada.",
    domains: ["memoria"],
  },
  // HOME-021
  {
    prompt: "¿Qué hizo en segundo lugar al llegar?",
    options: ["Se sacó los zapatos", "Prendió la luz", "Dejó las llaves en la mesa", "Colgó el abrigo"],
    correct_answer: 3,
    difficulty: 2,
    stimulus: "Al llegar a la casa, primero dejó las llaves en la mesa, después colgó el abrigo y por último se sacó los zapatos.",
    subdimension: "memoria_de_secuencia",
    feedback_correct: "Correcto. En segundo lugar colgó el abrigo.",
    feedback_incorrect: "El orden era: primero las llaves, después colgar el abrigo, por último sacarse los zapatos.",
    clinician_note: "Memoria de secuencia: retener el orden temporal de 3 acciones y recuperar la posición ordinal de una de ellas.",
    domains: ["memoria"],
  },
  // HOME-022
  {
    prompt: "¿De qué color era la frutera?",
    options: ["Roja", "Blanca", "Azul", "Verde"],
    correct_answer: 3,
    difficulty: 2,
    stimulus: "En la cocina hay una taza blanca, una frutera verde y un mantel a cuadros.",
    subdimension: "retencion_de_escena",
    feedback_correct: "Correcto. La frutera era verde.",
    feedback_incorrect: "La frutera era verde. La taza era la blanca.",
    clinician_note: "Retención de escena con binding objeto-atributo: recuperar un atributo específico (color) vinculado a un objeto entre 3 presentados, cada uno con su propio atributo.",
    domains: ["memoria"],
  },
  // HOME-023
  {
    prompt: "Ahora sobre el escritorio hay una lámpara, un cuaderno y una tijera. ¿Qué cambió respecto de lo anterior?",
    options: ["La lámpara fue reemplazada", "El cuaderno fue reemplazado", "No cambió nada", "El lápiz fue reemplazado por una tijera"],
    correct_answer: 3,
    difficulty: 2,
    stimulus: "Sobre el escritorio hay una lámpara, un cuaderno y un lápiz.",
    subdimension: "deteccion_de_cambio",
    feedback_correct: "Correcto. El lápiz fue reemplazado por una tijera.",
    feedback_incorrect: "Antes había un lápiz; ahora hay una tijera en su lugar.",
    clinician_note: "Detección de cambio por reemplazo: comparar la escena recordada (3 objetos) con la versión modificada presente. Requiere retención y comparación activa.",
    domains: ["atencion", "memoria"],
  },
  // HOME-024
  {
    prompt: "Ahora en la repisa solo hay un jabón y una crema. ¿Qué objeto ya no está?",
    options: ["El jabón", "El vaso con cepillos de dientes", "La crema", "No falta ninguno"],
    correct_answer: 1,
    difficulty: 2,
    stimulus: "En la repisa del baño hay un jabón, un vaso con cepillos de dientes y una crema.",
    subdimension: "deteccion_de_cambio",
    feedback_correct: "Correcto. El vaso con cepillos de dientes ya no está.",
    feedback_incorrect: "Antes había un jabón, un vaso con cepillos de dientes y una crema. El vaso fue el que se retiró.",
    clinician_note: "Detección de cambio por eliminación: identificar cuál de 3 objetos originales fue retirado. Operación distinta al reemplazo (HOME-023): requiere notar una ausencia, no una sustitución.",
    domains: ["atencion", "memoria"],
  },
  // HOME-025
  {
    prompt: "¿Cuál de estos frascos NO estaba en la alacena?",
    options: ["Frasco de arroz", "Frasco de sal", "Frasco de azúcar", "Frasco de harina"],
    correct_answer: 1,
    difficulty: 2,
    stimulus: "En la alacena hay tres frascos: uno de arroz, uno de azúcar y uno de harina.",
    subdimension: "discriminacion_entre_similares",
    feedback_correct: "Correcto. El frasco de sal no fue mencionado.",
    feedback_incorrect: "Los frascos eran de arroz, azúcar y harina. El de sal no estaba.",
    clinician_note: "Discriminación entre objetos similares retenidos: los 4 frascos son del mismo tipo; requiere recordar cuáles fueron nombrados y discriminar el intruso entre items semánticamente cercanos.",
    domains: ["atencion", "memoria"],
  },
  // HOME-026
  {
    prompt: "¿Dónde estaba el bolso?",
    options: ["Junto a la puerta de entrada", "En el perchero del pasillo", "Sobre la silla del comedor", "Debajo de la cama"],
    correct_answer: 2,
    difficulty: 2,
    stimulus: "El paraguas está junto a la puerta de entrada, el bolso está sobre la silla del comedor y las zapatillas están debajo de la cama.",
    subdimension: "memoria_de_ubicacion",
    feedback_correct: "Correcto. El bolso estaba sobre la silla del comedor.",
    feedback_incorrect: "El bolso estaba sobre la silla del comedor.",
    clinician_note: "Memoria de ubicación con 3 bindings objeto-lugar. Demanda moderada: debe discriminar entre las ubicaciones de los tres objetos para responder sobre uno.",
    domains: ["memoria"],
  },
  // HOME-027
  {
    prompt: "Hay cinco objetos en la cocina: olla grande con tapa, sartén chica sin mango, pava mediana con mango, colador grande sin tapa y cacerola chica con tapa. ¿Cuál es grande y no tiene tapa?",
    options: ["Olla", "Colador", "Pava", "Cacerola"],
    correct_answer: 1,
    difficulty: 3,
    stimulus: null,
    subdimension: "atencion_sostenida",
    feedback_correct: "Correcto. El colador es grande y no tiene tapa.",
    feedback_incorrect: "La olla grande tiene tapa. El colador es grande y no tiene tapa.",
    clinician_note: "Atención sostenida: rastrear dos atributos simultáneos (tamaño y accesorio) en 5 objetos para encontrar la intersección correcta. Alta carga atencional.",
    domains: ["atencion"],
  },
  // HOME-028
  {
    prompt: "En la casa hay cinco sillas: de madera en la cocina, de plástico en el patio, de madera en el comedor, tapizada en el living y de plástico en el balcón. ¿En qué ambientes están las de madera?",
    options: ["Cocina y patio", "Cocina y comedor", "Cocina, comedor y living", "Solo en la cocina"],
    correct_answer: 1,
    difficulty: 3,
    stimulus: null,
    subdimension: "rastreo_de_atributos",
    feedback_correct: "Correcto. Las sillas de madera están en la cocina y en el comedor.",
    feedback_incorrect: "Las sillas de madera son dos: la de la cocina y la del comedor.",
    clinician_note: "Rastreo de atributos: filtrar por un atributo (material) entre 5 objetos del mismo tipo, cada uno con material y ubicación propios. Requiere sostener la atención a lo largo de la enumeración.",
    domains: ["atencion"],
  },
  // HOME-029
  {
    prompt: "¿Cuál de estos grupos incluye solamente objetos que estaban en el living?",
    options: ["Sillón, alfombra, portarretratos, velador y manta", "Sillón, alfombra, almohadón, lámpara de pie y manta", "Sillón, alfombra, portarretratos, lámpara de pie y manta", "Sillón, cortina, portarretratos, lámpara de pie y manta"],
    correct_answer: 2,
    difficulty: 3,
    stimulus: "En el living hay un sillón, una alfombra, un portarretratos, una lámpara de pie y una manta sobre el respaldo.",
    subdimension: "retencion_de_escena",
    feedback_correct: "Correcto. Recordó los cinco objetos.",
    feedback_incorrect: "Los objetos eran: sillón, alfombra, portarretratos, lámpara de pie y manta.",
    clinician_note: "Retención de escena extendida: 5 objetos. Distractores sustituyen un objeto por otro plausible del mismo ambiente. Alta carga de retención.",
    domains: ["memoria"],
  },
  // HOME-030
  {
    prompt: "¿Qué hizo justo después de lavar los platos?",
    options: ["Los guardó en la alacena", "Juntó los platos", "Los secó con el repasador", "Limpió la mesa"],
    correct_answer: 2,
    difficulty: 3,
    stimulus: "Para ordenar la cocina después de comer, primero juntó los platos, después los lavó, luego los secó con el repasador y por último los guardó en la alacena.",
    subdimension: "memoria_de_secuencia",
    feedback_correct: "Correcto. Después de lavarlos, los secó con el repasador.",
    feedback_incorrect: "El orden era: juntar, lavar, secar con el repasador y guardar en la alacena.",
    clinician_note: "Memoria de secuencia con 4 pasos. Requiere retener la cadena completa y ubicar la posición relativa del paso consultado.",
    domains: ["memoria"],
  },
  // HOME-031
  {
    prompt: "¿Dónde quedaron las llaves?",
    options: ["En la mesita de luz", "En el estante del living", "Sobre la mesa del comedor", "En el cajón de la cocina"],
    correct_answer: 3,
    difficulty: 3,
    stimulus: "El teléfono quedó en la mesita de luz, los anteojos sobre la mesa del comedor, las llaves en el cajón de la cocina y la billetera en el estante del living.",
    subdimension: "memoria_de_ubicacion",
    feedback_correct: "Correcto. Las llaves estaban en el cajón de la cocina.",
    feedback_incorrect: "Las llaves habían quedado en el cajón de la cocina.",
    clinician_note: "Memoria de ubicación con 4 bindings objeto-lugar. Cada opción corresponde a la ubicación real de uno de los objetos, generando interferencia entre asociaciones.",
    domains: ["memoria"],
  },
  // HOME-032
  {
    prompt: "¿De qué color era el mantel y dónde estaba?",
    options: ["Mantel blanco, sobre la mesada", "Mantel gris, colgado del horno", "Mantel rojo, en la mesa", "Mantel verde, en la silla"],
    correct_answer: 2,
    difficulty: 3,
    stimulus: "En la cocina hay una taza blanca sobre la mesada, un mantel rojo en la mesa, una frutera de mimbre con naranjas y un trapo gris colgado del horno.",
    subdimension: "retencion_de_escena",
    feedback_correct: "Correcto. El mantel era rojo y estaba en la mesa.",
    feedback_incorrect: "El mantel era rojo y estaba en la mesa.",
    clinician_note: "Retención con binding doble (objeto + color + ubicación). Recuperar dos atributos de un objeto entre 4 presentados, cada uno con sus propios atributos. Alta carga.",
    domains: ["memoria"],
  },
  // HOME-033
  {
    prompt: "Ahora en el escritorio hay una lámpara, una carpeta, un portalápices, un anotador y un reloj. ¿Qué objeto fue reemplazado?",
    options: ["La lámpara", "El portalápices", "La calculadora", "El reloj"],
    correct_answer: 2,
    difficulty: 3,
    stimulus: "En el escritorio hay una lámpara, una carpeta, un portalápices, una calculadora y un reloj.",
    subdimension: "deteccion_de_cambio",
    feedback_correct: "Correcto. La calculadora fue reemplazada por un anotador.",
    feedback_incorrect: "Antes había una calculadora; ahora hay un anotador en su lugar.",
    clinician_note: "Detección de cambio en escena compleja: 5 objetos originales, 1 sustituido. Requiere retener los 5 y comparar con la versión modificada para detectar el cambio.",
    domains: ["atencion", "memoria"],
  },
  // HOME-034
  {
    prompt: "¿Qué contenía el frasco que era bajo y no tenía azúcar?",
    options: ["Arroz", "Fideos", "Azúcar", "Sal"],
    correct_answer: 3,
    difficulty: 3,
    stimulus: "En la alacena hay cuatro frascos: uno alto con arroz, uno bajo con azúcar, uno alto con fideos y uno bajo con sal.",
    subdimension: "discriminacion_entre_similares",
    feedback_correct: "Correcto. El frasco bajo que no tenía azúcar era el de sal.",
    feedback_incorrect: "Los frascos bajos eran el de azúcar y el de sal. El que no tenía azúcar contenía sal.",
    clinician_note: "Discriminación entre objetos similares con binding doble (tamaño + contenido): requiere retener 4 frascos con 2 atributos cada uno, filtrar por tamaño y excluir uno para identificar el correcto.",
    domains: ["atencion", "memoria"],
  },
];

// MT pilot: 30 questions for memoria_de_trabajo ("Lista del supermercado")
const MT_QUESTIONS = [
  // MT-01 (legacy corrected)
  {
    prompt: "¿Cuáles eran los productos de la lista?",
    options: ["Pan, leche y manzanas", "Café, arroz y jabón", "Tomates, queso y pilas", "Pan, galletitas y manzanas"],
    correct_answer: 0,
    difficulty: 1,
    stimulus: "En la lista de compras hay pan, leche y manzanas.",
    subdimension: "retencion_y_evocacion",
    feedback_correct: "Correcto. Recuperó la lista completa de tres productos.",
    feedback_incorrect: "Los productos eran pan, leche y manzanas.",
    clinician_note: "Reconocimiento de lista completa de 3 ítems presentada previamente. Demanda baja: recuperación directa, distractores con ítems completamente diferentes o con una sustitución.",
    domains: ["memoria"],
  },
  // MT-02 (legacy corrected)
  {
    prompt: "Elena quería comprar leche, arroz y jabón. ¿Qué producto NO estaba en su lista?",
    options: ["Arroz", "Pilas", "Jabón", "Leche"],
    correct_answer: 1,
    difficulty: 1,
    stimulus: null,
    subdimension: "deteccion_de_anomalia",
    feedback_correct: "Correcto. Detectó el elemento que no pertenecía a la lista.",
    feedback_incorrect: "Los productos eran leche, arroz y jabón. Las pilas no estaban en la lista.",
    clinician_note: "Detección de elemento intruso en lista de 3 ítems. Demanda baja: el intruso no guarda relación semántica cercana con los originales.",
    domains: ["memoria", "atencion"],
  },
  // MT-03 (legacy corrected)
  {
    prompt: "La lista tenía leche, pan y manzanas. Si ya puso leche y pan en el chango, ¿qué falta?",
    options: ["Leche", "Pan", "Manzanas", "Ya tiene todo"],
    correct_answer: 2,
    difficulty: 1,
    stimulus: null,
    subdimension: "actualizacion_de_memoria",
    feedback_correct: "Correcto. Identificó el producto pendiente.",
    feedback_incorrect: "Faltaban las manzanas: leche y pan ya estaban en el chango.",
    clinician_note: "Actualización de memoria de trabajo: descontar 2 ítems ya obtenidos de una lista de 3 y retener el pendiente. Demanda baja: un solo ítem remanente.",
    domains: ["memoria", "atencion"],
  },
  // MT-04 (legacy corrected)
  {
    prompt: "El cartel decía: 2 yogures y 1 queso. ¿Qué debe llevar?",
    options: ["Un yogur y dos quesos", "Dos quesos y una leche", "Un yogur y un queso", "Dos yogures y un queso"],
    correct_answer: 3,
    difficulty: 1,
    stimulus: null,
    subdimension: "rastreo_de_atributos",
    feedback_correct: "Correcto. Retuvo las cantidades correctas de cada producto.",
    feedback_incorrect: "El cartel indicaba 2 yogures y 1 queso.",
    clinician_note: "Retención de doble atributo: producto con cantidad. Demanda baja: dos pares producto-cantidad, distractores invierten o alteran las cantidades.",
    domains: ["memoria", "atencion"],
  },
  // MT-05 (legacy corrected)
  {
    prompt: "La receta pide tomate, queso y albahaca. ¿Qué grupo de productos sirve para prepararla?",
    options: ["Tomate, queso y albahaca", "Pan, mermelada y café", "Jabón, arroz y pilas", "Tomate, arroz y café"],
    correct_answer: 0,
    difficulty: 1,
    stimulus: null,
    subdimension: "categorizacion_funcional",
    feedback_correct: "Correcto. Asoció los productos con el propósito de la receta.",
    feedback_incorrect: "Los ingredientes de la receta eran tomate, queso y albahaca.",
    clinician_note: "Agrupación semántica por contexto: asociar tres productos con el propósito que los vincula. Demanda baja: el vínculo temático es directo.",
    domains: ["memoria"],
  },
  // MT-06
  {
    prompt: "¿Cuál de estas verduras pidió?",
    options: ["Zapallo", "Morrones", "Lechuga", "Tomate"],
    correct_answer: 1,
    difficulty: 1,
    stimulus: "En la verdulería pidió papa, cebolla y morrones.",
    subdimension: "retencion_y_evocacion",
    feedback_correct: "Correcto. Reconoció uno de los productos pedidos.",
    feedback_incorrect: "Las verduras pedidas eran papa, cebolla y morrones.",
    clinician_note: "Recuperación selectiva: reconocer un ítem de una lista breve entre distractores de la misma categoría semántica. Demanda baja: 3 ítems, un solo dato a recuperar.",
    domains: ["memoria"],
  },
  // MT-07
  {
    prompt: "Marta fue a comprar productos de limpieza y puso en el chango: lavandina, detergente, un paquete de fideos y jabón en polvo. ¿Cuál no corresponde a esa categoría?",
    options: ["Lavandina", "Jabón en polvo", "Fideos", "Detergente"],
    correct_answer: 2,
    difficulty: 1,
    stimulus: null,
    subdimension: "deteccion_de_anomalia",
    feedback_correct: "Correcto. Los fideos no son un producto de limpieza.",
    feedback_incorrect: "Lavandina, detergente y jabón en polvo son productos de limpieza. Los fideos no corresponden a esa categoría.",
    clinician_note: "Detección de ítem fuera de categoría en enumeración de 4 elementos. Demanda baja: la anomalía es evidente por pertenecer a una categoría funcional diferente.",
    domains: ["memoria", "atencion"],
  },
  // MT-08
  {
    prompt: "La lista decía manteca, pero en el negocio no había. Decidió llevar margarina en su lugar. ¿Qué lleva finalmente?",
    options: ["Manteca", "Aceite", "Las dos cosas", "Margarina"],
    correct_answer: 3,
    difficulty: 1,
    stimulus: null,
    subdimension: "actualizacion_de_memoria",
    feedback_correct: "Correcto. Retuvo la sustitución realizada.",
    feedback_incorrect: "Como no había manteca, decidió llevar margarina.",
    clinician_note: "Actualización por sustitución: reemplazar un ítem por otro y retener el cambio. Demanda baja: un solo reemplazo directo.",
    domains: ["memoria"],
  },
  // MT-09
  {
    prompt: "¿En qué parte del supermercado busca la leche?",
    options: ["En la entrada", "Al fondo", "En las cajas", "En el pasillo central"],
    correct_answer: 1,
    difficulty: 1,
    stimulus: "Las frutas están en la entrada del supermercado y los lácteos están al fondo.",
    subdimension: "rastreo_de_atributos",
    feedback_correct: "Correcto. Los lácteos estaban al fondo.",
    feedback_incorrect: "Las frutas estaban en la entrada y los lácteos al fondo. La leche es un lácteo.",
    clinician_note: "Asociación categoría-ubicación: retener dos bindings (frutas→entrada, lácteos→fondo) y recuperar la ubicación de un producto a partir de su categoría. Demanda baja: dos asociaciones directas.",
    domains: ["memoria", "atencion"],
  },
  // MT-10
  {
    prompt: "Cuando llega al supermercado se encuentra con un vecino y conversan un momento. Al entrar, ¿qué productos tenía que comprar?",
    options: ["Aceite, harina y huevos", "Aceite, leche y huevos", "Manteca, harina y huevos", "Aceite, harina y azúcar"],
    correct_answer: 0,
    difficulty: 1,
    stimulus: "Tiene que comprar aceite, harina y huevos.",
    subdimension: "retencion_y_evocacion",
    feedback_correct: "Correcto. Recordó los tres productos pese a la distracción.",
    feedback_incorrect: "Los productos eran aceite, harina y huevos.",
    clinician_note: "Retención de lista breve con distracción narrativa interpuesta. Demanda baja: 3 ítems, la distracción es contextual, no agrega carga de procesamiento real.",
    domains: ["memoria"],
  },
  // MT-11
  {
    prompt: "¿Cuánta leche tenía que comprar?",
    options: ["1 litro", "Medio litro", "2 litros", "3 litros"],
    correct_answer: 2,
    difficulty: 1,
    stimulus: "Necesita comprar: 1 kilo de azúcar, medio kilo de yerba y 2 litros de leche.",
    subdimension: "rastreo_de_atributos",
    feedback_correct: "Correcto. Recuperó la cantidad indicada.",
    feedback_incorrect: "Tenía que comprar 2 litros de leche.",
    clinician_note: "Recuperación de un atributo numérico (cantidad) de un ítem dentro de una lista de tres pares producto-cantidad. Demanda baja: una sola asociación a recuperar.",
    domains: ["memoria", "atencion"],
  },
  // MT-12
  {
    prompt: "¿Qué producto anotó último?",
    options: ["Azúcar", "Yerba", "No se puede saber", "Café"],
    correct_answer: 3,
    difficulty: 1,
    stimulus: "Fue anotando: primero azúcar, después yerba y al final café.",
    subdimension: "memoria_de_secuencia",
    feedback_correct: "Correcto. El último producto anotado fue el café.",
    feedback_incorrect: "El orden era: primero azúcar, después yerba y al final café.",
    clinician_note: "Retención del orden de 3 ítems y recuperación del último. Demanda baja: secuencia corta con marcadores ordinales explícitos (primero, después, al final).",
    domains: ["memoria"],
  },
  // MT-13
  {
    prompt: "¿Cuáles eran los cuatro productos de la lista?",
    options: ["Arroz, fideos, aceite y sal", "Arroz, harina, aceite y vinagre", "Arroz, fideos, aceite y vinagre", "Arroz, fideos, manteca y vinagre"],
    correct_answer: 2,
    difficulty: 2,
    stimulus: "La lista de compras tiene: arroz, fideos, aceite y vinagre.",
    subdimension: "retencion_y_evocacion",
    feedback_correct: "Correcto. Recordó los cuatro productos.",
    feedback_incorrect: "Los productos eran arroz, fideos, aceite y vinagre.",
    clinician_note: "Retención de lista de 4 ítems. Cada distractor sustituye un ítem por otro semánticamente cercano. Demanda moderada: mayor carga de retención y discriminación fina entre opciones similares.",
    domains: ["memoria"],
  },
  // MT-14
  {
    prompt: "Fue al supermercado a comprar para un guiso: carne, papa, batata, cebolla y un champú que necesitaba. ¿Cuál de los productos no es un ingrediente del guiso?",
    options: ["Papa", "Batata", "Cebolla", "Champú"],
    correct_answer: 3,
    difficulty: 2,
    stimulus: null,
    subdimension: "deteccion_de_anomalia",
    feedback_correct: "Correcto. El champú no es un ingrediente del guiso.",
    feedback_incorrect: "Los ingredientes del guiso eran carne, papa, batata y cebolla. El champú no es un ingrediente.",
    clinician_note: "Detección de anomalía en lista mixta de 5 ítems: distinguir ingredientes de un ítem no alimentario que aparece mezclado en la misma compra. Demanda moderada: lista más larga y contexto de compra mixta.",
    domains: ["memoria", "atencion"],
  },
  // MT-15
  {
    prompt: "Ya puso la leche y el jamón en el chango. ¿Qué productos le faltan?",
    options: ["Leche y queso", "Pan y queso", "Queso y jamón", "Pan y jamón"],
    correct_answer: 1,
    difficulty: 2,
    stimulus: "Tiene que comprar: leche, pan, queso y jamón.",
    subdimension: "actualizacion_de_memoria",
    feedback_correct: "Correcto. Faltan pan y queso.",
    feedback_incorrect: "Tenía que comprar leche, pan, queso y jamón. Ya puso leche y jamón. Faltan pan y queso.",
    clinician_note: "Actualización: descontar 2 ítems de una lista de 4 y retener los 2 pendientes. Demanda moderada: más ítems que en d1 y dos operaciones de exclusión con dos remanentes.",
    domains: ["memoria", "atencion"],
  },
  // MT-16
  {
    prompt: "¿Cuánta harina y cuánto aceite tenía que comprar?",
    options: ["2 kilos de harina y 1 litro de aceite", "1 kilo de harina y 2 litros de aceite", "2 kilos de harina y medio litro de aceite", "Medio kilo de harina y 1 litro de aceite"],
    correct_answer: 0,
    difficulty: 2,
    stimulus: "Tiene que comprar: 2 kilos de harina, 1 litro de aceite y medio kilo de azúcar.",
    subdimension: "rastreo_de_atributos",
    feedback_correct: "Correcto. Recuperó ambas cantidades.",
    feedback_incorrect: "Tenía que comprar 2 kilos de harina y 1 litro de aceite.",
    clinician_note: "Recuperación simultánea de dos bindings producto-cantidad de una lista de tres pares. Demanda moderada: los distractores invierten o intercambian cantidades entre productos.",
    domains: ["memoria", "atencion"],
  },
  // MT-17
  {
    prompt: "¿Qué producto necesitan los dos?",
    options: ["Pan", "Café", "Huevos", "Manteca"],
    correct_answer: 2,
    difficulty: 2,
    stimulus: "Carlos necesita: leche, pan y huevos. Marta necesita: huevos, café y manteca.",
    subdimension: "comparacion_y_seleccion",
    feedback_correct: "Correcto. Huevos es el producto compartido.",
    feedback_incorrect: "Carlos necesita leche, pan y huevos. Marta necesita huevos, café y manteca. El producto compartido son los huevos.",
    clinician_note: "Comparación entre dos listas breves para encontrar el elemento compartido. Demanda moderada: requiere mantener ambas listas activas y cruzarlas.",
    domains: ["memoria", "atencion"],
  },
  // MT-18
  {
    prompt: "¿Qué producto estaba en la primera lista pero NO en la segunda?",
    options: ["Leche", "Fideos", "Detergente", "Arroz"],
    correct_answer: 3,
    difficulty: 2,
    stimulus: "Primero leyó una lista que decía: leche, arroz y jabón. Después leyó otra que decía: leche, fideos y detergente.",
    subdimension: "retencion_y_evocacion",
    feedback_correct: "Correcto. El arroz solo estaba en la primera lista.",
    feedback_incorrect: "La primera lista tenía leche, arroz y jabón. La segunda tenía leche, fideos y detergente. El arroz solo estaba en la primera.",
    clinician_note: "Retención con interferencia proactiva: discriminar entre dos listas que comparten un ítem y recuperar uno exclusivo de la primera. Demanda moderada: la superposición parcial genera confusión.",
    domains: ["memoria", "atencion"],
  },
  // MT-19
  {
    prompt: "¿Adónde fue en segundo lugar?",
    options: ["A la verdulería", "A la carnicería", "A la panadería", "A las cajas"],
    correct_answer: 1,
    difficulty: 2,
    stimulus: "Primero compró las verduras, después pasó por la carnicería y por último fue a la panadería.",
    subdimension: "memoria_de_secuencia",
    feedback_correct: "Correcto. En segundo lugar fue a la carnicería.",
    feedback_incorrect: "El orden fue: primero verduras, después carnicería y por último panadería.",
    clinician_note: "Memoria de secuencia: retener el orden de 3 paradas y recuperar la posición ordinal de una. Demanda moderada: requiere mantener no solo los destinos sino el orden temporal.",
    domains: ["memoria"],
  },
  // MT-20
  {
    prompt: "La lista original tenía arroz, fideos y aceite. En el supermercado se acordó de que también necesitaba sal. ¿Cuál es la lista actualizada?",
    options: ["Arroz, fideos, aceite y sal", "Arroz, fideos y sal", "Fideos, aceite y sal", "Arroz, fideos, aceite y azúcar"],
    correct_answer: 0,
    difficulty: 2,
    stimulus: null,
    subdimension: "actualizacion_de_memoria",
    feedback_correct: "Correcto. Agregó sal sin perder los productos originales.",
    feedback_incorrect: "La lista original era arroz, fideos y aceite. Al agregar sal, queda: arroz, fideos, aceite y sal.",
    clinician_note: "Actualización por adición: agregar un ítem nuevo a una lista de 3 retenida previamente. Demanda moderada: requiere mantener los 3 originales intactos e incorporar el agregado; los distractores pierden un original.",
    domains: ["memoria"],
  },
  // MT-21
  {
    prompt: "Compró yogur, queso, manzanas, jabón y pan. El yogur y el queso los encontró en la sección de lácteos. ¿Qué productos encontró en esa sección?",
    options: ["Yogur y manzanas", "Yogur y queso", "Queso y pan", "Manzanas y jabón"],
    correct_answer: 1,
    difficulty: 2,
    stimulus: null,
    subdimension: "categorizacion_funcional",
    feedback_correct: "Correcto. Yogur y queso estaban en la sección de lácteos.",
    feedback_incorrect: "El yogur y el queso son los que encontró en la sección de lácteos.",
    clinician_note: "Asociación ítem-sección con información explícita en un contexto de 5 productos. Demanda moderada: debe identificar cuáles de los 5 fueron asignados a la sección mencionada.",
    domains: ["memoria", "atencion"],
  },
  // MT-22
  {
    prompt: "¿Cuáles fueron los dos primeros productos que anotó?",
    options: ["Aceite y leche", "Leche y jabón", "Arroz y aceite", "Arroz y jabón"],
    correct_answer: 2,
    difficulty: 2,
    stimulus: "Fue anotando la lista en este orden: primero arroz, segundo aceite, tercero leche y cuarto jabón.",
    subdimension: "memoria_de_secuencia",
    feedback_correct: "Correcto. Los dos primeros fueron arroz y aceite.",
    feedback_incorrect: "El orden era: primero arroz, segundo aceite, tercero leche, cuarto jabón.",
    clinician_note: "Recuperación posicional de los dos primeros ítems de una secuencia de 4. Demanda moderada: requiere retener el orden completo y recuperar un subconjunto posicional.",
    domains: ["memoria"],
  },
  // MT-23
  {
    prompt: "En la lista anotó: leche a $800, pan a $500 y queso a $1200. ¿Cuál era el producto más caro?",
    options: ["Leche", "Pan", "Los tres costaban lo mismo", "Queso"],
    correct_answer: 3,
    difficulty: 2,
    stimulus: null,
    subdimension: "rastreo_de_atributos",
    feedback_correct: "Correcto. El queso era el más caro, a $1200.",
    feedback_incorrect: "Los precios eran: leche $800, pan $500, queso $1200. El más caro era el queso.",
    clinician_note: "Rastreo de atributo numérico (precio) en 3 ítems y comparación ordinal. Demanda moderada: requiere retener 3 bindings producto-precio y determinar el máximo.",
    domains: ["memoria", "atencion"],
  },
  // MT-24
  {
    prompt: "La lista original decía: café, azúcar, yerba y leche. Después tachó el café y anotó té en su lugar. ¿Cómo quedó la lista?",
    options: ["Té, azúcar, yerba y leche", "Café, azúcar, yerba y leche", "Té, azúcar, yerba y café", "Café, azúcar, té y leche"],
    correct_answer: 0,
    difficulty: 2,
    stimulus: null,
    subdimension: "actualizacion_de_memoria",
    feedback_correct: "Correcto. Reemplazó café por té y mantuvo el resto.",
    feedback_incorrect: "La lista era café, azúcar, yerba y leche. Al reemplazar café por té, queda: té, azúcar, yerba y leche.",
    clinician_note: "Actualización por sustitución en lista de 4 ítems: retener la lista, aplicar la sustitución y verificar el resultado completo. Demanda moderada: más ítems que la sustitución de d1 y verificación de 4 posiciones.",
    domains: ["memoria"],
  },
  // MT-25
  {
    prompt: "¿Cuál de estos grupos coincide exactamente con lo anotado?",
    options: ["Leche descremada, pan lactal, queso cremoso, manteca y dulce de leche", "Leche entera, pan lactal, queso cremoso, manteca y dulce de leche", "Leche descremada, pan francés, queso cremoso, manteca y dulce de leche", "Leche descremada, pan lactal, queso cremoso, margarina y dulce de leche"],
    correct_answer: 0,
    difficulty: 3,
    stimulus: "Anotó para comprar: leche descremada, pan lactal, queso cremoso, manteca y dulce de leche.",
    subdimension: "retencion_y_evocacion",
    feedback_correct: "Correcto. Recordó los cinco productos con sus especificaciones.",
    feedback_incorrect: "Los productos eran: leche descremada, pan lactal, queso cremoso, manteca y dulce de leche.",
    clinician_note: "Retención de 5 ítems con atributos específicos (tipo de leche, tipo de pan). Los distractores alteran un solo atributo por opción. Alta demanda: requiere retención precisa de los 5 ítems con sus especificaciones.",
    domains: ["memoria", "atencion"],
  },
  // MT-26
  {
    prompt: "¿Qué producto necesitan Juan y María pero no Pedro?",
    options: ["Pan", "Leche", "Queso", "Café"],
    correct_answer: 1,
    difficulty: 3,
    stimulus: "Juan necesita leche y pan. María necesita leche y queso. Pedro necesita pan y café.",
    subdimension: "comparacion_y_seleccion",
    feedback_correct: "Correcto. Leche es el producto que comparten Juan y María pero no Pedro.",
    feedback_incorrect: "Juan necesita leche y pan. María necesita leche y queso. Pedro necesita pan y café. El producto compartido por Juan y María que Pedro no necesita es la leche.",
    clinician_note: "Intersección con exclusión: retener tres listas de 2 ítems cada una, encontrar la intersección de dos y verificar exclusión del tercero. Alta carga de memoria de trabajo por la triple comparación cruzada.",
    domains: ["memoria", "atencion"],
  },
  // MT-27
  {
    prompt: "Tachó el vinagre, agregó limones y reemplazó la sal por pimienta. ¿Cómo quedó la lista?",
    options: ["Arroz, fideos, aceite, sal y limones", "Arroz, fideos, aceite, pimienta y vinagre", "Arroz, fideos, aceite, pimienta y limones", "Arroz, fideos, sal, pimienta y limones"],
    correct_answer: 2,
    difficulty: 3,
    stimulus: "La lista original tenía: arroz, fideos, aceite, sal y vinagre.",
    subdimension: "actualizacion_de_memoria",
    feedback_correct: "Correcto. Aplicó las tres modificaciones correctamente.",
    feedback_incorrect: "Tachó vinagre, agregó limones y reemplazó sal por pimienta. La lista queda: arroz, fideos, aceite, pimienta y limones.",
    clinician_note: "Triple actualización secuencial sobre una lista de 5 ítems: una eliminación, una adición y una sustitución. Alta demanda: tres operaciones diferentes aplicadas en secuencia sobre memoria de trabajo.",
    domains: ["memoria", "atencion"],
  },
  // MT-28
  {
    prompt: "¿Cuánto queso tiene que buscar y en qué sección?",
    options: ["2 kilos, en la carnicería", "3 paquetes, en almacén", "1 kilo, en la carnicería", "1 kilo, en la fiambrería"],
    correct_answer: 3,
    difficulty: 3,
    stimulus: "Tiene que buscar: 2 kilos de carne en la carnicería, 1 kilo de queso en la fiambrería y 3 paquetes de fideos en almacén.",
    subdimension: "rastreo_de_atributos",
    feedback_correct: "Correcto. Un kilo de queso, en la fiambrería.",
    feedback_incorrect: "Tenía que buscar 1 kilo de queso en la fiambrería.",
    clinician_note: "Triple binding producto-cantidad-sección en 3 ítems: retener tres asociaciones de tres atributos y recuperar dos atributos de un ítem específico. Alta demanda por la carga de bindings simultáneos.",
    domains: ["memoria", "atencion"],
  },
  // MT-29
  {
    prompt: "Al repasarla, dijo: leche, huevos, pan, queso y café. ¿Qué dos productos cambió de lugar?",
    options: ["Leche y huevos", "Pan y huevos", "Queso y café", "Leche y pan"],
    correct_answer: 1,
    difficulty: 3,
    stimulus: "La lista del supermercado era: primero leche, segundo pan, tercero huevos, cuarto queso y quinto café.",
    subdimension: "memoria_de_secuencia",
    feedback_correct: "Correcto. Pan y huevos intercambiaron posiciones.",
    feedback_incorrect: "La lista original era: leche, pan, huevos, queso, café. Al repasar dijo: leche, huevos, pan, queso, café. Pan y huevos cambiaron de lugar.",
    clinician_note: "Detección de intercambio posicional en secuencia de 5 ítems: retener la secuencia original, compararla con la versión alterada e identificar los dos elementos permutados. Alta demanda: comparación posicional de 5 ítems.",
    domains: ["memoria", "atencion"],
  },
  // MT-30
  {
    prompt: "Compró estos productos: leche en caja, yogur natural, jugo de naranja en botella, agua mineral en botella y queso untable. Si separa los lácteos de las bebidas no lácteas, ¿qué productos van en el grupo de lácteos?",
    options: ["Leche, yogur y jugo", "Leche, jugo y queso untable", "Leche, yogur y queso untable", "Yogur, jugo y agua"],
    correct_answer: 2,
    difficulty: 3,
    stimulus: null,
    subdimension: "categorizacion_funcional",
    feedback_correct: "Correcto. Los lácteos son leche, yogur y queso untable.",
    feedback_incorrect: "Los lácteos son: leche, yogur natural y queso untable. El jugo y el agua mineral son bebidas no lácteas.",
    clinician_note: "Categorización de 5 ítems con criterio que requiere conocimiento funcional: la leche es lácteo (no solo bebida), el jugo no es lácteo aunque es bebida. Alta demanda: 5 ítems con fronteras semánticas que exigen clasificación deliberada.",
    domains: ["memoria", "atencion"],
  },
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

  // Resolve slugs to IDs (needed by both legacy and HOME blocks)
  const sectionRows = await knex("sections").select("id", "slug");
  const slugToId = Object.fromEntries(sectionRows.map((r) => [r.slug, r.id]));

  const domainRows = await knex("cognitive_domains").select("id", "slug");
  const domainSlugToId = Object.fromEntries(domainRows.map((r) => [r.slug, r.id]));

  // --- Legacy questions: only insert if none exist yet ---
  const [{ count: legacyCount }] = await knex("questions")
    .where("source", "legacy_seed_v1")
    .count("id as count");

  if (Number(legacyCount) === 0) {
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

  // --- HOME pilot questions: only insert if none exist for this section+source ---
  const homeSectionId = slugToId["atencion_visual"];

  const [{ count: homeCount }] = await knex("questions")
    .where({ source: "ai_assisted_v1", section_id: homeSectionId })
    .count("id as count");

  if (Number(homeCount) === 0) {
    for (const q of HOME_QUESTIONS) {
      const [inserted] = await knex("questions")
        .insert({
          section_id: homeSectionId,
          prompt: q.prompt,
          response_type: "multiple_choice",
          options: JSON.stringify(q.options),
          correct_answer: q.correct_answer,
          scoring_value: 1,
          difficulty: q.difficulty,
          feedback_correct: q.feedback_correct,
          feedback_incorrect: q.feedback_incorrect,
          clinician_note: q.clinician_note,
          stimulus: q.stimulus,
          subdimension: q.subdimension,
          source: "ai_assisted_v1",
          is_active: true,
          is_validated: false,
        })
        .returning("id");

      for (const domainSlug of q.domains) {
        await knex("question_cognitive_domains").insert({
          question_id: inserted.id,
          cognitive_domain_id: domainSlugToId[domainSlug],
        });
      }
    }
  }

  // --- MT questions: migrate from ai_assisted_v1 to bank_v1, then insert if needed ---
  const mtSectionId = slugToId["memoria_de_trabajo"];

  // One-time migration: remove old ai_assisted_v1 MT questions (replaced by bank_v1)
  const oldMtIds = await knex("questions")
    .where({ source: "ai_assisted_v1", section_id: mtSectionId })
    .select("id");
  if (oldMtIds.length > 0) {
    const ids = oldMtIds.map((r) => r.id);
    await knex("question_cognitive_domains").whereIn("question_id", ids).del();
    await knex("questions").whereIn("id", ids).del();
  }

  // --- Bank questions (bank_v1): insert per section if none exist ---
  const BANK_SECTIONS = [
    { slug: "memoria_de_trabajo", questions: MT_QUESTIONS },
    { slug: "atencion_y_calculo", questions: ATENCION_Y_CALCULO_QUESTIONS },
    { slug: "funciones_ejecutivas", questions: FUNCIONES_EJECUTIVAS_QUESTIONS },
    { slug: "orientacion_temporal", questions: ORIENTACION_TEMPORAL_QUESTIONS },
    { slug: "memoria_asociativa", questions: MEMORIA_ASOCIATIVA_QUESTIONS },
    { slug: "metacognicion", questions: METACOGNICION_QUESTIONS },
    { slug: "memoria_prospectiva", questions: MEMORIA_PROSPECTIVA_QUESTIONS },
    { slug: "comprension_funcional", questions: COMPRENSION_FUNCIONAL_QUESTIONS },
    { slug: "orientacion_espacial", questions: ORIENTACION_ESPACIAL_QUESTIONS },
  ];

  for (const { slug, questions } of BANK_SECTIONS) {
    const sectionId = slugToId[slug];
    const [{ count }] = await knex("questions")
      .where({ source: "bank_v1", section_id: sectionId })
      .count("id as count");

    if (Number(count) === 0) {
      for (const q of questions) {
        const [inserted] = await knex("questions")
          .insert({
            section_id: sectionId,
            prompt: q.prompt,
            response_type: "multiple_choice",
            options: JSON.stringify(q.options),
            correct_answer: q.correct_answer,
            scoring_value: 1,
            difficulty: q.difficulty,
            feedback_correct: q.feedback_correct,
            feedback_incorrect: q.feedback_incorrect,
            clinician_note: q.clinician_note,
            stimulus: q.stimulus || null,
            subdimension: q.subdimension,
            source: "bank_v1",
            is_active: true,
            is_validated: false,
          })
          .returning("id");

        for (const domainSlug of q.domains) {
          await knex("question_cognitive_domains").insert({
            question_id: inserted.id,
            cognitive_domain_id: domainSlugToId[domainSlug],
          });
        }
      }
    }
  }

  // --- Backfill N:M domain assignments for legacy_seed_v1 questions ---
  //
  // Las 43 preguntas legacy fueron insertadas sin asociaciones a cognitive_domains
  // (CLAUDE.md: "La asignación de dominios a las 43 preguntas legacy: pendiente").
  // Mientras no exista la matriz definitiva ACTIVIDAD × DOMINIO, se asigna a cada
  // pregunta legacy el dominio primario de su sección (una sola asociación por
  // pregunta). Esto evita que la elegibilidad con filtro de dominios reduzca el
  // banco por falta de clasificación, no por falta de contenido.
  //
  // Operación NO destructiva e idempotente:
  //   - Sólo inserta filas en question_cognitive_domains que no existan.
  //   - No modifica columnas de questions ni toca contenido.
  //   - Preguntas legacy que YA tengan al menos una asociación son ignoradas.
  const LEGACY_SECTION_PRIMARY_DOMAIN = {
    memoria_de_trabajo: "memoria",
    atencion_y_calculo: "atencion",
    funciones_ejecutivas: "funciones_ejecutivas",
    orientacion_temporal: "orientacion",
    memoria_asociativa: "memoria",
    metacognicion: "funciones_ejecutivas",
    memoria_prospectiva: "memoria",
    atencion_visual: "atencion",
    comprension_funcional: "comprension_lenguaje",
    orientacion_espacial: "orientacion",
  };

  const legacyRows = await knex("questions as q")
    .leftJoin(
      "question_cognitive_domains as qcd",
      "qcd.question_id",
      "q.id"
    )
    .join("sections as s", "s.id", "q.section_id")
    .where("q.source", "legacy_seed_v1")
    .whereNull("qcd.question_id")
    .select("q.id as question_id", "s.slug as section_slug");

  for (const row of legacyRows) {
    const primarySlug = LEGACY_SECTION_PRIMARY_DOMAIN[row.section_slug];
    if (!primarySlug) continue;
    const domainId = domainSlugToId[primarySlug];
    if (!domainId) continue;
    await knex("question_cognitive_domains").insert({
      question_id: row.question_id,
      cognitive_domain_id: domainId,
    });
  }

  // --- Promoción técnica (F1) de preguntas pendientes ---
  //
  // Las preguntas con is_validated=false AND validation_level IS NULL que
  // además superan la revisión técnica automatizada (4 opciones válidas,
  // correct_answer en rango, feedback presente, subdimension, dificultad 1/2/3,
  // al menos un dominio N:M, sin duplicados estructurales) se marcan como
  // validation_level='technical'. Esto NO modifica is_validated: la columna
  // histórica se preserva. El selector trata como elegible cualquier pregunta
  // con is_validated=true OR validation_level IS NOT NULL.
  //
  // 'clinical' NO se asigna automáticamente aquí: no hay evidencia documental
  // de validación clínica profesional para el banco histórico, y el usuario
  // explícitamente pidió preservar el estado actual sin reclamar lo contrario.
  //
  // Idempotente: sólo toca filas que todavía no tienen validation_level.
  // Como la revisión técnica no detectó observaciones en ninguna de las 247
  // pendientes (ver backend/docs/technical-review.md si se agregan reglas en
  // el futuro), el bloque es completo. Si se incorporan preguntas nuevas
  // posteriores que fallen revisión, deberían quedar en validation_level=NULL
  // y manejarse en patch posterior; este bloque las dejaría intactas.
  const VALID_DOMAINS = new Set(["memoria","atencion","funciones_ejecutivas","orientacion","comprension_lenguaje"]);

  const toReview = await knex("questions as q")
    .leftJoin("question_cognitive_domains as qcd","qcd.question_id","q.id")
    .leftJoin("cognitive_domains as cd","cd.id","qcd.cognitive_domain_id")
    .where("q.is_active", true).where("q.is_validated", false).whereNull("q.validation_level")
    .select("q.id","q.prompt","q.options","q.correct_answer","q.difficulty","q.subdimension","q.feedback_correct","q.feedback_incorrect","cd.slug as domain_slug");

  const grouped = new Map();
  for (const r of toReview) {
    let v = grouped.get(r.id);
    if (!v) { v = { ...r, domains: [] }; delete v.domain_slug; grouped.set(r.id, v); }
    if (r.domain_slug) v.domains.push(r.domain_slug);
  }

  const promptSeen = new Map();
  const flagged = new Set();
  for (const q of grouped.values()) {
    let opts;
    try { opts = typeof q.options === "string" ? JSON.parse(q.options) : q.options; } catch { opts = null; }
    let bad = false;
    if (!Array.isArray(opts) || opts.length !== 4) bad = true;
    else {
      if (opts.some((o) => typeof o !== "string" || o.trim().length === 0)) bad = true;
      const uniq = new Set(opts.map((o) => String(o).trim().toLowerCase()));
      if (uniq.size !== opts.length) bad = true;
      if (!(Number.isInteger(q.correct_answer) && q.correct_answer >= 0 && q.correct_answer < opts.length)) bad = true;
    }
    if (!q.prompt || q.prompt.trim().length < 10) bad = true;
    if (!q.feedback_correct || !q.feedback_incorrect) bad = true;
    if (!q.subdimension) bad = true;
    if (![1,2,3].includes(q.difficulty)) bad = true;
    if (q.domains.length === 0) bad = true;
    if (q.domains.some((d) => !VALID_DOMAINS.has(d))) bad = true;

    const norm = (q.prompt || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[.,¿?¡!;:()]/g, "").slice(0, 60);
    if (norm) {
      if (!promptSeen.has(norm)) promptSeen.set(norm, []);
      promptSeen.get(norm).push(q.id);
    }
    if (bad) flagged.add(q.id);
  }
  for (const [, ids] of promptSeen.entries()) {
    if (ids.length > 1) ids.forEach((id) => flagged.add(id));
  }

  const approvedIds = [...grouped.keys()].filter((id) => !flagged.has(id));
  if (approvedIds.length > 0) {
    await knex("questions")
      .whereIn("id", approvedIds)
      .whereNull("validation_level")
      .update({ validation_level: "technical" });
  }

  // --- Grupo A: expansión N:M por subdim/sección (idempotente) ---
  //
  // Sólo asociaciones DEFENDIBLES por la demanda cognitiva real de la
  // subdimensión (ver propuesta aprobada). Grupo B queda sin aplicar
  // (discriminacion_funcional → atencion, reconocimiento_funcional → atencion,
  //  asociacion_objeto_lugar → orientacion, calculo_funcional dif=2 → memoria
  //  en atencion_y_calculo).
  const STRICT_SUBDIM_RULES = {
    actualizacion_de_memoria: ["memoria","funciones_ejecutivas"],
    retencion_y_evocacion: ["memoria"],
    memoria_de_secuencia: ["memoria"],
    memoria_de_ubicacion: ["memoria"],
    retencion_de_escena: ["memoria"],
    discriminacion_entre_similares: ["memoria","atencion"],
    rastreo_de_atributos: ["memoria","atencion"],
    deteccion_de_cambio: ["memoria","atencion"],
    atencion_selectiva: ["atencion"],
    atencion_sostenida: ["atencion"],
    deteccion_de_anomalia: ["atencion"],
    planificacion_secuencial: ["funciones_ejecutivas","memoria"],
    flexibilidad_cognitiva: ["funciones_ejecutivas"],
    inhibicion_de_respuesta: ["funciones_ejecutivas"],
    juicio_y_resolucion: ["funciones_ejecutivas"],
    estrategia_y_autorregulacion: ["funciones_ejecutivas"],
    automonitoreo: ["funciones_ejecutivas"],
    reconocimiento_de_dificultad: ["funciones_ejecutivas"],
    comparacion_y_seleccion: ["funciones_ejecutivas"],
    categorizacion_funcional: ["funciones_ejecutivas"],
    orientacion_temporal: ["orientacion"],
    orientacion_espacial: ["orientacion"],
    comprension_funcional: ["comprension_lenguaje"],
  };
  // Sección × subdim con demanda específica justificada
  const STRICT_SECTION_RULES = {
    atencion_y_calculo: {
      calculo_funcional: { minDiff: 2, add: ["funciones_ejecutivas"] },
      calculo_funcional_hard: { minDiff: 3, add: ["memoria"] },
    },
    orientacion_temporal: {
      calculo_funcional: { minDiff: 1, add: ["orientacion","funciones_ejecutivas"] },
    },
    orientacion_espacial: {
      planificacion_secuencial: { minDiff: 1, add: ["memoria"] },
      comprension_funcional: { minDiff: 1, add: ["comprension_lenguaje"] },
    },
  };

  const allEligible = await knex("questions as q")
    .join("sections as s","s.id","q.section_id")
    .where("q.is_active", true)
    .andWhere(function(){this.where("q.is_validated",true).orWhereNotNull("q.validation_level");})
    .select("q.id","q.subdimension","q.difficulty","s.slug as section_slug");

  const existingNM = await knex("question_cognitive_domains as qcd")
    .join("cognitive_domains as cd","cd.id","qcd.cognitive_domain_id")
    .select("qcd.question_id","cd.slug");
  const existingNMSet = new Set(existingNM.map((r) => `${r.question_id}::${r.slug}`));

  const nmInserts = [];
  for (const q of allEligible) {
    const needed = new Set();
    const subRule = STRICT_SUBDIM_RULES[q.subdimension];
    if (subRule) subRule.forEach((d) => needed.add(d));
    const sr = STRICT_SECTION_RULES[q.section_slug];
    if (sr) {
      for (const [k, rule] of Object.entries(sr)) {
        const baseSub = k.replace(/_hard$/, "");
        if (q.subdimension === baseSub && q.difficulty >= rule.minDiff) {
          rule.add.forEach((d) => needed.add(d));
        }
      }
    }
    for (const d of needed) {
      const key = `${q.id}::${d}`;
      if (!existingNMSet.has(key)) {
        nmInserts.push({ qid: q.id, domainSlug: d });
        existingNMSet.add(key);
      }
    }
  }
  if (nmInserts.length > 0) {
    const domSlugToId = Object.fromEntries(
      (await knex("cognitive_domains").select("id","slug")).map((r) => [r.slug, r.id])
    );
    const payload = nmInserts
      .map((r) => ({ question_id: r.qid, cognitive_domain_id: domSlugToId[r.domainSlug] }))
      .filter((r) => Number.isInteger(r.cognitive_domain_id));
    if (payload.length > 0) {
      await knex("question_cognitive_domains").insert(payload);
    }
  }

  // --- bank_v2: preguntas nuevas para cubrir las 50 combinaciones ---
  //
  // Idempotente: sólo inserta si no hay preguntas source='bank_v2' aún para
  // esa sección. source='bank_v2', is_validated=false, validation_level='technical'.
  // Las asociaciones N:M vienen explícitas en cada pregunta (q.domains[]).
  const sectionRows2 = await knex("sections").select("id","slug");
  const slugToId2 = Object.fromEntries(sectionRows2.map((r) => [r.slug, r.id]));
  const domSlugToId2 = Object.fromEntries(
    (await knex("cognitive_domains").select("id","slug")).map((r) => [r.slug, r.id])
  );
  for (const [sectionSlug, questions] of Object.entries(BANK_V2)) {
    const sectionId = slugToId2[sectionSlug];
    if (!sectionId) continue;
    // Idempotencia granular: por prompt. Permite incorporar preguntas nuevas
    // en versiones posteriores del bank_v2 sin reinsertar las ya cargadas ni
    // borrar nada existente.
    const existingPrompts = new Set(
      (await knex("questions")
        .where({ source: "bank_v2", section_id: sectionId })
        .select("prompt")).map((r) => r.prompt)
    );
    for (const q of questions) {
      if (existingPrompts.has(q.prompt)) continue;
      const [inserted] = await knex("questions").insert({
        section_id: sectionId,
        prompt: q.prompt,
        response_type: "multiple_choice",
        options: JSON.stringify(q.options),
        correct_answer: q.correct_answer,
        scoring_value: 1,
        difficulty: q.difficulty,
        feedback_correct: q.feedback_correct,
        feedback_incorrect: q.feedback_incorrect,
        clinician_note: q.clinician_note || null,
        stimulus: q.stimulus || null,
        subdimension: q.subdimension || null,
        source: "bank_v2",
        is_active: true,
        is_validated: false,
        validation_level: "technical",
      }).returning("id");
      for (const dSlug of q.domains || []) {
        const did = domSlugToId2[dSlug];
        if (did) {
          await knex("question_cognitive_domains").insert({
            question_id: inserted.id,
            cognitive_domain_id: did,
          });
        }
      }
    }
  }
}
