import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  authHeaders,
  clearAuth,
  consumePatientLoginLink,
  fetchPasswordlessConfig,
  getPatientCookieSession,
  hasPatientSessionHint,
  isSameOriginApi,
  logoutPatientSession,
  requestPatientLoginLink,
  restorePatientSession,
} from "./authService.js";

const LINK_TOKEN = "A".repeat(43);
const PATIENT = { id: 5, role: "patient", name: "Ana", email: "ana@example.test" };

function jsonResponse(body, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
}

function localStorageDump() {
  return Object.keys(localStorage).map((k) => `${k}=${localStorage.getItem(k)}`).join("\n");
}

beforeEach(() => {
  localStorage.clear();
  clearAuth();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearAuth();
  localStorage.clear();
});

describe("authService – acceso sin contraseña (F2/F3)", () => {
  test("consume: el token viaja en el body de un POST, nunca en la URL", async () => {
    const fetchStub = vi.fn(() => jsonResponse({ user: PATIENT, csrf_token: "csrf-1", expires_at: "2026-12-01" }));
    vi.stubGlobal("fetch", fetchStub);
    await consumePatientLoginLink(LINK_TOKEN);
    const [url, opts] = fetchStub.mock.calls[0];
    expect(url).toMatch(/\/auth\/patient-link\/consume$/);
    expect(url).not.toContain(LINK_TOKEN);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({ token: LINK_TOKEN });
  });

  test("consume: no guarda credenciales en localStorage (sólo una marca booleana)", async () => {
    localStorage.setItem("ma_auth_token", "jwt-viejo");
    localStorage.setItem("ma_auth_user", JSON.stringify({ id: 1 }));
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ user: PATIENT, csrf_token: "csrf-secreto", expires_at: "x" })));
    await consumePatientLoginLink(LINK_TOKEN);
    const dump = localStorageDump();
    expect(dump).not.toContain(LINK_TOKEN);
    expect(dump).not.toContain("csrf-secreto");
    expect(dump).not.toContain("jwt-viejo");
    expect(dump).not.toContain(PATIENT.email);
    expect(Object.keys(localStorage)).toEqual(["ma_patient_session_hint"]);
    expect(hasPatientSessionHint()).toBe(true);
    expect(getPatientCookieSession()).toEqual({ user: PATIENT, csrfToken: "csrf-secreto" });
  });

  test("authHeaders: JWT tiene prioridad; con sesión por cookie sólo manda X-CSRF-Token", async () => {
    expect(authHeaders()).toBeNull();
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ user: PATIENT, csrf_token: "csrf-2", expires_at: "x" })));
    await consumePatientLoginLink(LINK_TOKEN);
    expect(authHeaders()).toEqual({ "X-CSRF-Token": "csrf-2" });
    localStorage.setItem("ma_auth_token", "jwt");
    expect(authHeaders()).toEqual({ Authorization: "Bearer jwt" });
  });

  test("consume: enlace vencido o usado → error 410 sin sesión", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ error: "El enlace venció", status: "invalid_link" }, 410)));
    const err = await consumePatientLoginLink(LINK_TOKEN).catch((e) => e);
    expect(err.status).toBe(410);
    expect(err.code).toBe("invalid_link");
    expect(getPatientCookieSession()).toBeNull();
    expect(hasPatientSessionHint()).toBe(false);
  });

  test("consume: rechaza respuestas que no son de un paciente", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ user: { ...PATIENT, role: "professional" }, csrf_token: "c" })));
    await expect(consumePatientLoginLink(LINK_TOKEN)).rejects.toThrow();
    expect(getPatientCookieSession()).toBeNull();
  });

  test("restore: 200 recupera usuario y CSRF; 401 borra la marca", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ user: PATIENT, csrf_token: "csrf-3" })));
    expect(await restorePatientSession()).toEqual(PATIENT);
    expect(authHeaders()).toEqual({ "X-CSRF-Token": "csrf-3" });

    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ error: "x", status: "session_invalid" }, 401)));
    expect(await restorePatientSession()).toBeNull();
    expect(hasPatientSessionHint()).toBe(false);
    expect(authHeaders()).toBeNull();
  });

  test("restore: error de red/servidor se propaga sin borrar la marca", async () => {
    localStorage.setItem("ma_patient_session_hint", "1");
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ error: "caído" }, 502)));
    await expect(restorePatientSession()).rejects.toMatchObject({ status: 502 });
    expect(hasPatientSessionHint()).toBe(true);
  });

  test("logout: POST con X-CSRF-Token y limpia el estado local", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ user: PATIENT, csrf_token: "csrf-4" })));
    await restorePatientSession();
    const fetchStub = vi.fn(() => Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(null) }));
    vi.stubGlobal("fetch", fetchStub);
    await logoutPatientSession();
    const [url, opts] = fetchStub.mock.calls[0];
    expect(url).toMatch(/\/auth\/patient-session\/logout$/);
    expect(opts.headers["X-CSRF-Token"]).toBe("csrf-4");
    expect(getPatientCookieSession()).toBeNull();
    expect(hasPatientSessionHint()).toBe(false);
  });

  test("logout sin red: igual limpia el estado local", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ user: PATIENT, csrf_token: "c" })));
    await restorePatientSession();
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    await logoutPatientSession();
    expect(getPatientCookieSession()).toBeNull();
  });

  test("request: envía el email y propaga el 429", async () => {
    const fetchStub = vi.fn(() => jsonResponse({ error: "muchos", status: "rate_limited" }, 429));
    vi.stubGlobal("fetch", fetchStub);
    const err = await requestPatientLoginLink("ana@example.test").catch((e) => e);
    expect(err.status).toBe(429);
    expect(JSON.parse(fetchStub.mock.calls[0][1].body)).toEqual({ email: "ana@example.test" });
  });

  test("config: con API en otro origen el flujo se oculta sin consultar al backend", async () => {
    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);
    expect(isSameOriginApi()).toBe(false); // tests: API_URL=http://localhost:3001/api, página en otro origen
    expect(await fetchPasswordlessConfig()).toEqual({ enabled: false });
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
