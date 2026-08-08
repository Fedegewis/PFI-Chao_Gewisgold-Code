export const PATIENT_DEFAULTS = {
  mood: "sin registrar",
  status: "Sin actividades completadas",
  note: "Todavía no realizó actividades en esta sesión.",
  score: 0,
  trend: "0%",
  responseTime: "-",
  risk: "Bajo"
};

export const PROFESSIONAL_DEFAULT_INSTRUCTIONS =
  "Hacer preguntas simples, de una consigna por vez, y registrar estado emocional.";

export const LOGIN_ERROR_MESSAGE = "Credenciales incorrectas. Revisá el README o usá los datos demo.";
export const ACTIVITY_DRAFT_MESSAGE = "La sesión se registra al finalizar";
export const EMPTY_CHART_MESSAGE =
  "Todavía no hay sesiones registradas. Cuando el paciente complete actividades vas a ver acá su evolución de precisión y tiempos.";

export const AI_CHAT_DISCLAIMER =
  "Conversación simulada para demostración. No reemplaza acompañamiento profesional.";

export const AI_CHAT_GREETING =
  "Hola, soy tu compañero del jardín. Contame cómo estás hoy y elegimos juntos por dónde empezar.";

export const AI_CHAT_REPLIES = {
  alegria: [
    "Qué bueno saberlo. Aprovechemos esa energía con un desafío nuevo del jardín.",
    "Me alegra mucho. Si querés, sumamos una actividad un poquito más larga hoy.",
    "Se nota tu entusiasmo. ¿Vamos a regar dos plantas hoy?"
  ],
  bien: [
    "Genial. Vamos a un ritmo parejo y sumamos una actividad recomendada.",
    "Perfecto. Elegí la que más te llame la atención y arrancamos.",
    "Sigamos con lo que ya venís haciendo, está bueno mantener la constancia."
  ],
  calma: [
    "Vamos sin apuro. Podemos empezar con una actividad corta.",
    "Buena idea tomarlo con calma. Elegí una que te resulte cómoda.",
    "Respirá profundo y arrancamos con algo suave."
  ],
  cansancio: [
    "Está bien descansar. ¿Qué te parece una sola actividad breve y guiada?",
    "Vamos despacio hoy. Si querés paramos cuando lo necesites.",
    "Con poquito ya alcanza. Elegí la más corta y vemos cómo te va."
  ],
  tristeza: [
    "Gracias por contarme. Empecemos con algo suave, sin exigencia.",
    "Estoy con vos. Podemos hacer una actividad tranquila y ver cómo te sentís.",
    "No hace falta rendir hoy. Elegí lo que más te acompañe."
  ],
  default: [
    "Contame un poco más para poder acompañarte mejor.",
    "Estoy escuchando. Si querés, empezamos por una actividad corta.",
    "Cuando estés listo/a elegimos juntos una actividad del jardín."
  ]
};
