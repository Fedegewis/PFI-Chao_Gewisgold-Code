// Integración de IA local (RF2.3 adaptabilidad dinámica y RF4.3 observaciones
// clínicas). Se apoya en Ollama corriendo en la máquina del profesional
// (privacidad: los datos no salen del equipo, RNF2.1/RNF2.2). Si Ollama no esta
// disponible, cada función cae en una heurística local para que la app siga
// siendo 100% funcional en la demo/tesis.

import { SLOW_MS } from "./constants/appConfig.js";
import { formatLatency } from "./lib/format.js";
import { averageField, countSessionsThisWeek, getPatientSessions } from "./services/sessionService.js";

export const OLLAMA_URL = import.meta.env.VITE_OLLAMA_URL ?? "http://localhost:11434/api/generate";
export const OLLAMA_MODEL = import.meta.env.VITE_OLLAMA_MODEL ?? "llama3";

async function ollamaGenerate(prompt, { timeoutMs = 2500 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`Ollama respondió ${res.status}`);
    const data = await res.json();
    return (data.response || "").trim();
  } finally {
    clearTimeout(timer);
  }
}

// --- RF2.3: ajuste de dificultad en tiempo real según desempeño ---

// Heurística local: sube si acertó rápido, baja si erró, mantiene si acertó lento.
export function heuristicDifficulty({ correct, latencyMs }) {
  if (correct && latencyMs <= SLOW_MS) return "up";
  if (!correct) return "down";
  return "hold";
}

// Intenta pedir la recomendación a Ollama; si falla usa la heurística local.
export async function recommendDifficulty(perf, aiInstructions) {
  try {
    const prompt = [
      "Sos un motor adaptativo de estimulación cognitiva para adultos mayores.",
      `Instrucciones del profesional: ${aiInstructions || "sin indicaciones"}.`,
      `Última respuesta correcta: ${perf.correct ? "si" : "no"}.`,
      `Latencia de respuesta: ${perf.latencyMs} ms.`,
      `Nivel de dificultad actual: ${perf.level + 1} de ${perf.maxLevel + 1}.`,
      `Precisión acumulada en la sesión: ${perf.accuracy}%.`,
      "Respondé UNA sola palabra: up (más difícil), down (más fácil) u hold (mantener)."
    ].join("\n");
    const out = await ollamaGenerate(prompt, { timeoutMs: 1800 });
    const match = out.toLowerCase().match(/\b(up|down|hold)\b/);
    if (match) return { action: match[1], source: "ollama" };
  } catch {
    // Ollama no disponible: se usa la heurística local
  }
  return { action: heuristicDifficulty(perf), source: "local" };
}

// --- RF4.3: síntesis de observaciones clínicas ---

function pick(list, seed) {
  const index = Math.abs(seed) % list.length;
  return list[index];
}

// Observación redactada localmente a partir de las métricas reales del paciente.
// Devuelve tanto el texto plano (para compatibilidad) como secciones cortas.
export function heuristicObservation(patient, sessions) {
  const patientSessions = getPatientSessions(sessions, patient.id);
  const firstName = patient.name.split(" ")[0];
  const seed = (patient.name || "").length + patientSessions.length;

  if (patientSessions.length === 0) {
    const openers = [
      `Todavía no tenemos sesiones registradas de ${firstName}.`,
      `${firstName} aún no completó ninguna sesión.`
    ];
    const suggestions = [
      "Para armar una línea de base convendría arrancar con actividades cortas de 5 a 8 minutos.",
      "Un primer bloque de 5 a 8 minutos alcanza para tener referencia de precisión y tiempos."
    ];
    const sections = {
      resumen: pick(openers, seed),
      recomendacion: pick(suggestions, seed + 1)
    };
    return { text: `${sections.resumen} ${sections.recomendacion}`, sections };
  }

  const avgAccuracy = Math.round(averageField(patientSessions, "accuracy"));
  const avgLatencyMs = averageField(patientSessions, "avgLatencyMs");
  const last = patientSessions[patientSessions.length - 1];
  const weekCount = countSessionsThisWeek(patientSessions);
  const half = Math.floor(patientSessions.length / 2) || 1;
  const firstAvg = Math.round(averageField(patientSessions.slice(0, half), "accuracy"));
  const lastAvg = Math.round(averageField(patientSessions.slice(-half), "accuracy"));
  const delta = lastAvg - firstAvg;
  const domains = [...new Set(patientSessions.map((s) => s.skill).filter(Boolean))];

  const resumenVariants = [
    `${firstName} viene sosteniendo la rutina: lleva ${patientSessions.length} sesión(es) en total y ${weekCount} en la última semana. Precisión promedio ${avgAccuracy}%, con tiempos alrededor de ${formatLatency(avgLatencyMs)}.`,
    `En estas ${patientSessions.length} sesión(es) (${weekCount} esta semana) ${firstName} muestra una precisión promedio del ${avgAccuracy}% y responde en torno a ${formatLatency(avgLatencyMs)}.`,
    `Van ${patientSessions.length} sesión(es) registradas de ${firstName}, ${weekCount} de ellas en los últimos días. Precisión promedio ${avgAccuracy}% y tiempos cerca de ${formatLatency(avgLatencyMs)}.`
  ];

  let tendencia;
  if (patientSessions.length < 2) {
    tendencia = "Con una sola sesión todavía no se puede leer tendencia; conviene sumar al menos dos más para comparar.";
  } else if (delta > 5) {
    tendencia = pick([
      `Se nota una mejora clara: ${delta} puntos arriba entre las primeras y las últimas sesiones.`,
      `El progreso se hace visible, ganando ${delta} puntos de precisión respecto al arranque.`
    ], seed + 2);
  } else if (delta < -5) {
    tendencia = pick([
      `Aparece un descenso de ${Math.abs(delta)} puntos; puede ser fatiga o que las consignas se pusieron mas exigentes.`,
      `La curva bajo ${Math.abs(delta)} puntos en las últimas sesiones, algo a monitorear.`
    ], seed + 3);
  } else {
    tendencia = pick([
      "El rendimiento se mantiene parejo entre sesiones, sin saltos importantes.",
      "La performance se ve estable, sin cambios significativos de una sesión a otra."
    ], seed + 4);
  }

  const latencia = last.avgLatencyMs > SLOW_MS
    ? pick([
        "Los tiempos de la última sesión se estiraron más de lo habitual; ayudaría acortar consignas y sumar pausas.",
        "Latencia elevada en la última sesión: podrían venir bien preguntas más breves y descansos entre bloques."
      ], seed + 5)
    : pick([
        "Los tiempos de respuesta están dentro de un rango funcional.",
        "La velocidad de respuesta se mantiene en un rango cómodo."
      ], seed + 6);

  let recomendacion;
  if (avgAccuracy >= 75) {
    recomendacion = "Se puede probar sumar dificultad de a poco o incorporar un dominio nuevo.";
  } else if (avgAccuracy >= 55) {
    recomendacion = "Convendria consolidar los dominios actuales antes de escalar la dificultad.";
  } else {
    recomendacion = "Priorizar sesiones cortas con mucho refuerzo positivo hasta recuperar precisión.";
  }
  if (domains.length) {
    recomendacion += ` Dominios trabajados hasta ahora: ${domains.join(", ")}.`;
  }

  const sections = { resumen: resumenVariants[Math.abs(seed) % resumenVariants.length], tendencia, latencia, recomendacion };
  const text = `${sections.resumen} ${sections.tendencia} ${sections.latencia} ${sections.recomendacion}`;
  return { text, sections };
}

// Intenta que Ollama redacte la observación; si falla usa la version heurística.
export async function generateObservation(patient, sessions) {
  const patientSessions = getPatientSessions(sessions, patient.id);
  const fallback = heuristicObservation(patient, sessions);
  if (patientSessions.length === 0) return { text: fallback.text, sections: fallback.sections, source: "local" };
  try {
    const resumen = patientSessions
      .slice(-8)
      .map((s) => `${new Date(s.date).toLocaleDateString("es-AR")}: ${s.activityTitle} (${s.skill}) precisión ${s.accuracy}%, latencia ${formatLatency(s.avgLatencyMs)}`)
      .join("\n");
    const prompt = [
      "Sos un asistente clinico que sintetiza patrones conductuales de estimulación cognitiva en adultos mayores.",
      `Paciente: ${patient.name}, ${patient.age} años.`,
      `Indicaciones del profesional: ${patient.aiInstructions || "sin indicaciones"}.`,
      "Datos de las últimas sesiones:",
      resumen,
      "Redacta una observación clínica breve (3 a 5 oraciones), en español neutro, mencionando precisión, tiempos de respuesta, tendencia y una recomendación. No inventes datos que no estén arriba."
    ].join("\n");
    const out = await ollamaGenerate(prompt, { timeoutMs: 9000 });
    if (out) return { text: out, source: "ollama" };
  } catch {
    // Ollama no disponible: se usa la observación heurística
  }
  return { text: fallback.text, sections: fallback.sections, source: "local" };
}
