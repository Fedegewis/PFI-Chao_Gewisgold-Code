// 7F: tests contra PostgreSQL real de la tabla session_analyses + repository.
// Fixtures aisladas: crea un profesional + paciente + sesión ad-hoc, y los
// elimina en el after. session_analyses cascadea al borrar la sesión.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

import db from "../src/db/connection.js";
import {
  createSuccessfulAnalysis,
  createFailedAnalysis,
  getAnalysesForSession,
  sanitizeErrorMessage,
  ANALYSIS_ERROR_MESSAGE_MAX,
} from "../src/services/ai/analysisRepository.js";
import { toPersistedErrorCode, PERSISTED_ERROR_CODES } from "../src/services/ai/errorMapping.js";
import { OllamaErrorCodes } from "../src/services/ai/errors.js";
import { AnalysisValidationCodes } from "../src/services/ai/validationErrors.js";

let professionalId;
let patientId;
let sessionId;
let extraSessionId;

function validAnalysis(overrides = {}) {
  return {
    schema_version: "1",
    summary: "Sesión completa.",
    observations_by_section: [
      { section_slug: "atencion_visual", observation: "5/5 respondidas." },
    ],
    aspects_to_review: [],
    evidence: [{ scope: "global", metric: "accuracy", value: 0.8 }],
    ...overrides,
  };
}

describe("session_analyses (7F)", () => {
  before(async () => {
    const stamp = Date.now();
    const [prof] = await db("users")
      .insert({ role: "professional", name: "Dr Analyses", email: `analyses-prof-${stamp}@test.com` })
      .returning("*");
    professionalId = prof.id;
    const [pat] = await db("users")
      .insert({ role: "patient", name: "Pac Analyses", email: `analyses-pat-${stamp}@test.com`, professional_id: professionalId, age: 70 })
      .returning("*");
    patientId = pat.id;
    const [ses] = await db("sessions")
      .insert({ patient_id: patientId, professional_id: professionalId })
      .returning("*");
    sessionId = ses.id;
    const [ses2] = await db("sessions")
      .insert({ patient_id: patientId, professional_id: professionalId })
      .returning("*");
    extraSessionId = ses2.id;
  });

  after(async () => {
    // El CASCADE en session_id borra los análisis; alcanzamos con borrar sesiones y users.
    await db("sessions").whereIn("id", [sessionId, extraSessionId]).del();
    await db("users").whereIn("id", [patientId, professionalId]).del();
    await db.destroy();
  });

  describe("schema/tabla", () => {
    it("la tabla existe y responde", async () => {
      const rows = await db("session_analyses").limit(1).select("id");
      assert.ok(Array.isArray(rows));
    });
  });

  describe("createSuccessfulAnalysis", () => {
    it("inserta un análisis ok con analysis obligatorio", async () => {
      const row = await createSuccessfulAnalysis(db, {
        sessionId,
        model: "llama3.2:3b",
        schemaVersion: "1",
        promptVersion: "1.0",
        analysis: validAnalysis(),
        latencyMs: 7200,
      });
      assert.equal(row.status, "ok");
      assert.equal(row.error_code, null);
      assert.equal(row.error_message, null);
      assert.equal(row.model, "llama3.2:3b");
      assert.equal(row.schema_version, "1");
      assert.equal(row.prompt_version, "1.0");
      assert.equal(row.latency_ms, 7200);
      assert.equal(row.analysis.summary, "Sesión completa.");
      assert.equal(row.analysis.evidence[0].value, 0.8);
      assert.ok(row.created_at instanceof Date);
    });

    it("rechaza análisis sin schema_version=1 (no fue validado)", async () => {
      await assert.rejects(
        () => createSuccessfulAnalysis(db, {
          sessionId,
          model: "m", schemaVersion: "1", promptVersion: "1.0",
          analysis: { summary: "x" },
          latencyMs: 100,
        }),
        TypeError
      );
    });

    it("rechaza sessionId inválido", async () => {
      await assert.rejects(
        () => createSuccessfulAnalysis(db, {
          sessionId: 0,
          model: "m", schemaVersion: "1", promptVersion: "1.0",
          analysis: validAnalysis(), latencyMs: 1,
        }),
        TypeError
      );
    });

    it("rechaza latency_ms negativo", async () => {
      await assert.rejects(
        () => createSuccessfulAnalysis(db, {
          sessionId,
          model: "m", schemaVersion: "1", promptVersion: "1.0",
          analysis: validAnalysis(), latencyMs: -1,
        }),
        TypeError
      );
    });
  });

  describe("createFailedAnalysis", () => {
    it("inserta failed con error_code normalizado y latency null", async () => {
      const row = await createFailedAnalysis(db, {
        sessionId,
        errorCode: toPersistedErrorCode("ollama", OllamaErrorCodes.OLLAMA_OFFLINE),
        errorMessage: "connect ECONNREFUSED 127.0.0.1:11434",
      });
      assert.equal(row.status, "failed");
      assert.equal(row.error_code, "OLLAMA_OFFLINE");
      assert.equal(row.analysis, null);
      assert.equal(row.latency_ms, null);
      assert.equal(row.model, null);
      assert.equal(row.schema_version, null);
      assert.equal(row.prompt_version, null);
      assert.ok(row.error_message.includes("ECONNREFUSED"));
    });

    it("acepta failed post-parse con model/prompt/latency conocidos", async () => {
      const row = await createFailedAnalysis(db, {
        sessionId,
        errorCode: toPersistedErrorCode("analysis", AnalysisValidationCodes.SCHEMA_INVALID),
        errorMessage: "summary excede 400 caracteres (450)",
        model: "llama3.2:3b",
        schemaVersion: "1",
        promptVersion: "1.0",
        latencyMs: 8300,
      });
      assert.equal(row.error_code, "ANALYSIS_SCHEMA_INVALID");
      assert.equal(row.latency_ms, 8300);
      assert.equal(row.model, "llama3.2:3b");
    });

    it("rechaza errorCode fuera de la whitelist normalizada", async () => {
      await assert.rejects(
        () => createFailedAnalysis(db, { sessionId, errorCode: "SOMETHING_ELSE" }),
        TypeError
      );
      // Un código INTERNO sin normalizar tampoco vale:
      await assert.rejects(
        () => createFailedAnalysis(db, { sessionId, errorCode: "OLLAMA_OFFLINE_RAW" }),
        TypeError
      );
    });

    it("errorCode obligatorio", async () => {
      await assert.rejects(
        () => createFailedAnalysis(db, { sessionId }),
        TypeError
      );
    });
  });

  describe("historial y consultas", () => {
    it("permite múltiples intentos por misma session (fail + ok + ok)", async () => {
      // Uso una sesión distinta para no contaminar el conteo de otros tests.
      await createFailedAnalysis(db, {
        sessionId: extraSessionId,
        errorCode: "OLLAMA_TIMEOUT",
      });
      await createSuccessfulAnalysis(db, {
        sessionId: extraSessionId,
        model: "llama3.2:3b", schemaVersion: "1", promptVersion: "1.0",
        analysis: validAnalysis(), latencyMs: 6000,
      });
      await createSuccessfulAnalysis(db, {
        sessionId: extraSessionId,
        model: "llama3.1:8b", schemaVersion: "1", promptVersion: "1.0",
        analysis: validAnalysis({ summary: "regenerado con otro modelo" }),
        latencyMs: 15000,
      });
      const rows = await getAnalysesForSession(db, extraSessionId);
      assert.equal(rows.length, 3);
      // El orden es desc por created_at: el último insertado va primero.
      assert.equal(rows[0].model, "llama3.1:8b");
      assert.equal(rows[0].status, "ok");
      assert.equal(rows[2].status, "failed");
    });

    it("getAnalysesForSession no devuelve rows de otra sesión", async () => {
      const otherRows = await getAnalysesForSession(db, sessionId);
      const extraRows = await getAnalysesForSession(db, extraSessionId);
      for (const r of otherRows) assert.equal(r.session_id, sessionId);
      for (const r of extraRows) assert.equal(r.session_id, extraSessionId);
    });
  });

  describe("constraints DB", () => {
    it("prohíbe ok sin analysis (CHECK)", async () => {
      await assert.rejects(
        () => db("session_analyses").insert({
          session_id: sessionId, status: "ok", schema_version: "1",
          prompt_version: "1.0", model: "m",
        }),
        (e) => e.code === "23514"
      );
    });

    it("prohíbe failed sin error_code (CHECK)", async () => {
      await assert.rejects(
        () => db("session_analyses").insert({
          session_id: sessionId, status: "failed", analysis: null,
        }),
        (e) => e.code === "23514"
      );
    });

    it("prohíbe status desconocido (CHECK checkIn)", async () => {
      await assert.rejects(
        () => db("session_analyses").insert({
          session_id: sessionId, status: "weird",
        }),
        (e) => e.code === "23514"
      );
    });

    it("prohíbe latency_ms negativa (CHECK)", async () => {
      await assert.rejects(
        () => db("session_analyses").insert({
          session_id: sessionId, status: "failed", error_code: "OLLAMA_OFFLINE",
          latency_ms: -1,
        }),
        (e) => e.code === "23514"
      );
    });

    it("FK: session_id inexistente rechazado", async () => {
      await assert.rejects(
        () => db("session_analyses").insert({
          session_id: 999999999, status: "failed", error_code: "OLLAMA_OFFLINE",
        }),
        (e) => e.code === "23503"
      );
    });
  });

  describe("cascade + aislamiento", () => {
    it("borrar la sesión borra sus análisis (CASCADE) sin tocar session_results de otras sesiones", async () => {
      const [tmpSes] = await db("sessions")
        .insert({ patient_id: patientId, professional_id: professionalId })
        .returning("*");
      await createFailedAnalysis(db, { sessionId: tmpSes.id, errorCode: "OLLAMA_TIMEOUT" });
      await createSuccessfulAnalysis(db, {
        sessionId: tmpSes.id, model: "m", schemaVersion: "1", promptVersion: "1.0",
        analysis: validAnalysis(), latencyMs: 100,
      });
      let rows = await getAnalysesForSession(db, tmpSes.id);
      assert.equal(rows.length, 2);
      await db("sessions").where({ id: tmpSes.id }).del();
      rows = await getAnalysesForSession(db, tmpSes.id);
      assert.equal(rows.length, 0);
      // Otras sesiones intactas.
      const others = await getAnalysesForSession(db, sessionId);
      assert.ok(others.length >= 1);
    });

    it("no crea filas en sessions/session_results/answers al insertar análisis", async () => {
      const [{ count: sesBefore }] = await db("sessions").count("id as count");
      const [{ count: srBefore }]  = await db("session_results").count("id as count");
      const [{ count: ansBefore }] = await db("answers").count("id as count");
      await createFailedAnalysis(db, { sessionId, errorCode: "OLLAMA_OFFLINE" });
      const [{ count: sesAfter }] = await db("sessions").count("id as count");
      const [{ count: srAfter }]  = await db("session_results").count("id as count");
      const [{ count: ansAfter }] = await db("answers").count("id as count");
      assert.equal(sesBefore, sesAfter);
      assert.equal(srBefore, srAfter);
      assert.equal(ansBefore, ansAfter);
    });
  });

  describe("normalización error_code", () => {
    it("mapea INVALID_JSON de Ollama a OLLAMA_INVALID_JSON", () => {
      assert.equal(toPersistedErrorCode("ollama", OllamaErrorCodes.INVALID_JSON), "OLLAMA_INVALID_JSON");
    });
    it("mapea INVALID_JSON de Analysis a ANALYSIS_INVALID_JSON", () => {
      assert.equal(toPersistedErrorCode("analysis", AnalysisValidationCodes.INVALID_JSON), "ANALYSIS_INVALID_JSON");
    });
    it("todos los OllamaErrorCodes están en la whitelist", () => {
      for (const v of Object.values(OllamaErrorCodes)) {
        const persisted = toPersistedErrorCode("ollama", v);
        assert.ok(PERSISTED_ERROR_CODES.has(persisted));
      }
    });
    it("todos los AnalysisValidationCodes están en la whitelist", () => {
      for (const v of Object.values(AnalysisValidationCodes)) {
        const persisted = toPersistedErrorCode("analysis", v);
        assert.ok(PERSISTED_ERROR_CODES.has(persisted));
      }
    });
    it("family desconocida es error", () => {
      assert.throws(() => toPersistedErrorCode("mystery", "x"), TypeError);
    });
    it("código interno desconocido es error", () => {
      assert.throws(() => toPersistedErrorCode("ollama", "NOPE"), TypeError);
    });
  });

  describe("sanitizeErrorMessage", () => {
    it("truncatea a 500 chars", () => {
      const long = "x".repeat(1200);
      const out = sanitizeErrorMessage(long);
      assert.equal(out.length, ANALYSIS_ERROR_MESSAGE_MAX);
    });
    it("elimina saltos de línea y tabs", () => {
      const out = sanitizeErrorMessage("línea1\nlínea2\r\n\ttab");
      assert.ok(!out.includes("\n"));
      assert.ok(!out.includes("\r"));
      assert.ok(!out.includes("\t"));
    });
    it("null/undefined/'' devuelven null", () => {
      assert.equal(sanitizeErrorMessage(null), null);
      assert.equal(sanitizeErrorMessage(undefined), null);
      assert.equal(sanitizeErrorMessage(""), null);
      assert.equal(sanitizeErrorMessage("   "), null);
    });
    it("acepta Error y extrae message", () => {
      const out = sanitizeErrorMessage(new Error("boom"));
      assert.equal(out, "boom");
    });
    it("persistido: error_message queda sanitizado en DB", async () => {
      const row = await createFailedAnalysis(db, {
        sessionId,
        errorCode: "OLLAMA_HTTP_ERROR",
        errorMessage: "line1\nline2\r\n" + "y".repeat(1000),
      });
      assert.ok(!row.error_message.includes("\n"));
      assert.ok(row.error_message.length <= ANALYSIS_ERROR_MESSAGE_MAX);
    });
  });

  describe("seguridad — no persiste datos prohibidos", () => {
    it("row solo contiene los campos esperados; no PII, no correct_answer, no prompt", async () => {
      const [row] = await db("session_analyses")
        .where("session_id", sessionId).limit(1).select("*");
      // Whitelist estricta de columnas físicas.
      const allowed = new Set([
        "id", "session_id", "status", "error_code", "model",
        "schema_version", "prompt_version", "analysis",
        "latency_ms", "error_message", "created_at",
      ]);
      for (const k of Object.keys(row)) {
        assert.ok(allowed.has(k), `columna inesperada '${k}' en session_analyses`);
      }
      const json = JSON.stringify(row);
      for (const forbidden of [
        "\"name\":\"Pac Analyses\"", "analyses-pat-", "analyses-prof-",
        "correct_answer", "correct_answer_snapshot",
        "prompt_snapshot", "stimulus_snapshot",
        "SYSTEM:", "CONTEXT ", // sniff de que no se coló el prompt
      ]) {
        assert.ok(!json.includes(forbidden), `row no debe contener '${forbidden}'`);
      }
    });
  });
});
