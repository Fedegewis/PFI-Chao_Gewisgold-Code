// Cobertura del fix de refresco silencioso: al autenticarse como profesional,
// al seleccionar un paciente y al volver a la pestaña (visibilitychange/focus),
// el hook refetchea las sesiones del paciente seleccionado.
import { render, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../main.jsx";

const PROF = {
  id: 555,
  role: "professional",
  name: "Prof Refresh",
  email: "prof-refresh@example.com",
  is_active: true,
};

const PATIENT = {
  id: 909,
  role: "patient",
  name: "Paciente Refresh",
  email: "pat-refresh@example.com",
  age: 70,
  is_active: true,
  professional_id: PROF.id,
};

function jsonResponse(body, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
}

function setStoredProfessionalSession() {
  localStorage.setItem("ma_auth_token", "fake-prof-jwt");
  localStorage.setItem("ma_auth_user", JSON.stringify(PROF));
  localStorage.setItem("ma_app_session_v1", JSON.stringify({ role: "professional", professionalId: PROF.id }));
}

function completedSession(id, isoDate) {
  return {
    id,
    status: "completed",
    created_at: isoDate,
    started_at: isoDate,
    completed_at: isoDate,
    abandoned_at: null,
    sections: [{ section_slug: "orientacion_temporal", section_name: "Orientación temporal" }],
    summary: {
      total_questions: 5, answered_questions: 5, correct_count: 3, incorrect_count: 2,
      accuracy: 0.6, completion_rate: 1, mean_latency_ms: 3300,
    },
  };
}

function makeFetchStub({ sessionsByCall = [] } = {}) {
  const calls = [];
  let sessionsCallIndex = 0;
  const stub = vi.fn((url, opts = {}) => {
    const method = (opts.method || "GET").toUpperCase();
    const strUrl = String(url);
    calls.push({ url: strUrl, method });

    if (strUrl.endsWith("/api/auth/me") && method === "GET") {
      return jsonResponse({ user: PROF });
    }
    if (strUrl.endsWith("/api/patients") && method === "GET") {
      return jsonResponse([PATIENT]);
    }
    if (strUrl.match(/\/api\/patients\/\d+\/sessions$/) && method === "GET") {
      const idx = Math.min(sessionsCallIndex, sessionsByCall.length - 1);
      const payload = sessionsByCall[idx] ?? [];
      sessionsCallIndex += 1;
      return jsonResponse(payload);
    }
    if (strUrl.match(/\/training-config$|\/training-availability$|\/cognitive-domains$/)) {
      // Panel de configuración: contenidos inertes para el test.
      return jsonResponse({
        max_questions: 4, active_domain_slugs: null,
        effective_max_questions: 4, effective_active_domain_slugs: null,
        requested: 4, active_domain_slugs_effective: null, any_sufficient: true, sections: [],
        // catálogo mínimo
        ...(strUrl.endsWith("/cognitive-domains") ? [] : {}),
      });
    }
    return jsonResponse({}, 404);
  });
  vi.stubGlobal("fetch", stub);
  return { stub, get calls() { return calls; } };
}

function countSessionsCalls(calls, patientId) {
  return calls.filter(
    (c) => c.method === "GET" && c.url.endsWith(`/api/patients/${patientId}/sessions`)
  ).length;
}

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "";
  setStoredProfessionalSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  window.location.hash = "";
});

describe("useAppController — refresh profesional del historial de sesiones", () => {
  test("al montar como profesional autenticado se hace GET /patients/:id/sessions", async () => {
    const iso = new Date().toISOString();
    const stub = makeFetchStub({
      sessionsByCall: [[completedSession(1001, iso)]],
    });

    render(<App />);

    await waitFor(() => {
      expect(countSessionsCalls(stub.calls, PATIENT.id)).toBeGreaterThanOrEqual(1);
    });
  });

  test("al volver la pestaña a visible se refetchea (sin loops)", async () => {
    const iso = new Date().toISOString();
    // 1er fetch: 1 sesión. 2do fetch (post-visibilitychange): 2 sesiones.
    const stub = makeFetchStub({
      sessionsByCall: [
        [completedSession(1001, iso)],
        [completedSession(1001, iso), completedSession(1002, iso)],
      ],
    });

    render(<App />);
    await waitFor(() => {
      expect(countSessionsCalls(stub.calls, PATIENT.id)).toBe(1);
    });

    // Simular que la pestaña estuvo oculta y volvió a estar visible.
    act(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => {
      expect(countSessionsCalls(stub.calls, PATIENT.id)).toBe(2);
    });

    // Verificar que no hay loops: sin más eventos, no debería seguir creciendo.
    const before = countSessionsCalls(stub.calls, PATIENT.id);
    await new Promise((r) => setTimeout(r, 50));
    expect(countSessionsCalls(stub.calls, PATIENT.id)).toBe(before);
  });

  test("visibilitychange a 'hidden' NO dispara refetch", async () => {
    const iso = new Date().toISOString();
    const stub = makeFetchStub({ sessionsByCall: [[completedSession(1001, iso)]] });

    render(<App />);
    await waitFor(() => {
      expect(countSessionsCalls(stub.calls, PATIENT.id)).toBe(1);
    });

    act(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // No debería re-fetchear.
    await new Promise((r) => setTimeout(r, 20));
    expect(countSessionsCalls(stub.calls, PATIENT.id)).toBe(1);
  });
});
