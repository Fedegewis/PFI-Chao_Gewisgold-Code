// 3.6 — Materiales de generación compartidos por los dos caminos (in-process
// en analysisService y worker en analysisQueue).
//
// A partir del contexto (contextBuilder) y del input crudo de la sesión
// (loadSessionAnalysisInput) arma, en un solo lugar:
//   - las observaciones determinísticas (observationsBuilder),
//   - los hechos enriquecidos (sessionFacts),
//   - el prompt,
//   - las opciones de validación,
//   - los campos determinísticos que se persisten junto al texto del modelo.
// Así un mismo texto del modelo recibe exactamente la misma decisión por
// cualquiera de los dos caminos, y la revisión al leer usa los mismos hechos
// que vio el modelo.
//
// Función pura: sin DB, sin red, sin process.env.

import { buildObservations } from "./observationsBuilder.js";
import { buildSessionFacts } from "./sessionFacts.js";
import { buildSessionAnalysisPrompt } from "./promptBuilder.js";
import { AI_CONTRACT_V36, GENERATION_VALIDATION_OPTIONS } from "./contentSafety.js";

/**
 * @param {object} context  Salida de buildSessionAnalysisContext.
 * @param {object} [input]  Salida de loadSessionAnalysisInput (question_details,
 *   adaptive_level, same_activity_previous_count). Si falta, los hechos
 *   enriquecidos quedan vacíos y el prompt usa sólo las observaciones.
 */
export function buildAnalysisMaterials(context, input = {}) {
  const deterministic = buildObservations(context);
  const facts = buildSessionFacts(context, {
    questionDetails: input?.question_details,
    adaptiveLevel: input?.adaptive_level ?? null,
    sameActivityPreviousCount: input?.same_activity_previous_count,
  });
  // Las observaciones sólo se pasan como respaldo: con hechos enriquecidos
  // el prompt NO las incluye (el 3B las copiaba textuales).
  const { prompt, promptVersion, outputSchema } = buildSessionAnalysisPrompt(context, {
    observations: deterministic.observations,
    facts,
  });
  const validationOptions = {
    observations: deterministic.observations,
    followUp: deterministic.follow_up,
    factSentences: facts.sentences,
    detail: facts.sheet,
    ...GENERATION_VALIDATION_OPTIONS,
  };
  const persistExtras = {
    observations: deterministic.observations,
    follow_up: deterministic.follow_up,
    // Marca de contrato y hechos que vio el modelo: la revisión al leer
    // (contentSafety.withholdNonCompliantText) los usa para evaluar el texto
    // con las mismas reglas que en la generación.
    ai_contract: AI_CONTRACT_V36,
    context_facts: facts.sentences,
    facts_sheet: facts.sheet,
  };
  // Suficiencia (3.6, ajuste): sin al menos un tipo de pregunta con
  // respuestas puntuadas, la síntesis sólo repetiría los bloques
  // determinísticos. En ese caso no se llama al modelo y se persiste un
  // resultado identificado como determinístico (deterministicAnalysis).
  const sufficient = facts.sufficient === true;
  return { deterministic, facts, prompt, promptVersion, outputSchema, sufficient, validationOptions, persistExtras };
}

export const SYNTHESIS_SKIPPED_INSUFFICIENT = "insufficient_data";

/**
 * Contenido persistible cuando no se pide síntesis al modelo. No contiene
 * texto redactado: summary vacío, sin aspectos, y `synthesis_source:
 * "deterministic"` para que la API y el panel nunca lo presenten como IA.
 */
export function deterministicAnalysis(materials, deterministicFields) {
  return {
    schema_version: "3",
    summary: "",
    aspects_to_review: [],
    synthesis_source: "deterministic",
    synthesis_skipped_reason: SYNTHESIS_SKIPPED_INSUFFICIENT,
    ...deterministicFields,
    ...materials.persistExtras,
  };
}
