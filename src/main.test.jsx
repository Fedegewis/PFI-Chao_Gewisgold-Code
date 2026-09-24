import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { App } from "./main.jsx";

function renderApp() {
  return render(<App />);
}

const DEMO_PROFESSIONAL_ID = "psico-01";
const DEMO_PATIENT = {
  id: "elena",
  role: "patient",
  name: "Elena Ríos",
  email: "elena.rios@demo.com",
  age: 72,
  professional_id: DEMO_PROFESSIONAL_ID,
  is_active: true,
};

function jsonResponse(body, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
}

function installFetchStub({ patients = [DEMO_PATIENT], loginUser, createPatientResponse } = {}) {
  const stub = vi.fn((url, opts = {}) => {
    const method = (opts.method || "GET").toUpperCase();
    if (url.includes("/auth/login") || url.includes("/auth/register") || url.includes("/auth/google")) {
      return jsonResponse({
        user: loginUser || { id: DEMO_PROFESSIONAL_ID, role: "professional", name: "Dra. Test", email: "test@demo.com", is_active: true },
        token: "fake-jwt-token",
      });
    }
    if (url.includes("/patients") && method === "GET") {
      return jsonResponse(patients);
    }
    if (url.includes("/users") && method === "POST") {
      return jsonResponse(createPatientResponse || { ...DEMO_PATIENT, id: "maria-perez", name: "Maria Perez", age: 74, email: "maria.perez@demo.com" }, 201);
    }
    return jsonResponse({}, 404);
  });
  vi.stubGlobal("fetch", stub);
  return stub;
}

function setStoredProfessionalSession() {
  localStorage.setItem("ma_app_session_v1", JSON.stringify({ role: "professional", professionalId: DEMO_PROFESSIONAL_ID }));
  localStorage.setItem("ma_auth_token", "fake-test-token");
  localStorage.setItem("ma_auth_user", JSON.stringify({ id: DEMO_PROFESSIONAL_ID, role: "professional", name: "Dra. Test", email: "test@demo.com" }));
}

function setStoredPatientSession() {
  localStorage.setItem("ma_app_session_v1", JSON.stringify({ role: "patient", professionalId: "psico-01" }));
}

function setStoredSessions(sessions) {
  localStorage.setItem("ma_sessions_v1", JSON.stringify(sessions));
}

describe("MenteActiva critical flows", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    window.location.hash = "";
  });

  test("renders the main login page", () => {
    renderApp();

    expect(screen.getByRole("heading", { name: /menteactiva/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /entrar como paciente/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue("elena.rios@demo.com")).toBeInTheDocument();
  });

  test("shows validation for invalid patient login", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.clear(screen.getByLabelText(/email/i));
    await user.type(screen.getByLabelText(/email/i), "wrong@demo.com");
    await user.clear(screen.getByLabelText(/clave/i));
    await user.type(screen.getByLabelText(/clave/i), "bad-pass");
    await user.click(screen.getByRole("button", { name: /entrar como paciente/i }));

    expect(screen.getByText(/credenciales incorrectas/i)).toBeInTheDocument();
  });

  test("navigates after a valid professional login via API", async () => {
    installFetchStub({ patients: [] });

    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole("tab", { name: /psic[oó]logo/i }));
    await user.type(screen.getByLabelText(/email/i), "test@demo.com");
    await user.type(screen.getByLabelText(/clave/i), "segura123");
    await user.click(screen.getByRole("button", { name: /entrar como psic[oó]logo/i }));

    expect(await screen.findByRole("heading", { name: /seguimiento/i })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /ning[uú]n paciente seleccionado/i })).toBeInTheDocument();
  });

  test("restores the professional route from direct URL and persisted session with real patients", async () => {
    installFetchStub({ patients: [DEMO_PATIENT] });
    setStoredProfessionalSession();
    window.location.hash = "#/professional";

    renderApp();

    expect(await screen.findByRole("heading", { name: /seguimiento/i })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /precisi[oó]n por sesi[oó]n/i })).toBeInTheDocument();
  });

  test("professional with zero patients sees an empty state, not demo data", async () => {
    installFetchStub({ patients: [] });
    setStoredProfessionalSession();
    window.location.hash = "#/professional";

    renderApp();

    expect(await screen.findByRole("heading", { name: /seguimiento/i })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /ning[uú]n paciente seleccionado/i })).toBeInTheDocument();
    expect(screen.queryByText(/elena r[ií]os/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /precisi[oó]n por sesi[oó]n/i })).not.toBeInTheDocument();
  });

  test("completes the main patient activity flow and updates the dashboard state", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole("button", { name: /entrar como paciente/i }));
    await user.click(screen.getByRole("button", { name: /lista del supermercado/i }));

    const answers = [
      /pan, leche y manzanas/i,
      /pilas/i,
      /manzanas/i,
      /dos yogures y un queso/i,
      /tomate, queso y albahaca/i
    ];

    for (const answer of answers) {
      await user.click(await screen.findByRole("button", { name: answer }));
      await user.click(screen.getByRole("button", { name: /siguiente|finalizar sesi[oó]n/i }));
    }

    expect(await screen.findByText(/1 de 10 actividades hechas hoy/i)).toBeInTheDocument();
    expect(screen.getByText(/hecha por hoy/i)).toBeInTheDocument();
    expect(window.location.hash).toBe("#/patient");
  });

  test("restores an in-progress activity after remounting", async () => {
    const user = userEvent.setup();
    setStoredPatientSession();

    const firstRender = renderApp();
    await user.click(screen.getByRole("button", { name: /lista del supermercado/i }));
    await user.click(await screen.findByRole("button", { name: /pan, leche y manzanas/i }));
    await user.click(screen.getByRole("button", { name: /siguiente/i }));

    expect(await screen.findByText(/pregunta 2 de 5/i)).toBeInTheDocument();
    firstRender.unmount();

    renderApp();

    expect(await screen.findByText(/pregunta 2 de 5/i)).toBeInTheDocument();
    expect(screen.getByText(/respondidas: 1\/5/i)).toBeInTheDocument();
  });

  test("validates and completes the critical professional patient-creation form", async () => {
    const user = userEvent.setup();
    installFetchStub({ patients: [] });
    setStoredProfessionalSession();
    window.location.hash = "#/professional";
    renderApp();

    await user.click(screen.getByRole("button", { name: /agregar paciente/i }));
    await user.click(screen.getByRole("button", { name: /crear paciente/i }));
    expect(await screen.findByText(/ingres[aá] un nombre/i)).toBeInTheDocument();

    const nameInput = screen.getByLabelText(/nombre del paciente/i);
    const ageInput = screen.getByLabelText(/^edad$/i);
    await user.type(nameInput, "Maria Perez");
    await user.clear(ageInput);
    await user.type(ageInput, "300");
    await user.click(screen.getByRole("button", { name: /crear paciente/i }));
    expect(await screen.findByText(/la edad debe ser un n[uú]mero entero entre 1 y 120/i)).toBeInTheDocument();

    await user.clear(ageInput);
    await user.type(ageInput, "74");
    await user.click(screen.getByRole("button", { name: /crear paciente/i }));

    expect(await screen.findByText(/paciente creado correctamente/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /maria perez/i })).toBeInTheDocument();
  });

  test("shows loading and fallback error handling for AI observations", async () => {
    const user = userEvent.setup();
    const pending = {};
    pending.promise = new Promise((resolve, reject) => {
      pending.resolve = resolve;
      pending.reject = reject;
    });
    vi.stubGlobal("fetch", vi.fn((url) => {
      // Endpoint de pacientes: devolvemos el paciente demo para llegar a la ficha.
      if (String(url).includes("/patients")) {
        return jsonResponse([DEMO_PATIENT]);
      }
      // Cualquier otra llamada (observación IA) queda pendiente hasta que el test decida.
      return pending.promise;
    }));
    setStoredProfessionalSession();
    setStoredSessions([
      {
        id: "elena-market-1",
        patientId: "elena",
        activityId: "market",
        activityTitle: "Lista del supermercado",
        skill: "Memoria",
        date: "2026-08-01T12:00:00.000Z",
        correct: 4,
        total: 5,
        accuracy: 80,
        avgLatencyMs: 3200
      }
    ]);
    window.location.hash = "#/professional";

    renderApp();

    await user.click(await screen.findByRole("button", { name: /generar observaci[oó]n/i }));
    expect(screen.getByRole("button", { name: /generando/i })).toBeDisabled();

    pending.reject(new Error("network down"));

    expect(await screen.findByText(/s[ií]ntesis local/i)).toBeInTheDocument();
    expect(screen.getByText(/precisi[oó]n promedio 80%/i)).toBeInTheDocument();
  });

  test("validates AI configuration inputs before saving", async () => {
    const user = userEvent.setup();
    installFetchStub({ patients: [DEMO_PATIENT] });
    setStoredProfessionalSession();
    window.location.hash = "#/professional";
    renderApp();
    await screen.findByRole("heading", { name: /ficha del usuario/i });

    const textarea = screen.getByLabelText(/c[oó]mo se mide y qu[eé] tipo de preguntas debe hacer/i);
    const numberInput = screen.getByLabelText(/cantidad m[aá]xima de preguntas/i);

    await user.clear(textarea);
    await user.click(screen.getByRole("button", { name: /guardar criterio/i }));
    expect(await screen.findByText(/describ[eí] al menos una indicaci[oó]n/i)).toBeInTheDocument();

    await user.type(textarea, "Indicaciones nuevas");
    await user.clear(numberInput);
    await user.type(numberInput, "11");
    await user.click(screen.getByRole("button", { name: /guardar criterio/i }));
    expect(await screen.findByText(/la cantidad m[aá]xima debe estar entre 1 y 10 preguntas/i)).toBeInTheDocument();

    await user.clear(numberInput);
    await user.type(numberInput, "6");
    await user.click(screen.getByRole("button", { name: /guardar criterio/i }));

    expect(await screen.findByText(/criterio guardado/i)).toBeInTheDocument();
  });
});
