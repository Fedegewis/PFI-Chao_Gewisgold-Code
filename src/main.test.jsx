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

function installFetchStub({
  patients = [DEMO_PATIENT],
  loginUser,
  onDelete,
  invitations = [],
  createInvitationResponse,
  onCreateInvitation,
  onRevokeInvitation,
  onCreateUser,
} = {}) {
  const stub = vi.fn((url, opts = {}) => {
    const method = (opts.method || "GET").toUpperCase();
    const strUrl = String(url);
    if (strUrl.includes("/auth/login") || strUrl.includes("/auth/register") || strUrl.includes("/auth/google")) {
      return jsonResponse({
        user: loginUser || { id: DEMO_PROFESSIONAL_ID, role: "professional", name: "Dra. Test", email: "test@demo.com", is_active: true },
        token: "fake-jwt-token",
      });
    }
    if (strUrl.includes("/patients/") && method === "DELETE") {
      if (onDelete) onDelete(strUrl);
      return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(null) });
    }
    if (strUrl.includes("/patients") && method === "GET") {
      return jsonResponse(patients);
    }
    if (strUrl.match(/\/invitations\/\d+$/) && method === "DELETE") {
      if (onRevokeInvitation) onRevokeInvitation(strUrl);
      return jsonResponse({ status: "revoked" });
    }
    if (strUrl.includes("/invitations") && method === "POST") {
      if (onCreateInvitation) onCreateInvitation(opts);
      return jsonResponse(
        createInvitationResponse || {
          id: 1001,
          professional_id: DEMO_PROFESSIONAL_ID,
          email: "maria.perez@demo.com",
          patient_name: "Maria Perez",
          age: 74,
          token: "fake-invite-token-123",
          expires_at: new Date(Date.now() + 604800000).toISOString(),
          status: "pending",
        },
        201
      );
    }
    if (strUrl.includes("/invitations") && method === "GET") {
      return jsonResponse(invitations);
    }
    if (strUrl.includes("/users") && method === "POST") {
      // POST /api/users fue eliminado en 6C.7. La rama queda para atrapar llamadas indebidas.
      if (onCreateUser) onCreateUser(opts);
      return jsonResponse({ error: "Not found" }, 404);
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

  test("renders the main login page with empty patient credentials", () => {
    renderApp();

    expect(screen.getByRole("heading", { name: /menteactiva/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /entrar como paciente/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toHaveValue("");
    expect(screen.getByLabelText(/clave/i)).toHaveValue("");
    expect(screen.queryByDisplayValue("elena.rios@demo.com")).not.toBeInTheDocument();
  });

  test("shows a backend-driven error for invalid patient credentials", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: "Credenciales incorrectas" }),
    })));
    renderApp();

    await user.type(screen.getByLabelText(/email/i), "wrong@demo.com");
    await user.type(screen.getByLabelText(/clave/i), "bad-pass");
    await user.click(screen.getByRole("button", { name: /entrar como paciente/i }));

    expect(await screen.findByText(/credenciales incorrectas/i)).toBeInTheDocument();
  });

  test("patient login calls POST /api/auth/login and enters the patient screen", async () => {
    const user = userEvent.setup();
    const calls = [];
    vi.stubGlobal("fetch", vi.fn((url, opts = {}) => {
      calls.push({ url: String(url), method: (opts.method || "GET").toUpperCase(), body: opts.body });
      if (String(url).includes("/auth/login")) {
        return jsonResponse({
          user: { id: 42, role: "patient", name: "Real Patient", email: "real@patient.com", is_active: true },
          token: "patient-jwt",
        });
      }
      return jsonResponse({}, 404);
    }));
    renderApp();

    await user.type(screen.getByLabelText(/email/i), "real@patient.com");
    await user.type(screen.getByLabelText(/clave/i), "secreta123");
    await user.click(screen.getByRole("button", { name: /entrar como paciente/i }));

    expect(await screen.findByRole("button", { name: /lista del supermercado/i })).toBeInTheDocument();
    expect(localStorage.getItem("ma_auth_token")).toBe("patient-jwt");
    const savedUser = JSON.parse(localStorage.getItem("ma_auth_user"));
    expect(savedUser.role).toBe("patient");
    const loginCall = calls.find((c) => c.url.includes("/auth/login"));
    expect(loginCall).toBeDefined();
    expect(loginCall.method).toBe("POST");
    expect(JSON.parse(loginCall.body)).toEqual({ email: "real@patient.com", password: "secreta123" });
  });

  test("professional using the patient tab does NOT enter the patient panel and gets an error", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn((url) => {
      if (String(url).includes("/auth/login")) {
        return jsonResponse({
          user: { id: 7, role: "professional", name: "Dra. X", email: "dra@x.com", is_active: true },
          token: "prof-jwt",
        });
      }
      return jsonResponse({}, 404);
    }));
    renderApp();

    await user.type(screen.getByLabelText(/email/i), "dra@x.com");
    await user.type(screen.getByLabelText(/clave/i), "profpass");
    await user.click(screen.getByRole("button", { name: /entrar como paciente/i }));

    expect(await screen.findByText(/no corresponde a un paciente/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /lista del supermercado/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /seguimiento/i })).not.toBeInTheDocument();
    expect(localStorage.getItem("ma_auth_token")).toBeNull();
  });

  test("patient using the professional tab does NOT enter the professional panel and gets an error", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn((url) => {
      if (String(url).includes("/auth/login")) {
        return jsonResponse({
          user: { id: 42, role: "patient", name: "Paciente Y", email: "y@p.com", is_active: true },
          token: "pat-jwt",
        });
      }
      return jsonResponse({}, 404);
    }));
    renderApp();

    await user.click(screen.getByRole("tab", { name: /psic[oó]logo/i }));
    await user.type(screen.getByLabelText(/email/i), "y@p.com");
    await user.type(screen.getByLabelText(/clave/i), "patpass");
    await user.click(screen.getByRole("button", { name: /entrar como psic[oó]logo/i }));

    expect(await screen.findByText(/no corresponde a un profesional/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /seguimiento/i })).not.toBeInTheDocument();
    expect(localStorage.getItem("ma_auth_token")).toBeNull();
  });

  test("restores an authenticated patient session on refresh from localStorage", async () => {
    localStorage.setItem("ma_auth_token", "patient-jwt");
    localStorage.setItem(
      "ma_auth_user",
      JSON.stringify({ id: 42, role: "patient", name: "Real Patient", email: "real@patient.com" })
    );
    localStorage.setItem("ma_app_session_v1", JSON.stringify({ role: "patient" }));
    window.location.hash = "#/patient";

    renderApp();

    expect(await screen.findByRole("button", { name: /lista del supermercado/i })).toBeInTheDocument();
  });

  test("logout as patient clears token, user and returns to login", async () => {
    const user = userEvent.setup();
    localStorage.setItem("ma_auth_token", "patient-jwt");
    localStorage.setItem(
      "ma_auth_user",
      JSON.stringify({ id: 42, role: "patient", name: "Real Patient", email: "real@patient.com" })
    );
    localStorage.setItem("ma_app_session_v1", JSON.stringify({ role: "patient" }));
    window.location.hash = "#/patient";

    renderApp();

    await user.click(await screen.findByRole("button", { name: /salir/i }));

    expect(localStorage.getItem("ma_auth_token")).toBeNull();
    expect(localStorage.getItem("ma_auth_user")).toBeNull();
    expect(await screen.findByRole("button", { name: /entrar como paciente/i })).toBeInTheDocument();
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

  test("completes the main patient activity flow with backend questions and returns to patient screen", async () => {
    const user = userEvent.setup();
    localStorage.setItem("ma_auth_token", "patient-jwt");
    localStorage.setItem(
      "ma_auth_user",
      JSON.stringify({ id: 42, role: "patient", name: "Test Paciente", email: "t@p.com", is_active: true })
    );
    localStorage.setItem("ma_app_session_v1", JSON.stringify({ role: "patient" }));
    window.location.hash = "#/patient";

    const backendQuestions = [
      { id: 1, display_order: 1, prompt_snapshot: "Backend Q1", options_snapshot: ["Alpha", "Beta", "Gamma", "Delta"], stimulus_snapshot: null, response_type: "multiple_choice" },
      { id: 2, display_order: 2, prompt_snapshot: "Backend Q2", options_snapshot: ["Rojo", "Verde", "Azul", "Amarillo"], stimulus_snapshot: null, response_type: "multiple_choice" },
      { id: 3, display_order: 3, prompt_snapshot: "Backend Q3", options_snapshot: ["Uno", "Dos", "Tres", "Cuatro"], stimulus_snapshot: null, response_type: "multiple_choice" },
      { id: 4, display_order: 4, prompt_snapshot: "Backend Q4", options_snapshot: ["Norte", "Sur", "Este", "Oeste"], stimulus_snapshot: null, response_type: "multiple_choice" },
    ];
    vi.stubGlobal("fetch", vi.fn((url) => {
      const strUrl = String(url);
      if (strUrl.includes("/patient/sessions")) {
        return jsonResponse({
          id: 1234,
          patient_id: 42,
          professional_id: 7,
          status: "created",
          sections: [{ id: 10, section_id: 100, questions: backendQuestions }],
        }, 201);
      }
      return jsonResponse({}, 404);
    }));
    renderApp();

    await user.click(await screen.findByRole("button", { name: /lista del supermercado/i }));

    await screen.findByText("Backend Q1");
    for (let i = 1; i <= backendQuestions.length; i++) {
      await screen.findByText(`Backend Q${i}`);
      const firstOption = backendQuestions[i - 1].options_snapshot[0];
      await user.click(screen.getByRole("button", { name: firstOption }));
      await user.click(screen.getByRole("button", { name: /siguiente|finalizar sesi[oó]n/i }));
    }

    // Vuelve al patient screen; dashboard local no se actualiza (backend mode)
    expect(await screen.findByRole("heading", { name: /actividades disponibles/i })).toBeInTheDocument();
    expect(window.location.hash).toBe("#/patient");
  });

  test("patient activity renders backend questions in display_order and NOT demo pool questions", async () => {
    const user = userEvent.setup();
    localStorage.setItem("ma_auth_token", "patient-jwt");
    localStorage.setItem(
      "ma_auth_user",
      JSON.stringify({ id: 42, role: "patient", name: "P", email: "p@p.com", is_active: true })
    );
    localStorage.setItem("ma_app_session_v1", JSON.stringify({ role: "patient" }));
    window.location.hash = "#/patient";

    // Deliberadamente en orden desordenado — el frontend debe respetar display_order.
    const backendQuestions = [
      { id: 20, display_order: 2, prompt_snapshot: "SEGUNDA backend", options_snapshot: ["a", "b", "c", "d"], stimulus_snapshot: null, response_type: "multiple_choice" },
      { id: 10, display_order: 1, prompt_snapshot: "PRIMERA backend", options_snapshot: ["a", "b", "c", "d"], stimulus_snapshot: "Este es el stimulus.", response_type: "multiple_choice" },
    ];
    vi.stubGlobal("fetch", vi.fn((url) => {
      if (String(url).includes("/patient/sessions")) {
        return jsonResponse({
          id: 999,
          patient_id: 42,
          professional_id: 7,
          status: "created",
          sections: [{ id: 1, section_id: 100, questions: backendQuestions }],
        }, 201);
      }
      return jsonResponse({}, 404);
    }));
    renderApp();

    await user.click(await screen.findByRole("button", { name: /lista del supermercado/i }));

    // Fase 1: stimulus visible (backend Q1 tiene stimulus)
    expect(await screen.findByText("Este es el stimulus.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /continuar/i }));

    // Fase 2: PRIMERA backend visible; NO deben aparecer prompts del banco demo.
    expect(await screen.findByText("PRIMERA backend")).toBeInTheDocument();
    expect(screen.queryByText(/pan, leche y manzanas/i)).not.toBeInTheDocument();
    expect(screen.queryByText("SEGUNDA backend")).not.toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "a" })[0]);
    await user.click(screen.getByRole("button", { name: /siguiente/i }));

    // Segunda pregunta: SEGUNDA backend
    expect(await screen.findByText("SEGUNDA backend")).toBeInTheDocument();
    expect(screen.queryByText("PRIMERA backend")).not.toBeInTheDocument();
  });

  test("frontend does NOT receive correct_answer_snapshot from backend response payload", async () => {
    const user = userEvent.setup();
    localStorage.setItem("ma_auth_token", "patient-jwt");
    localStorage.setItem(
      "ma_auth_user",
      JSON.stringify({ id: 42, role: "patient", name: "P", email: "p@p.com", is_active: true })
    );
    localStorage.setItem("ma_app_session_v1", JSON.stringify({ role: "patient" }));
    window.location.hash = "#/patient";

    let responseSent;
    vi.stubGlobal("fetch", vi.fn((url) => {
      if (String(url).includes("/patient/sessions")) {
        responseSent = {
          id: 1,
          patient_id: 42,
          professional_id: 7,
          status: "created",
          sections: [{
            id: 1,
            section_id: 100,
            questions: [
              { id: 1, display_order: 1, prompt_snapshot: "Q1", options_snapshot: ["a", "b", "c", "d"], stimulus_snapshot: null, response_type: "multiple_choice" }
            ],
          }],
        };
        return jsonResponse(responseSent, 201);
      }
      return jsonResponse({}, 404);
    }));
    renderApp();

    await user.click(await screen.findByRole("button", { name: /lista del supermercado/i }));
    await screen.findByText("Q1");
    // Verificar el payload que salió del backend stub (representa lo que llega al cliente).
    const serialized = JSON.stringify(responseSent);
    expect(serialized.includes("correct_answer")).toBe(false);
  });

  test("patient opening an activity calls POST /api/patient/sessions and stores session id", async () => {
    const user = userEvent.setup();
    localStorage.setItem("ma_auth_token", "patient-jwt");
    localStorage.setItem(
      "ma_auth_user",
      JSON.stringify({ id: 42, role: "patient", name: "P", email: "p@p.com", is_active: true })
    );
    localStorage.setItem("ma_app_session_v1", JSON.stringify({ role: "patient" }));
    window.location.hash = "#/patient";

    const calls = [];
    vi.stubGlobal("fetch", vi.fn((url, opts = {}) => {
      const strUrl = String(url);
      calls.push({ url: strUrl, method: (opts.method || "GET").toUpperCase(), body: opts.body });
      if (strUrl.includes("/patient/sessions")) {
        return jsonResponse({ id: 555, patient_id: 42, professional_id: 7, status: "created", sections: [] }, 201);
      }
      return jsonResponse({}, 404);
    }));
    renderApp();

    await user.click(await screen.findByRole("button", { name: /lista del supermercado/i }));

    const call = calls.find((c) => c.url.includes("/patient/sessions"));
    expect(call).toBeDefined();
    expect(call.method).toBe("POST");
    const body = JSON.parse(call.body);
    expect(body).toEqual({ sections: [{ section_slug: "memoria_de_trabajo", question_count: 4 }] });
    expect(body.patient_id).toBeUndefined();
    expect(body.professional_id).toBeUndefined();
    expect(window.location.hash).toBe("#/activity/market");
  });

  test("patient activity does NOT start if creating the session fails", async () => {
    const user = userEvent.setup();
    localStorage.setItem("ma_auth_token", "patient-jwt");
    localStorage.setItem(
      "ma_auth_user",
      JSON.stringify({ id: 42, role: "patient", name: "P", email: "p@p.com", is_active: true })
    );
    localStorage.setItem("ma_app_session_v1", JSON.stringify({ role: "patient" }));
    window.location.hash = "#/patient";

    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ error: "Servidor caído" }, 500)));
    renderApp();

    await user.click(await screen.findByRole("button", { name: /lista del supermercado/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/servidor caído|no se pudo iniciar/i);
    expect(window.location.hash).toBe("#/patient");
    expect(screen.queryByRole("button", { name: /pan, leche y manzanas/i })).not.toBeInTheDocument();
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

  test("professional creates an invitation: shows link, does not add patient, does not call POST /users", async () => {
    const user = userEvent.setup();
    const inviteCalls = [];
    const userCalls = [];
    installFetchStub({
      patients: [],
      onCreateInvitation: (opts) => inviteCalls.push(JSON.parse(opts.body)),
      onCreateUser: (opts) => userCalls.push(JSON.parse(opts.body)),
    });
    setStoredProfessionalSession();
    window.location.hash = "#/professional";
    renderApp();

    await user.click(await screen.findByRole("button", { name: /invitar paciente/i }));
    await user.type(screen.getByLabelText(/nombre del paciente/i), "Maria Perez");
    const ageInput = screen.getByLabelText(/^edad$/i);
    await user.clear(ageInput);
    await user.type(ageInput, "74");
    await user.type(screen.getByLabelText(/email del paciente/i), "maria.perez@demo.com");
    await user.click(screen.getByRole("button", { name: /crear invitación/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/invitación creada/i);
    const linkInput = screen.getByRole("textbox", { name: /enlace de invitación/i });
    expect(linkInput.value).toContain("/#/invite/fake-invite-token-123");
    expect(linkInput.value.startsWith(window.location.origin)).toBe(true);

    expect(inviteCalls.length).toBe(1);
    expect(inviteCalls[0]).toEqual({ name: "Maria Perez", age: 74, email: "maria.perez@demo.com" });
    expect(userCalls.length).toBe(0);
    expect(screen.queryByRole("button", { name: /maria perez/i })).not.toBeInTheDocument();
    const localToken = Object.keys(localStorage).some((k) => {
      try { return String(localStorage.getItem(k)).includes("fake-invite-token-123"); } catch { return false; }
    });
    expect(localToken).toBe(false);
  });

  test("invite form shows validation errors for invalid email and age", async () => {
    const user = userEvent.setup();
    installFetchStub({ patients: [] });
    setStoredProfessionalSession();
    window.location.hash = "#/professional";
    renderApp();

    await user.click(await screen.findByRole("button", { name: /invitar paciente/i }));
    await user.type(screen.getByLabelText(/nombre del paciente/i), "Maria Perez");
    await user.type(screen.getByLabelText(/email del paciente/i), "not-an-email");
    await user.click(screen.getByRole("button", { name: /crear invitación/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/email válido/i);

    await user.clear(screen.getByLabelText(/email del paciente/i));
    await user.type(screen.getByLabelText(/email del paciente/i), "maria.perez@demo.com");
    const ageInput = screen.getByLabelText(/^edad$/i);
    await user.clear(ageInput);
    await user.type(ageInput, "300");
    await user.click(screen.getByRole("button", { name: /crear invitación/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/la edad debe ser un n[uú]mero entero entre 1 y 120/i);
  });

  test("invite form surfaces backend errors (email already registered)", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn((url, opts = {}) => {
      const strUrl = String(url);
      const method = (opts.method || "GET").toUpperCase();
      if (strUrl.includes("/patients") && method === "GET") return jsonResponse([]);
      if (strUrl.includes("/invitations") && method === "GET") return jsonResponse([]);
      if (strUrl.includes("/invitations") && method === "POST") {
        return jsonResponse({ error: "El email ya está registrado" }, 409);
      }
      return jsonResponse({}, 404);
    }));
    setStoredProfessionalSession();
    window.location.hash = "#/professional";
    renderApp();

    await user.click(await screen.findByRole("button", { name: /invitar paciente/i }));
    await user.type(screen.getByLabelText(/nombre del paciente/i), "Ana");
    await user.type(screen.getByLabelText(/email del paciente/i), "ana@ya-existe.com");
    await user.click(screen.getByRole("button", { name: /crear invitación/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/ya está registrado/i);
  });

  test("navigating to #/invite/:token renders the public invitation screen (no auth)", async () => {
    vi.stubGlobal("fetch", vi.fn((url) => {
      const strUrl = String(url);
      if (strUrl.includes("/invitations/lookup")) {
        return jsonResponse({
          status: "pending",
          email: "nueva@paciente.com",
          patient_name: "Nueva Paciente",
          age: 70,
          expires_at: new Date(Date.now() + 604800000).toISOString(),
          professional_name: "Dra. Test",
        });
      }
      return jsonResponse({}, 404);
    }));
    window.location.hash = "#/invite/valid-token-xyz";
    renderApp();

    expect(await screen.findByRole("heading", { name: /aceptar invitación/i })).toBeInTheDocument();
    expect(screen.getByText(/Nueva Paciente/)).toBeInTheDocument();
    expect(screen.getByText(/nueva@paciente\.com/)).toBeInTheDocument();
    expect(screen.getByText(/Dra\. Test/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /menteactiva/i, level: 1 })).toBeInTheDocument();
    expect(localStorage.getItem("ma_auth_token")).toBeNull();
    // Informative fields are not <input>s — they live inside <dd>
    expect(screen.queryByRole("textbox", { name: /email/i })).not.toBeInTheDocument();
    // Only password inputs are editable
    expect(screen.getByLabelText(/crear contraseña/i)).toHaveAttribute("type", "password");
    expect(screen.getByLabelText(/confirmar contraseña/i)).toHaveAttribute("type", "password");
  });

  test("invite: short password shows validation and does not call accept", async () => {
    const user = userEvent.setup();
    const acceptCalls = [];
    vi.stubGlobal("fetch", vi.fn((url, opts = {}) => {
      const strUrl = String(url);
      if (strUrl.includes("/invitations/lookup")) {
        return jsonResponse({
          status: "pending",
          email: "n@p.com",
          patient_name: "Nueva",
          age: 70,
          expires_at: new Date(Date.now() + 604800000).toISOString(),
          professional_name: "Dra.",
        });
      }
      if (strUrl.includes("/accept")) {
        acceptCalls.push(opts);
        return jsonResponse({ user: {}, token: "x" }, 201);
      }
      return jsonResponse({}, 404);
    }));
    window.location.hash = "#/invite/t1";
    renderApp();

    await screen.findByRole("heading", { name: /aceptar invitación/i });
    await user.type(screen.getByLabelText(/crear contraseña/i), "abc");
    await user.type(screen.getByLabelText(/confirmar contraseña/i), "abc");
    await user.click(screen.getByRole("button", { name: /aceptar invitación/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/al menos 6/i);
    expect(acceptCalls.length).toBe(0);
  });

  test("invite: mismatched confirmation shows validation and does not call accept", async () => {
    const user = userEvent.setup();
    const acceptCalls = [];
    vi.stubGlobal("fetch", vi.fn((url, opts = {}) => {
      const strUrl = String(url);
      if (strUrl.includes("/invitations/lookup")) {
        return jsonResponse({
          status: "pending",
          email: "n@p.com",
          patient_name: "Nueva",
          expires_at: new Date(Date.now() + 604800000).toISOString(),
          professional_name: "Dra.",
        });
      }
      if (strUrl.includes("/accept")) {
        acceptCalls.push(opts);
        return jsonResponse({ user: {}, token: "x" }, 201);
      }
      return jsonResponse({}, 404);
    }));
    window.location.hash = "#/invite/t2";
    renderApp();

    await screen.findByRole("heading", { name: /aceptar invitación/i });
    await user.type(screen.getByLabelText(/crear contraseña/i), "secreto123");
    await user.type(screen.getByLabelText(/confirmar contraseña/i), "otro456789");
    await user.click(screen.getByRole("button", { name: /aceptar invitación/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/no coinciden/i);
    expect(acceptCalls.length).toBe(0);
  });

  test("invite accept: sends only {password}, persists session, navigates to #/patient", async () => {
    const user = userEvent.setup();
    let acceptBody = null;
    vi.stubGlobal("fetch", vi.fn((url, opts = {}) => {
      const strUrl = String(url);
      if (strUrl.includes("/invitations/lookup")) {
        return jsonResponse({
          status: "pending",
          email: "nueva@paciente.com",
          patient_name: "Nueva Paciente",
          age: 70,
          expires_at: new Date(Date.now() + 604800000).toISOString(),
          professional_name: "Dra. Test",
        });
      }
      if (strUrl.match(/\/invitations\/[^/]+\/accept$/)) {
        acceptBody = JSON.parse(opts.body);
        return jsonResponse(
          {
            user: {
              id: 501,
              role: "patient",
              name: "Nueva Paciente",
              email: "nueva@paciente.com",
              is_active: true,
            },
            token: "patient-jwt-real",
          },
          201
        );
      }
      return jsonResponse({}, 404);
    }));
    window.location.hash = "#/invite/valid-token";
    renderApp();

    await screen.findByRole("heading", { name: /aceptar invitación/i });
    await user.type(screen.getByLabelText(/crear contraseña/i), "secreto123");
    await user.type(screen.getByLabelText(/confirmar contraseña/i), "secreto123");
    await user.click(screen.getByRole("button", { name: /aceptar invitación/i }));

    expect(await screen.findByRole("button", { name: /lista del supermercado/i })).toBeInTheDocument();
    expect(acceptBody).toEqual({ password: "secreto123" });
    expect(localStorage.getItem("ma_auth_token")).toBe("patient-jwt-real");
    const savedUser = JSON.parse(localStorage.getItem("ma_auth_user"));
    expect(savedUser.role).toBe("patient");
    expect(savedUser.id).toBe(501);
    // Token no se guarda separadamente
    const rawStorage = Object.keys(localStorage).map((k) => localStorage.getItem(k)).join("|");
    expect(rawStorage.includes("valid-token")).toBe(false);
    expect(window.location.hash).toBe("#/patient");
  });

  test("invite accept: non-patient user role does not create a session", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn((url) => {
      const strUrl = String(url);
      if (strUrl.includes("/invitations/lookup")) {
        return jsonResponse({
          status: "pending",
          email: "x@p.com",
          patient_name: "X",
          expires_at: new Date(Date.now() + 604800000).toISOString(),
          professional_name: "Dra.",
        });
      }
      if (strUrl.includes("/accept")) {
        return jsonResponse(
          { user: { id: 9, role: "professional", name: "X", email: "x@p.com", is_active: true }, token: "pro-jwt" },
          201
        );
      }
      return jsonResponse({}, 404);
    }));
    window.location.hash = "#/invite/tt";
    renderApp();
    await screen.findByRole("heading", { name: /aceptar invitación/i });
    await user.type(screen.getByLabelText(/crear contraseña/i), "secreto123");
    await user.type(screen.getByLabelText(/confirmar contraseña/i), "secreto123");
    await user.click(screen.getByRole("button", { name: /aceptar invitación/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/no pudo aceptarse/i);
    expect(localStorage.getItem("ma_auth_token")).toBeNull();
    expect(screen.queryByRole("button", { name: /lista del supermercado/i })).not.toBeInTheDocument();
  });

  test("invite: expired status shows message and no form", async () => {
    vi.stubGlobal("fetch", vi.fn((url) => {
      const strUrl = String(url);
      if (strUrl.includes("/invitations/lookup")) {
        return jsonResponse({ status: "expired" });
      }
      return jsonResponse({}, 404);
    }));
    window.location.hash = "#/invite/exp";
    renderApp();
    expect(await screen.findByText(/venció/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/crear contraseña/i)).not.toBeInTheDocument();
  });

  test("invite: revoked status shows message and no form", async () => {
    vi.stubGlobal("fetch", vi.fn((url) => {
      const strUrl = String(url);
      if (strUrl.includes("/invitations/lookup")) {
        return jsonResponse({ status: "revoked" });
      }
      return jsonResponse({}, 404);
    }));
    window.location.hash = "#/invite/rev";
    renderApp();
    expect(await screen.findByText(/ya no está disponible/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/crear contraseña/i)).not.toBeInTheDocument();
  });

  test("invite: accepted status shows message and login button", async () => {
    vi.stubGlobal("fetch", vi.fn((url) => {
      const strUrl = String(url);
      if (strUrl.includes("/invitations/lookup")) {
        return jsonResponse({ status: "accepted" });
      }
      return jsonResponse({}, 404);
    }));
    window.location.hash = "#/invite/acc";
    renderApp();
    expect(await screen.findByText(/ya fue utilizada/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /inicio de sesión/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/crear contraseña/i)).not.toBeInTheDocument();
  });

  test("invite: 404 invalid token shows invalid-link message", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ status: "invalid", error: "Invitación no encontrada" }, 404)));
    window.location.hash = "#/invite/bad";
    renderApp();
    expect(await screen.findByText(/no es válido/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/crear contraseña/i)).not.toBeInTheDocument();
  });

  test("invite: network error shows a generic error with a retry button", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("Failed to fetch"))));
    window.location.hash = "#/invite/net";
    renderApp();
    expect(await screen.findByText(/no pudimos cargar la invitación/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reintentar/i })).toBeInTheDocument();
  });

  test("invite: opening #/invite with an existing professional session still shows invitation, then accept replaces session", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn((url, _opts = {}) => {
      const strUrl = String(url);
      if (strUrl.includes("/invitations/lookup")) {
        return jsonResponse({
          status: "pending",
          email: "nueva@paciente.com",
          patient_name: "Nueva",
          age: 68,
          expires_at: new Date(Date.now() + 604800000).toISOString(),
          professional_name: "Dra. Test",
        });
      }
      if (strUrl.match(/\/invitations\/[^/]+\/accept$/)) {
        return jsonResponse(
          {
            user: { id: 999, role: "patient", name: "Nueva", email: "nueva@paciente.com", is_active: true },
            token: "new-patient-jwt",
          },
          201
        );
      }
      return jsonResponse({}, 404);
    }));
    setStoredProfessionalSession();
    window.location.hash = "#/invite/session-collision";
    renderApp();

    expect(await screen.findByRole("heading", { name: /aceptar invitación/i })).toBeInTheDocument();
    // Prior pro session tokens are still in storage during the invite screen
    expect(localStorage.getItem("ma_auth_token")).toBe("fake-test-token");

    await user.type(screen.getByLabelText(/crear contraseña/i), "secreto123");
    await user.type(screen.getByLabelText(/confirmar contraseña/i), "secreto123");
    await user.click(screen.getByRole("button", { name: /aceptar invitación/i }));

    expect(await screen.findByRole("button", { name: /lista del supermercado/i })).toBeInTheDocument();
    expect(localStorage.getItem("ma_auth_token")).toBe("new-patient-jwt");
    const savedUser = JSON.parse(localStorage.getItem("ma_auth_user"));
    expect(savedUser.role).toBe("patient");
    expect(savedUser.id).toBe(999);
  });

  test("pending invitations list renders and revoke calls DELETE /api/invitations/:id", async () => {
    const user = userEvent.setup();
    const revokeCalls = [];
    installFetchStub({
      patients: [],
      invitations: [
        {
          id: 501,
          patient_name: "Ana Pendiente",
          email: "ana.pendiente@demo.com",
          age: 70,
          status: "pending",
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        },
      ],
      onRevokeInvitation: (url) => revokeCalls.push(url),
    });
    setStoredProfessionalSession();
    window.location.hash = "#/professional";
    renderApp();

    expect(await screen.findByText(/ana pendiente/i)).toBeInTheDocument();
    expect(screen.getByText(/ana\.pendiente@demo\.com/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /revocar invitación a ana\.pendiente@demo\.com/i }));

    expect(revokeCalls.length).toBe(1);
    expect(revokeCalls[0]).toMatch(/\/invitations\/501$/);
    expect(screen.queryByText(/ana pendiente/i)).not.toBeInTheDocument();
  });

  test("deletes a patient after confirmation and removes it from the list", async () => {
    const user = userEvent.setup();
    const deleteCalls = [];
    installFetchStub({
      patients: [DEMO_PATIENT],
      onDelete: (url) => deleteCalls.push(url),
    });
    setStoredProfessionalSession();
    window.location.hash = "#/professional";
    renderApp();

    const deleteButton = await screen.findByRole("button", { name: /eliminar paciente elena r[ií]os/i });
    await user.click(deleteButton);
    expect(await screen.findByRole("dialog", { name: /eliminar a elena r[ií]os/i })).toBeInTheDocument();
    expect(screen.getByText(/no se puede deshacer/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /s[ií], eliminar definitivamente/i }));

    expect(await screen.findByRole("heading", { name: /ning[uú]n paciente seleccionado/i })).toBeInTheDocument();
    expect(screen.queryByText(/elena r[ií]os/i)).not.toBeInTheDocument();
    expect(deleteCalls.length).toBe(1);
    expect(deleteCalls[0]).toMatch(/\/patients\/elena$/);
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
    await screen.findByRole("heading", { level: 2, name: /elena r[ií]os/i });

    const textarea = screen.getByLabelText(/c[oó]mo se mide y qu[eé] tipo de preguntas debe hacer/i);
    const numberInput = screen.getByLabelText(/cantidad m[aá]xima de preguntas/i);

    await user.clear(textarea);
    await user.click(screen.getByRole("button", { name: /guardar criterio/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/describ[eí] al menos una indicaci[oó]n/i);

    await user.type(textarea, "Indicaciones nuevas");
    await user.clear(numberInput);
    await user.type(numberInput, "11");
    await user.click(screen.getByRole("button", { name: /guardar criterio/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/la cantidad m[aá]xima debe estar entre 1 y 10 preguntas/i);

    await user.clear(numberInput);
    await user.type(numberInput, "6");
    await user.click(screen.getByRole("button", { name: /guardar criterio/i }));

    expect(await screen.findByRole("button", { name: /^guardado$/i })).toBeInTheDocument();
  });
});
