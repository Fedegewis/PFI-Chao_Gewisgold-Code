// Mobile (≤ 760 px): el estado de ánimo elegido en el panel compacto, ubicado
// antes de las actividades, debe llegar al backend como patient_reported_mood
// al iniciar la sesión de entrenamiento (mismo flujo que en escritorio).
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MOBILE_LAYOUT_QUERY } from "./hooks/useMediaQuery.js";
import { App } from "./main.jsx";

function jsonResponse(body, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
}

function mockMobileViewport() {
  window.matchMedia = vi.fn((query) => ({
    matches: query === MOBILE_LAYOUT_QUERY,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function loginBackendPatient() {
  localStorage.setItem("ma_auth_token", "patient-jwt");
  localStorage.setItem(
    "ma_auth_user",
    JSON.stringify({ id: 42, role: "patient", name: "Paula Prueba", email: "p@p.com", is_active: true })
  );
  localStorage.setItem("ma_app_session_v1", JSON.stringify({ role: "patient" }));
  window.location.hash = "#/patient";
}

function stubFetch(calls) {
  vi.stubGlobal("fetch", vi.fn((url, opts = {}) => {
    calls.push({ url: String(url), method: (opts.method || "GET").toUpperCase(), body: opts.body });
    if (String(url).includes("/patient/sessions")) {
      return jsonResponse({ id: 1, patient_id: 42, professional_id: 7, status: "created", sections: [] }, 201);
    }
    return jsonResponse({}, 404);
  }));
}

afterEach(() => {
  delete window.matchMedia;
  vi.unstubAllGlobals();
});

describe("Mobile — estado de ánimo antes de las actividades", () => {
  test("el ánimo elegido en mobile viaja como patient_reported_mood al iniciar la sesión", async () => {
    mockMobileViewport();
    loginBackendPatient();
    const calls = [];
    stubFetch(calls);
    const user = userEvent.setup();
    render(<App />);

    const main = await screen.findByRole("region", { name: "Actividades del paciente" });
    const moodGroup = within(main).getByRole("group", { name: "¿Cómo te sentís hoy?" });
    const cansancio = within(moodGroup).getByRole("button", { name: /^Cansancio\./ });
    await user.click(cansancio);
    expect(cansancio).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: /lista del supermercado/i }));

    const post = calls.find((c) => c.url.includes("/patient/sessions") && c.method === "POST");
    expect(post).toBeDefined();
    expect(JSON.parse(post.body)).toEqual({
      sections: [{ section_slug: "memoria_de_trabajo" }],
      patient_reported_mood: "cansancio",
    });
  });

  test("sin ánimo elegido en mobile no se envía patient_reported_mood", async () => {
    mockMobileViewport();
    loginBackendPatient();
    const calls = [];
    stubFetch(calls);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: /lista del supermercado/i }));

    const post = calls.find((c) => c.url.includes("/patient/sessions") && c.method === "POST");
    expect(post).toBeDefined();
    expect(JSON.parse(post.body).patient_reported_mood).toBeUndefined();
  });

  test("la selección de ánimo se conserva al volver a la pantalla de actividades", async () => {
    mockMobileViewport();
    loginBackendPatient();
    const calls = [];
    stubFetch(calls);
    const user = userEvent.setup();
    const { unmount } = render(<App />);

    await user.click(await screen.findByRole("button", { name: /^Bien\./ }));
    unmount();
    // Reload simulado: el ánimo de hoy se reconstruye desde el storage.
    render(<App />);
    const bien = await screen.findByRole("button", { name: /^Bien\./ });
    expect(bien).toHaveAttribute("aria-pressed", "true");
  });
});
