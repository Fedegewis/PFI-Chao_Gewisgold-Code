export const PATIENT_DEFAULTS = {
  mood: "sin registrar",
  status: "Sin actividades completadas",
  note: "Todavia no realizo actividades en esta sesion.",
  score: 0,
  trend: "0%",
  responseTime: "-",
  risk: "Bajo"
};

export const PROFESSIONAL_DEFAULT_INSTRUCTIONS =
  "Hacer preguntas simples, de una consigna por vez, y registrar estado emocional.";

export const LOGIN_ERROR_MESSAGE = "Credenciales incorrectas. Revisa el README o usa los datos demo.";
export const ACTIVITY_DRAFT_MESSAGE = "La sesion se registra al finalizar";
export const EMPTY_CHART_MESSAGE =
  "Todavia no hay sesiones registradas. Cuando el paciente complete actividades vas a ver aca su evolucion de precision y tiempos.";

export const AI_CHAT_DISCLAIMER =
  "Conversacion simulada para demostracion. No reemplaza acompanamiento profesional.";

export const AI_CHAT_GREETING =
  "Hola, soy tu companero del jardin. Contame como estas hoy y elegimos juntos por donde empezar.";

export const AI_CHAT_REPLIES = {
  alegria: [
    "Que bueno saberlo. Aprovechemos esa energia con un desafio nuevo del jardin.",
    "Me alegra mucho. Si querés, sumamos una actividad un poquito mas larga hoy.",
    "Se nota tu entusiasmo. Vamos a regar dos plantas hoy?"
  ],
  bien: [
    "Genial. Vamos a un ritmo pareja y sumamos una actividad recomendada.",
    "Perfecto. Elegi la que mas te llame la atencion y arrancamos.",
    "Sigamos con lo que ya venis haciendo, esta bueno mantener la constancia."
  ],
  calma: [
    "Vamos sin apuro. Podemos empezar con una actividad corta.",
    "Buena idea tomarlo con calma. Elegi una que te resulte comoda.",
    "Respira profundo y arrancamos con algo suave."
  ],
  cansancio: [
    "Esta bien descansar. Que te parece una sola actividad breve y guiada?",
    "Vamos despacio hoy. Si querés paramos cuando lo necesites.",
    "Con poquito ya alcanza. Elegi la mas corta y vemos como te va."
  ],
  tristeza: [
    "Gracias por contarme. Empecemos con algo suave, sin exigencia.",
    "Estoy con vos. Podemos hacer una actividad tranquila y ver como te sentis.",
    "No hace falta rendir hoy. Elegi lo que mas te acompane."
  ],
  default: [
    "Contame un poco mas para poder acompanarte mejor.",
    "Estoy escuchando. Si querés, empezamos por una actividad corta.",
    "Cuando estés listo/a elegimos juntos una actividad del jardin."
  ]
};
