import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  BookOpenCheck,
  Brain,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  Copy,
  Flower2,
  Heart,
  Leaf,
  Link as LinkIcon,
  ListChecks,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  ShoppingBasket,
  Sparkles,
  Sprout,
  Stethoscope,
  SunMedium,
  Target,
  Timer,
  Trophy,
  UserPlus,
  UserRound,
  UsersRound
} from "lucide-react";
import "./styles.css";

const LOGIN = {
  patient: { email: "elena.rios@demo.com", password: "menteactiva" },
  professional: { email: "psicologa@demo.com", password: "jardin2" }
};

function q(prompt, options, patientGood, patientTry, clinician) {
  return { prompt, options, correct: 0, patientGood, patientTry, clinician };
}

const activities = [
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
      q("La lista original tenia pan, leche y manzanas. Cual opcion coincide?", ["Pan, leche y manzanas", "Cafe, arroz y jabon", "Tomates, queso y pilas"], "Muy bien. Recuperaste la lista completa.", "Buen intento. Probemos mirando de nuevo los productos.", "Reconocimiento verbal simple y mantenimiento de tres items."),
      q("Antes de salir, Elena queria comprar leche, arroz y jabon. Que producto NO estaba en la lista?", ["Pilas", "Arroz", "Jabon"], "Exacto. Detectaste el elemento intruso.", "Casi. La idea era encontrar lo que sobra.", "Control inhibitorio ante distractor semantico."),
      q("Si primero puso leche en el chango y despues pan, que producto falta?", ["Manzanas", "Cafe", "Detergente"], "Bien hecho. Recordaste el item pendiente.", "No pasa nada. Quedaba un producto por recuperar.", "Actualizacion de memoria de trabajo."),
      q("El cartel decia: 2 yogures y 1 queso. Que debe llevar?", ["Dos yogures y un queso", "Un yogur y dos quesos", "Dos quesos y una leche"], "Perfecto. Leiste cantidad y producto.", "Conviene mirar cantidad y producto por separado.", "Atencion sostenida a doble atributo."),
      q("La receta pide tomate, queso y albahaca. Que grupo sirve para preparar la comida?", ["Tomate, queso y albahaca", "Pan, mermelada y cafe", "Jabon, arroz y pilas"], "Muy bien. Agrupaste elementos relacionados.", "La proxima puede resolverse buscando que cosas van juntas.", "Asociacion semantica por contexto cotidiano.")
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
      q("El boleto cuesta $480. Que combinacion paga justo?", ["$200 + $200 + $80", "$500 + $100", "$100 + $100 + $100"], "Excelente. Calculaste el monto exacto.", "Revisamos la suma y seguimos.", "Calculo monetario funcional."),
      q("El colectivo sale a las 10:30 y tarda 20 minutos. A que hora llega?", ["10:50", "10:40", "11:10"], "Muy bien. Sumaste el tiempo de viaje.", "Estas tareas entrenan orientacion temporal.", "Orientacion temporal y adicion de intervalo."),
      q("Si tiene $600 y paga $480, cuanto cambio deberia recibir?", ["$120", "$80", "$180"], "Correcto. Resolviste el cambio esperado.", "La respuesta sale restando el costo a lo que entregaste.", "Resta funcional y monitoreo de transaccion."),
      q("Linea 15 al centro y linea 21 al hospital. Cual toma para ir al hospital?", ["Linea 21", "Linea 15", "Cualquiera de las dos"], "Exacto. Elegiste usando la informacion importante.", "Habia que buscar la palabra hospital.", "Atencion selectiva guiada por destino."),
      q("El chofer pide apoyar la tarjeta una vez. Que accion corresponde?", ["Apoyar la tarjeta una vez", "Apoyarla tres veces", "Guardar la tarjeta sin usarla"], "Muy bien. Seguiste una instruccion simple.", "Estas consignas practican acciones cotidianas.", "Comprension instruccional y control de respuesta.")
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
      q("Para preparar te, cual paso va primero?", ["Calentar agua", "Servir el te en la taza", "Guardar la taza"], "Muy bien. Identificaste el primer paso.", "Pensemos que accion necesita ocurrir antes.", "Inicio de secuencia y planificacion basica."),
      q("Ya calentaste agua y pusiste el saquito. Que sigue?", ["Esperar unos minutos", "Comprar una tetera", "Lavar la ropa"], "Correcto. Mantuviste la continuidad.", "La clave es elegir el paso que continua.", "Continuidad secuencial y descarte de distractores."),
      q("Si falta leche para la receta, que decision ayuda mas?", ["Anotarla para comprar", "Apagar la luz", "Cambiar de canal"], "Exacto. Elegiste una accion util.", "La pregunta buscaba una solucion practica.", "Resolucion de problemas cotidianos."),
      q("La receta dice mezclar, hornear y dejar enfriar. Que va ultimo?", ["Dejar enfriar", "Mezclar", "Hornear"], "Muy bien. Ubicaste el cierre.", "Puede ayudar imaginar la accion completa.", "Ordenamiento temporal y cierre de tarea."),
      q("Si el horno esta muy caliente, que conviene hacer?", ["Usar agarradera o pedir ayuda", "Tocarlo con la mano", "Dejar la puerta abierta todo el dia"], "Perfecto. Elegiste una accion segura.", "La prioridad era elegir la opcion mas segura.", "Juicio practico y seguridad domestica.")
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
      q("El turno con la doctora es el martes a las 16:00. Que dato es importante recordar?", ["Martes a las 16:00", "Jueves a las 10:00", "Domingo a la noche"], "Muy bien. Recordaste dia y horario juntos.", "En la agenda conviene unir siempre dia y hora.", "Memoria prospectiva con asociacion dia-horario."),
      q("Si hoy es lunes y el turno es manana, que dia es el turno?", ["Martes", "Miercoles", "Viernes"], "Exacto. Ubicaste manana dentro de la semana.", "Estas preguntas practican orientacion semanal.", "Orientacion temporal relativa."),
      q("Para no olvidarse del turno, que accion ayuda mas?", ["Anotarlo en la agenda", "Cambiarlo de lugar sin avisar", "No mirar el horario"], "Perfecto. Elegiste una estrategia de apoyo.", "La opcion mas util era usar una ayuda externa.", "Uso de estrategia compensatoria."),
      q("Si una cita pasa del martes al viernes, que conviene actualizar?", ["El dia en la agenda y el recordatorio", "Solo el color del papel", "Nada"], "Bien. Actualizaste la informacion importante.", "Cuando cambia una cita, se actualiza agenda y aviso.", "Actualizacion de informacion.")
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
      q("Ana usa lentes y trae una carpeta azul. Quien trae la carpeta azul?", ["Ana", "Luis", "Marta"], "Muy bien. Uniste el nombre con la pista visual.", "La pista era la carpeta azul.", "Codificacion asociativa nombre-atributo."),
      q("Luis dijo que vive cerca de la plaza. Quien vive cerca de la plaza?", ["Luis", "Ana", "Elena"], "Correcto. Recuperaste el dato asociado.", "Lo importante es volver a buscar la asociacion.", "Recuperacion de informacion contextual."),
      q("Marta pidio te y Ana pidio cafe. Quien pidio cafe?", ["Ana", "Marta", "Luis"], "Exacto. Diferenciaste asociaciones parecidas.", "Estas consignas entrenan comparacion de pares.", "Discriminacion entre asociaciones competidoras."),
      q("Rosa vive en el piso 2, Pedro en el 5 y Ana en el 3. Quien vive mas alto?", ["Pedro", "Ana", "Rosa"], "Correcto. Comparaste numeros asociados a personas.", "El piso mas alto era el numero mayor.", "Comparacion numerica en memoria asociativa.")
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
      q("Si hoy sentis poca energia, que opcion ayuda a continuar?", ["Elegir una actividad breve", "Abandonar toda la semana", "Hacer todo mas rapido"], "Muy bien. Adaptar la rutina tambien es avanzar.", "La idea es encontrar una forma amable de continuar.", "Autoregulacion y seleccion de carga apropiada."),
      q("Despues de una pregunta dificil, que conviene hacer?", ["Respirar y probar la siguiente", "Pensar que ya no sirve", "Cerrar sin registrar nada"], "Exacto. Mantener la participacion es parte del entrenamiento.", "Una pregunta dificil no define toda la sesion.", "Tolerancia a frustracion y persistencia."),
      q("Que dato puede ayudar al profesional a acompanarte mejor?", ["Como te sentiste durante la actividad", "El color de la pared", "La marca del telefono"], "Perfecto. Ese registro ayuda a ajustar sesiones.", "El profesional necesita saber como viviste la actividad.", "Metacognicion y reporte subjetivo."),
      q("Si notas que te fue mejor al principio que al final, que podria estar apareciendo?", ["Cansancio o fatiga", "Mejora del clima", "Un error del calendario"], "Muy bien. Identificaste una posible senal de fatiga.", "Cambiar al final puede relacionarse con cansancio.", "Reconocimiento subjetivo de fatiga cognitiva.")
    ]
  }
];

const initialPatients = [
  { id: "elena", name: "Elena Rios", age: 72, email: LOGIN.patient.email, mood: "tranquila", status: "Rendimiento optimo", note: "Atencion estable y buena adherencia semanal.", score: 86, trend: "+8%", rt: "1.9 s", risk: "Bajo", aiInstructions: "Usar preguntas breves, ejemplos cotidianos y refuerzo amable. Evitar consignas con mas de dos datos juntos.", link: "https://menteactiva.demo/p/elena", completed: ["market"], answers: 8, maxQuestions: 5 },
  { id: "carlos", name: "Carlos Molina", age: 78, email: "carlos.molina@demo.com", mood: "cansado", status: "Posible fatiga", note: "Latencia elevada hacia el final de la sesion.", score: 68, trend: "-6%", rt: "3.9 s", risk: "Medio", aiInstructions: "Priorizar sesiones cortas, pausas y preguntas con orientacion temporal.", link: "https://menteactiva.demo/p/carlos", completed: [], answers: 4, maxQuestions: 4 }
];

const weekly = [72, 84, 78, 88, 91, 76, 86];
const motivation = ["Hoy tambien cuenta: una pregunta hecha con calma ya riega el jardin.", "Avanzar poquito sigue siendo avanzar.", "Tu ritmo es parte del entrenamiento, no un obstaculo."];
const cx = (...classes) => classes.filter(Boolean).join(" ");

function App() {
  const [screen, setScreen] = useState("login");
  const [role, setRole] = useState("patient");
  const [patients, setPatients] = useState(initialPatients);
  const [selectedPatientId, setSelectedPatientId] = useState("elena");
  const [selectedActivity, setSelectedActivity] = useState(activities[0]);
  const [loginError, setLoginError] = useState("");
  const selectedPatient = patients.find((patient) => patient.id === selectedPatientId) || patients[0];
  const phrase = useMemo(() => motivation[new Date().getDay() % motivation.length], []);

  function login(nextRole, email, password) {
    if (email === LOGIN[nextRole].email && password === LOGIN[nextRole].password) {
      setRole(nextRole);
      setScreen(nextRole === "professional" ? "professional" : "patient");
      setLoginError("");
      return;
    }
    setLoginError("Credenciales incorrectas. Revisa el README o usa los datos demo.");
  }

  function logout() {
    setScreen("login");
    setRole("patient");
    setLoginError("");
  }

  function updatePatient(id, patch) {
    setPatients((current) => current.map((patient) => patient.id === id ? { ...patient, ...patch } : patient));
  }

  function completeActivity(activityId, answeredCount) {
    updatePatient(selectedPatient.id, {
      completed: Array.from(new Set([...selectedPatient.completed, activityId])),
      answers: selectedPatient.answers + answeredCount,
      score: Math.min(100, selectedPatient.score + 2)
    });
    setScreen("patient");
  }

  return (
    <main className="app-shell">
      <div className="app-inner">
        <GlobalHeader screen={screen} role={role} logout={logout} setScreen={setScreen} />
        {screen === "login" && <LoginScreen onLogin={login} loginError={loginError} />}
        {screen === "patient" && <PatientScreen patient={selectedPatient} phrase={phrase} setSelectedActivity={setSelectedActivity} setScreen={setScreen} />}
        {screen === "activity" && <ActivityScreen patient={selectedPatient} activity={selectedActivity} onBack={() => setScreen("patient")} onComplete={completeActivity} />}
        {screen === "professional" && <ProfessionalScreen patients={patients} selectedPatient={selectedPatient} setSelectedPatientId={setSelectedPatientId} updatePatient={updatePatient} setPatients={setPatients} />}
      </div>
    </main>
  );
}

function GlobalHeader({ screen, role, logout, setScreen }) {
  return (
    <header className="topbar">
      <button className="brand" onClick={() => setScreen(screen === "login" ? "login" : role)}>
        <span><Leaf size={28} /></span>
        <div><strong>MenteActiva Jardin</strong><small>Ambiente 2 - Jardin Cognitivo</small></div>
      </button>
      {screen !== "login" && (
        <nav>
          <button className={screen === "patient" ? "active" : ""} onClick={() => setScreen("patient")}><UserRound size={18} /> Paciente</button>
          {role === "professional" && <button className={screen === "professional" ? "active" : ""} onClick={() => setScreen("professional")}><Stethoscope size={18} /> Psicologo</button>}
          <button onClick={logout}><ArrowLeft size={18} /> Salir</button>
        </nav>
      )}
    </header>
  );
}

function LoginScreen({ onLogin, loginError }) {
  const [mode, setMode] = useState("patient");
  const [email, setEmail] = useState(LOGIN.patient.email);
  const [password, setPassword] = useState(LOGIN.patient.password);

  function switchMode(nextMode) {
    setMode(nextMode);
    setEmail(LOGIN[nextMode].email);
    setPassword(LOGIN[nextMode].password);
  }

  return (
    <section className="login-layout">
      <div className="login-copy">
        <p className="eyebrow">Ambiente 2</p>
        <h1>Jardin Cognitivo</h1>
        <p>El jardin se alimenta y crece segun los desafios completados. El paciente ve juegos cotidianos; el psicologo configura preguntas, limites y seguimiento.</p>
        <div className="motivation-banner"><Sparkles size={24} /> Bienvenida IA: {motivation[0]}</div>
      </div>
      <div className="panel login-panel">
        <div className="login-tabs">
          <button className={mode === "patient" ? "tab-active" : ""} onClick={() => switchMode("patient")}><UserRound size={20} /> Paciente</button>
          <button className={mode === "professional" ? "tab-active" : ""} onClick={() => switchMode("professional")}><Stethoscope size={20} /> Psicologo</button>
        </div>
        <div className="login-title"><ShieldCheck size={34} /><div><h2>Inicio de sesion</h2><p>Usa las credenciales demo del README.</p></div></div>
        <label>Email</label>
        <input value={email} onChange={(event) => setEmail(event.target.value)} />
        <label>Clave</label>
        <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" />
        {loginError && <div className="error-box"><AlertTriangle size={20} /> {loginError}</div>}
        <button className="primary" onClick={() => onLogin(mode, email, password)}>Entrar como {mode === "patient" ? "paciente" : "psicologo"} <ChevronRight size={22} /></button>
      </div>
    </section>
  );
}

function PatientScreen({ patient, phrase, setSelectedActivity, setScreen }) {
  const completedCount = patient.completed.length;
  function startActivity(activity) {
    if (patient.completed.includes(activity.id)) return;
    setSelectedActivity(activity);
    setScreen("activity");
  }
  return (
    <div className="patient-layout">
      <section className="panel patient-main">
        <div className="garden-welcome"><Sparkles size={22} /><span>Hola, {patient.name.split(" ")[0]}. {phrase}</span></div>
        <GardenStrip completedIds={patient.completed} />
        <div className="section-head"><div><p className="eyebrow">Tus juegos de hoy</p><h2>Todos los desafios del jardin</h2></div><span className="streak-pill">Racha: 5 dias</span></div>
        <div className="activity-grid">
          {activities.map((activity, index) => <ActivityCard key={activity.id} activity={activity} index={index} completed={patient.completed.includes(activity.id)} onClick={() => startActivity(activity)} />)}
        </div>
      </section>
      <aside className="patient-aside">
        <PerformancePanel patient={patient} completedCount={completedCount} />
        <MoodPanel />
        <ProgressPanel completedCount={completedCount} />
      </aside>
    </div>
  );
}

function GardenStrip({ completedIds }) {
  return (
    <div className="garden-strip">
      <div><p className="eyebrow">Idea jardin</p><h2>Regamos una actividad por dia</h2></div>
      <div className="plant-row">
        {activities.map((activity, index) => {
          const done = completedIds.includes(activity.id);
          const today = !done && index === completedIds.length;
          const PlantIcon = done ? Flower2 : today ? Sprout : Leaf;
          return <div key={activity.id} className={cx("plant-pot", done && "plant-done", today && "plant-today")}><PlantIcon size={32} /><span>{done ? "Pintado" : today ? "Regar hoy" : "Pendiente"}</span></div>;
        })}
      </div>
    </div>
  );
}

function ActivityCard({ activity, index, completed, onClick }) {
  const Icon = activity.icon;
  return (
    <button onClick={onClick} disabled={completed} className={cx("activity-card", index === 0 && !completed && "activity-recommended", completed && "activity-completed")}>
      <div className="activity-icon"><Icon size={32} /></div>
      <div className="activity-copy"><span className="activity-status">{activity.status}</span><h3>{activity.title}</h3><p>{activity.skill} - {activity.time}</p>{completed && <strong className="done-badge"><CheckCircle2 size={18} /> Hecha por hoy</strong>}{!completed && index === 0 && <strong className="start-button">Comenzar</strong>}</div>
      <ChevronRight size={28} />
    </button>
  );
}

function ActivityScreen({ patient, activity, onBack, onComplete }) {
  const questions = activity.questions.slice(0, patient.maxQuestions);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState([]);
  const current = questions[questionIndex];
  const selected = answers[questionIndex];
  const isCorrect = selected === current.correct;
  const completed = answers.filter((answer) => answer !== undefined).length;
  const isLast = questionIndex === questions.length - 1;
  function chooseAnswer(index) {
    const next = [...answers];
    next[questionIndex] = index;
    setAnswers(next);
  }
  return (
    <section className="panel game-panel">
      <button onClick={onBack} className="back-link"><ArrowLeft size={22} /> Volver a actividades</button>
      <div className="game-layout">
        <div className="game-prompt"><p>{activity.skill}</p><h2>{activity.title}</h2><div className="session-progress"><span>Pregunta {questionIndex + 1} de {questions.length}</span><div><i style={{ width: `${((questionIndex + 1) / questions.length) * 100}%` }} /></div></div><p className="prompt-copy">{activity.intro}</p><div className="chip-row"><StatusChip icon={Clock3} text="Sin limite estricto" /><StatusChip icon={Target} text={`${questions.length} preguntas max.`} /><StatusChip icon={BookOpenCheck} text="Feedback inmediato" /></div><div className="session-card"><p>Tu avance queda guardado</p><span>Respondidas: {completed}/{questions.length}</span><span>Cuando completas, se pinta una parte del jardin.</span></div></div>
        <div className="question-panel"><div className="question-header"><h3>Pregunta {questionIndex + 1}</h3><span>{completed}/{questions.length}</span></div><p className="question-text">{current.prompt}</p><div className="answer-grid">{current.options.map((answer, index) => <button key={answer} onClick={() => chooseAnswer(index)} className={cx("answer-button", selected === index && (isCorrect ? "answer-good" : "answer-review"))}><span>{String.fromCharCode(65 + index)}</span>{answer}{selected === index && <CheckCircle2 size={24} />}</button>)}</div>{selected !== undefined && <div className={cx("feedback-box", !isCorrect && "feedback-encourage")}>{isCorrect ? <CheckCircle2 size={24} /> : <RefreshCw size={24} />}<p>{isCorrect ? current.patientGood : current.patientTry}</p></div>}<div className="activity-actions"><button onClick={() => setQuestionIndex(Math.max(0, questionIndex - 1))} className="secondary-action" disabled={questionIndex === 0}>Anterior</button><button onClick={() => isLast ? onComplete(activity.id, questions.length) : setQuestionIndex(questionIndex + 1)} className="primary" disabled={selected === undefined}>{isLast ? "Finalizar sesion" : "Siguiente"}</button></div></div>
      </div>
    </section>
  );
}

function ProfessionalScreen({ patients, selectedPatient, setSelectedPatientId, updatePatient, setPatients }) {
  const [newName, setNewName] = useState("");
  const [newAge, setNewAge] = useState("70");
  const [instructions, setInstructions] = useState(selectedPatient.aiInstructions);
  const [maxQuestions, setMaxQuestions] = useState(selectedPatient.maxQuestions);
  function selectPatient(patient) {
    setSelectedPatientId(patient.id);
    setInstructions(patient.aiInstructions);
    setMaxQuestions(patient.maxQuestions);
  }
  function createPatient() {
    if (!newName.trim()) return;
    const id = newName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || `paciente-${patients.length + 1}`;
    const next = { id, name: newName, age: Number(newAge) || 70, email: `${id}@demo.com`, mood: "sin registrar", status: "Paciente nuevo", note: "Paciente creado por el psicologo. Falta completar criterio de medicion.", score: 0, trend: "0%", rt: "-", risk: "Bajo", aiInstructions: "Hacer preguntas simples, de una consigna por vez, y registrar estado emocional.", link: `https://menteactiva.demo/p/${id}`, completed: [], answers: 0, maxQuestions: 4 };
    setPatients((current) => [...current, next]);
    setSelectedPatientId(next.id);
    setInstructions(next.aiInstructions);
    setMaxQuestions(next.maxQuestions);
    setNewName("");
  }
  function saveAiConfig() {
    updatePatient(selectedPatient.id, { aiInstructions: instructions, maxQuestions: Number(maxQuestions) || 4 });
  }
  return (
    <div className="professional-layout">
      <section className="panel professional-patients"><div className="section-head compact"><div><p className="eyebrow">Panel de pacientes</p><h2>Seguimiento</h2></div><button className="icon-action"><Search size={22} /></button></div><div className="patient-list">{patients.map((patient) => <button key={patient.id} className={cx("patient-row", patient.id === selectedPatient.id && "selected-patient")} onClick={() => selectPatient(patient)}><div className="avatar">{patient.name[0]}</div><div><strong>{patient.name}</strong><span>{patient.age} anios - {patient.status}</span><small>IA: {patient.aiInstructions}</small></div><ChevronRight size={22} /></button>)}</div><div className="create-box"><p className="eyebrow">Creacion del paciente</p><input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Nombre del paciente" /><input value={newAge} onChange={(event) => setNewAge(event.target.value)} placeholder="Edad" /><button className="primary" onClick={createPatient}><UserPlus size={20} /> Crear paciente</button></div></section>
      <section className="professional-stack"><div className="metric-grid"><Metric icon={CheckCircle2} label="Aciertos" value={`${selectedPatient.score}%`} detail={selectedPatient.trend} /><Metric icon={Timer} label="Tiempo medio" value={selectedPatient.rt} detail="respuesta" /><Metric icon={Activity} label="Riesgo" value={selectedPatient.risk} detail="preventivo" /></div><div className="panel"><div className="section-head compact"><div><p className="eyebrow">Instrucciones para IA</p><h2>{selectedPatient.name}</h2></div><Brain size={30} /></div><label>Como se mide y que tipo de preguntas debe hacer</label><textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} /><label>Cantidad maxima de preguntas</label><input type="number" min="1" max="10" value={maxQuestions} onChange={(event) => setMaxQuestions(event.target.value)} /><button className="primary" onClick={saveAiConfig}><CheckCircle2 size={20} /> Guardar criterio</button><div className="link-box"><LinkIcon size={22} /><div><strong>Envio de link</strong><p>{selectedPatient.link}</p></div><button className="icon-action" title="Copiar link"><Copy size={20} /></button><button className="icon-action" title="Enviar link"><Send size={20} /></button></div></div><div className="panel"><div className="section-head compact"><div><p className="eyebrow">Dentro de cada paciente</p><h2>Preguntas que se hacen</h2></div><BarChart3 size={30} /></div><div className="question-bank">{activities.flatMap((activity) => activity.questions.map((question, index) => <article key={`${activity.id}-${index}`}><strong>{activity.title}</strong><p>{question.prompt}</p><small>{question.clinician}</small></article>))}</div></div></section>
    </div>
  );
}

function PerformancePanel({ patient, completedCount }) {
  const total = activities.length;
  const percent = Math.round((completedCount / total) * 100);
  return <div className="panel performance-panel"><div className="performance-head"><Trophy className="theme-icon" size={30} /><div><h3>Mi rendimiento</h3><p>Tu jardin crece con cada actividad completada.</p></div></div><div className="performance-ring" style={{ "--value": `${percent}%` }}><strong>{completedCount}/{total}</strong><span>hechas hoy</span></div><p className="performance-note">Cantidad maxima definida por el psicologo: {patient.maxQuestions} preguntas.</p></div>;
}

function MoodPanel() {
  return <div className="panel"><h3>Como te sentis hoy?</h3><div className="mood-row">{["Bien", "Calma", "Cansancio"].map((label) => <button key={label}><Heart size={24} /> {label}</button>)}</div></div>;
}

function ProgressPanel({ completedCount }) {
  return <div className="panel"><h3>Progreso semanal</h3><div className="mini-bars">{weekly.map((value, index) => <span key={index} style={{ height: `${Math.max(24, value)}%` }} />)}</div><p>{completedCount > 0 ? `Ya completaste ${completedCount} actividad${completedCount === 1 ? "" : "es"} hoy.` : "Todavia no completaste actividades hoy."}</p></div>;
}

function Metric({ icon: Icon, label, value, detail }) {
  return <article className="panel metric-card"><Icon className="theme-icon" size={28} /><p>{label}</p><strong>{value}</strong><span>{detail}</span></article>;
}

function StatusChip({ icon: Icon, text }) {
  return <span className="status-chip"><Icon size={16} /> {text}</span>;
}

createRoot(document.getElementById("root")).render(<App />);
