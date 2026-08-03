import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { App } from "./main.jsx";

function renderApp() {
  return render(<App />);
}

function setStoredProfessionalSession() {
  localStorage.setItem("ma_app_session_v1", JSON.stringify({ role: "professional", professionalId: "psico-01" }));
}

function setStoredPatientSession() {
  localStorage.setItem("ma_app_session_v1", JSON.stringify({ role: "patient", professionalId: "psico-01" }));
}

function setStoredSessions(sessions) {
  localStorage.setItem("ma_sessions_v1", JSON.stringify(sessions));
}

describe("MenteActiva critical flows", () => {
  test("renders the main login page", () => {
    renderApp();

    expect(screen.getByRole("heading", { name: /jardin cognitivo/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /entrar como paciente/i })).toBeInTheDocument();
    expect(screen.getByDisplayValue("elena.rios@demo.com")).toBeInTheDocument();
  });

  test("shows validation for invalid login and navigates after a valid professional login", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.type(screen.getByLabelText(/email/i), "wrong@demo.com");
    await user.clear(screen.getByLabelText(/clave/i));
    await user.type(screen.getByLabelText(/clave/i), "bad-pass");
    await user.click(screen.getByRole("button", { name: /entrar como paciente/i }));

    expect(screen.getByText(/credenciales incorrectas/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /psicologo/i }));
    await user.click(screen.getByRole("button", { name: /entrar como psicologo/i }));

    expect(await screen.findByRole("heading", { name: /seguimiento/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^paciente$/i }));
    expect(await screen.findByRole("heading", { name: /todos los desafios del jardin/i })).toBeInTheDocument();
  });

  test("restores the professional route from direct URL and persisted session", async () => {
    setStoredProfessionalSession();
    window.location.hash = "#/professional";

    renderApp();

    expect(await screen.findByRole("heading", { name: /seguimiento/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /precision por sesion/i })).toBeInTheDocument();
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
      await user.click(screen.getByRole("button", { name: /siguiente|finalizar sesion/i }));
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
    setStoredProfessionalSession();
    window.location.hash = "#/professional";
    renderApp();

    await user.click(screen.getByRole("button", { name: /crear paciente/i }));
    expect(await screen.findByText(/ingresa un nombre/i)).toBeInTheDocument();

    const nameInput = screen.getByLabelText(/nombre del paciente/i);
    const ageInput = screen.getByLabelText(/^edad$/i);
    await user.type(nameInput, "Maria Perez");
    await user.clear(ageInput);
    await user.type(ageInput, "300");
    await user.click(screen.getByRole("button", { name: /crear paciente/i }));
    expect(await screen.findByText(/la edad debe ser un numero entero entre 1 y 120/i)).toBeInTheDocument();

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
    vi.stubGlobal("fetch", vi.fn(() => pending.promise));
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

    await user.click(screen.getByRole("button", { name: /generar observacion/i }));
    expect(screen.getByRole("button", { name: /generando/i })).toBeDisabled();

    pending.reject(new Error("network down"));

    expect(await screen.findByText(/sintesis local/i)).toBeInTheDocument();
    expect(screen.getByText(/precision promedio 80%/i)).toBeInTheDocument();
  });

  test("validates AI configuration inputs before saving", async () => {
    const user = userEvent.setup();
    setStoredProfessionalSession();
    window.location.hash = "#/professional";
    renderApp();

    const textarea = screen.getByLabelText(/como se mide y que tipo de preguntas debe hacer/i);
    const numberInput = screen.getByLabelText(/cantidad maxima de preguntas/i);

    await user.clear(textarea);
    await user.click(screen.getByRole("button", { name: /guardar criterio/i }));
    expect(await screen.findByText(/describe al menos una indicacion/i)).toBeInTheDocument();

    await user.type(textarea, "Indicaciones nuevas");
    await user.clear(numberInput);
    await user.type(numberInput, "11");
    await user.click(screen.getByRole("button", { name: /guardar criterio/i }));
    expect(await screen.findByText(/la cantidad maxima debe estar entre 1 y 10 preguntas/i)).toBeInTheDocument();

    await user.clear(numberInput);
    await user.type(numberInput, "6");
    await user.click(screen.getByRole("button", { name: /guardar criterio/i }));

    expect(await screen.findByText(/criterio guardado/i)).toBeInTheDocument();
  });
});
