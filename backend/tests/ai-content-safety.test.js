// Seguridad del contenido IA (auditoría 2026-11-04).
//
// Tests puros (sin DB). Cubren:
//  - regresión con los 8 textos reales persistidos en producción;
//  - variantes generadas (singular/plural, tildes, mayúsculas, negación)
//    para no depender de una lista rígida de frases;
//  - falsos positivos: todas las frases determinísticas del backend y los
//    nombres de actividades deben aceptarse;
//  - anclaje (grounding) a las observaciones de la sesión;
//  - protección al leer análisis persistidos.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CLAIM_FAMILIES,
  RETRIABLE_SEMANTIC_REASONS,
  buildSupportedStems,
  findForbiddenClaim,
  findUngroundedSentence,
  normalizeText,
  reviewStoredAnalysis,
  withholdNonCompliantText,
} from "../src/services/ai/contentSafety.js";
import { parseAndValidateSessionAnalysis } from "../src/services/ai/responseValidator.js";
import { AnalysisValidationCodes as CODES } from "../src/services/ai/validationErrors.js";

const PROD = JSON.parse(
  readFileSync(new URL("./fixtures/ai-outputs-prod-2026-11.json", import.meta.url), "utf8")
).analyses;

const SECTION_NAMES = [
  "Memoria de trabajo", "Atención y cálculo", "Funciones ejecutivas", "Orientación temporal",
  "Memoria asociativa", "Metacognición", "Memoria prospectiva", "Atención visual",
  "Comprensión funcional", "Orientación espacial",
  "Lista del supermercado", "Pagar el boleto", "Ordenar una receta", "Agenda de turnos",
  "Caras y nombres", "Cómo me siento hoy", "Tomar la medicación", "Objetos de la casa",
  "Mensajes y llamadas", "Camino al barrio",
];

// Todas las frases literales que observationsBuilder.js puede emitir. Se
// leen del código fuente para que una frase nueva quede cubierta sin
// actualizar este test.
function deterministicPhrases() {
  const src = readFileSync(new URL("../src/services/ai/observationsBuilder.js", import.meta.url), "utf8");
  const phrases = [...src.matchAll(/"([A-ZÁÉÍÓÚÑ][^"]{20,})"/g)].map((m) => m[1]);
  assert.ok(phrases.length >= 15, "se esperaban las frases del observationsBuilder");
  return phrases;
}

describe("contentSafety — normalización", () => {
  it("quita tildes, pasa a minúsculas y colapsa espacios", () => {
    assert.equal(normalizeText("  PATOLOGÍAS   Clínicas\n"), "patologias clinicas");
    assert.equal(normalizeText(null), "");
  });
});

describe("contentSafety — regresión con textos reales de producción", () => {
  for (const a of PROD) {
    it(`${a.label}: el texto persistido no cumple las reglas vigentes`, () => {
      const review = reviewStoredAnalysis({ schema_version: "3", ...a });
      assert.equal(review.compliant, false);
      assert.ok(review.reasons.length > 0);
    });
  }

  it("el caso reportado (sesión del 4/11) se rechaza como descarte clínico", () => {
    const hit = findForbiddenClaim("No se detectaron patologías ni condiciones clínicas en esta sesión aislada.");
    assert.equal(hit?.reason, "clinical_rule_out");
  });

  it("el validador rechaza el output exacto de la sesión del 4/11", () => {
    const a = PROD.find((x) => x.label === "analysis-8");
    assert.throws(
      () => parseAndValidateSessionAnalysis(
        JSON.stringify({ schema_version: "3", summary: a.summary, aspects_to_review: a.aspects_to_review }),
        { sections: [] }
      ),
      (err) => err.code === CODES.SCHEMA_INVALID && err.info?.reason === "clinical_rule_out"
    );
  });
});

// Variantes generadas: cada concepto se prueba en singular/plural, con y sin
// tildes y en mayúsculas, dentro de oraciones distintas.
const VARIANT_CASES = {
  clinical_rule_out: [
    "No se detectó {x} en la actividad.",
    "Los resultados descartan {x}.",
    "No hay indicios de {x} durante la sesión.",
    "Sin signos de {x}.",
  ],
  forbidden_clinical_term: [
    "Se observa {x} durante la sesión.",
    "Podría tratarse de {x}.",
  ],
};
const CLINICAL_NOUNS = [
  "patología", "patologías", "patologia", "PATOLOGÍAS", "enfermedad", "enfermedades",
  "demencia", "deterioro cognitivo", "trastornos de memoria", "síndrome", "déficit",
  "condiciones clínicas", "condición médica", "síntomas",
];

describe("contentSafety — variantes generadas de afirmaciones clínicas", () => {
  for (const [expected, templates] of Object.entries(VARIANT_CASES)) {
    for (const t of templates) {
      for (const noun of CLINICAL_NOUNS) {
        const text = t.replace("{x}", noun);
        it(`rechaza: ${text}`, () => {
          const hit = findForbiddenClaim(text);
          assert.ok(hit, `no detectó: ${text}`);
          if (expected === "clinical_rule_out") {
            assert.ok(["clinical_rule_out", "forbidden_clinical_term"].includes(hit.reason));
          }
        });
      }
    }
  }
});

describe("contentSafety — familias no clínicas", () => {
  const cases = [
    ["therapeutic_or_improvement_claim", "Revisar la eficacia de la actividad en la memoria."],
    ["therapeutic_or_improvement_claim", "La memoria mejoró gracias al entrenamiento."],
    ["therapeutic_or_improvement_claim", "Ajustar el ritmo para MEJORAR LA ATENCIÓN del paciente."],
    ["therapeutic_or_improvement_claim", "Se observó una mejora en la precisión respecto de la sesión anterior."],
    ["therapeutic_or_improvement_claim", "La actividad funciona como terapia complementaria."],
    ["therapeutic_or_improvement_claim", "Considerar ajustar la medicación del paciente."],
    ["capacity_attribution", "Revisar la capacidad del paciente para tomar decisiones."],
    ["capacity_attribution", "Considerar las habilidades cognitivas involucradas."],
    ["capacity_attribution", "Revisar la relación entre la actividad y la atención del paciente."],
    ["capacity_attribution", "El rendimiento cognitivo fue estable."],
    ["evaluative_judgment", "La sesión se completó con éxito."],
    ["evaluative_judgment", "El resultado fue satisfactorio."],
    ["evaluative_judgment", "Mantener la precisión en un nivel óptimo."],
    ["evaluative_judgment", "Mostró una memoria conservada."],
    ["speculative_interpretation", "El aumento podría deberse a factores externos."],
    ["speculative_interpretation", "Esto sugiere que la actividad se mantuvo estable."],
    ["prompt_rule_echo", "La actividad se describió sin juicios evaluativos."],
    ["prompt_rule_echo", "Una sesión aislada no permite conclusiones."],
    ["unauthorized_observation_about_actor", "El profesional observó que la lista fue retenida."],
  ];
  for (const [reason, text] of cases) {
    it(`${reason}: ${text}`, () => {
      assert.equal(findForbiddenClaim(text)?.reason, reason);
    });
  }
});

describe("contentSafety — falsos positivos", () => {
  it("acepta todas las frases determinísticas del backend", () => {
    for (const p of deterministicPhrases()) {
      assert.equal(findForbiddenClaim(p), null, `falso positivo: ${p}`);
    }
  });

  it("acepta los nombres de todas las actividades", () => {
    for (const n of SECTION_NAMES) {
      assert.equal(findForbiddenClaim(`Se realizó la actividad ${n}.`), null, n);
    }
  });

  const valid = [
    "La sesión de estimulación cognitiva se completó en su totalidad, pero se registraron más respuestas incorrectas que correctas en la actividad de memoria prospectiva.",
    "En la actividad Caras y nombres se registraron más respuestas correctas que incorrectas.",
    "La actividad trabajó la atención y la memoria durante la sesión.",
    "Todavía no hay sesiones comparables para describir una tendencia.",
    "Se registraron preguntas sin responder durante la sesión.",
  ];
  for (const v of valid) {
    it(`acepta paráfrasis descriptiva: ${v.slice(0, 50)}…`, () => {
      assert.equal(findForbiddenClaim(v), null);
    });
  }
});

describe("contentSafety — anclaje a las observaciones", () => {
  const stems = buildSupportedStems({
    observations: [
      "La sesión fue completada en su totalidad.",
      "Se registraron más respuestas correctas que incorrectas.",
      "No existen todavía sesiones comparables para describir una tendencia.",
    ],
    followUp: ["Se requieren nuevas sesiones comparables para observar la evolución del desempeño."],
    activityNames: ["Funciones ejecutivas", "funciones_ejecutivas"],
  });

  it("acepta una paráfrasis fiel de las observaciones", () => {
    const s = "En la actividad Funciones ejecutivas la sesión se completó en su totalidad y se registraron más respuestas correctas que incorrectas. Todavía no hay sesiones comparables para observar una tendencia.";
    assert.equal(findUngroundedSentence(s, stems), null);
  });

  it("rechaza una oración sin respaldo aunque no use términos prohibidos", () => {
    const s = "La actividad resultó entretenida y despertó interés durante el recorrido propuesto.";
    const out = findUngroundedSentence(s, stems);
    assert.ok(out);
    assert.ok(out.unsupported.includes("interes"));
  });

  it("rechaza recomendaciones inventadas para el profesional", () => {
    const s = "En la próxima sesión, el profesional podría revisar los detalles de la actividad y ajustar la estrategia según sea necesario.";
    assert.ok(findUngroundedSentence(s, stems));
  });

  it("el validador aplica el anclaje sólo si recibe observaciones", () => {
    const raw = JSON.stringify({
      schema_version: "3",
      summary: "La actividad resultó entretenida y despertó interés durante el recorrido propuesto.",
    });
    const ctx = { sections: [{ slug: "funciones_ejecutivas", name: "Funciones ejecutivas" }] };
    assert.ok(parseAndValidateSessionAnalysis(raw, ctx).summary);
    assert.throws(
      () => parseAndValidateSessionAnalysis(raw, ctx, { observations: ["La sesión fue completada en su totalidad."] }),
      (err) => err.code === CODES.SCHEMA_INVALID && err.info?.reason === "ungrounded_statement"
    );
  });
});

describe("contentSafety — protección al leer", () => {
  const deterministic = {
    activities: [{ slug: "funciones_ejecutivas", name: "Funciones ejecutivas", cognitive_domain_slugs: ["memoria"] }],
    evidence: [
      { scope: "global", metric: "total_questions", value: 4 },
      { scope: "global", metric: "correct_answers", value: 4 },
      { scope: "global", metric: "incorrect_answers", value: 0 },
      { scope: "global", metric: "completion_rate", value: 1 },
    ],
    observations: ["La sesión fue completada en su totalidad."],
    follow_up: ["Se requieren nuevas sesiones comparables para observar la evolución del desempeño."],
  };

  it("un análisis conforme se devuelve sin cambios (misma referencia)", () => {
    const content = { schema_version: "3", summary: "La sesión fue completada en su totalidad.", aspects_to_review: [], ...deterministic };
    const out = withholdNonCompliantText(content);
    assert.equal(out.withheld, false);
    assert.equal(out.content, content);
  });

  it("v3 no conforme: omite summary y aspects y conserva los bloques determinísticos sin mutar el original", () => {
    const content = { schema_version: "3", ...PROD[7], ...deterministic };
    const snapshot = structuredClone(content);
    const out = withholdNonCompliantText(content);
    assert.equal(out.withheld, true);
    assert.equal(out.content.summary, undefined);
    assert.equal(out.content.aspects_to_review, undefined);
    assert.deepEqual(out.content.observations, deterministic.observations);
    assert.deepEqual(out.content.evidence, deterministic.evidence);
    assert.deepEqual(content, snapshot);
  });

  it("detecta oraciones sin anclaje en análisis v3.4 persistidos", () => {
    const content = {
      schema_version: "3",
      summary: "La actividad resultó entretenida y despertó interés durante el recorrido propuesto.",
      ...deterministic,
    };
    assert.deepEqual(reviewStoredAnalysis(content).reasons, ["ungrounded_statement"]);
  });

  it("contratos legacy: revisa y omite todos los campos redactados por el modelo", () => {
    const content = {
      schema_version: "2",
      summary: "Resumen descriptivo.",
      observations_by_section: [{ section_slug: "x", text: "Sin signos de deterioro." }],
      comparison: "Texto comparativo.",
      evidence: [{ metric: "accuracy", value: 1 }],
    };
    const out = withholdNonCompliantText(content);
    assert.equal(out.withheld, true);
    assert.equal(out.content.observations_by_section, undefined);
    assert.equal(out.content.summary, undefined);
    assert.equal(out.content.comparison, undefined);
    assert.deepEqual(out.content.evidence, content.evidence);
  });

  it("detecta en análisis persistidos texto que contradice la evidencia guardada", () => {
    // La evidencia registra 4 correctas y 0 incorrectas.
    const content = {
      schema_version: "3",
      summary: "La sesión fue completada en su totalidad y se registraron más respuestas incorrectas que correctas.",
      ...deterministic,
    };
    const review = reviewStoredAnalysis(content);
    assert.equal(review.compliant, false);
    assert.ok(review.reasons.includes("contradicts_recorded_data"));
  });

  it("tolera contenido vacío o nulo", () => {
    assert.deepEqual(reviewStoredAnalysis(null), { compliant: true, reasons: [] });
    assert.equal(withholdNonCompliantText(null).withheld, false);
  });
});

describe("contentSafety — reintentos", () => {
  it("todas las familias y el anclaje son reintenciables", () => {
    for (const f of CLAIM_FAMILIES) assert.ok(RETRIABLE_SEMANTIC_REASONS.has(f.reason), f.reason);
    for (const r of ["ungrounded_statement", "numeric_metric_in_text", "max_length_exceeded"]) {
      assert.ok(RETRIABLE_SEMANTIC_REASONS.has(r), r);
    }
  });
});
