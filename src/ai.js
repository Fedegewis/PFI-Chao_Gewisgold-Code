// Integracion de IA local (RF2.3 adaptabilidad dinamica y RF4.3 observaciones
// clinicas). Se apoya en Ollama corriendo en la maquina del profesional
// (privacidad: los datos no salen del equipo, RNF2.1/RNF2.2). Si Ollama no esta
// disponible, cada funcion cae en una heuristica local para que la app siga
// siendo 100% funcional en la demo/tesis.

import { SLOW_MS } from "./constants/appConfig.js";
import { formatLatency } from "./lib/format.js";
import { countSessionsThisWeek, getPatientSessions } from "./services/sessionService.js";

export { SLOW_MS };

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
    if (!res.ok) throw new Error(`Ollama respondio ${res.status}`);
    const data = await res.json();
    return (data.response || "").trim();
  } finally {
    clearTimeout(timer);
  }
}

// --- RF2.3: ajuste de dificultad en tiempo real segun desempeno ---

// Heuristica local: sube si acerto rapido, baja si erro, mantiene si acerto lento.
export function heuristicDifficulty({ correct, latencyMs }) {
  if (correct && latencyMs <= SLOW_MS) return "up";
  if (!correct) return "down";
  return "hold";
}

// Intenta pedir la recomendacion a Ollama; si falla usa la heuristica local.
export async function recommendDifficulty(perf, aiInstructions) {
  try {
    const prompt = [
      "Sos un motor adaptativo de estimulacion cognitiva para adultos mayores.",
      `Instrucciones del profesional: ${aiInstructions || "sin indicaciones"}.`,
      `Ultima respuesta correcta: ${perf.correct ? "si" : "no"}.`,
      `Latencia de respuesta: ${perf.latencyMs} ms.`,
      `Nivel de dificultad actual: ${perf.level + 1} de ${perf.maxLevel + 1}.`,
      `Precision acumulada en la sesion: ${perf.accuracy}%.`,
      "Respondras UNA sola palabra: up (mas dificil), down (mas facil) u hold (mantener)."
    ].join("\n");
    const out = await ollamaGenerate(prompt, { timeoutMs: 1800 });
    const match = out.toLowerCase().match(/\b(up|down|hold)\b/);
    if (match) return { action: match[1], source: "ollama" };
  } catch {
    // Ollama no disponible: se usa la heuristica local
  }
  return { action: heuristicDifficulty(perf), source: "local" };
}

// --- RF4.3: sintesis de observaciones clinicas ---

// Observacion redactada localmente a partir de las metricas reales del paciente.
export function heuristicObservation(patient, sessions) {
  const mine = getPatientSessions(sessions, patient.id);
  if (mine.length === 0) {
    return `Aun no hay sesiones registradas para ${patient.name}. Se sugiere iniciar con actividades breves (5-8 min) para establecer una linea de base de precision y latencia.`;
  }
  const avgAccuracy = Math.round(mine.reduce((acc, s) => acc + s.accuracy, 0) / mine.length);
  const avgLatencyMs = mine.reduce((acc, s) => acc + s.avgLatencyMs, 0) / mine.length;
  const last = mine[mine.length - 1];
  const half = Math.floor(mine.length / 2) || 1;
  const firstHalf = mine.slice(0, half);
  const lastHalf = mine.slice(-half);
  const firstAvg = Math.round(firstHalf.reduce((acc, s) => acc + s.accuracy, 0) / firstHalf.length);
  const lastAvg = Math.round(lastHalf.reduce((acc, s) => acc + s.accuracy, 0) / lastHalf.length);
  const delta = lastAvg - firstAvg;

  const trendText =
    mine.length < 2
      ? "Todavia no hay suficientes sesiones para establecer una tendencia."
      : delta > 5
        ? `Se observa una mejora de ${delta} puntos de precision entre las primeras y ultimas sesiones.`
        : delta < -5
          ? `Se observa un descenso de ${Math.abs(delta)} puntos de precision, posible senal de fatiga o mayor dificultad.`
          : "El rendimiento se mantiene estable entre sesiones.";

  const latencyText =
    last.avgLatencyMs > SLOW_MS
      ? "La latencia media de la ultima sesion es elevada; conviene priorizar consignas breves y pausas."
      : "Los tiempos de respuesta se encuentran dentro de un rango funcional.";

  const domains = [...new Set(mine.map((s) => s.skill).filter(Boolean))].join(", ");

  return [
    `${patient.name} registro ${mine.length} sesion(es), con ${countSessionsThisWeek(mine)} en la ultima semana.`,
    `Precision promedio ${avgAccuracy}% y tiempo medio de respuesta ${formatLatency(avgLatencyMs)}.`,
    trendText,
    latencyText,
    domains ? `Dominios trabajados: ${domains}.` : ""
  ]
    .filter(Boolean)
    .join(" ");
}

// Intenta que Ollama redacte la observacion; si falla usa la version heuristica.
export async function generateObservation(patient, sessions) {
  const mine = getPatientSessions(sessions, patient.id);
  const fallback = heuristicObservation(patient, sessions);
  if (mine.length === 0) return { text: fallback, source: "local" };
  try {
    const resumen = mine
      .slice(-8)
      .map((s) => `${new Date(s.date).toLocaleDateString("es-AR")}: ${s.activityTitle} (${s.skill}) precision ${s.accuracy}%, latencia ${formatLatency(s.avgLatencyMs)}`)
      .join("\n");
    const prompt = [
      "Sos un asistente clinico que sintetiza patrones conductuales de estimulacion cognitiva en adultos mayores.",
      `Paciente: ${patient.name}, ${patient.age} anios.`,
      `Indicaciones del profesional: ${patient.aiInstructions || "sin indicaciones"}.`,
      "Datos de las ultimas sesiones:",
      resumen,
      "Redacta una observacion clinica breve (3 a 5 oraciones), en espanol neutro, mencionando precision, tiempos de respuesta, tendencia y una recomendacion. No inventes datos que no esten arriba."
    ].join("\n");
    const out = await ollamaGenerate(prompt, { timeoutMs: 9000 });
    if (out) return { text: out, source: "ollama" };
  } catch {
    // Ollama no disponible: se usa la observacion heuristica
  }
  return { text: fallback, source: "local" };
}
