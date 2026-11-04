import { render, screen, cleanup, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { BackendPatientDetail } from "./BackendPatientDetail.jsx";

const PATIENT = { id: 1, name: "Paciente Test", age: 70 };

function session(adaptive) {
  return {
    id: 10,
    status: "completed",
    created_at: "2026-11-04T10:00:00Z",
    started_at: "2026-11-04T10:00:00Z",
    completed_at: "2026-11-04T10:05:00Z",
    abandoned_at: null,
    patient_reported_mood: null,
    summary: {
      total_questions: 4, answered_questions: 4, correct_count: 3, incorrect_count: 1,
      accuracy: 0.75, completion_rate: 1, mean_latency_ms: 3300,
    },
    adaptive,
  };
}

function renderWith(s) {
  globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  render(
    <BackendPatientDetail
      selectedPatient={PATIENT}
      sessionsState={{ patientId: 1, list: [s], loading: false, error: "" }}
      onDeletePatient={null}
    />
  );
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("BackendPatientDetail — ajuste de dificultad", () => {
  test("muestra nivel, cambio, motivo, evidencia y mezcla real", () => {
    renderWith(session({
      level: 3,
      version: "1",
      decision: {
        level: 3, previous_level: 2, change: "up", rule: "high_accuracy_sustained",
        thresholds: { up: 0.8, down: 0.4, min_sessions: 2, min_scored_responses: 6 },
        evidence: { session_ids: [9, 8], sessions_count: 2, correct_count: 7, scored_count: 8, accuracy: 0.875 },
        selection: { targets: { 1: 0, 2: 1, 3: 3 }, actual_mix: { 1: 0, 2: 1, 3: 3 } },
      },
    }));
    const block = within(screen.getByTestId("adaptive-decision"));
    expect(block.getByText("Nivel 3 (más exigente)")).toBeTruthy();
    expect(block.getByText("Subió (antes: nivel 2)")).toBeTruthy();
    expect(block.getByText(/umbral de subida/)).toBeTruthy();
    expect(block.getByText("2 sesiones · 7 de 8 respuestas correctas (87,5 %)")).toBeTruthy();
    expect(block.getByText("Media: 1 · Difícil: 3")).toBeTruthy();
    expect(block.getByText(/No constituye una evaluación clínica/)).toBeTruthy();
  });

  test("sesión histórica sin nivel: muestra el bloque con «Adaptación no disponible»", () => {
    renderWith(session(null));
    expect(screen.queryByTestId("adaptive-decision")).toBeNull();
    const block = within(screen.getByTestId("adaptive-decision-unavailable"));
    expect(block.getByText("Ajuste de dificultad")).toBeTruthy();
    expect(block.getByText("Adaptación no disponible para esta sesión.")).toBeTruthy();
    // No se inventa un nivel para sesiones históricas.
    expect(screen.queryByText(/Nivel [123] \(/)).toBeNull();
  });

  test("registro incompleto (nivel fuera de rango o ausente): no inventa nivel", () => {
    renderWith(session({ level: null, version: "1", decision: null }));
    expect(screen.getByTestId("adaptive-decision-unavailable")).toBeTruthy();
    cleanup();
    renderWith(session({ level: 7, version: "1", decision: {} }));
    expect(screen.getByTestId("adaptive-decision-unavailable")).toBeTruthy();
  });

  test("nivel válido sin traza de decisión: muestra el nivel sin afirmar evidencia", () => {
    renderWith(session({ level: 2, version: "1", decision: null }));
    const block = within(screen.getByTestId("adaptive-decision"));
    expect(block.getByText("Nivel 2 (intermedio)")).toBeTruthy();
    expect(screen.queryByText("Sin sesiones completadas previas en este nivel.")).toBeNull();
  });
});
