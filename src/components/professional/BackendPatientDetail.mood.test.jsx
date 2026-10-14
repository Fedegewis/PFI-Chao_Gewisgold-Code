import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { BackendPatientDetail } from "./BackendPatientDetail.jsx";

const PATIENT = { id: 1, name: "Paciente Test", age: 70 };

function session({ id, mood }) {
  return {
    id,
    status: "completed",
    created_at: "2026-09-30T10:00:00Z",
    started_at: "2026-09-30T10:00:00Z",
    completed_at: "2026-09-30T10:05:00Z",
    abandoned_at: null,
    patient_reported_mood: mood ?? null,
    sections: [{ section_slug: "orientacion_temporal", section_name: "Orientación temporal" }],
    summary: {
      total_questions: 5, answered_questions: 5, correct_count: 3, incorrect_count: 2,
      accuracy: 0.6, completion_rate: 1, mean_latency_ms: 3300,
    },
  };
}

function fetchStub() {
  // El componente no hace fetch directo — depende de sessionsState prop. Stub por seguridad.
  globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("BackendPatientDetail — mood en detalle de la sesión", () => {
  test("muestra 'Estado de ánimo registrado' con label legible cuando mood existe", () => {
    fetchStub();
    const s = session({ id: 1, mood: "bien" });
    render(
      <BackendPatientDetail
        selectedPatient={PATIENT}
        sessionsState={{ patientId: 1, list: [s], loading: false, error: "" }}
        onDeletePatient={null}
      />
    );
    expect(screen.getByText(/Estado de ánimo registrado/i)).toBeTruthy();
    expect(screen.getByText("Bien")).toBeTruthy();
  });

  test("mapea cansancio → Cansancio", () => {
    fetchStub();
    const s = session({ id: 2, mood: "cansancio" });
    render(
      <BackendPatientDetail
        selectedPatient={PATIENT}
        sessionsState={{ patientId: 1, list: [s], loading: false, error: "" }}
        onDeletePatient={null}
      />
    );
    expect(screen.getByText("Cansancio")).toBeTruthy();
  });

  test("omite el bloque de mood cuando patient_reported_mood es null (sin 'Sin datos')", () => {
    fetchStub();
    const s = session({ id: 3, mood: null });
    render(
      <BackendPatientDetail
        selectedPatient={PATIENT}
        sessionsState={{ patientId: 1, list: [s], loading: false, error: "" }}
        onDeletePatient={null}
      />
    );
    expect(screen.queryByText(/Estado de ánimo registrado/i)).toBeNull();
    expect(screen.queryByText(/sin datos/i)).toBeNull();
    expect(screen.queryByText(/no registrado/i)).toBeNull();
  });

  test("omite el bloque de mood para valores inesperados (fallback seguro)", () => {
    fetchStub();
    const s = session({ id: 4, mood: "no-conocido" });
    render(
      <BackendPatientDetail
        selectedPatient={PATIENT}
        sessionsState={{ patientId: 1, list: [s], loading: false, error: "" }}
        onDeletePatient={null}
      />
    );
    expect(screen.queryByText(/Estado de ánimo registrado/i)).toBeNull();
  });
});
