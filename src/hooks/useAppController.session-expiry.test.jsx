// Sesión vencida: el JWT dura 24 h. Un paciente que vuelve al día siguiente
// no debe quedar en una pantalla autenticada donde todo falla con
// "Token inválido o expirado": vuelve al login con un aviso claro.
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

function fakeJwt(expSecondsFromNow) {
  const payload = { id: PATIENT_USER.id, role: "patient", exp: Math.floor(Date.now() / 1000) + expSecondsFromNow };
  const b64 = btoa(JSON.stringify(payload)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `eyJhbGciOiJIUzI1NiJ9.${b64}.firma`;
}

function storePatientSession(token) {
  localStorage.setItem("ma_auth_token", token);
  localStorage.setItem("ma_auth_user", JSON.stringify(PATIENT_USER));
  localStorage.setItem("ma_app_session_v1", JSON.stringify({ role: "patient", professionalId: 1 }));
}

function jsonResponse(body, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
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

describe("sesión vencida", () => {
  test("un JWT vencido al abrir la app lleva al login con aviso y limpia la sesión guardada", async () => {
    storePatientSession(fakeJwt(-3600));
    const fetchStub = vi.fn(() => jsonResponse({}, 404));
    vi.stubGlobal("fetch", fetchStub);

    render(<App />);

    expect(await screen.findByText("Tu sesión terminó. Volvé a ingresar.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /agenda de turnos/i })).not.toBeInTheDocument();
    expect(localStorage.getItem("ma_auth_token")).toBeNull();
    expect(localStorage.getItem("ma_auth_user")).toBeNull();
    // Ninguna llamada autenticada con el token vencido.
    const authed = fetchStub.mock.calls.filter(([, opts]) => opts?.headers?.Authorization);
    expect(authed).toHaveLength(0);
  });

  test("un 401 de la API durante el uso cierra la sesión y vuelve al login", async () => {
    storePatientSession(fakeJwt(3600));
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse({ error: "Token inválido o expirado" }, 401))
    );

    render(<App />);

    expect(await screen.findByText("Tu sesión terminó. Volvé a ingresar.")).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem("ma_auth_token")).toBeNull());
    expect(screen.queryByText("Token inválido o expirado")).not.toBeInTheDocument();
  });

  test("un JWT vigente mantiene al paciente en su pantalla", async () => {
    storePatientSession(fakeJwt(3600));
    vi.stubGlobal(
      "fetch",
      vi.fn((url) => (String(url).endsWith("/patient/sessions") ? jsonResponse([]) : jsonResponse({}, 404)))
    );

    render(<App />);

    expect(await screen.findByRole("button", { name: /agenda de turnos/i })).toBeInTheDocument();
    expect(screen.queryByText("Tu sesión terminó. Volvé a ingresar.")).not.toBeInTheDocument();
  });
});
