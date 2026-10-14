import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createPatientSession } from "./patientSessionsApi.js";
import * as authService from "./authService.js";

beforeEach(() => {
  vi.spyOn(authService, "getToken").mockReturnValue("fake-jwt-token");
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(body, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  });
}

// Cubre el contrato acordado para patient_reported_mood tras el fix del bug
// donde el frontend enviaba "sin registrar" (no está en el whitelist del
// backend) y rompía POST /api/patient/sessions con 400.
describe("createPatientSession – contrato de patient_reported_mood", () => {
  test("omite patient_reported_mood cuando no se pasa (paciente no autorreportó)", async () => {
    const fetchStub = vi.fn(() => jsonResponse({ id: 1, status: "created" }, 201));
    vi.stubGlobal("fetch", fetchStub);
    await createPatientSession({ sectionSlug: "memoria_de_trabajo" });
    const body = JSON.parse(fetchStub.mock.calls[0][1].body);
    expect(body).toEqual({ sections: [{ section_slug: "memoria_de_trabajo" }] });
    expect(body.patient_reported_mood).toBeUndefined();
  });

  test("omite patient_reported_mood cuando se pasa explícitamente null", async () => {
    const fetchStub = vi.fn(() => jsonResponse({ id: 2, status: "created" }, 201));
    vi.stubGlobal("fetch", fetchStub);
    await createPatientSession({ sectionSlug: "memoria_de_trabajo", patientReportedMood: null });
    const body = JSON.parse(fetchStub.mock.calls[0][1].body);
    expect(body.patient_reported_mood).toBeUndefined();
  });

  test("envía patient_reported_mood cuando se pasa un slug válido", async () => {
    const fetchStub = vi.fn(() => jsonResponse({ id: 3, status: "created" }, 201));
    vi.stubGlobal("fetch", fetchStub);
    await createPatientSession({ sectionSlug: "memoria_de_trabajo", patientReportedMood: "cansancio" });
    const body = JSON.parse(fetchStub.mock.calls[0][1].body);
    expect(body.patient_reported_mood).toBe("cansancio");
    expect(body.sections).toEqual([{ section_slug: "memoria_de_trabajo" }]);
  });
});
