import {
  CalendarDays,
  ClipboardList,
  Clock3,
  Home,
  ListChecks,
  MapPinned,
  Send,
  ShoppingBasket,
  SunMedium,
  UsersRound
} from "lucide-react";

function createQuestion(prompt, options, correctIndex, patientGood, patientTry, clinician) {
  return { prompt, options, correct: correctIndex, patientGood, patientTry, clinician };
}

export const activities = [
  {
    id: "market",
    title: "Lista del supermercado",
    skill: "Memoria de trabajo",
    time: "12 min",
    icon: ShoppingBasket,
    status: "Recomendado",
    focus: "Memoria de trabajo, reconocimiento y control atencional",
    intro: "Mira la consigna y elegí la opción qué mejor recuerda o completa la situación.",
    questions: [
      createQuestion("La lista original tenía pan, leche y manzanas. Cuál opción coincide?", ["Pan, leche y manzanas", "Café, arroz y jabón", "Tomates, queso y pilas"], 0, "Correcto. Recuperaste la lista completa.", "Revisemos. Probemos mirando de nuevo los productos.", "Reconocimiento verbal simple y mantenimiento de tres ítems."),
      createQuestion("Antes de salir, Elena quería comprar leche, arroz y jabón. Qué producto NO estaba en la lista?", ["Arroz", "Pilas", "Jabón"], 1, "Correcto. Detectaste el elemento intruso.", "Revisemos. La idea era encontrar lo qué sobra.", "Control inhibitorio ante distractor semántico."),
      createQuestion("Si primero puso leche en el chango y después pan, qué producto falta?", ["Café", "Detergente", "Manzanas"], 2, "Correcto. Recordaste el ítem pendiente.", "Revisemos. Quedaba un producto por recuperar.", "Actualización de memoria de trabajo."),
      createQuestion("El cartel decía: 2 yogures y 1 queso. Qué debe llevar?", ["Dos yogures y un queso", "Un yogur y dos quesos", "Dos quesos y una leche"], 0, "Correcto. Leíste cantidad y producto.", "Conviene mirar cantidad y producto por separado.", "Atención sostenida a doble atributo."),
      createQuestion("La receta pide tomate, queso y albahaca. Qué grupo sirve para preparar la comida?", ["Pan, mermelada y café", "Tomate, queso y albahaca", "Jabón, arroz y pilas"], 1, "Correcto. Agrupaste elementos relacionados.", "La próxima puede resolverse buscando qué cosas van juntas.", "Asociación semántica por contexto cotidiano.")
    ]
  },
  {
    id: "bus",
    title: "Pagar el boleto",
    skill: "Atención y cálculo",
    time: "10 min",
    icon: CalendarDays,
    status: "Breve",
    focus: "Cálculo funcional, atención selectiva y toma de decisión",
    intro: "Resoluciónes cortas con dinero, horarios y decisiónes de traslado.",
    questions: [
      createQuestion("El boleto cuesta $480. Qué combinacion paga justo?", ["$500 + $100", "$100 + $100 + $100", "$200 + $200 + $80"], 2, "Correcto. Calculaste el monto exacto.", "Revisamos la suma y seguimos.", "Cálculo monetario funcional."),
      createQuestion("El colectivo sale a las 10:30 y tarda 20 minutos. A qué hora llega?", ["10:50", "10:40", "11:10"], 0, "Correcto. Sumaste el tiempo de viaje.", "Estás tareas entrenan orientación temporal.", "Orientación temporal y adición de intervalo."),
      createQuestion("Si tiene $600 y paga $480, cuanto cambio debería recibir?", ["$80", "$120", "$180"], 1, "Correcto. Resolviste el cambio esperado.", "La respuesta sale restándo el costo a lo qué entregaste.", "Resta funcional y monitoreo de transaccion."),
      createQuestion("Linea 15 al centro y linea 21 al hospital. Cuál toma para ir al hospital?", ["Linea 15", "Cualquiera de las dos", "Linea 21"], 2, "Correcto. Elegiste usando la información importante.", "Habia qué buscar la palabra hospital.", "Atención selectiva guiada por destino."),
      createQuestion("El chofer pide apoyar la tarjeta una vez. Qué accion corresponde?", ["Apoyar la tarjeta una vez", "Apoyarla tres veces", "Guardar la tarjeta sin usarla"], 0, "Correcto. Seguiste una instruccion simple.", "Estás consignas práctican acciones cotidianas.", "Comprensión instruccional y control de respuesta.")
    ]
  },
  {
    id: "recipe",
    title: "Ordenar una receta",
    skill: "Funciones ejecutivas",
    time: "11 min",
    icon: ListChecks,
    status: "Guiado",
    focus: "Planificación, secuenciación y flexibilidad cognitiva",
    intro: "Ordena pasos y elegí acciones coherentes para completar una tarea diaria.",
    questions: [
      createQuestion("Para preparar te, cual paso va primero?", ["Servir el te en la taza", "Calentar agua", "Guardar la taza"], 1, "Correcto. Identificaste el primer paso.", "Pensemos qué accion necesita ocurrir antes.", "Inicio de secuencia y planificación básica."),
      createQuestion("Ya calentaste agua y pusiste el saquito. Qué sigue?", ["Esperar unos minutos", "Comprar una tetera", "Lavar la ropa"], 0, "Correcto. Mantuviste la continuidad.", "La clave es elegir el paso qué continúa.", "Continuidad secuencial y descarte de distractores."),
      createQuestion("Si falta leche para la receta, qué decisión ayuda mas?", ["Apagar la luz", "Cambiar de canal", "Anotarla para comprar"], 2, "Correcto. Elegiste una accion útil.", "La pregunta buscaba una solucion práctica.", "Resolución de problemas cotidianos."),
      createQuestion("La receta dice mezclar, hornear y dejar enfriar. Qué va ultimo?", ["Mezclar", "Dejar enfriar", "Hornear"], 1, "Correcto. Ubicaste el cierre.", "Puede ayudar imaginar la accion completa.", "Ordenamiento temporal y cierre de tarea."),
      createQuestion("Si el horno esta muy caliente, qué conviene hacer?", ["Tocarlo con la mano", "Dejar la puerta abierta todo el dia", "Usar agarradera o pedir ayuda"], 2, "Correcto. Elegiste una accion segura.", "La prioridad era elegir la opción mas segura.", "Juicio práctico y seguridad doméstica.")
    ]
  },
  {
    id: "calendar",
    title: "Agenda de turnos",
    skill: "Orientación temporal",
    time: "9 min",
    icon: Clock3,
    status: "Nuevo",
    focus: "Orientación temporal, memoria prospectiva y comprensión de agenda",
    intro: "Práctica fechas, horarios y recordatorios como en una agenda diaria.",
    questions: [
      createQuestion("El turno con la doctora es el martes a las 16:00. Qué dato es importante recordar?", ["Jueves a las 10:00", "Domingo a la noche", "Martes a las 16:00"], 2, "Correcto. Recordaste dia y horario juntos.", "En la agenda conviene unir siempre dia y hora.", "Memoria prospectiva con asociación dia-horario."),
      createQuestion("Si hoy es lunes y el turno es mañana, qué dia es el turno?", ["Martes", "Miércoles", "Viernes"], 0, "Correcto. Ubicaste mañana dentro de la semana.", "Estás preguntas práctican orientación semanal.", "Orientación temporal relativa."),
      createQuestion("Para no olvidarse del turno, qué accion ayuda mas?", ["Cambiarlo de lugar sin avisar", "Anotarlo en la agenda", "No mirar el horario"], 1, "Correcto. Elegiste una estrategia de apoyo.", "La opción mas útil era usar una ayuda externa.", "Uso de estrategia compensatoria."),
      createQuestion("Si una cita pasa del martes al viernes, qué conviene actualizar?", ["Solo el color del papel", "Nada", "El dia en la agenda y el recordatorio"], 2, "Bien. Actualizaste la información importante.", "Cuándo cambia una cita, se actualiza agenda y aviso.", "Actualización de información.")
    ]
  },
  {
    id: "names",
    title: "Caras y nombres",
    skill: "Memoria asociativa",
    time: "8 min",
    icon: UsersRound,
    status: "Social",
    focus: "Asociación rostro-nombre, reconocimiento y recuperación guiada",
    intro: "Asocia personas con datos simples para entrenar memoria social.",
    questions: [
      createQuestion("Ana usa lentes y trae una carpeta azul. Quién trae la carpeta azul?", ["Ana", "Luis", "Marta"], 0, "Correcto. Uniste el nombre con la pista visual.", "La pista era la carpeta azul.", "Codificación asociativa nombre-atributo."),
      createQuestion("Luis dijo qué vive cerca de la plaza. Quién vive cerca de la plaza?", ["Luis", "Ana", "Elena"], 0, "Correcto. Recuperaste el dato asociado.", "Lo importante es volver a buscar la asociación.", "Recuperación de información contextual."),
      createQuestion("Marta pidio te y Ana pidio café. Quién pidio café?", ["Marta", "Ana", "Luis"], 1, "Correcto. Diferenciaste asociaciónes parecidas.", "Estás consignas entrenan comparacion de pares.", "Discriminacion entre asociaciónes competidoras."),
      createQuestion("Rosa vive en el piso 2, Pedro en el 5 y Ana en el 3. Quién vive mas alto?", ["Ana", "Rosa", "Pedro"], 2, "Correcto. Comparaste números asociados a personas.", "El piso mas alto era el número mayor.", "Comparacion numerica en memoria asociativa.")
    ]
  },
  {
    id: "wellbeing",
    title: "Cómo me siento hoy",
    skill: "Autorreporte y metacognición",
    time: "5 min",
    icon: SunMedium,
    status: "Diario",
    focus: "Registro subjetivo, metacognición y adherencia emocional",
    intro: "Un cierre breve para registrar energía, animo y dificultad percibida.",
    questions: [
      createQuestion("Si hoy sentis poca energía, qué opción ayuda a continúar?", ["Abandonar toda la semana", "Elegir una actividad breve", "Hacer todo mas rápido"], 1, "Correcto. Adaptar la rutina tambien es avanzar.", "La idea es encontrar una forma amable de continúar.", "Autorregulación y seleccion de carga apropiada."),
      createQuestion("Después de una pregunta difícil, qué conviene hacer?", ["Respirar y probar la siguiente", "Pensar qué ya no sirve", "Cerrar sin registrar nada"], 0, "Correcto. Mantener la participacion es parte del entrenamiento.", "Una pregunta difícil no define toda la sesión.", "Tolerancia a frustracion y persistencia."),
      createQuestion("Qué dato puede ayudar al profesional a acompañarte mejor?", ["El color de la pared", "La marca del teléfono", "Cómo te sentiste durante la actividad"], 2, "Correcto. Ese registro ayuda a ajustar sesiónes.", "El profesional necesita saber como viviste la actividad.", "Metacognición y reporte subjetivo."),
      createQuestion("Si notas qué te fue mejor al principio qué al final, qué podría estar apareciendo?", ["Cansancio o fatiga", "Mejora del clima", "Un error del calendario"], 0, "Correcto. Identificaste una posible señal de fatiga.", "Cambiar al final puede relacionarse con cansancio.", "Reconocimiento subjetivo de fatiga cognitiva.")
    ]
  },
  {
    id: "medication",
    title: "Tomar la medicación",
    skill: "Rutina y memoria prospectiva",
    time: "7 min",
    icon: ClipboardList,
    status: "Salud",
    focus: "Memoria prospectiva, lectura funcional y seguimiento de instrucciones",
    intro: "Lee recordatorios y elegí la accion qué mejor cuida la rutina diaria.",
    questions: [
      createQuestion("La pastilla azul se toma después del desayuno. Cuándo conviene tomarla?", ["Después del desayuno", "Antes de dormir", "En cualquier momento"], 0, "Correcto. Ubicaste el momento correcto.", "La clave era mirar en qué parte del dia aparece la toma.", "Memoria prospectiva ligada a rutina diaria."),
      createQuestion("Si hoy ya tomaste la medicación de la mañana, qué ayuda a no repetirla?", ["Tomarla otra vez por las dudas", "Marcarla en el pastillero o agenda", "No mirar ningun registro"], 1, "Correcto. Elegiste una estrategia segura.", "Estás consignas práctican chequeo antes de actuar.", "Monitoreo de rutina y prevención de duplicados."),
      createQuestion("El medico indico agua y no jugo para una toma. Qué corresponde hacer?", ["Tomarla con cualquier bebida", "Esperar una semana", "Tomarla con agua"], 2, "Correcto. Seguiste la indicacion principal.", "Habia qué elegir la opción mas cercana a la consigna.", "Comprensión de instruccion funcional."),
      createQuestion("Si se termina una caja y quedan dos comprimidos sueltos, qué conviene anotar?", ["Qué hace falta pedir una nueva caja", "El color de la mesa", "Nada porque ya alcanza"], 0, "Correcto. Pensaste en la continuidad del tratamiento.", "La idea era anticiparse a la falta del medicamento.", "Planificación y continuidad de tratamiento.")
    ]
  },
  {
    id: "home",
    title: "Objetos de la casa",
    skill: "Atención visual",
    time: "6 min",
    icon: Home,
    status: "Hogar",
    focus: "Atención selectiva, reconocimiento y asociación funcional",
    intro: "Relaciona objetos cotidianos con el lugar o uso qué mejor corresponde.",
    questions: [
      createQuestion("Cuál de estos objetos se usa para barrer el piso?", ["Almohada", "Escoba", "Toalla"], 1, "Correcto. Identificaste el objeto correcto.", "Pensemos para qué sirve cada elemento en la vida diaria.", "Reconocimiento funcional de objetos."),
      createQuestion("Si queres guardar comida en la heladera, qué conviene usar?", ["Una revista", "Un control remoto", "Un recipiente con tapa"], 2, "Correcto. Elegiste la opción mas útil.", "La consigna buscaba una solucion práctica y segura.", "Decisión funcional en contexto doméstico."),
      createQuestion("Qué objeto suele estar en el baño para secarse las manos?", ["Toalla", "Lampara", "Cuaderno"], 0, "Correcto. Recuperaste una asociación cotidiana.", "Estás preguntas entrenan atención a contextos conocidos.", "Asociación objeto-lugar."),
      createQuestion("Si se corta la luz de noche, qué ayuda mas a moverse seguro?", ["Anteojos de sol", "Linterna", "Florero"], 1, "Correcto. Priorizaste seguridad y orientación.", "La opción correcta era la qué ayuda a ver mejor.", "Juicio práctico en el hogar.")
    ]
  },
  {
    id: "phone",
    title: "Mensajes y llamadas",
    skill: "Comprensión funcional",
    time: "8 min",
    icon: Send,
    status: "Comunicación",
    focus: "Comprensión de mensajes, seleccion de respuesta y memoria inmediata",
    intro: "Resuelve situaciónes simples de teléfono, mensajes y avisos.",
    questions: [
      createQuestion("Tu hija escribe: 'Llego a las 18'. Qué dato importante conviene recordar?", ["Qué llega a las 18", "Qué sale mañana", "Qué cambia de teléfono"], 0, "Correcto. Recuperaste la información central.", "Lo importante era quedarse con el horario del mensaje.", "Comprensión de mensaje breve."),
      createQuestion("Si escuchas una llamada perdida del medico, qué accion ayuda mas?", ["Borrar el número", "Apagar el teléfono", "Devolver la llamada o anotarla"], 2, "Correcto. Elegiste una respuesta útil.", "La consigna buscaba continuidad y seguimiento.", "Toma de decisión ante aviso relevante."),
      createQuestion("Te mandan 'Trae carnét y estudios'. Qué deberías preparar?", ["Solo la billetera", "El carnét y los estudios", "Nada"], 1, "Correcto. Seguiste la consigna completa.", "Habia qué conservar los dos elementos pedidos.", "Memoria inmediata de dos ítems."),
      createQuestion("Si no entendes un audio, qué opción ayuda mas?", ["Inventar el contenido", "Ignorarlo", "Pedir qué lo repitan o escribirlo"], 2, "Correcto. Elegiste una estrategia compensatoria.", "La mejor opción era buscar apoyo para comprender bien.", "Compensacion y monitoreo de comprensión.")
    ]
  },
  {
    id: "orientation",
    title: "Camino al barrio",
    skill: "Orientación y decisión",
    time: "9 min",
    icon: MapPinned,
    status: "Trayecto",
    focus: "Orientación espacial básica, lectura de referencias y toma de decisión",
    intro: "Usa referencias simples del barrio para elegir el camino o la señal correcta.",
    questions: [
      createQuestion("La farmacia esta después de la plaza y antes del banco. Dónde queda?", ["Antes de la plaza", "Entre la plaza y el banco", "Detras del banco"], 1, "Correcto. Ordenaste las referencias del camino.", "La pista estaba en mirar qué lugar va antes y después.", "Orientación espacial verbal."),
      createQuestion("Si el cartel dice 'Salida' con una flecha a la derecha, para donde conviene ir?", ["Hacia la derecha", "Hacia la izquierda", "Quedarse quieto"], 0, "Correcto. Seguiste la señal principal.", "Estás tareas entrenan lectura funcional del entorno.", "Lectura de señaletica."),
      createQuestion("Vas a la panadería y ves primero el kiosco y después la verdulería. Qué lugar aparece en el medio?", ["La verdulería antes del kiosco", "No se puede saber", "El kiosco antes de la verdulería"], 2, "Correcto. Ubicaste el orden del trayecto.", "La idea era sostener dos referencias en secuencia.", "Secuenciacion espacial."),
      createQuestion("Si una calle esta cerrada, qué conviene hacer?", ["Cruzar igual", "Buscar otra opción segura o pedir ayuda", "Volver sin mirar"], 1, "Correcto. Elegiste una decisión segura.", "La opción correcta priorizaba seguridad y ayuda.", "Flexibilidad y juicio práctico.")
    ]
  }
];

export function getActivityById(activityId) {
  return activities.find((activity) => activity.id === activityId) || activities[0];
}
