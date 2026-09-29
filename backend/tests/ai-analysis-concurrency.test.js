// 7J.1B — Serialización de generaciones de análisis concurrentes.
//
// Los tests inyectan un mock de `generateFn` (cliente Ollama) que espera un
// tiempo controlado antes de resolver. Con eso reproducimos la ventana en la
// que dos POST casi simultáneos habrían disparado dos inferencias.
//
// Corren contra menteactiva_test (aislada por NODE_ENV=test + fail-closed
// en knexfile). menteactiva y session 4610 quedan intocadas.

import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import db from "../src/db/connection.js";
import {
  generateSessionAnalysis,
} from "../src/services/ai/analysisService.js";
import { buildAnalysisLockKey } from "../src/services/ai/analysisLock.js";
import { ANALYSIS_SCHEMA_VERSION } from "../src/services/ai/responseValidator.js";
import { PROMPT_BUILDER_VERSION } from "../src/services/ai/promptBuilder.js";

const EMAIL_SUFFIX = "@analysis-concurrency.test.com";
const MODEL = "test-model-concurrency";

let profA;
let patientA;
let sectionRow;
let sessionRow;
let secondSessionRow;

async function cleanTestData() {
  const patientIds = () => db("users").select("id").where("email", "like", `%${EMAIL_SUFFIX}`);
  const sessionIds = () => db("sessions").select("id").whereIn("patient_id", patientIds());
  await db("session_analyses").whereIn("session_id", sessionIds()).del();
  const sectionIds = () => db("session_sections").select("id").whereIn("session_id", sessionIds());
  const sqIds = () => db("session_questions").select("id").whereIn("session_section_id", sectionIds());
  await db("answers").whereIn("session_question_id", sqIds()).del();
  await db("session_results").whereIn("session_id", sessionIds()).del();
  await db("session_questions").whereIn("session_section_id", sectionIds()).del();
  await db("session_sections").whereIn("session_id", sessionIds()).del();
  await db("sessions").whereIn("patient_id", patientIds()).del();
  await db("users").where("email", "like", `%${EMAIL_SUFFIX}`).del();
}

async function insertCompletedSession() {
  const [s] = await db("sessions")
    .insert({
      patient_id: patientA.id,
      professional_id: profA.id,
      status: "completed",
      started_at: new Date(),
      completed_at: new Date(),
    })
    .returning("*");
  await db("session_sections")
    .insert({ session_id: s.id, section_id: sectionRow.id, requested_count: 4, display_order: 1 });
  // session_results por sección + global.
  const metrics = {
    total_questions: 4, answered_questions: 4,
    correct_count: 2, incorrect_count: 2, unanswered_count: 0,
    accuracy: 0.5, completion_rate: 1,
    mean_latency_ms: 1500, min_latency_ms: 900, max_latency_ms: 2100, latency_std_ms: 400,
  };
  await db("session_results").insert([
    { session_id: s.id, section_id: sectionRow.id, ...metrics },
    { session_id: s.id, section_id: null, ...metrics },
  ]);
  return s;
}

function makeGenerateStub({ delayMs = 100, validJson = true } = {}) {
  let callCount = 0;
  const stub = async () => {
    callCount += 1;
    await new Promise((r) => setTimeout(r, delayMs));
    const text = validJson
      ? JSON.stringify({
          schema_version: "1",
          summary: "Sesión con métricas registradas.",
          observations_by_section: [
            {
              section_slug: sectionRow.slug,
              observation: "Respondió 4 preguntas; 2 correctas y 2 incorrectas; latencia media 1500 ms.",
            },
          ],
          aspects_to_review: ["Precisión registrada: 50%"],
          evidence: [
            { scope: "global", metric: "accuracy", value: 0.5 },
          ],
        })
      : "not json at all";
    return { text, raw: {}, latencyMs: delayMs, model: MODEL };
  };
  return { stub, getCallCount: () => callCount };
}

function deps(generateFn, overrides = {}) {
  return {
    generate: generateFn,
    config: { model: MODEL, url: "http://x", timeoutMs: 5000, enabled: true },
    ...overrides,
  };
}

describe("7J.1B — Advisory lock por identidad de análisis", () => {
  before(async () => {
    await cleanTestData();
    const stamp = Date.now();
    [profA] = await db("users")
      .insert({ role: "professional", name: "Prof C", email: `prof-${stamp}${EMAIL_SUFFIX}` })
      .returning("*");
    [patientA] = await db("users")
      .insert({ role: "patient", name: "Pat C", email: `pat-${stamp}${EMAIL_SUFFIX}`, professional_id: profA.id, age: 70 })
      .returning("*");
    sectionRow = await db("sections").where({ slug: "orientacion_temporal" }).first();
    sessionRow = await insertCompletedSession();
    secondSessionRow = await insertCompletedSession();
  });

  beforeEach(async () => {
    // Limpia analyses previos de los tests, no de la sesión real 4610.
    await db("session_analyses")
      .whereIn("session_id", [sessionRow.id, secondSessionRow.id])
      .del();
  });

  after(async () => {
    await cleanTestData();
    await db.destroy();
  });

  it("buildAnalysisLockKey es determinístico y depende de la identidad (no de force)", () => {
    const a = buildAnalysisLockKey({ sessionId: 1, model: "m", schemaVersion: "1", promptVersion: "1.2" });
    const b = buildAnalysisLockKey({ sessionId: 1, model: "m", schemaVersion: "1", promptVersion: "1.2" });
    assert.deepEqual(a, b);
    const c = buildAnalysisLockKey({ sessionId: 2, model: "m", schemaVersion: "1", promptVersion: "1.2" });
    assert.notEqual(a.key1, c.key1);
    const d = buildAnalysisLockKey({ sessionId: 1, model: "m", schemaVersion: "1", promptVersion: "1.1" });
    assert.notEqual(a.key2, d.key2, "cambio de prompt_version cambia key2");
  });

  it("dos POST normales concurrentes generan una sola inferencia y ambos reciben resultado válido", async () => {
    const { stub, getCallCount } = makeGenerateStub({ delayMs: 200 });
    const [r1, r2] = await Promise.all([
      generateSessionAnalysis({ sessionId: sessionRow.id, force: false }, deps(stub)),
      generateSessionAnalysis({ sessionId: sessionRow.id, force: false }, deps(stub)),
    ]);
    assert.equal(getCallCount(), 1, "Ollama debió invocarse una sola vez");
    // Uno de los dos es "generated", el otro "cache".
    const sources = [r1.source, r2.source].sort();
    assert.deepEqual(sources, ["cache", "generated"]);
    // Ambos reciben una fila válida con content aprobado.
    for (const r of [r1, r2]) {
      assert.equal(r.analysis.status, "ok");
      assert.equal(r.analysis.session_id, sessionRow.id);
      assert.equal(r.analysis.model, MODEL);
      assert.equal(r.analysis.prompt_version, PROMPT_BUILDER_VERSION);
      assert.equal(r.analysis.schema_version, ANALYSIS_SCHEMA_VERSION);
      assert.equal(r.analysis.analysis.schema_version, "1");
    }
  });

  it("dos force=true concurrentes generan una sola inferencia y el segundo reutiliza al primero", async () => {
    const { stub, getCallCount } = makeGenerateStub({ delayMs: 200 });
    const [r1, r2] = await Promise.all([
      generateSessionAnalysis({ sessionId: sessionRow.id, force: true }, deps(stub)),
      generateSessionAnalysis({ sessionId: sessionRow.id, force: true }, deps(stub)),
    ]);
    assert.equal(getCallCount(), 1, "dos force=true concurrentes: Ollama debió invocarse una sola vez");
    const sources = [r1.source, r2.source].sort();
    assert.deepEqual(sources, ["cache", "generated"]);
  });

  it("force=true posterior a un análisis existente regenera aunque el pre-lock cache tenga una fila", async () => {
    const { stub, getCallCount } = makeGenerateStub({ delayMs: 50 });
    // Primer request: genera y persiste.
    const r1 = await generateSessionAnalysis({ sessionId: sessionRow.id, force: false }, deps(stub));
    assert.equal(r1.source, "generated");
    // Delay para asegurar que el segundo request tiene requestStartedAt > created_at del primero.
    await new Promise((r) => setTimeout(r, 20));
    // Segundo request explícito force=true: regenera pese al cache existente.
    const r2 = await generateSessionAnalysis({ sessionId: sessionRow.id, force: true }, deps(stub));
    assert.equal(r2.source, "generated", "force=true DEBE regenerar cuando no hay concurrencia");
    assert.equal(getCallCount(), 2, "Ollama invocado dos veces (una por cada request secuencial)");
    assert.notEqual(r1.analysis.id, r2.analysis.id);
  });

  it("dos sesiones distintas concurrentes NO se bloquean entre sí", async () => {
    let concurrentPeak = 0;
    let inFlight = 0;
    const stub = async () => {
      inFlight += 1;
      if (inFlight > concurrentPeak) concurrentPeak = inFlight;
      await new Promise((r) => setTimeout(r, 150));
      inFlight -= 1;
      return {
        text: JSON.stringify({
          schema_version: "1",
          summary: "Sesión con métricas registradas.",
          observations_by_section: [
            { section_slug: sectionRow.slug, observation: "Respondió 4 preguntas." },
          ],
          aspects_to_review: [],
          evidence: [{ scope: "global", metric: "accuracy", value: 0.5 }],
        }),
        raw: {},
        latencyMs: 150,
        model: MODEL,
      };
    };
    const [r1, r2] = await Promise.all([
      generateSessionAnalysis({ sessionId: sessionRow.id, force: false }, deps(stub)),
      generateSessionAnalysis({ sessionId: secondSessionRow.id, force: false }, deps(stub)),
    ]);
    assert.equal(r1.source, "generated");
    assert.equal(r2.source, "generated");
    assert.equal(concurrentPeak, 2, "las inferencias de sesiones distintas deben poder correr en paralelo");
  });

  it("si Ollama falla en el primer request, el lock se libera y un segundo request puede reintentar", async () => {
    let call = 0;
    const stub = async () => {
      call += 1;
      if (call === 1) {
        const err = new Error("boom");
        err.code = "OLLAMA_OFFLINE";
        // Simular una excepción tipo OllamaClientError.
        const { OllamaClientError, OllamaErrorCodes } = await import("../src/services/ai/errors.js");
        throw new OllamaClientError(OllamaErrorCodes.OLLAMA_OFFLINE, "boom");
      }
      return {
        text: JSON.stringify({
          schema_version: "1",
          summary: "Sesión con métricas registradas.",
          observations_by_section: [
            { section_slug: sectionRow.slug, observation: "Respondió 4 preguntas." },
          ],
          aspects_to_review: [],
          evidence: [{ scope: "global", metric: "accuracy", value: 0.5 }],
        }),
        raw: {},
        latencyMs: 50,
        model: MODEL,
      };
    };
    // Primer request debe lanzar OllamaClientError.
    await assert.rejects(
      generateSessionAnalysis({ sessionId: sessionRow.id, force: true }, deps(stub)),
      (err) => err && err.code === "OLLAMA_OFFLINE",
    );
    // Segundo request re-adquiere el lock (si no se hubiera liberado, se colgaría),
    // detecta que NO hay fila ok posterior a su start (la fila 1 fue failed) y regenera.
    const r2 = await generateSessionAnalysis({ sessionId: sessionRow.id, force: true }, deps(stub));
    assert.equal(r2.source, "generated");
    assert.equal(r2.analysis.status, "ok");
  });

  it("si el validator rechaza el output del primer request, el lock se libera y el segundo puede reintentar", async () => {
    let call = 0;
    const stub = async () => {
      call += 1;
      if (call === 1) {
        return { text: "not json", raw: {}, latencyMs: 30, model: MODEL };
      }
      return {
        text: JSON.stringify({
          schema_version: "1",
          summary: "Sesión con métricas registradas.",
          observations_by_section: [
            { section_slug: sectionRow.slug, observation: "Respondió 4 preguntas." },
          ],
          aspects_to_review: [],
          evidence: [{ scope: "global", metric: "accuracy", value: 0.5 }],
        }),
        raw: {},
        latencyMs: 30,
        model: MODEL,
      };
    };
    await assert.rejects(
      generateSessionAnalysis({ sessionId: sessionRow.id, force: true }, deps(stub)),
      // AnalysisValidationError esperado
    );
    const r2 = await generateSessionAnalysis({ sessionId: sessionRow.id, force: true }, deps(stub));
    assert.equal(r2.source, "generated");
    assert.equal(r2.analysis.status, "ok");
  });
});
