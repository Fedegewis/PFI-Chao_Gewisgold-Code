import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  SERVER_UNAVAILABLE_MESSAGE,
  clearAuth,
  fetchCurrentUser,
  getSavedUser,
  getToken,
  loginWithGoogle,
  loginWithPassword,
  persistAuthSession,
  registerProfessional,
  setToken,
} from "./authService.js";

beforeEach(() => {
  localStorage.clear();
  // loginWithGoogle conserva instrumentación console.debug temporal.
  vi.spyOn(console, "debug").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

function jsonResponse(body, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  });
}

// Simula la página HTML de error de un proxy (Vercel/Render) ante 502/504.
function htmlResponse(status) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.reject(new SyntaxError("Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON")),
  });
}

const USER = { id: 7, role: "professional", name: "Dra. Test", email: "pro@example.test" };

describe("authService – respuestas no-JSON", () => {
  test("loginWithPassword: 502 HTML lanza mensaje legible con status, sin guardar sesión", async () => {
    vi.stubGlobal("fetch", vi.fn(() => htmlResponse(502)));
    const err = await loginWithPassword({ email: "pro@example.test", password: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(SyntaxError);
    expect(err.message).toBe(SERVER_UNAVAILABLE_MESSAGE);
    expect(err.status).toBe(502);
    expect(getToken()).toBeNull();
    expect(getSavedUser()).toBeNull();
  });

  test("loginWithPassword: 200 sin JSON se trata como error y no persiste token indefinido", async () => {
    vi.stubGlobal("fetch", vi.fn(() => htmlResponse(200)));
    const err = await loginWithPassword({ email: "pro@example.test", password: "x" }).catch((e) => e);
    expect(err.message).toBe(SERVER_UNAVAILABLE_MESSAGE);
    expect(err.status).toBe(200);
    expect(getToken()).toBeNull();
    expect(localStorage.getItem("ma_auth_user")).toBeNull();
  });

  test("registerProfessional: 504 HTML lanza mensaje legible", async () => {
    vi.stubGlobal("fetch", vi.fn(() => htmlResponse(504)));
    const err = await registerProfessional({ name: "A", email: "a@example.test", password: "x" }).catch((e) => e);
    expect(err.message).toBe(SERVER_UNAVAILABLE_MESSAGE);
    expect(err.status).toBe(504);
    expect(getToken()).toBeNull();
  });

  test("loginWithGoogle: 502 HTML lanza mensaje legible con status, sin guardar sesión", async () => {
    vi.stubGlobal("fetch", vi.fn(() => htmlResponse(502)));
    const err = await loginWithGoogle("google-credential").catch((e) => e);
    expect(err).not.toBeInstanceOf(SyntaxError);
    expect(err.message).toBe(SERVER_UNAVAILABLE_MESSAGE);
    expect(err.status).toBe(502);
    expect(getToken()).toBeNull();
  });
});

describe("authService – comportamiento existente preservado", () => {
  test("loginWithPassword: 401 JSON propaga el mensaje del backend", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ error: "Credenciales incorrectas" }, 401)));
    const err = await loginWithPassword({ email: "pro@example.test", password: "x" }).catch((e) => e);
    expect(err.message).toBe("Credenciales incorrectas");
    expect(err.status).toBe(401);
  });

  test("loginWithPassword: error JSON sin campo error usa el mensaje genérico previo", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({}, 500)));
    const err = await loginWithPassword({ email: "pro@example.test", password: "x" }).catch((e) => e);
    expect(err.message).toBe("Error del servidor");
    expect(err.status).toBe(500);
  });

  test("loginWithPassword: 200 JSON guarda token y usuario", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ user: USER, token: "jwt-ok" })));
    const data = await loginWithPassword({ email: "pro@example.test", password: "x" });
    expect(data.token).toBe("jwt-ok");
    expect(getToken()).toBe("jwt-ok");
    expect(getSavedUser()).toEqual(USER);
  });

  test("loginWithGoogle: 403 JSON propaga el mensaje del backend", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ error: "Google Auth está disponible solo para profesionales" }, 403)));
    const err = await loginWithGoogle("google-credential").catch((e) => e);
    expect(err.message).toBe("Google Auth está disponible solo para profesionales");
    expect(err.status).toBe(403);
  });

  test("loginWithGoogle: 200 JSON guarda token y usuario", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ user: USER, token: "jwt-google" })));
    await loginWithGoogle("google-credential");
    expect(getToken()).toBe("jwt-google");
    expect(getSavedUser()).toEqual(USER);
  });

  test("fallo de red (fetch rechaza) se propaga sin cambios", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    const err = await loginWithPassword({ email: "pro@example.test", password: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(err.message).toBe("Failed to fetch");
  });
});

describe("authService – sesión guardada", () => {
  test("setToken(null) borra el token y clearAuth borra token y usuario", () => {
    persistAuthSession({ user: USER, token: "jwt" });
    setToken(null);
    expect(getToken()).toBeNull();
    persistAuthSession({ user: USER, token: "jwt" });
    clearAuth();
    expect(getToken()).toBeNull();
    expect(getSavedUser()).toBeNull();
  });

  test("getSavedUser con JSON corrupto devuelve null", () => {
    localStorage.setItem("ma_auth_user", "{no-json");
    expect(getSavedUser()).toBeNull();
  });

  test("getToken devuelve null si localStorage falla", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    expect(getToken()).toBeNull();
  });

  test("registerProfessional: 201 JSON guarda token y usuario", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ user: USER, token: "jwt-reg" }, 201)));
    await registerProfessional({ name: "Dra. Test", email: USER.email, password: "secreto123" });
    expect(getToken()).toBe("jwt-reg");
  });

  test("loginWithGoogle: fallo de red se propaga", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    await expect(loginWithGoogle("cred")).rejects.toThrow("Failed to fetch");
  });
});

describe("authService – fetchCurrentUser", () => {
  test("sin token no llama al backend", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchCurrentUser()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("con token válido actualiza el usuario guardado", async () => {
    setToken("jwt");
    const fetchMock = vi.fn(() => jsonResponse({ user: USER }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchCurrentUser()).resolves.toEqual(USER);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer jwt");
    expect(getSavedUser()).toEqual(USER);
  });

  test("con token rechazado limpia la sesión", async () => {
    persistAuthSession({ user: USER, token: "vencido" });
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ error: "Token inválido" }, 401)));
    await expect(fetchCurrentUser()).resolves.toBeNull();
    expect(getToken()).toBeNull();
    expect(getSavedUser()).toBeNull();
  });
});
