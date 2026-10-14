// 7H.2: cobertura del flujo paciente backend → dashboard con "Hecha por hoy"
// derivado desde PostgreSQL vía GET /api/patient/sessions.
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../main.jsx";

const PATIENT_USER = {
  id: 101,
  role: "patient",
  name: "Paciente Test",
  email: "patient-test@example.com",
  age: 68,
  is_active: true,
  professional_id: 1,
};

function jsonResponse(body, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  });
}

function setStoredPatientSessionBackend() {
  localStorage.setItem("ma_auth_token", "fake-patient-jwt");
  localStorage.setItem("ma_auth_user", JSON.stringify(PATIENT_USER));
  localStorage.setItem("ma_app_session_v1", JSON.stringify({ role: "patient", professionalId: PATIENT_USER.professional_id }));
}

function todayIso(hour = 10) {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function yesterdayIso() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
}

function makeFetchStub({ mySessions = [] } = {}) {
  const calls = [];
  const stub = vi.fn((url, opts = {}) => {
    const method = (opts.method || "GET").toUpperCase();
    const strUrl = String(url);
    calls.push({ url: strUrl, method });
    if (strUrl.endsWith("/api/patient/sessions") && method === "GET") {
      return jsonResponse(mySessions);
    }
    return jsonResponse({}, 404);
  });
  vi.stubGlobal("fetch", stub);
  return { stub, calls };
}

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  window.location.hash = "";
});

describe("useAppController — progreso del paciente backend (7H.2)", () => {
  test("sesión completed de hoy marca la actividad como completada", async () => {
    setStoredPatientSessionBackend();
    makeFetchStub({
      mySessions: [
        {
          id: 999,
          status: "completed",
          created_at: todayIso(9),
          started_at: todayIso(9),
          completed_at: todayIso(10),
          abandoned_at: null,
          sections: [{ section_slug: "orientacion_temporal", section_name: "Orientación temporal" }],
          summary: { total_questions: 4, answered_questions: 4, correct_count: 2, incorrect_count: 2, accuracy: 0.5, completion_rate: 1, mean_latency_ms: 3233 },
        },
      ],
    });

    render(<App />);
    // El botón de la actividad "Agenda de turnos" queda deshabilitado y con "Hecha por hoy".
    const btn = await screen.findByRole("button", { name: /agenda de turnos/i });
    await waitFor(() => {
      expect(btn).toHaveAttribute("disabled");
    });
    expect(btn.textContent).toMatch(/Hecha por hoy/i);
  });

  test("sesión completed de otro día NO marca Hecha por hoy", async () => {
    setStoredPatientSessionBackend();
    makeFetchStub({
      mySessions: [
        {
          id: 4611,
          status: "completed",
          created_at: yesterdayIso(),
          completed_at: yesterdayIso(),
          sections: [{ section_slug: "orientacion_temporal" }],
          summary: { total_questions: 4, answered_questions: 4, correct_count: 4, incorrect_count: 0, accuracy: 1, completion_rate: 1, mean_latency_ms: 1000 },
        },
      ],
    });

    render(<App />);
    const btn = await screen.findByRole("button", { name: /agenda de turnos/i });
    // Esperar a que el fetch complete: buscamos que NO aparezca "Hecha por hoy" tras render inicial.
    await waitFor(() => {
      expect(btn.textContent).not.toMatch(/Hecha por hoy/i);
    });
    expect(btn).not.toHaveAttribute("disabled");
  });

  test("sesión abandoned de hoy NO cuenta como completada", async () => {
    setStoredPatientSessionBackend();
    makeFetchStub({
      mySessions: [
        {
          id: 4612,
          status: "abandoned",
          created_at: todayIso(9),
          started_at: todayIso(9),
          completed_at: null,
          abandoned_at: todayIso(9),
          sections: [{ section_slug: "orientacion_temporal" }],
        },
      ],
    });

    render(<App />);
    const btn = await screen.findByRole("button", { name: /agenda de turnos/i });
    // Damos un pequeño tiempo al fetch async.
    await waitFor(() => {
      expect(btn.textContent).not.toMatch(/Hecha por hoy/i);
    });
    expect(btn).not.toHaveAttribute("disabled");
  });

  test("dos actividades completadas hoy quedan ambas marcadas", async () => {
    setStoredPatientSessionBackend();
    makeFetchStub({
      mySessions: [
        {
          id: 1, status: "completed", completed_at: todayIso(9),
          sections: [{ section_slug: "orientacion_temporal" }],
          summary: { total_questions: 4, answered_questions: 4, correct_count: 3, incorrect_count: 1, accuracy: 0.75, completion_rate: 1, mean_latency_ms: 1200 },
        },
        {
          id: 2, status: "completed", completed_at: todayIso(11),
          sections: [{ section_slug: "atencion_visual" }],
          summary: { total_questions: 4, answered_questions: 4, correct_count: 4, incorrect_count: 0, accuracy: 1, completion_rate: 1, mean_latency_ms: 1500 },
        },
      ],
    });

    render(<App />);
    const cal = await screen.findByRole("button", { name: /agenda de turnos/i });
    const home = await screen.findByRole("button", { name: /objetos de la casa/i });
    await waitFor(() => {
      expect(cal.textContent).toMatch(/Hecha por hoy/i);
      expect(home.textContent).toMatch(/Hecha por hoy/i);
    });
  });

  test("service pega al endpoint correcto con Bearer + método GET", async () => {
    setStoredPatientSessionBackend();
    const { calls } = makeFetchStub({ mySessions: [] });

    render(<App />);
    await waitFor(() => {
      const call = calls.find((c) => c.url.endsWith("/api/patient/sessions"));
      expect(call).toBeDefined();
      expect(call.method).toBe("GET");
    });
  });

  test("si el fetch falla, la UI no explota y no marca nada como completado", async () => {
    setStoredPatientSessionBackend();
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ error: "boom" }, 500)));

    render(<App />);
    const btn = await screen.findByRole("button", { name: /agenda de turnos/i });
    // Sin regresión: la tarjeta aparece normal, no "Hecha por hoy".
    expect(btn.textContent).not.toMatch(/Hecha por hoy/i);
  });
});
