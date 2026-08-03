import {
  CalendarDays,
  ClipboardList,
  Clock3,
  Leaf,
  ListChecks,
  MapPinned,
  Send,
  ShoppingBasket,
  SunMedium,
  UsersRound
} from "lucide-react";

function createQuestion(prompt, options, patientGood, patientTry, clinician) {
  return { prompt, options, correct: 0, patientGood, patientTry, clinician };
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
    intro: "Mira la consigna y elegi la opcion que mejor recuerda o completa la situacion.",
    questions: [
      createQuestion("La lista original tenia pan, leche y manzanas. Cual opcion coincide?", ["Pan, leche y manzanas", "Cafe, arroz y jabon", "Tomates, queso y pilas"], "Muy bien. Recuperaste la lista completa.", "Buen intento. Probemos mirando de nuevo los productos.", "Reconocimiento verbal simple y mantenimiento de tres items."),
      createQuestion("Antes de salir, Elena queria comprar leche, arroz y jabon. Que producto NO estaba en la lista?", ["Pilas", "Arroz", "Jabon"], "Exacto. Detectaste el elemento intruso.", "Casi. La idea era encontrar lo que sobra.", "Control inhibitorio ante distractor semantico."),
      createQuestion("Si primero puso leche en el chango y despues pan, que producto falta?", ["Manzanas", "Cafe", "Detergente"], "Bien hecho. Recordaste el item pendiente.", "No pasa nada. Quedaba un producto por recuperar.", "Actualizacion de memoria de trabajo."),
      createQuestion("El cartel decia: 2 yogures y 1 queso. Que debe llevar?", ["Dos yogures y un queso", "Un yogur y dos quesos", "Dos quesos y una leche"], "Perfecto. Leiste cantidad y producto.", "Conviene mirar cantidad y producto por separado.", "Atencion sostenida a doble atributo."),
      createQuestion("La receta pide tomate, queso y albahaca. Que grupo sirve para preparar la comida?", ["Tomate, queso y albahaca", "Pan, mermelada y cafe", "Jabon, arroz y pilas"], "Muy bien. Agrupaste elementos relacionados.", "La proxima puede resolverse buscando que cosas van juntas.", "Asociacion semantica por contexto cotidiano.")
    ]
  },
  {
    id: "bus",
    title: "Pagar el boleto",
    skill: "Atencion y calculo",
    time: "10 min",
    icon: CalendarDays,
    status: "Breve",
    focus: "Calculo funcional, atencion selectiva y toma de decision",
    intro: "Resoluciones cortas con dinero, horarios y decisiones de traslado.",
    questions: [
      createQuestion("El boleto cuesta $480. Que combinacion paga justo?", ["$200 + $200 + $80", "$500 + $100", "$100 + $100 + $100"], "Excelente. Calculaste el monto exacto.", "Revisamos la suma y seguimos.", "Calculo monetario funcional."),
      createQuestion("El colectivo sale a las 10:30 y tarda 20 minutos. A que hora llega?", ["10:50", "10:40", "11:10"], "Muy bien. Sumaste el tiempo de viaje.", "Estas tareas entrenan orientacion temporal.", "Orientacion temporal y adicion de intervalo."),
      createQuestion("Si tiene $600 y paga $480, cuanto cambio deberia recibir?", ["$120", "$80", "$180"], "Correcto. Resolviste el cambio esperado.", "La respuesta sale restando el costo a lo que entregaste.", "Resta funcional y monitoreo de transaccion."),
      createQuestion("Linea 15 al centro y linea 21 al hospital. Cual toma para ir al hospital?", ["Linea 21", "Linea 15", "Cualquiera de las dos"], "Exacto. Elegiste usando la informacion importante.", "Habia que buscar la palabra hospital.", "Atencion selectiva guiada por destino."),
      createQuestion("El chofer pide apoyar la tarjeta una vez. Que accion corresponde?", ["Apoyar la tarjeta una vez", "Apoyarla tres veces", "Guardar la tarjeta sin usarla"], "Muy bien. Seguiste una instruccion simple.", "Estas consignas practican acciones cotidianas.", "Comprension instruccional y control de respuesta.")
    ]
  },
  {
    id: "recipe",
    title: "Ordenar una receta",
    skill: "Funciones ejecutivas",
    time: "11 min",
    icon: ListChecks,
    status: "Guiado",
    focus: "Planificacion, secuenciacion y flexibilidad cognitiva",
    intro: "Ordena pasos y elegi acciones coherentes para completar una tarea diaria.",
    questions: [
      createQuestion("Para preparar te, cual paso va primero?", ["Calentar agua", "Servir el te en la taza", "Guardar la taza"], "Muy bien. Identificaste el primer paso.", "Pensemos que accion necesita ocurrir antes.", "Inicio de secuencia y planificacion basica."),
      createQuestion("Ya calentaste agua y pusiste el saquito. Que sigue?", ["Esperar unos minutos", "Comprar una tetera", "Lavar la ropa"], "Correcto. Mantuviste la continuidad.", "La clave es elegir el paso que continua.", "Continuidad secuencial y descarte de distractores."),
      createQuestion("Si falta leche para la receta, que decision ayuda mas?", ["Anotarla para comprar", "Apagar la luz", "Cambiar de canal"], "Exacto. Elegiste una accion util.", "La pregunta buscaba una solucion practica.", "Resolucion de problemas cotidianos."),
      createQuestion("La receta dice mezclar, hornear y dejar enfriar. Que va ultimo?", ["Dejar enfriar", "Mezclar", "Hornear"], "Muy bien. Ubicaste el cierre.", "Puede ayudar imaginar la accion completa.", "Ordenamiento temporal y cierre de tarea."),
      createQuestion("Si el horno esta muy caliente, que conviene hacer?", ["Usar agarradera o pedir ayuda", "Tocarlo con la mano", "Dejar la puerta abierta todo el dia"], "Perfecto. Elegiste una accion segura.", "La prioridad era elegir la opcion mas segura.", "Juicio practico y seguridad domestica.")
    ]
  },
  {
    id: "calendar",
    title: "Agenda de turnos",
    skill: "Orientacion temporal",
    time: "9 min",
    icon: Clock3,
    status: "Nuevo",
    focus: "Orientacion temporal, memoria prospectiva y comprension de agenda",
    intro: "Practica fechas, horarios y recordatorios como en una agenda diaria.",
    questions: [
      createQuestion("El turno con la doctora es el martes a las 16:00. Que dato es importante recordar?", ["Martes a las 16:00", "Jueves a las 10:00", "Domingo a la noche"], "Muy bien. Recordaste dia y horario juntos.", "En la agenda conviene unir siempre dia y hora.", "Memoria prospectiva con asociacion dia-horario."),
      createQuestion("Si hoy es lunes y el turno es manana, que dia es el turno?", ["Martes", "Miercoles", "Viernes"], "Exacto. Ubicaste manana dentro de la semana.", "Estas preguntas practican orientacion semanal.", "Orientacion temporal relativa."),
      createQuestion("Para no olvidarse del turno, que accion ayuda mas?", ["Anotarlo en la agenda", "Cambiarlo de lugar sin avisar", "No mirar el horario"], "Perfecto. Elegiste una estrategia de apoyo.", "La opcion mas util era usar una ayuda externa.", "Uso de estrategia compensatoria."),
      createQuestion("Si una cita pasa del martes al viernes, que conviene actualizar?", ["El dia en la agenda y el recordatorio", "Solo el color del papel", "Nada"], "Bien. Actualizaste la informacion importante.", "Cuando cambia una cita, se actualiza agenda y aviso.", "Actualizacion de informacion.")
    ]
  },
  {
    id: "names",
    title: "Caras y nombres",
    skill: "Memoria asociativa",
    time: "8 min",
    icon: UsersRound,
    status: "Social",
    focus: "Asociacion rostro-nombre, reconocimiento y recuperacion guiada",
    intro: "Asocia personas con datos simples para entrenar memoria social.",
    questions: [
      createQuestion("Ana usa lentes y trae una carpeta azul. Quien trae la carpeta azul?", ["Ana", "Luis", "Marta"], "Muy bien. Uniste el nombre con la pista visual.", "La pista era la carpeta azul.", "Codificacion asociativa nombre-atributo."),
      createQuestion("Luis dijo que vive cerca de la plaza. Quien vive cerca de la plaza?", ["Luis", "Ana", "Elena"], "Correcto. Recuperaste el dato asociado.", "Lo importante es volver a buscar la asociacion.", "Recuperacion de informacion contextual."),
      createQuestion("Marta pidio te y Ana pidio cafe. Quien pidio cafe?", ["Ana", "Marta", "Luis"], "Exacto. Diferenciaste asociaciones parecidas.", "Estas consignas entrenan comparacion de pares.", "Discriminacion entre asociaciones competidoras."),
      createQuestion("Rosa vive en el piso 2, Pedro en el 5 y Ana en el 3. Quien vive mas alto?", ["Pedro", "Ana", "Rosa"], "Correcto. Comparaste numeros asociados a personas.", "El piso mas alto era el numero mayor.", "Comparacion numerica en memoria asociativa.")
    ]
  },
  {
    id: "wellbeing",
    title: "Como me siento hoy",
    skill: "Autorreporte y metacognicion",
    time: "5 min",
    icon: SunMedium,
    status: "Diario",
    focus: "Registro subjetivo, metacognicion y adherencia emocional",
    intro: "Un cierre breve para registrar energia, animo y dificultad percibida.",
    questions: [
      createQuestion("Si hoy sentis poca energia, que opcion ayuda a continuar?", ["Elegir una actividad breve", "Abandonar toda la semana", "Hacer todo mas rapido"], "Muy bien. Adaptar la rutina tambien es avanzar.", "La idea es encontrar una forma amable de continuar.", "Autoregulacion y seleccion de carga apropiada."),
      createQuestion("Despues de una pregunta dificil, que conviene hacer?", ["Respirar y probar la siguiente", "Pensar que ya no sirve", "Cerrar sin registrar nada"], "Exacto. Mantener la participacion es parte del entrenamiento.", "Una pregunta dificil no define toda la sesion.", "Tolerancia a frustracion y persistencia."),
      createQuestion("Que dato puede ayudar al profesional a acompanarte mejor?", ["Como te sentiste durante la actividad", "El color de la pared", "La marca del telefono"], "Perfecto. Ese registro ayuda a ajustar sesiones.", "El profesional necesita saber como viviste la actividad.", "Metacognicion y reporte subjetivo."),
      createQuestion("Si notas que te fue mejor al principio que al final, que podria estar apareciendo?", ["Cansancio o fatiga", "Mejora del clima", "Un error del calendario"], "Muy bien. Identificaste una posible senal de fatiga.", "Cambiar al final puede relacionarse con cansancio.", "Reconocimiento subjetivo de fatiga cognitiva.")
    ]
  },
  {
    id: "medication",
    title: "Tomar la medicacion",
    skill: "Rutina y memoria prospectiva",
    time: "7 min",
    icon: ClipboardList,
    status: "Salud",
    focus: "Memoria prospectiva, lectura funcional y seguimiento de instrucciones",
    intro: "Lee recordatorios y elegi la accion que mejor cuida la rutina diaria.",
    questions: [
      createQuestion("La pastilla azul se toma despues del desayuno. Cuando conviene tomarla?", ["Despues del desayuno", "Antes de dormir", "En cualquier momento"], "Muy bien. Ubicaste el momento correcto.", "La clave era mirar en que parte del dia aparece la toma.", "Memoria prospectiva ligada a rutina diaria."),
      createQuestion("Si hoy ya tomaste la medicacion de la manana, que ayuda a no repetirla?", ["Marcarla en el pastillero o agenda", "Tomarla otra vez por las dudas", "No mirar ningun registro"], "Exacto. Elegiste una estrategia segura.", "Estas consignas practican chequeo antes de actuar.", "Monitoreo de rutina y prevencion de duplicados."),
      createQuestion("El medico indico agua y no jugo para una toma. Que corresponde hacer?", ["Tomarla con agua", "Tomarla con cualquier bebida", "Esperar una semana"], "Correcto. Seguiste la indicacion principal.", "Habia que elegir la opcion mas cercana a la consigna.", "Comprension de instruccion funcional."),
      createQuestion("Si se termina una caja y quedan dos comprimidos sueltos, que conviene anotar?", ["Que hace falta pedir una nueva caja", "El color de la mesa", "Nada porque ya alcanza"], "Perfecto. Pensaste en la continuidad del tratamiento.", "La idea era anticiparse a la falta del medicamento.", "Planificacion y continuidad de tratamiento.")
    ]
  },
  {
    id: "home",
    title: "Objetos de la casa",
    skill: "Atencion visual",
    time: "6 min",
    icon: Leaf,
    status: "Hogar",
    focus: "Atencion selectiva, reconocimiento y asociacion funcional",
    intro: "Relaciona objetos cotidianos con el lugar o uso que mejor corresponde.",
    questions: [
      createQuestion("Cual de estos objetos se usa para barrer el piso?", ["Escoba", "Almohada", "Toalla"], "Muy bien. Identificaste el objeto correcto.", "Pensemos para que sirve cada elemento en la vida diaria.", "Reconocimiento funcional de objetos."),
      createQuestion("Si queres guardar comida en la heladera, que conviene usar?", ["Un recipiente con tapa", "Una revista", "Un control remoto"], "Exacto. Elegiste la opcion mas util.", "La consigna buscaba una solucion practica y segura.", "Decision funcional en contexto domestico."),
      createQuestion("Que objeto suele estar en el bano para secarse las manos?", ["Toalla", "Lampara", "Cuaderno"], "Correcto. Recuperaste una asociacion cotidiana.", "Estas preguntas entrenan atencion a contextos conocidos.", "Asociacion objeto-lugar."),
      createQuestion("Si se corta la luz de noche, que ayuda mas a moverse seguro?", ["Linterna", "Anteojos de sol", "Florero"], "Perfecto. Priorizaste seguridad y orientacion.", "La opcion correcta era la que ayuda a ver mejor.", "Juicio practico en el hogar.")
    ]
  },
  {
    id: "phone",
    title: "Mensajes y llamadas",
    skill: "Comprension funcional",
    time: "8 min",
    icon: Send,
    status: "Comunicacion",
    focus: "Comprension de mensajes, seleccion de respuesta y memoria inmediata",
    intro: "Resuelve situaciones simples de telefono, mensajes y avisos.",
    questions: [
      createQuestion("Tu hija escribe: 'Llego a las 18'. Que dato importante conviene recordar?", ["Que llega a las 18", "Que sale manana", "Que cambia de telefono"], "Muy bien. Recuperaste la informacion central.", "Lo importante era quedarse con el horario del mensaje.", "Comprension de mensaje breve."),
      createQuestion("Si escuchas una llamada perdida del medico, que accion ayuda mas?", ["Devolver la llamada o anotarla", "Borrar el numero", "Apagar el telefono"], "Exacto. Elegiste una respuesta util.", "La consigna buscaba continuidad y seguimiento.", "Toma de decision ante aviso relevante."),
      createQuestion("Te mandan 'Trae carnet y estudios'. Que deberias preparar?", ["El carnet y los estudios", "Solo la billetera", "Nada"], "Correcto. Seguiste la consigna completa.", "Habia que conservar los dos elementos pedidos.", "Memoria inmediata de dos items."),
      createQuestion("Si no entendes un audio, que opcion ayuda mas?", ["Pedir que lo repitan o escribirlo", "Inventar el contenido", "Ignorarlo"], "Perfecto. Elegiste una estrategia compensatoria.", "La mejor opcion era buscar apoyo para comprender bien.", "Compensacion y monitoreo de comprension.")
    ]
  },
  {
    id: "orientation",
    title: "Camino al barrio",
    skill: "Orientacion y decision",
    time: "9 min",
    icon: MapPinned,
    status: "Trayecto",
    focus: "Orientacion espacial basica, lectura de referencias y toma de decision",
    intro: "Usa referencias simples del barrio para elegir el camino o la senal correcta.",
    questions: [
      createQuestion("La farmacia esta despues de la plaza y antes del banco. Donde queda?", ["Entre la plaza y el banco", "Antes de la plaza", "Detras del banco"], "Muy bien. Ordenaste las referencias del camino.", "La pista estaba en mirar que lugar va antes y despues.", "Orientacion espacial verbal."),
      createQuestion("Si el cartel dice 'Salida' con una flecha a la derecha, para donde conviene ir?", ["Hacia la derecha", "Hacia la izquierda", "Quedarse quieto"], "Exacto. Seguiste la senal principal.", "Estas tareas entrenan lectura funcional del entorno.", "Lectura de senaletica."),
      createQuestion("Vas a la panaderia y ves primero el kiosco y despues la verduleria. Que lugar aparece en el medio?", ["El kiosco antes de la verduleria", "La verduleria antes del kiosco", "No se puede saber"], "Correcto. Ubicaste el orden del trayecto.", "La idea era sostener dos referencias en secuencia.", "Secuenciacion espacial."),
      createQuestion("Si una calle esta cerrada, que conviene hacer?", ["Buscar otra opcion segura o pedir ayuda", "Cruzar igual", "Volver sin mirar"], "Perfecto. Elegiste una decision segura.", "La opcion correcta priorizaba seguridad y ayuda.", "Flexibilidad y juicio practico.")
    ]
  }
];

export function getActivityById(activityId) {
  return activities.find((activity) => activity.id === activityId) || activities[0];
}
