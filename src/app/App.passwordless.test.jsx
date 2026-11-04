// F2/F3 — flujo completo en la app (jsdom, backend simulado con fetch):
// enlace → canje → pantalla del paciente → recarga → cierre de sesión.
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { App } from "./App.jsx";
import { clearAuth } from "../services/authService.js";
import { clearCapturedLoginLinkToken } from "../services/navigationService.js";

const TOKEN = "C".repeat(43);
const PATIENT = { id: 31, role: "patient", name: "Ana Gómez", email: "ana@example.test" };

function jsonResponse(body, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
}

function installBackend({ sessionValid = true } = {}) {
  const calls = [];
  const stub = vi.fn((url, opts = {}) => {
    const method = (opts.method || "GET").toUpperCase();
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    calls.push({ method, path, headers: opts.headers || {}, body: opts.body });
    if (path.endsWith("/auth/patient-link/consume")) {
      return jsonResponse({ user: PATIENT, csrf_token: "csrf-app", expires_at: "2026-12-04T00:00:00Z", auth_method: "patient_session" });
    }
    if (path.endsWith("/auth/patient-session") && method === "GET") {
      return sessionValid
        ? jsonResponse({ user: PATIENT, csrf_token: "csrf-app", expires_at: "2026-12-04T00:00:00Z" })
        : jsonResponse({ error: "x", status: "session_invalid" }, 401);
    }
    if (path.endsWith("/auth/patient-session/logout")) {
      return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(null) });
    }
    if (path.endsWith("/patient/sessions") && method === "GET") return jsonResponse([]);
    if (path.endsWith("/auth/passwordless/config")) return jsonResponse({ enabled: true });
    return jsonResponse({}, 404);
  });
  vi.stubGlobal("fetch", stub);
  return { stub, calls };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearAuth();
  clearCapturedLoginLinkToken();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("App – acceso con enlace (F2/F3)", () => {
  test("enlace → Ingresar → pantalla del paciente, sin tokens en la URL ni en localStorage", async () => {
    window.history.replaceState(null, "", `/#/enlace/${TOKEN}`);
    const { calls } = installBackend();
    render(<App />);

    expect(window.location.href).not.toContain(TOKEN);
    await userEvent.click(await screen.findByRole("button", { name: /^ingresar$/i }));
    expect(await screen.findByText(/hola, ana./i, {}, { timeout: 3000 })).toBeInTheDocument();

    const consume = calls.find((c) => c.path.endsWith("/auth/patient-link/consume"));
    expect(consume.method).toBe("POST");
    expect(JSON.parse(consume.body)).toEqual({ token: TOKEN });
    expect(calls.every((c) => !c.path.includes(TOKEN))).toBe(true);

    // Requests posteriores del paciente: sin Authorization, con CSRF en memoria.
    await vi.waitFor(() => expect(calls.some((c) => c.path.endsWith("/patient/sessions"))).toBe(true));
    for (const c of calls.filter((x) => x.path.endsWith("/patient/sessions"))) {
      expect(c.headers.Authorization).toBeUndefined();
      expect(c.headers["X-CSRF-Token"]).toBe("csrf-app");
    }

    const stored = Object.keys(localStorage).map((k) => `${k}=${localStorage.getItem(k)}`).join("\n");
    expect(stored).not.toContain(TOKEN);
    expect(stored).not.toContain("csrf-app");
    expect(localStorage.getItem("ma_auth_token")).toBeNull();
    expect(window.location.href).not.toContain(TOKEN);
  });

  test("recarga con sesión por cookie: se restaura sin pedir contraseña; Salir la revoca", async () => {
    localStorage.setItem("ma_patient_session_hint", "1");
    window.history.replaceState(null, "", "/#/patient");
    const { calls } = installBackend();
    render(<App />);

    expect(await screen.findByText(/hola, ana./i, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(calls.some((c) => c.path.endsWith("/auth/patient-session") && c.method === "GET")).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: /salir/i }));
    const logout = calls.find((c) => c.path.endsWith("/auth/patient-session/logout"));
    expect(logout.method).toBe("POST");
    expect(logout.headers["X-CSRF-Token"]).toBe("csrf-app");
    expect(localStorage.getItem("ma_patient_session_hint")).toBeNull();
    expect(await screen.findByLabelText("Clave")).toBeInTheDocument();
  });

  test("recarga con sesión revocada o vencida: vuelve al login con un aviso", async () => {
    localStorage.setItem("ma_patient_session_hint", "1");
    window.history.replaceState(null, "", "/#/patient");
    installBackend({ sessionValid: false });
    render(<App />);
    expect(await screen.findByText(/tu sesión terminó/i)).toBeInTheDocument();
    expect(localStorage.getItem("ma_patient_session_hint")).toBeNull();
    expect(screen.queryByText(/hola, ana./i)).not.toBeInTheDocument();
  });
});
