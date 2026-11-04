// v3.4 — Observaciones determinísticas para el seguimiento profesional.
//
// Función pura: recibe el contexto normalizado (salida de contextBuilder)
// y devuelve dos arrays:
//   - observations: frases descriptivas construidas por reglas cerradas
//     sobre datos reales del backend. Lenguaje adulto, no clínico, sin
//     cifras, sin calificaciones subjetivas.
//   - follow_up: aspectos sugeridos para la próxima sesión, derivados
//     1:1 de las observaciones aplicables. No son diagnósticos ni
//     recomendaciones terapéuticas: son recordatorios de qué revisar.
//
// Reglas intencionalmente acotadas: ninguna observación introduce
// umbrales clínicos, "capacidad", "mejoría", "deterioro", "déficit",
// "excelente", "pobre". Toda frase se puede justificar directamente
// con un valor presente en el contexto.
//
// Fuente de verdad: contextBuilder.buildSessionAnalysisContext (schema v2+).

const EPSILON = 1e-9;

function isPositive(n) {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/**
 * @param {object} context  Contexto normalizado (ver contextBuilder).
 * @returns {{ observations: string[], follow_up: string[] }}
 */
export function buildObservations(context) {
  if (!context || typeof context !== "object") {
    throw new TypeError("context obligatorio");
  }
  const observations = [];
  const follow_up = [];

  const global = context.global?.metrics || {};
  const total = global.total_questions;
  const correct = global.correct_count;
  const incorrect = global.incorrect_count;
  const unanswered = global.unanswered_count;
  const completionRate = global.completion_rate;

  // 1) Completitud de la sesión.
  if (typeof completionRate === "number") {
    if (completionRate >= 1 - EPSILON) {
      observations.push("La sesión fue completada en su totalidad.");
    } else {
      observations.push("Se registraron preguntas sin responder durante la sesión.");
      follow_up.push(
        "Verificar si el paciente tuvo dificultades para completar la actividad en el tiempo disponible."
      );
    }
  }

  // 2) Distribución de aciertos (sin usar porcentajes).
  if (typeof correct === "number" && typeof incorrect === "number") {
    if (correct > incorrect) {
      observations.push("Se registraron más respuestas correctas que incorrectas.");
    } else if (correct < incorrect) {
      observations.push("Se registraron más respuestas incorrectas que correctas.");
      follow_up.push(
        "Observar si esta distribución de respuestas se mantiene en próximas sesiones de la misma actividad."
      );
    } else if (
      (typeof total === "number" && total > 0) ||
      correct > 0 ||
      incorrect > 0
    ) {
      observations.push("La cantidad de respuestas correctas e incorrectas fue similar.");
    }
  }

  // 3) Comparación histórica — SOLO si existe comparison_metrics real.
  //    comparisonBuilder garantiza que la referencia es una previa de la
  //    MISMA actividad; aquí nos limitamos a describir la dirección.
  const cm = context.comparison_metrics;
  if (cm) {
    const acc = cm.accuracy;
    // P1 (mecanismo adaptativo): si las sesiones no comparten nivel de
    // dificultad, la diferencia de precisión no se describe como subida ni
    // bajada. same=null → una de las dos es anterior al mecanismo.
    const level = cm.difficulty_level;
    const levelsDiffer = level && level.same === false;
    const levelUnknown = level && level.same === null;
    if (acc && acc.direction !== "sin_datos" && levelsDiffer) {
      observations.push(
        "La sesión anterior comparable se realizó con un nivel de dificultad distinto, por lo que la diferencia de precisión no es directamente comparable."
      );
      follow_up.push(
        "Considerar la diferencia de nivel de dificultad al revisar la evolución de la precisión entre sesiones."
      );
    } else if (acc && acc.direction !== "sin_datos" && levelUnknown) {
      observations.push(
        "Una de las sesiones comparadas no tiene un nivel de dificultad registrado, por lo que la diferencia de precisión no es directamente comparable."
      );
      follow_up.push(
        "Considerar que las sesiones comparadas pueden diferir en la dificultad de sus preguntas."
      );
    } else if (acc && acc.direction === "subió") {
      observations.push(
        "La precisión fue superior a la de una sesión anterior comparable de la misma actividad."
      );
      follow_up.push(
        "Revisar la evolución de la precisión entre sesiones comparables, considerando las diferencias en las preguntas."
      );
    } else if (acc && acc.direction === "bajó") {
      observations.push(
        "La precisión fue inferior a la de una sesión anterior comparable de la misma actividad."
      );
      follow_up.push(
        "Revisar la evolución de la precisión entre sesiones comparables, considerando las diferencias en las preguntas."
      );
    } else if (acc && acc.direction === "igual") {
      observations.push(
        "La precisión fue similar a la de una sesión anterior comparable de la misma actividad."
      );
    }

    const lat = cm.mean_latency_ms;
    if (lat && lat.direction === "subió") {
      observations.push(
        "El tiempo promedio de respuesta aumentó respecto de una sesión comparable."
      );
      follow_up.push(
        "Observar el ritmo de respuesta en próximas sesiones comparables."
      );
    } else if (lat && lat.direction === "bajó") {
      observations.push(
        "El tiempo promedio de respuesta disminuyó respecto de una sesión comparable."
      );
      follow_up.push(
        "Observar el ritmo de respuesta en próximas sesiones comparables."
      );
    }
  } else {
    observations.push(
      "No existen todavía sesiones comparables para describir una tendencia."
    );
    follow_up.push(
      "Se requieren nuevas sesiones comparables para observar la evolución del desempeño."
    );
  }

  // Deduplicación defensiva por si una regla futura produce la misma frase.
  const dedupe = (arr) => Array.from(new Set(arr));
  // Suprimir aspectos no accionables cuando no hubo preguntas (defensa).
  if (!isPositive(total) && correct === 0 && incorrect === 0 && unanswered === 0) {
    return { observations: dedupe(observations), follow_up: [] };
  }
  return {
    observations: dedupe(observations),
    follow_up: dedupe(follow_up),
  };
}

export const OBSERVATIONS_BUILDER_VERSION = "3.4";
