// 7D: tests unitarios de promptBuilder — sin Ollama, sin DB.
// Verifica que el prompt sea determinístico, en español, contenga reglas
// explícitas de no-diagnóstico/no-invención, y NO filtre datos excluidos.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildSessionAnalysisContext } from "../src/services/ai/contextBuilder.js";
import {
  buildSessionAnalysisPrompt,
  PROMPT_BUILDER_VERSION,
} from "../src/services/ai/promptBuilder.js";

function makeCtx(overrides = {}) {
  return buildSessionAnalysisContext({
    session: { duration_seconds: 300 },
    global: {
      total_questions: 5,
      answered_questions: 5,
      correct_count: 4,
      incorrect_count: 1,
      unanswered_count: 0,
      accuracy: 0.8,
      completion_rate: 1,
      mean_latency_ms: 4200,
      min_latency_ms: 2100,
      max_latency_ms: 6300,
      latency_std_ms: 1200.5,
    },
    sections: overrides.sections || [
      {
        slug: "atencion_visual",
        name: "Objetos de la casa",
        cognitive_domain_slugs: ["atencion", "memoria"],
        result: {
          total_questions: 5,
          answered_questions: 5,
          correct_count: 4,
          incorrect_count: 1,
          unanswered_count: 0,
          accuracy: 0.8,
          completion_rate: 1,
          mean_latency_ms: 4200,
          min_latency_ms: 2100,
          max_latency_ms: 6300,
          latency_std_ms: 1200.5,
        },
      },
    ],
  });
}

describe("promptBuilder — shape básico", () => {
  it("devuelve { prompt, promptVersion }", () => {
    const out = buildSessionAnalysisPrompt(makeCtx());
    assert.equal(typeof out.prompt, "string");
    assert.ok(out.prompt.length > 0);
    assert.equal(out.promptVersion, PROMPT_BUILDER_VERSION);
  });

  it("es determinístico: mismo contexto → mismo prompt", () => {
    const a = buildSessionAnalysisPrompt(makeCtx()).prompt;
    const b = buildSessionAnalysisPrompt(makeCtx()).prompt;
    assert.equal(a, b);
  });

  it("valida contexto", () => {
    assert.throws(() => buildSessionAnalysisPrompt(), TypeError);
    assert.throws(() => buildSessionAnalysisPrompt(null), TypeError);
    assert.throws(() => buildSessionAnalysisPrompt({ schema_version: "999" }), TypeError);
  });
});

describe("promptBuilder — español + reglas explícitas", () => {
  it("está redactado en español (system rules)", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    // Palabras clave inequívocamente españolas del bloque de reglas.
    for (const w of ["español", "profesional", "sesión", "MenteActiva"]) {
      assert.ok(prompt.includes(w), `prompt debe contener '${w}'`);
    }
  });

  it("prohíbe diagnóstico y patologías", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    const lc = prompt.toLowerCase();
    assert.ok(lc.includes("no diagnostiques"));
    for (const w of ["patologías", "demencia", "alzheimer", "deterioro cognitivo", "mci"]) {
      assert.ok(lc.includes(w), `prompt debe listar '${w}' como prohibido`);
    }
  });

  it("prohíbe recomendar tratamiento/medicación", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    const lc = prompt.toLowerCase();
    assert.ok(lc.includes("no recomiendes"));
    assert.ok(lc.includes("tratamientos"));
    assert.ok(lc.includes("medicación"));
  });

  it("prohíbe inventar umbrales/clasificaciones y recalcular métricas", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    const lc = prompt.toLowerCase();
    assert.ok(lc.includes("no inventes umbrales"));
    assert.ok(lc.includes("no recalcules"));
    for (const w of ["rápido", "lento", "normal", "anormal", "bueno", "malo", "prometedor", "preocupante"]) {
      assert.ok(lc.includes(w), `prompt debe listar '${w}' en las clasificaciones prohibidas`);
    }
  });

  it("usa el término 'Aspectos a revisar' (decisión 7C §4)", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(prompt.includes("Aspectos a revisar"));
    assert.ok(!prompt.toLowerCase().includes("áreas a monitorear"));
    assert.ok(!prompt.toLowerCase().includes("areas a monitorear"));
  });

  it("pide salida JSON con schema v1 estricto y sin markdown", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(prompt.includes("JSON"));
    assert.ok(prompt.includes("sin markdown"));
    assert.ok(prompt.includes("EXACTAMENTE estos campos"));
    assert.ok(prompt.includes("schema_version"));
    assert.ok(prompt.includes("observations_by_section"));
    assert.ok(prompt.includes("aspects_to_review"));
    assert.ok(prompt.includes("evidence"));
  });

  it("prohíbe confidence/risk/diagnosis/severity/probability/score/recommendations/patterns", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    for (const w of ["confidence", "risk", "diagnosis", "severity", "probability", "score", "recommendations", "patterns"]) {
      assert.ok(prompt.includes(w), `prompt debe listar '${w}' como prohibido`);
    }
  });

  it("prohíbe comparaciones normativas por edad", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(prompt.includes("comparaciones normativas por edad"));
  });

  it("promptVersion es 1.2 (Etapa 7J.1A — calidad y fuentes cerradas)", () => {
    const { promptVersion } = buildSessionAnalysisPrompt(makeCtx());
    assert.equal(promptVersion, "1.2");
  });

  it("exige al menos 1 elemento en evidence (ajuste previo a 7F)", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(/AL MENOS 1 elemento/i.test(prompt));
  });

  it("evidence — Forma A (GLOBAL) prohíbe section_slug de forma explícita (7I opción A)", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    // Debe aparecer una cláusula que describa la forma GLOBAL con exactamente
    // tres claves y que prohíba section_slug en ese caso.
    assert.ok(/Forma A/i.test(prompt), "prompt debe rotular la forma GLOBAL como 'Forma A'");
    assert.ok(/EXACTAMENTE tres claves: scope, metric, value/.test(prompt),
      "Forma A debe declarar exactamente {scope, metric, value}");
    assert.ok(/NUNCA incluir section_slug/.test(prompt),
      "Forma A debe prohibir section_slug de manera positiva");
    // Ejemplo canónico GLOBAL.
    assert.ok(prompt.includes('{"scope":"global","metric":"accuracy","value":0.5}'),
      "prompt debe traer un ejemplo válido GLOBAL sin section_slug");
  });

  it("evidence — Forma B (SECTION) exige section_slug con ejemplo canónico (7I opción A)", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(/Forma B/i.test(prompt), "prompt debe rotular la forma SECTION como 'Forma B'");
    assert.ok(/EXACTAMENTE cuatro claves: scope, metric, value, section_slug/.test(prompt),
      "Forma B debe declarar exactamente {scope, metric, value, section_slug}");
    assert.ok(/section_slug es OBLIGATORIO/.test(prompt),
      "Forma B debe marcar section_slug como obligatorio en esa forma");
    // Ejemplo canónico SECTION.
    assert.ok(prompt.includes('{"scope":"section","metric":"accuracy","value":0.5,"section_slug":"orientacion_temporal"}'),
      "prompt debe traer un ejemplo válido SECTION con section_slug");
  });

  it("evidence — mezclar ambas formas invalida toda la respuesta (7I opción A)", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    // La cláusula anti-mezcla debe estar presente y ser inequívoca.
    assert.ok(/mezclar ambas/i.test(prompt),
      "prompt debe advertir que mezclar las dos formas invalida la respuesta");
    assert.ok(/invalida TODA la respuesta/.test(prompt),
      "prompt debe reforzar que la mezcla invalida la respuesta completa");
  });

  // ---------- 7J.1A: calidad del contenido ----------

  it("SYSTEM_RULES tiene reglas numeradas y visibles (7J.1A)", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    for (const label of ["REGLA 1", "REGLA 2", "REGLA 3", "REGLA 4", "REGLA 5", "REGLA 6", "REGLA 7", "REGLA 8", "REGLA 9", "REGLA 10"]) {
      assert.ok(prompt.includes(label), `prompt debe listar '${label}' como marcador de regla`);
    }
  });

  it("REGLA 6 exige lenguaje descriptivo con fórmulas aceptables (7J.1A)", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(/LENGUAJE DESCRIPTIVO/.test(prompt), "prompt debe rotular REGLA 6 con 'LENGUAJE DESCRIPTIVO'");
    // Fórmulas descriptivas concretas.
    assert.ok(prompt.includes("Respondió correctamente 2 de 4 preguntas."),
      "REGLA 6 debe traer una fórmula descriptiva ejemplar sobre respuestas");
    assert.ok(prompt.includes("La precisión registrada fue del 50%."),
      "REGLA 6 debe traer una fórmula descriptiva ejemplar sobre precisión");
    assert.ok(prompt.includes("La latencia media registrada fue de 3233 ms."),
      "REGLA 6 debe traer una fórmula descriptiva ejemplar sobre latencia");
  });

  it("REGLA 7 prohíbe vocabulario evaluativo/comparativo extendido (7J.1A)", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(/PROHIBICIÓN DE INTERPRETACIÓN NORMATIVA/.test(prompt),
      "prompt debe rotular REGLA 7 con 'PROHIBICIÓN DE INTERPRETACIÓN NORMATIVA'");
    // La lista de términos prohibidos debe cubrir los observados en analysis 230
    // y variantes morfológicas comunes.
    const bannedWords = [
      "alto", "alta", "elevado", "elevada",
      "bajo", "baja", "reducido", "reducida",
      "rápido", "rápida", "lento", "lenta",
      "bueno", "buena", "buenos", "buenas", "malo", "mala",
      "adecuado", "adecuada", "inadecuado",
      "normal", "anormal",
      "prometedor", "preocupante",
      "mejor", "peor",
      "esperado", "esperada", "inesperado",
      "ligeramente", "moderadamente", "levemente", "relativamente",
      "óptimo", "deficiente",
    ];
    for (const w of bannedWords) {
      assert.ok(prompt.includes(w), `REGLA 7 debe listar '${w}' como prohibido`);
    }
    // Frases construidas explícitamente rechazadas.
    assert.ok(prompt.includes("buena capacidad"),
      "REGLA 7 debe rechazar explícitamente la frase 'buena capacidad'");
    assert.ok(prompt.includes("baja precisión"),
      "REGLA 7 debe rechazar explícitamente la frase 'baja precisión'");
    assert.ok(prompt.includes("latencia elevada"),
      "REGLA 7 debe rechazar explícitamente la frase 'latencia elevada'");
    assert.ok(prompt.includes("bajo rendimiento"),
      "REGLA 7 debe rechazar explícitamente la frase 'bajo rendimiento'");
  });

  it("REGLA 8 restringe fuentes cerradas a COGNITIVE_DOMAINS_TOUCHED y sections (7J.1A)", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(/FUENTES CERRADAS/.test(prompt), "prompt debe rotular REGLA 8 con 'FUENTES CERRADAS'");
    assert.ok(/COGNITIVE_DOMAINS_TOUCHED/.test(prompt),
      "REGLA 8 debe nombrar COGNITIVE_DOMAINS_TOUCHED como fuente única");
    assert.ok(/section_slug/.test(prompt),
      "REGLA 8 debe restringir section_slug a los del contexto");
    assert.ok(/conocimiento general/.test(prompt),
      "REGLA 8 debe prohibir completar categorías con conocimiento general");
    // Ejemplo concreto que orienta al modelo.
    assert.ok(/orientacion.*no mencionar 'memoria'/s.test(prompt) || prompt.includes("no mencionar 'memoria'"),
      "REGLA 8 debe ejemplificar que si COGNITIVE_DOMAINS_TOUCHED=[orientacion], no se pueden nombrar otros dominios");
  });

  it("REGLA 9 exige summary factual con contenido cerrado (7J.1A)", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(/SUMMARY FACTUAL/.test(prompt), "prompt debe rotular REGLA 9 con 'SUMMARY FACTUAL'");
    assert.ok(/Sin inferencias sobre capacidad, estado ni desempeño/.test(prompt),
      "REGLA 9 debe prohibir inferencias sobre capacidad/estado/desempeño en el summary");
  });

  it("REGLA 10 restringe aspects_to_review a métricas registradas (7J.1A)", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(/ASPECTS_TO_REVIEW SIN VALORACIÓN/.test(prompt),
      "prompt debe rotular REGLA 10 con 'ASPECTS_TO_REVIEW SIN VALORACIÓN'");
    assert.ok(prompt.includes("Precisión registrada: 50%"),
      "REGLA 10 debe traer un ejemplo aceptable estilo 'Precisión registrada: 50%'");
    assert.ok(prompt.includes("Latencia media registrada: 3233 ms"),
      "REGLA 10 debe traer un ejemplo aceptable estilo 'Latencia media registrada: 3233 ms'");
    assert.ok(prompt.includes("Baja precisión"),
      "REGLA 10 debe declarar 'Baja precisión' como no aceptable");
    assert.ok(prompt.includes("Dificultades de orientación"),
      "REGLA 10 debe declarar 'Dificultades de orientación' como no aceptable");
  });

  it("prompt incluye un EJEMPLO POSITIVO y un EJEMPLO NEGATIVO (7J.1A)", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(/EJEMPLO POSITIVO/.test(prompt), "prompt debe incluir un bloque 'EJEMPLO POSITIVO'");
    assert.ok(/EJEMPLO NEGATIVO/.test(prompt), "prompt debe incluir un bloque 'EJEMPLO NEGATIVO'");
    // El ejemplo negativo debe explicar por qué se rechaza, citando reglas violadas.
    assert.ok(/viola REGLA 7/.test(prompt),
      "EJEMPLO NEGATIVO debe citar REGLA 7 como razón de rechazo");
    assert.ok(/viola REGLA 8/.test(prompt),
      "EJEMPLO NEGATIVO debe citar REGLA 8 como razón de rechazo");
  });

  it("no incluye session id ni patient_age en la línea SESSION (7E §0 + 7G §4)", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    const sessionLine = prompt.split("\n").find((l) => l.startsWith("SESSION"));
    assert.ok(sessionLine, "debe existir línea SESSION");
    assert.ok(!/\bid=/.test(sessionLine), "SESSION no debe contener 'id='");
    assert.ok(!sessionLine.includes("patient_age"), "SESSION no debe contener 'patient_age'");
    assert.ok(sessionLine.includes("duration_seconds="));
  });

  it("prompt entero no menciona edad del paciente (7G §4)", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(!/patient_age/.test(prompt));
  });
});

describe("promptBuilder — métricas y no-filtración", () => {
  it("incluye las métricas globales textualmente (números exactos)", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(prompt.includes("accuracy=0.8"));
    assert.ok(prompt.includes("mean_latency_ms=4200"));
    assert.ok(prompt.includes("completion_rate=1"));
  });

  it("incluye slug, name y dominios cognitivos de cada sección", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx());
    assert.ok(prompt.includes("slug=atencion_visual"));
    assert.ok(prompt.includes('name="Objetos de la casa"'));
    assert.ok(prompt.includes("cognitive_domains=[atencion,memoria]"));
  });

  it("NO contiene PII ni datos excluidos", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx({
      // Ni siquiera el contextBuilder los expone, pero test defensivo:
    }));
    for (const forbidden of [
      "correct_answer", "correct_answer_snapshot",
      "prompt_snapshot", "stimulus_snapshot",
      "feedback_correct", "feedback_incorrect",
      "selected_answer", "professional_id",
      "email", "password", "google_id", "jwt", "token",
    ]) {
      assert.ok(!prompt.includes(forbidden), `prompt no debe contener '${forbidden}'`);
    }
  });

  it("cuando la sección no tiene dominios, indica sin_dominios_asociados sin inventar clasificación", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx({
      sections: [
        {
          slug: "seccion_x",
          name: "Sección X",
          cognitive_domain_slugs: [],
          result: {
            total_questions: 3,
            answered_questions: 3,
            correct_count: 0,
            incorrect_count: 3,
            unanswered_count: 0,
            accuracy: 0,
            completion_rate: 1,
            mean_latency_ms: 4200,
            min_latency_ms: 100,
            max_latency_ms: 8000,
            latency_std_ms: 200,
          },
        },
      ],
    }));
    assert.ok(prompt.includes("cognitive_domains=[sin_dominios_asociados]"));
  });

  it("no clasifica cualitativamente accuracy=0 ni latencias en el prompt (regresión hallazgo 7B)", () => {
    const { prompt } = buildSessionAnalysisPrompt(makeCtx({
      sections: [
        {
          slug: "s",
          name: "S",
          cognitive_domain_slugs: ["atencion"],
          result: {
            total_questions: 1, answered_questions: 1, correct_count: 0, incorrect_count: 1,
            unanswered_count: 0, accuracy: 0, completion_rate: 1,
            mean_latency_ms: 4200, min_latency_ms: 4200, max_latency_ms: 4200, latency_std_ms: 0,
          },
        },
      ],
    }));
    // El prompt lista esas palabras COMO PROHIBIDAS. Verificamos que aparezcan
    // sólo dentro de la sección de reglas, no como etiquetado de una métrica.
    // Test más simple: los datos serializados (accuracy=…, latencia=…) NO deben
    // co-ocurrir con adjetivos evaluativos en la MISMA línea.
    const lines = prompt.split("\n");
    for (const line of lines) {
      if (/^GLOBAL:|^SECTION /.test(line)) {
        const lc = line.toLowerCase();
        for (const w of ["rápido", "lento", "bueno", "malo", "óptimo", "prometedor"]) {
          assert.ok(!lc.includes(w), `línea de datos '${line}' no puede clasificar con '${w}'`);
        }
      }
    }
  });
});
