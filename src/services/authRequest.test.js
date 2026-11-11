import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AUTH_EXPIRED_EVENT, authRequest } from "./authRequest.js";
import * as authService from "./authService.js";

beforeEach(() => {
  vi.spyOn(authService, "authHeaders").mockReturnValue({ Authorization: "Bearer fake-jwt-token" });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function response(status, body, { json = true } = {}) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: json ? () => Promise.resolve(body) : () => Promise.reject(new SyntaxError("Unexpected token <")),
  });
}

describe("authRequest", () => {
  test("devuelve el JSON en una respuesta correcta", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response(200, { ok: 1 })));
    await expect(authRequest("/x")).resolves.toEqual({ ok: 1 });
  });

  test("204 devuelve null", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response(204, null, { json: false })));
    await expect(authRequest("/x", { method: "DELETE" })).resolves.toBeNull();
  });

  test("un 401 avisa que la sesión venció", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response(401, { error: "Token inválido o expirado" })));
    const listener = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, listener);
    try {
      await expect(authRequest("/x")).rejects.toMatchObject({ status: 401 });
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(AUTH_EXPIRED_EVENT, listener);
    }
  });

  test("otros errores no cierran la sesión y conservan el mensaje del backend", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response(409, { error: "Ya respondida", status: "already_answered" })));
    const listener = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, listener);
    try {
      await expect(authRequest("/x")).rejects.toMatchObject({
        status: 409,
        message: "Ya respondida",
        data: { status: "already_answered" },
      });
      expect(listener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(AUTH_EXPIRED_EVENT, listener);
    }
  });

  test("sin conexión muestra un mensaje en español, no el del navegador", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Load failed"))));
    await expect(authRequest("/x")).rejects.toMatchObject({
      network: true,
      message: authService.SERVER_UNAVAILABLE_MESSAGE,
    });
  });

  test("una página de error del proxy (sin JSON) se informa como servidor no disponible", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response(502, null, { json: false })));
    await expect(authRequest("/x")).rejects.toMatchObject({
      status: 502,
      message: authService.SERVER_UNAVAILABLE_MESSAGE,
    });
  });
});

describe("isStoredTokenExpired", () => {
  function fakeJwt(payload) {
    const b64 = btoa(JSON.stringify(payload)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    return `eyJhbGciOiJIUzI1NiJ9.${b64}.firma`;
  }

  afterEach(() => localStorage.clear());

  test("detecta un JWT vencido", () => {
    localStorage.setItem("ma_auth_token", fakeJwt({ id: 1, exp: Math.floor(Date.now() / 1000) - 60 }));
    expect(authService.isStoredTokenExpired()).toBe(true);
  });

  test("un JWT vigente no está vencido", () => {
    localStorage.setItem("ma_auth_token", fakeJwt({ id: 1, exp: Math.floor(Date.now() / 1000) + 3600 }));
    expect(authService.isStoredTokenExpired()).toBe(false);
  });

  test("sin token o con un token ilegible no decide (lo resuelve el backend)", () => {
    expect(authService.isStoredTokenExpired()).toBe(false);
    localStorage.setItem("ma_auth_token", "no-es-un-jwt");
    expect(authService.isStoredTokenExpired()).toBe(false);
  });
});
