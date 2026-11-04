// Escenarios de la Fase 2 (prompt 3.5) sobre el validador puro.
//
// Cada escenario arma un contexto sintético, deriva las observaciones con el
// observationsBuilder REAL y valida textos con las mismas opciones que usan
// los dos caminos de generación (in-process y worker):
// GENERATION_VALIDATION_OPTIONS = { checkFacts: true, aspectsPolicy: "discard" }.
//
// Sin DB, sin Ollama. Datos ficticios.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseAndValidateSessionAnalysis } from "../src/services/ai/responseValidator.js";
import { buildObservations } from "../src/services/ai/observationsBuilder.js";
import {
  GENERATION_VALIDATION_OPTIONS,
  findForbiddenClaim,
  findMalformedSummary,
  reviewStoredAnalysis,
} from "../src/services/ai/contentSafety.js";

const ACTIVITY = { slug: "orientacion_temporal", name: "Agenda de turnos", cognitive_domain_slugs: ["orientacion"] };

function metrics({ total = 4, correct = 2, incorrect = 2, unanswered = 0 } = {}) {
  const answered = correct + incorrect;
  return {
    total_questions: total,
    answered_questions: answered,
    correct_count: correct,
    incorrect_count: incorrect,
    unanswered_count: unanswered,
    accuracy: answered > 0 ? correct / answered : null,
    completion_rate: total > 0 ? answered / total : 0,
    mean_latency_ms: 2000,
  };
}

function ctx({ m = metrics(), comparison = null, mood = null, section = ACTIVITY } = {}) {
  return {
    schema_version: "2",
    language: "es",
    patient_reported_mood: mood,
    global: { metrics: m },
    sections: [{ ...section, metrics: m }],
    comparison_metrics: comparison,
  };
}

function comparison({ accuracy = "bajó", latency = null, levelSame } = {}) {
  const c = {
    reference: { days_before: 3 },
    accuracy: { current: 0.5, previous: 0.75, delta_percentage_points: -25, direction: accuracy },
  };
  if (latency) c.mean_latency_ms = { direction: latency };
  if (levelSame !== undefined) c.difficulty_level = { current: 2, previous: levelSame === false ? 1 : 2, same: levelSame };
  return c;
}

function validate(summary, context, extra = {}) {
  const { observations, follow_up } = buildObservations(context);
  const raw = JSON.stringify({ schema_version: "3", summary, ...extra });
  return parseAndValidateSessionAnalysis(raw, context, {
    observations,
    followUp: follow_up,
    ...GENERATION_VALIDATION_OPTIONS,
  });
}

function rejectedWith(summary, context, reason) {
  assert.throws(
    () => validate(summary, context),
    (err) => {
      assert.equal(err.info?.reason, reason, `esperaba ${reason}, recibido ${err.info?.reason}: ${err.message}`);
      return true;
    },
  );
}

function accepted(summary, context) {
  const out = validate(summary, context);
  assert.equal(out.summary, summary);
  return out;
}

describe("Escenario: precisión total (todas correctas)", () => {
  const c = ctx({ m: metrics({ correct: 4, incorrect: 0 }) });

  it("acepta una síntesis fiel", () => {
    accepted("En Agenda de turnos la sesión se completó en su totalidad y se registraron más respuestas correctas que incorrectas.", c);
  });

  it("acepta decir que no hubo respuestas incorrectas", () => {
    accepted("En Agenda de turnos la sesión se completó en su totalidad y no se registraron respuestas incorrectas.", c);
  });

  it("rechaza invertir la distribución", () => {
    rejectedWith("En Agenda de turnos se registraron más respuestas incorrectas que correctas.", c, "contradicts_recorded_data");
  });

  it("rechaza un juicio evaluativo aunque los datos sean altos", () => {
    rejectedWith("En Agenda de turnos la sesión tuvo un desempeño excelente.", c, "evaluative_judgment");
  });

  it("rechaza atribuir una capacidad a partir del resultado", () => {
    assert.throws(() => validate("Todas las respuestas fueron correctas, lo que demuestra una buena memoria.", c));
  });
});

describe("Escenario: bajo desempeño", () => {
  const c = ctx({ m: metrics({ correct: 1, incorrect: 3 }) });

  it("acepta la paráfrasis de la distribución", () => {
    accepted("En Agenda de turnos se completó la sesión y hubo más respuestas incorrectas que correctas.", c);
  });

  it("rechaza afirmar que todas fueron correctas", () => {
    rejectedWith("En Agenda de turnos todas las respuestas fueron correctas.", c, "contradicts_recorded_data");
  });

  it("rechaza afirmaciones clínicas indirectas", () => {
    assert.throws(() => validate("En Agenda de turnos se registraron más respuestas incorrectas, compatible con problemas de memoria.", c));
    assert.throws(() => validate("Se registraron más respuestas incorrectas que correctas, lo que sugiere fallas de orientación.", c));
  });

  it("rechaza recomendar bajar la dificultad (Ollama no decide niveles)", () => {
    rejectedWith("Se registraron más respuestas incorrectas que correctas; convendría bajar la dificultad.", c, "clinical_recommendation");
  });
});

describe("Escenario: sesión incompleta", () => {
  const c = ctx({ m: metrics({ total: 4, correct: 1, incorrect: 1, unanswered: 2 }) });

  it("acepta mencionar preguntas sin responder", () => {
    accepted("En Agenda de turnos se registraron preguntas sin responder durante la sesión.", c);
  });

  it("rechaza afirmar que se completó en su totalidad", () => {
    rejectedWith("En Agenda de turnos la sesión fue completada en su totalidad.", c, "contradicts_recorded_data");
  });
});

describe("Escenario: sin sesiones comparables", () => {
  const c = ctx();

  it("acepta decir que todavía no hay sesiones comparables", () => {
    accepted("En Agenda de turnos la sesión se completó en su totalidad. Todavía no hay sesiones comparables para describir una evolución.", c);
  });

  it("rechaza inventar una comparación con una sesión anterior", () => {
    rejectedWith("En Agenda de turnos la precisión fue superior a la de una sesión anterior.", c, "contradicts_recorded_data");
  });

  it("rechaza hablar de tendencia", () => {
    assert.throws(() => validate("En Agenda de turnos se observa una tendencia descendente en los resultados.", c));
  });
});

describe("Escenario: comparación con el mismo nivel de dificultad", () => {
  const c = ctx({ comparison: comparison({ accuracy: "bajó", latency: "subió", levelSame: true }) });

  it("acepta describir la dirección registrada", () => {
    accepted("En Agenda de turnos la precisión fue inferior a la de una sesión anterior comparable y el tiempo promedio de respuesta aumentó.", c);
  });

  it("rechaza invertir la dirección de la precisión", () => {
    rejectedWith("En Agenda de turnos la precisión fue superior a la de una sesión anterior comparable.", c, "contradicts_recorded_data");
  });

  it("rechaza invertir la dirección del tiempo de respuesta", () => {
    rejectedWith("En Agenda de turnos el tiempo promedio de respuesta disminuyó respecto de una sesión comparable.", c, "contradicts_recorded_data");
  });

  it("una precisión inferior no puede describirse como declive o empeoramiento", () => {
    assert.throws(() => validate("En Agenda de turnos la precisión fue inferior, lo que evidencia un declive.", c));
    assert.throws(() => validate("En Agenda de turnos la precisión empeoró respecto de la sesión anterior.", c));
  });
});

describe("Escenario: comparación con distinto nivel de dificultad (mecanismo adaptativo)", () => {
  const differ = ctx({ comparison: comparison({ accuracy: "bajó", levelSame: false }) });
  const unknown = ctx({ comparison: comparison({ accuracy: "subió", levelSame: null }) });

  it("acepta la aclaración de no comparabilidad", () => {
    accepted("En Agenda de turnos la sesión anterior se realizó con un nivel de dificultad distinto, por lo que la diferencia de precisión no es directamente comparable.", differ);
  });

  it("rechaza describir la diferencia como baja cuando los niveles difieren", () => {
    rejectedWith("En Agenda de turnos la precisión fue inferior a la de la sesión anterior.", differ, "contradicts_recorded_data");
  });

  it("rechaza describir la diferencia como subida cuando el nivel es desconocido", () => {
    rejectedWith("En Agenda de turnos la precisión fue superior a la de la sesión anterior.", unknown, "contradicts_recorded_data");
  });

  it("rechaza atribuir el cambio al nivel o sugerir cambiarlo", () => {
    rejectedWith("Sería conveniente subir el nivel de dificultad en la próxima sesión.", differ, "clinical_recommendation");
  });
});

describe("Escenario: estado de ánimo presente y ausente", () => {
  it("con mood registrado, el modelo no puede mencionarlo (lo muestra el backend)", () => {
    const c = ctx({ mood: "cansancio" });
    rejectedWith("En Agenda de turnos la persona refirió sentirse cansada durante la sesión.", c, "mood_or_state_claim");
  });

  it("sin mood registrado, tampoco puede inferir un estado", () => {
    const c = ctx({ mood: null });
    rejectedWith("En Agenda de turnos la persona parecía motivada durante la sesión.", c, "mood_or_state_claim");
  });

  it("una síntesis sin mención de estado se acepta en ambos casos", () => {
    const s = "En Agenda de turnos la sesión se completó en su totalidad y la cantidad de respuestas correctas e incorrectas fue similar.";
    accepted(s, ctx({ mood: "cansancio" }));
    accepted(s, ctx({ mood: null }));
  });
});

describe("Paráfrasis legítimas (no deben rechazarse)", () => {
  const c = ctx({ m: metrics({ correct: 3, incorrect: 1 }), comparison: comparison({ accuracy: "subió", levelSame: true }) });
  const PARAPHRASES = [
    "En Agenda de turnos la sesión se completó en su totalidad.",
    "La actividad Agenda de turnos fue finalizada y hubo más aciertos que errores.",
    "En Agenda de turnos se respondieron todas las preguntas y predominaron las respuestas correctas.",
    "En Agenda de turnos la precisión fue mayor que en una sesión anterior comparable de la misma actividad.",
  ];
  for (const s of PARAPHRASES) {
    it(s, () => accepted(s, c));
  }
});

describe("Recomendaciones clínicas inapropiadas", () => {
  const c = ctx();
  const RECOMMENDATIONS = [
    "Se recomienda consultar a un médico.",
    "Conviene derivar a la persona a un especialista.",
    "Sería útil realizar una evaluación neuropsicológica.",
    "Se recomienda ajustar la medicación.",
    "Convendría aumentar la intensidad del entrenamiento.",
  ];
  for (const s of RECOMMENDATIONS) {
    it(s, () => {
      assert.throws(() => validate(s, c));
    });
  }
});

describe("Falsos positivos conocidos que NO deben bloquearse", () => {
  const NEUTRAL = [
    "En Tomar la medicación la sesión se completó en su totalidad.",
    "En Cómo me siento hoy la sesión se completó en su totalidad.",
    "En Caras y nombres la sesión se completó en su totalidad.",
    "La sesión anterior comparable se realizó con un nivel de dificultad distinto.",
    "Se requieren nuevas sesiones comparables para observar la evolución del desempeño.",
  ];
  for (const s of NEUTRAL) {
    it(s, () => {
      assert.equal(findForbiddenClaim(s), null);
    });
  }
});

describe("aspects_to_review con la política de generación", () => {
  it("se descarta sin validarse y la salida queda vacía", () => {
    const out = validate("En Agenda de turnos la sesión se completó en su totalidad.", ctx(), {
      aspects_to_review: ["Derivar a un especialista por déficit."],
    });
    assert.deepEqual(out.aspects_to_review, []);
  });

  it("con aspectsPolicy=validate (contratos anteriores) se sigue validando", () => {
    const c = ctx();
    const { observations, follow_up } = buildObservations(c);
    const raw = JSON.stringify({
      schema_version: "3",
      summary: "En Agenda de turnos la sesión se completó en su totalidad.",
      aspects_to_review: ["Se observa déficit de atención."],
    });
    assert.throws(() => parseAndValidateSessionAnalysis(raw, c, { observations, followUp: follow_up, checkFacts: true }));
  });
});

describe("Forma del summary (observado en la evaluación 3.5 con Ollama)", () => {
  const c = ctx();

  it("rechaza el summary truncado por la gramática JSON", () => {
    rejectedWith("La sesión de entrenamiento cognitivo ", c, "malformed_summary");
  });

  it("rechaza entidades HTML en lugar de comillas", () => {
    rejectedWith("La sesión de la actividad &quot;Agenda de turnos&quot; se completó en su totalidad.", c, "malformed_summary");
  });

  it("acepta una síntesis completa que termina en punto", () => {
    accepted("En Agenda de turnos la sesión se completó en su totalidad.", c);
  });

  it("findMalformedSummary informa el motivo", () => {
    assert.equal(findMalformedSummary("La sesión de entrenamiento cognitivo "), "missing_final_punctuation");
    assert.equal(findMalformedSummary("Sesión completada."), "too_short");
    assert.equal(findMalformedSummary("En &quot;X&quot; la sesión se completó en su totalidad."), "html_entity");
    assert.equal(findMalformedSummary("En Agenda de turnos la sesión se completó en su totalidad."), null);
  });

  it("un análisis persistido truncado se oculta al leer", () => {
    const review = reviewStoredAnalysis({ schema_version: "3", summary: "La sesión de entrenamiento cognitivo " });
    assert.ok(review.reasons.includes("malformed_summary"));
  });
});
