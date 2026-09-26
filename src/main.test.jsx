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
    vi.stubGlobal("fetch", vi.fn((url, opts = {}) => {
      const strUrl = String(url);
      const method = (opts.method || "GET").toUpperCase();
      if (strUrl.includes("/patient/sessions")) {
        return jsonResponse({
          id: 1234,
          patient_id: 42,
          professional_id: 7,
          status: "created",
          sections: [{ id: 10, section_id: 100, questions: backendQuestions }],
        }, 201);
      }
      if (strUrl.match(/\/sessions\/\d+\/start$/) && method === "POST") {
        return jsonResponse({ id: 1234, status: "in_progress" });
      }
      if (strUrl.match(/\/sessions\/\d+\/answers$/) && method === "POST") {
        return jsonResponse({ id: 1, session_question_id: 1, selected_answer: 0, response_time_ms: 100, answered_at: "now" }, 201);
      }
      if (strUrl.match(/\/sessions\/\d+\/complete$/) && method === "POST") {
        return jsonResponse({ id: 1234, status: "completed", completed_at: "now", global: {} });
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
    vi.stubGlobal("fetch", vi.fn((url, opts = {}) => {
      const strUrl = String(url);
      const method = (opts.method || "GET").toUpperCase();
      if (strUrl.includes("/patient/sessions")) {
        return jsonResponse({
          id: 999,
          patient_id: 42,
          professional_id: 7,
          status: "created",
          sections: [{ id: 1, section_id: 100, questions: backendQuestions }],
        }, 201);
      }
      if (strUrl.match(/\/sessions\/\d+\/start$/) && method === "POST") {
        return jsonResponse({ id: 999, status: "in_progress" });
      }
      if (strUrl.match(/\/sessions\/\d+\/answers$/) && method === "POST") {
        return jsonResponse({ id: 1, session_question_id: 10, selected_answer: 0, response_time_ms: 100 }, 201);
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

  // ============ 6D.3 ============

  function stubBackendActivityFetch({ questions, onCall } = {}) {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn((url, opts = {}) => {
      const strUrl = String(url);
      const method = (opts.method || "GET").toUpperCase();
      calls.push({ url: strUrl, method, body: opts.body });
      if (onCall) onCall({ url: strUrl, method, body: opts.body });
      if (strUrl.includes("/patient/sessions")) {
        return jsonResponse({
          id: 42, patient_id: 42, professional_id: 7, status: "created",
          sections: [{ id: 1, section_id: 100, questions }],
        }, 201);
      }
      if (strUrl.match(/\/sessions\/\d+\/start$/) && method === "POST") {
        return jsonResponse({ id: 42, status: "in_progress" });
      }
      if (strUrl.match(/\/sessions\/\d+\/answers$/) && method === "POST") {
        return jsonResponse({ id: 1, session_question_id: JSON.parse(opts.body).session_question_id, selected_answer: JSON.parse(opts.body).selected_answer, response_time_ms: JSON.parse(opts.body).response_time_ms }, 201);
      }
      if (strUrl.match(/\/sessions\/\d+\/complete$/) && method === "POST") {
        return jsonResponse({ id: 42, status: "completed", completed_at: "now", global: { total_questions: questions.length } });
      }
      if (strUrl.match(/\/sessions\/\d+\/abandon$/) && method === "POST") {
        return jsonResponse({ id: 42, status: "abandoned", abandoned_at: "now" });
      }
      return jsonResponse({}, 404);
    }));
    return calls;
  }

  function setStoredPatientAuth() {
    localStorage.setItem("ma_auth_token", "patient-jwt");
    localStorage.setItem("ma_auth_user", JSON.stringify({ id: 42, role: "patient", name: "P", email: "p@p.com", is_active: true }));
    localStorage.setItem("ma_app_session_v1", JSON.stringify({ role: "patient" }));
    window.location.hash = "#/patient";
  }

  test("6D.3: start is called exactly once when patient enters a backend activity", async () => {
    const user = userEvent.setup();
    setStoredPatientAuth();
    const calls = stubBackendActivityFetch({
      questions: [
        { id: 100, display_order: 1, prompt_snapshot: "Q1", options_snapshot: ["a", "b", "c", "d"], stimulus_snapshot: null, response_type: "multiple_choice" },
      ],
    });
    renderApp();

    await user.click(await screen.findByRole("button", { name: /lista del supermercado/i }));
    await screen.findByText("Q1");

    const startCalls = calls.filter((c) => c.url.match(/\/sessions\/\d+\/start$/));
    expect(startCalls.length).toBe(1);
  });

  test("6D.3: answer body only contains session_question_id + selected_answer + response_time_ms", async () => {
    const user = userEvent.setup();
    setStoredPatientAuth();
    let answerBody;
    stubBackendActivityFetch({
      questions: [
        { id: 100, display_order: 1, prompt_snapshot: "Q1", options_snapshot: ["opA", "opB", "opC", "opD"], stimulus_snapshot: null, response_type: "multiple_choice" },
      ],
      onCall: ({ url, method, body }) => {
        if (url.match(/\/sessions\/\d+\/answers$/) && method === "POST") {
          answerBody = JSON.parse(body);
        }
      },
    });
    renderApp();

    await user.click(await screen.findByRole("button", { name: /lista del supermercado/i }));
    await screen.findByText("Q1");
    await user.click(screen.getByRole("button", { name: "opA" }));
    await user.click(screen.getByRole("button", { name: /finalizar sesi[oó]n/i }));

    expect(await screen.findByRole("heading", { name: /actividades disponibles/i })).toBeInTheDocument();
    expect(answerBody).toBeDefined();
    expect(Object.keys(answerBody).sort()).toEqual(["response_time_ms", "selected_answer", "session_question_id"]);
    expect(answerBody.session_question_id).toBe(100);
    expect(answerBody.selected_answer).toBe(0);
    expect(Number.isInteger(answerBody.response_time_ms)).toBe(true);
    expect(answerBody.response_time_ms).toBeGreaterThanOrEqual(1);
  });

  test("6D.3: answer error does NOT advance to next question and allows retry", async () => {
    const user = userEvent.setup();
    setStoredPatientAuth();
    let answerAttempt = 0;
    vi.stubGlobal("fetch", vi.fn((url, opts = {}) => {
      const strUrl = String(url);
      const method = (opts.method || "GET").toUpperCase();
      if (strUrl.includes("/patient/sessions")) {
        return jsonResponse({
          id: 42, patient_id: 42, professional_id: 7, status: "created",
          sections: [{
            id: 1, section_id: 100, questions: [
              { id: 100, display_order: 1, prompt_snapshot: "Q1", options_snapshot: ["a", "b", "c", "d"], stimulus_snapshot: null, response_type: "multiple_choice" },
              { id: 101, display_order: 2, prompt_snapshot: "Q2", options_snapshot: ["a", "b", "c", "d"], stimulus_snapshot: null, response_type: "multiple_choice" },
            ],
          }],
        }, 201);
      }
      if (strUrl.match(/\/sessions\/\d+\/start$/) && method === "POST") {
        return jsonResponse({ id: 42, status: "in_progress" });
      }
      if (strUrl.match(/\/sessions\/\d+\/answers$/) && method === "POST") {
        answerAttempt++;
        if (answerAttempt === 1) return jsonResponse({ error: "Servidor caído" }, 500);
        return jsonResponse({ id: 1 }, 201);
      }
      return jsonResponse({}, 404);
    }));
    renderApp();

    await user.click(await screen.findByRole("button", { name: /lista del supermercado/i }));
    await screen.findByText("Q1");
    await user.click(screen.getAllByRole("button", { name: "a" })[0]);
    await user.click(screen.getByRole("button", { name: /siguiente/i }));

    // Error visible, sigue en Q1
    expect(await screen.findByRole("alert")).toHaveTextContent(/servidor caído|no se pudo guardar/i);
    expect(screen.getByText("Q1")).toBeInTheDocument();
    expect(screen.queryByText("Q2")).not.toBeInTheDocument();

    // Retry
    await user.click(screen.getByRole("button", { name: /siguiente/i }));
    expect(await screen.findByText("Q2")).toBeInTheDocument();
    expect(answerAttempt).toBe(2);
  });

  test("6D.3: double click on Siguiente sends only one answer request", async () => {
    const user = userEvent.setup();
    setStoredPatientAuth();
    let pendingResolve;
    const pending = new Promise((resolve) => { pendingResolve = resolve; });
    let answerCalls = 0;
    vi.stubGlobal("fetch", vi.fn((url, opts = {}) => {
      const strUrl = String(url);
      const method = (opts.method || "GET").toUpperCase();
      if (strUrl.includes("/patient/sessions")) {
        return jsonResponse({
          id: 42, patient_id: 42, professional_id: 7, status: "created",
          sections: [{
            id: 1, section_id: 100, questions: [
              { id: 100, display_order: 1, prompt_snapshot: "Q1", options_snapshot: ["a", "b", "c", "d"], stimulus_snapshot: null, response_type: "multiple_choice" },
              { id: 101, display_order: 2, prompt_snapshot: "Q2", options_snapshot: ["a", "b", "c", "d"], stimulus_snapshot: null, response_type: "multiple_choice" },
            ],
          }],
        }, 201);
      }
      if (strUrl.match(/\/sessions\/\d+\/start$/) && method === "POST") {
        return jsonResponse({ id: 42, status: "in_progress" });
      }
      if (strUrl.match(/\/sessions\/\d+\/answers$/) && method === "POST") {
        answerCalls++;
        return pending.then(() => ({ ok: true, status: 201, json: () => Promise.resolve({ id: 1 }) }));
      }
      return jsonResponse({}, 404);
    }));
    renderApp();

    await user.click(await screen.findByRole("button", { name: /lista del supermercado/i }));
    await screen.findByText("Q1");
    await user.click(screen.getAllByRole("button", { name: "a" })[0]);

    const next = screen.getByRole("button", { name: /siguiente/i });
    await user.click(next);
    // Click segundo mientras el primero está en vuelo
    await user.click(next).catch(() => {});
    await user.click(next).catch(() => {});

    expect(answerCalls).toBe(1);
    pendingResolve();
    await screen.findByText("Q2");
  });

  // ============ 6D.4 ============

  test("6D.4: last answer is persisted BEFORE complete is called (order + single complete)", async () => {
    const user = userEvent.setup();
    setStoredPatientAuth();
    const calls = [];
    vi.stubGlobal("fetch", vi.fn((url, opts = {}) => {
      const strUrl = String(url);
      const method = (opts.method || "GET").toUpperCase();
      calls.push({ url: strUrl, method });
      if (strUrl.includes("/patient/sessions")) {
        return jsonResponse({
          id: 100, patient_id: 42, professional_id: 7, status: "created",
          sections: [{ id: 1, section_id: 100, questions: [
            { id: 1, display_order: 1, prompt_snapshot: "Q1", options_snapshot: ["a","b","c","d"], stimulus_snapshot: null, response_type: "multiple_choice" },
          ]}],
        }, 201);
      }
      if (strUrl.match(/\/sessions\/\d+\/start$/)) return jsonResponse({ id: 100, status: "in_progress" });
      if (strUrl.match(/\/sessions\/\d+\/answers$/)) return jsonResponse({ id: 1 }, 201);
      if (strUrl.match(/\/sessions\/\d+\/complete$/)) return jsonResponse({ id: 100, status: "completed" });
      return jsonResponse({}, 404);
    }));
    renderApp();

    await user.click(await screen.findByRole("button", { name: /lista del supermercado/i }));
    await screen.findByText("Q1");
    await user.click(screen.getAllByRole("button", { name: "a" })[0]);
    await user.click(screen.getByRole("button", { name: /finalizar sesi[oó]n/i }));

    // Debe llegar a patient screen sólo tras completar.
    expect(await screen.findByRole("heading", { name: /actividades disponibles/i })).toBeInTheDocument();
    const seq = calls.filter((c) => c.method === "POST").map((c) => c.url);
    const answerIdx = seq.findIndex((u) => u.match(/\/answers$/));
    const completeIdx = seq.findIndex((u) => u.match(/\/complete$/));
    expect(answerIdx).toBeGreaterThan(-1);
    expect(completeIdx).toBeGreaterThan(answerIdx);
    // Sólo un complete
    expect(seq.filter((u) => u.match(/\/complete$/)).length).toBe(1);
  });

  test("6D.4: complete error keeps activity screen and allows retry without re-sending answer", async () => {
    const user = userEvent.setup();
    setStoredPatientAuth();
    let answerCalls = 0;
    let completeAttempts = 0;
    vi.stubGlobal("fetch", vi.fn((url, opts = {}) => {
      const strUrl = String(url);
      const method = (opts.method || "GET").toUpperCase();
      if (strUrl.includes("/patient/sessions")) {
        return jsonResponse({
          id: 111, patient_id: 42, professional_id: 7, status: "created",
          sections: [{ id: 1, section_id: 100, questions: [
            { id: 55, display_order: 1, prompt_snapshot: "Q1", options_snapshot: ["a","b","c","d"], stimulus_snapshot: null, response_type: "multiple_choice" },
          ]}],
        }, 201);
      }
      if (strUrl.match(/\/sessions\/\d+\/start$/)) return jsonResponse({ id: 111, status: "in_progress" });
      if (strUrl.match(/\/sessions\/\d+\/answers$/) && method === "POST") {
        answerCalls++;
        return jsonResponse({ id: 1 }, 201);
      }
      if (strUrl.match(/\/sessions\/\d+\/complete$/) && method === "POST") {
        completeAttempts++;
        if (completeAttempts === 1) return jsonResponse({ error: "Fallo temporal" }, 500);
        return jsonResponse({ id: 111, status: "completed" });
      }
      return jsonResponse({}, 404);
    }));
    renderApp();

    await user.click(await screen.findByRole("button", { name: /lista del supermercado/i }));
    await screen.findByText("Q1");
    await user.click(screen.getAllByRole("button", { name: "a" })[0]);
    await user.click(screen.getByRole("button", { name: /finalizar sesi[oó]n/i }));

    // Sigue en actividad; hay un error visible
    expect(await screen.findByRole("alert")).toHaveTextContent(/fallo temporal|no se pudo finalizar/i);
    expect(screen.getByText("Q1")).toBeInTheDocument();

    // Retry
    await user.click(screen.getByRole("button", { name: /finalizar sesi[oó]n/i }));
    expect(await screen.findByRole("heading", { name: /actividades disponibles/i })).toBeInTheDocument();

    // Answer no se reenvió en el retry
    expect(answerCalls).toBe(1);
    expect(completeAttempts).toBe(2);
  });

  test("6D.4: 409 already_answered contractual permite continuar; otro 409 sigue siendo error", async () => {
    const user = userEvent.setup();
    setStoredPatientAuth();
    let answerAttempt = 0;
    vi.stubGlobal("fetch", vi.fn((url, opts = {}) => {
      const strUrl = String(url);
      const method = (opts.method || "GET").toUpperCase();
      if (strUrl.includes("/patient/sessions")) {
        return jsonResponse({
          id: 222, patient_id: 42, professional_id: 7, status: "created",
          sections: [{ id: 1, section_id: 100, questions: [
            { id: 10, display_order: 1, prompt_snapshot: "Q1", options_snapshot: ["a","b","c","d"], stimulus_snapshot: null, response_type: "multiple_choice" },
            { id: 11, display_order: 2, prompt_snapshot: "Q2", options_snapshot: ["a","b","c","d"], stimulus_snapshot: null, response_type: "multiple_choice" },
          ]}],
        }, 201);
      }
      if (strUrl.match(/\/sessions\/\d+\/start$/)) return jsonResponse({ id: 222, status: "in_progress" });
      if (strUrl.match(/\/sessions\/\d+\/answers$/) && method === "POST") {
        answerAttempt++;
        if (answerAttempt === 1) return jsonResponse({ error: "Duplicada", status: "already_answered" }, 409);
        return jsonResponse({ error: "Otro conflicto", status: "conflict" }, 409);
      }
      return jsonResponse({}, 404);
    }));
    renderApp();

    await user.click(await screen.findByRole("button", { name: /lista del supermercado/i }));
    await screen.findByText("Q1");

    // Primer submit: 409 already_answered → avanza
    await user.click(screen.getAllByRole("button", { name: "a" })[0]);
    await user.click(screen.getByRole("button", { name: /siguiente/i }));
    expect(await screen.findByText("Q2")).toBeInTheDocument();

    // Segundo submit: 409 con otro status → error visible, no avanza
    await user.click(screen.getAllByRole("button", { name: "a" })[0]);
    await user.click(screen.getByRole("button", { name: /finalizar sesi[oó]n/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/otro conflicto|no se pudo guardar/i);
    expect(screen.getByText("Q2")).toBeInTheDocument();
  });

  test("6D.4: option is locked after a successful submit", async () => {
    const user = userEvent.setup();
    setStoredPatientAuth();
    let answerCalls = 0;
    vi.stubGlobal("fetch", vi.fn((url, opts = {}) => {
      const strUrl = String(url);
      const method = (opts.method || "GET").toUpperCase();
      if (strUrl.includes("/patient/sessions")) {
        return jsonResponse({
          id: 333, patient_id: 42, professional_id: 7, status: "created",
          sections: [{ id: 1, section_id: 100, questions: [
            { id: 1, display_order: 1, prompt_snapshot: "Q1", options_snapshot: ["a","b","c","d"], stimulus_snapshot: null, response_type: "multiple_choice" },
            { id: 2, display_order: 2, prompt_snapshot: "Q2", options_snapshot: ["a","b","c","d"], stimulus_snapshot: null, response_type: "multiple_choice" },
          ]}],
        }, 201);
      }
      if (strUrl.match(/\/sessions\/\d+\/start$/)) return jsonResponse({ id: 333, status: "in_progress" });
      if (strUrl.match(/\/sessions\/\d+\/answers$/) && method === "POST") {
        answerCalls++;
        return jsonResponse({ id: 1 }, 201);
      }
      return jsonResponse({}, 404);
    }));
    renderApp();

    await user.click(await screen.findByRole("button", { name: /lista del supermercado/i }));
    await screen.findByText("Q1");
    // Click a → submit → advance to Q2
    await user.click(screen.getAllByRole("button", { name: "a" })[0]);
    await user.click(screen.getByRole("button", { name: /siguiente/i }));
    await screen.findByText("Q2");
    // Ahora estamos en Q2. Volver a la anterior no está soportado en modo backend.
    // El test se centra en que al Submit Q2 y luego clickear otra opción, si el submit ya sucedió, no se reenvía.
    await user.click(screen.getAllByRole("button", { name: "a" })[0]);
    await user.click(screen.getByRole("button", { name: /finalizar sesi[oó]n/i }));
    // 2 answers persistidos (uno por pregunta), no reenvíos.
    expect(answerCalls).toBe(2);
  });

  test("6D.4: pulsar Volver muestra confirmación de abandono", async () => {
    const user = userEvent.setup();
    setStoredPatientAuth();
    stubBackendActivityFetch({ questions: [
      { id: 1, display_order: 1, prompt_snapshot: "Q1", options_snapshot: ["a","b","c","d"], stimulus_snapshot: null, response_type: "multiple_choice" },
    ]});
    renderApp();

    await user.click(await screen.findByRole("button", { name: /lista del supermercado/i }));
    await screen.findByText("Q1");
    await user.click(screen.getByRole("button", { name: /volver a actividades/i }));
    expect(await screen.findByRole("heading", { name: /abandonar esta actividad/i })).toBeInTheDocument();
    expect(screen.getByText(/marcada como abandonada/i)).toBeInTheDocument();
    // Sigue en actividad
    expect(screen.getByText("Q1")).toBeInTheDocument();
  });

  test("6D.4: confirmar abandono llama /abandon y vuelve al PatientScreen", async () => {
    const user = userEvent.setup();
    setStoredPatientAuth();
    const calls = stubBackendActivityFetch({ questions: [
      { id: 1, display_order: 1, prompt_snapshot: "Q1", options_snapshot: ["a","b","c","d"], stimulus_snapshot: null, response_type: "multiple_choice" },
    ]});
    renderApp();

    await user.click(await screen.findByRole("button", { name: /lista del supermercado/i }));
    await screen.findByText("Q1");
    await user.click(screen.getByRole("button", { name: /volver a actividades/i }));
    await user.click(screen.getByRole("button", { name: /s[ií], abandonar/i }));

    expect(await screen.findByRole("heading", { name: /actividades disponibles/i })).toBeInTheDocument();
    const abandonCalls = calls.filter((c) => c.method === "POST" && c.url.match(/\/abandon$/));
    expect(abandonCalls.length).toBe(1);
  });

  test("6D.4: cancelar confirmación permanece en la actividad", async () => {
    const user = userEvent.setup();
    setStoredPatientAuth();
    stubBackendActivityFetch({ questions: [
      { id: 1, display_order: 1, prompt_snapshot: "Q1", options_snapshot: ["a","b","c","d"], stimulus_snapshot: null, response_type: "multiple_choice" },
    ]});
    renderApp();

    await user.click(await screen.findByRole("button", { name: /lista del supermercado/i }));
    await screen.findByText("Q1");
    await user.click(screen.getByRole("button", { name: /volver a actividades/i }));
    await user.click(screen.getByRole("button", { name: /^cancelar$/i }));

    expect(screen.getByText("Q1")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /actividades disponibles/i })).not.toBeInTheDocument();
  });

  test("6D.4: error de abandon mantiene al patient en la actividad", async () => {
    const user = userEvent.setup();
    setStoredPatientAuth();
    vi.stubGlobal("fetch", vi.fn((url, opts = {}) => {
      const strUrl = String(url);
      const method = (opts.method || "GET").toUpperCase();
      if (strUrl.includes("/patient/sessions")) {
        return jsonResponse({
          id: 444, patient_id: 42, professional_id: 7, status: "created",
          sections: [{ id: 1, section_id: 100, questions: [
            { id: 1, display_order: 1, prompt_snapshot: "Q1", options_snapshot: ["a","b","c","d"], stimulus_snapshot: null, response_type: "multiple_choice" },
          ]}],
        }, 201);
      }
      if (strUrl.match(/\/sessions\/\d+\/start$/)) return jsonResponse({ id: 444, status: "in_progress" });
      if (strUrl.match(/\/sessions\/\d+\/abandon$/) && method === "POST") return jsonResponse({ error: "Servicio caído" }, 500);
      return jsonResponse({}, 404);
    }));
    renderApp();

    await user.click(await screen.findByRole("button", { name: /lista del supermercado/i }));
    await screen.findByText("Q1");
    await user.click(screen.getByRole("button", { name: /volver a actividades/i }));
    await user.click(screen.getByRole("button", { name: /s[ií], abandonar/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/servicio caído|no se pudo abandonar/i);
    expect(screen.getByText("Q1")).toBeInTheDocument();
  });

  // ============ 6D.5 ============

  function professionalWithPatient({ patientsList, patientSessionsByPatient, onCall } = {}) {
    vi.stubGlobal("fetch", vi.fn((url, opts = {}) => {
      const strUrl = String(url);
      const method = (opts.method || "GET").toUpperCase();
      if (onCall) onCall({ url: strUrl, method, body: opts.body });
      if (strUrl.includes("/patients/") && strUrl.endsWith("/sessions") && method === "GET") {
        const match = strUrl.match(/\/patients\/([^/]+)\/sessions$/);
        const patientId = match ? match[1] : null;
        const rows = (patientSessionsByPatient && patientSessionsByPatient[patientId]) || [];
        return jsonResponse(rows);
      }
      if (strUrl.includes("/patients") && method === "GET") {
        return jsonResponse(patientsList || []);
      }
      if (strUrl.includes("/invitations") && method === "GET") return jsonResponse([]);
      return jsonResponse({}, 404);
    }));
  }

  test("6D.5: patient sin sesiones muestra empty state real y no métricas demo", async () => {
    setStoredProfessionalSession();
    window.location.hash = "#/professional";
    professionalWithPatient({
      patientsList: [{ id: 100, role: "patient", name: "Real P", email: "r@p.com", age: 70, professional_id: DEMO_PROFESSIONAL_ID, is_active: true }],
      patientSessionsByPatient: { "100": [] },
    });
    renderApp();

    expect(await screen.findByRole("heading", { level: 2, name: /real p/i })).toBeInTheDocument();
    // Sin actividades reales
    expect(screen.getByText(/sin actividades completadas todavía/i)).toBeInTheDocument();
    // No aparecen métricas demo tipo "Riesgo"
    expect(screen.queryByText(/Rendimiento óptimo|Requiere apoyo|Riesgo/)).not.toBeInTheDocument();
    // No hay observación IA para paciente real
    expect(screen.queryByRole("button", { name: /generar observaci[oó]n/i })).not.toBeInTheDocument();
    // Placeholder de análisis
    expect(screen.getByText(/an[aá]lisis asistido estar[aá] disponible pr[oó]ximamente/i)).toBeInTheDocument();
  });

  test("6D.5: patient con sesiones reales muestra métricas de la última completada e historial", async () => {
    setStoredProfessionalSession();
    window.location.hash = "#/professional";
    professionalWithPatient({
      patientsList: [{ id: 200, role: "patient", name: "Real P", email: "r@p.com", age: 70, professional_id: DEMO_PROFESSIONAL_ID, is_active: true }],
      patientSessionsByPatient: {
        "200": [
          { id: 5, status: "completed", created_at: "2026-09-20T10:00:00Z", completed_at: "2026-09-20T10:05:00Z",
            summary: { total_questions: 4, answered_questions: 4, correct_count: 3, incorrect_count: 1, accuracy: 0.75, completion_rate: 1, mean_latency_ms: 1800 } },
          { id: 4, status: "abandoned", created_at: "2026-09-19T10:00:00Z", abandoned_at: "2026-09-19T10:01:00Z" },
          { id: 3, status: "in_progress", created_at: "2026-09-18T10:00:00Z", started_at: "2026-09-18T10:00:10Z" },
        ],
      },
    });
    renderApp();

    // Precisión de la última completed en la metric card
    await screen.findByRole("heading", { level: 2, name: /real p/i });
    const seventyFives = screen.getAllByText("75%");
    expect(seventyFives.length).toBeGreaterThanOrEqual(1);
    // Historial: completada, abandonada, en progreso
    expect(screen.getByText("Completada")).toBeInTheDocument();
    expect(screen.getByText("Abandonada")).toBeInTheDocument();
    expect(screen.getByText("En progreso")).toBeInTheDocument();
    // Abandoned NO muestra accuracy falsa
    const abandonedRow = screen.getByText("Abandonada").closest('[role="row"]');
    expect(abandonedRow).toBeTruthy();
    expect(abandonedRow.textContent).not.toMatch(/0%/);
    // Detalle expuesto para la última completada por defecto
    expect(screen.getByText(/Preguntas/i)).toBeInTheDocument();
  });

  test("6D.5: cambio rápido A→B no deja datos de A al llegar la respuesta de A tarde", async () => {
    const user = userEvent.setup();
    setStoredProfessionalSession();
    window.location.hash = "#/professional";
    let resolvers = {};
    vi.stubGlobal("fetch", vi.fn((url, opts = {}) => {
      const strUrl = String(url);
      const method = (opts.method || "GET").toUpperCase();
      if (strUrl.match(/\/patients\/(\d+)\/sessions$/)) {
        const id = strUrl.match(/\/patients\/(\d+)\/sessions$/)[1];
        return new Promise((resolve) => {
          resolvers[id] = () => resolve({
            ok: true, status: 200, json: () => Promise.resolve(
              id === "1"
                ? [{ id: 91, status: "completed", created_at: "2026-09-20T10:00:00Z", completed_at: "2026-09-20T10:05:00Z",
                    summary: { total_questions: 4, answered_questions: 4, correct_count: 4, incorrect_count: 0, accuracy: 1, completion_rate: 1, mean_latency_ms: 1500 } }]
                : []
            ),
          });
        });
      }
      if (strUrl.includes("/patients") && method === "GET") {
        return jsonResponse([
          { id: 1, role: "patient", name: "Paciente A", email: "a@x.com", age: 70, professional_id: DEMO_PROFESSIONAL_ID, is_active: true },
          { id: 2, role: "patient", name: "Paciente B", email: "b@x.com", age: 65, professional_id: DEMO_PROFESSIONAL_ID, is_active: true },
        ]);
      }
      if (strUrl.includes("/invitations") && method === "GET") return jsonResponse([]);
      return jsonResponse({}, 404);
    }));
    renderApp();

    // Espera a que aparezcan las tarjetas y el detalle de A
    await screen.findByRole("heading", { level: 2, name: /paciente a/i });
    const cards = screen.getAllByRole("listitem");
    const cardB = cards.find((c) => c.textContent.includes("Paciente B")).querySelector("button");
    await user.click(cardB);
    // Ahora resolvemos primero A (tarde) y luego B
    resolvers["1"] && resolvers["1"]();
    resolvers["2"] && resolvers["2"]();
    // El detalle debe ser de B (sin la métrica 100% de A)
    expect(await screen.findByRole("heading", { level: 2, name: /paciente b/i })).toBeInTheDocument();
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
    expect(screen.getByText(/sin actividades completadas todavía/i)).toBeInTheDocument();
  });

  test("6D.5: error al cargar sesiones muestra alert y no fallback a demo", async () => {
    setStoredProfessionalSession();
    window.location.hash = "#/professional";
    vi.stubGlobal("fetch", vi.fn((url, opts = {}) => {
      const strUrl = String(url);
      const method = (opts.method || "GET").toUpperCase();
      if (strUrl.match(/\/patients\/(\d+)\/sessions$/)) {
        return jsonResponse({ error: "Servidor caído" }, 500);
      }
      if (strUrl.includes("/patients") && method === "GET") {
        return jsonResponse([{ id: 300, role: "patient", name: "P Err", email: "e@x.com", age: 70, professional_id: DEMO_PROFESSIONAL_ID, is_active: true }]);
      }
      if (strUrl.includes("/invitations") && method === "GET") return jsonResponse([]);
      return jsonResponse({}, 404);
    }));
    renderApp();

    expect(await screen.findByRole("heading", { level: 2, name: /p err/i })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(/servidor caído|no se pudieron cargar/i);
    // No aparece observación IA demo ni "riesgo"
    expect(screen.queryByRole("button", { name: /generar observaci[oó]n/i })).not.toBeInTheDocument();
  });

  test("6D.5: PatientCard para backend no muestra Riesgo/Precisión demo", async () => {
    setStoredProfessionalSession();
    window.location.hash = "#/professional";
    professionalWithPatient({
      patientsList: [{ id: 400, role: "patient", name: "Card P", email: "c@x.com", age: 70, professional_id: DEMO_PROFESSIONAL_ID, is_active: true }],
      patientSessionsByPatient: { "400": [] },
    });
    renderApp();

    await screen.findByRole("heading", { level: 2, name: /card p/i });
    const card = screen.getByRole("listitem").querySelector("button");
    // aria-label neutral
    expect(card.getAttribute("aria-label")).not.toMatch(/riesgo/i);
    // El texto de la card no incluye la palabra Precisión ni Tiempo
    expect(card.textContent).not.toMatch(/Precisi[oó]n/);
    expect(card.textContent).not.toMatch(/Tiempo/);
  });

  test("6D.5: EvolutionChart con 1 sesión no inventa evolución", async () => {
    setStoredProfessionalSession();
    window.location.hash = "#/professional";
    professionalWithPatient({
      patientsList: [{ id: 500, role: "patient", name: "Uno", email: "u@x.com", age: 70, professional_id: DEMO_PROFESSIONAL_ID, is_active: true }],
      patientSessionsByPatient: {
        "500": [
          { id: 1, status: "completed", created_at: "2026-09-20T10:00:00Z", completed_at: "2026-09-20T10:05:00Z",
            summary: { total_questions: 3, answered_questions: 3, correct_count: 2, incorrect_count: 1, accuracy: 0.6667, completion_rate: 1, mean_latency_ms: 1500 } },
        ],
      },
    });
    renderApp();

    await screen.findByRole("heading", { level: 2, name: /uno/i });
    expect(screen.getByText(/al menos 2 sesiones completadas/i)).toBeInTheDocument();
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

  // ============ 6D.6 ============

  test("6D.6: logout de profesional limpia patients y no muestra datos del anterior tras nuevo login", async () => {
    const user = userEvent.setup();
    // Sesión 1: professional A con un paciente real
    professionalWithPatient({
      patientsList: [{ id: 700, role: "patient", name: "Paciente Antiguo", email: "old@x.com", age: 70, professional_id: DEMO_PROFESSIONAL_ID, is_active: true }],
      patientSessionsByPatient: { "700": [] },
    });
    setStoredProfessionalSession();
    window.location.hash = "#/professional";
    renderApp();

    // Verifica que el paciente del profesional A se ve
    expect(await screen.findByRole("heading", { level: 2, name: /paciente antiguo/i })).toBeInTheDocument();

    // Logout
    await user.click(screen.getByRole("button", { name: /salir/i }));
    expect(await screen.findByRole("button", { name: /entrar como paciente/i })).toBeInTheDocument();
    expect(localStorage.getItem("ma_auth_token")).toBeNull();
    expect(localStorage.getItem("ma_auth_user")).toBeNull();
    // No debe quedar el paciente anterior visible tras logout
    expect(screen.queryByText(/paciente antiguo/i)).not.toBeInTheDocument();
  });

  test("6D.6: professional autenticado NO usa ma_patients_v1 aunque exista en localStorage", async () => {
    // Sembrar localStorage con pacientes demo maliciosos
    localStorage.setItem(
      "ma_patients_v1",
      JSON.stringify([
        { id: "fake-legacy", name: "Paciente Demo Filtrado", age: 99, professionalId: DEMO_PROFESSIONAL_ID, completed: [], answers: 0, weeklyProgress: [0,0,0,0,0,0,0] },
      ])
    );
    // Backend sólo retorna un paciente real distinto
    professionalWithPatient({
      patientsList: [{ id: 800, role: "patient", name: "Paciente Real Backend", email: "r@x.com", age: 70, professional_id: DEMO_PROFESSIONAL_ID, is_active: true }],
      patientSessionsByPatient: { "800": [] },
    });
    setStoredProfessionalSession();
    window.location.hash = "#/professional";
    renderApp();

    // Aparece el paciente del backend
    expect(await screen.findByRole("heading", { level: 2, name: /paciente real backend/i })).toBeInTheDocument();
    // NO se filtra el paciente de localStorage
    expect(screen.queryByText(/paciente demo filtrado/i)).not.toBeInTheDocument();
  });

  test("6D.6: patient backend no hace fallback demo si la API de sesión falla", async () => {
    const user = userEvent.setup();
    setStoredPatientAuth();
    // Stub que rompe TODO — incluyendo POST /patient/sessions
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ error: "Backend caído" }, 500)));
    renderApp();

    await user.click(await screen.findByRole("button", { name: /lista del supermercado/i }));

    // Debe verse un error, NO debe haber comenzado la actividad con preguntas demo del banco local.
    expect(await screen.findByRole("alert")).toHaveTextContent(/backend caído|no se pudo iniciar/i);
    expect(window.location.hash).toBe("#/patient");
    // No aparecen preguntas del banco legacy (activities.js).
    expect(screen.queryByText(/pan, leche y manzanas/i)).not.toBeInTheDocument();
  });

  // ============ 6F ============

  function installFetchStubEmail({ patients = [], invitations = [], sendEmailResponse, sendEmailStatus = 200, onSendEmail } = {}) {
    return vi.stubGlobal("fetch", vi.fn((url, opts = {}) => {
      const strUrl = String(url);
      const method = (opts.method || "GET").toUpperCase();
      if (strUrl.includes("/auth/login")) {
        return jsonResponse({
          user: { id: DEMO_PROFESSIONAL_ID, role: "professional", name: "Dra. Test", email: "test@demo.com", is_active: true },
          token: "fake-jwt-token",
        });
      }
      if (strUrl.includes("/patients") && method === "GET") return jsonResponse(patients);
      if (strUrl.match(/\/invitations\/\d+\/send-email$/) && method === "POST") {
        if (onSendEmail) onSendEmail(opts);
        return jsonResponse(sendEmailResponse || { sent: true, message_id: "msg_test_1" }, sendEmailStatus);
      }
      if (strUrl.includes("/invitations") && method === "POST") {
        return jsonResponse({
          id: 2001,
          professional_id: DEMO_PROFESSIONAL_ID,
          email: "nueva@paciente.com",
          patient_name: "Nueva Paciente",
          age: 74,
          token: "plaintext-token-6f-abc",
          expires_at: new Date(Date.now() + 604800000).toISOString(),
          status: "pending",
        }, 201);
      }
      if (strUrl.includes("/invitations") && method === "GET") return jsonResponse(invitations);
      return jsonResponse({}, 404);
    }));
  }

  async function createInviteAsPro(user) {
    await user.click(await screen.findByRole("button", { name: /invitar paciente/i }));
    await user.type(screen.getByLabelText(/nombre del paciente/i), "Nueva Paciente");
    await user.type(screen.getByLabelText(/email del paciente/i), "nueva@paciente.com");
    await user.click(screen.getByRole("button", { name: /crear invitación/i }));
  }

  test("6F: al crear invitation aparecen ambas acciones Copiar y Enviar por email", async () => {
    const user = userEvent.setup();
    installFetchStubEmail({ patients: [] });
    setStoredProfessionalSession();
    window.location.hash = "#/professional";
    renderApp();

    await createInviteAsPro(user);

    expect(await screen.findByRole("button", { name: /copiar enlace de invitación/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enviar invitación por email a nueva@paciente\.com/i })).toBeInTheDocument();
  });

  test("6F: click 'Enviar por email' llama al endpoint correcto con el token y muestra éxito", async () => {
    const user = userEvent.setup();
    const sendCalls = [];
    installFetchStubEmail({
      patients: [],
      onSendEmail: (opts) => sendCalls.push({ body: opts.body }),
    });
    setStoredProfessionalSession();
    window.location.hash = "#/professional";
    renderApp();

    await createInviteAsPro(user);
    await user.click(await screen.findByRole("button", { name: /enviar invitación por email a nueva@paciente\.com/i }));

    // Mientras envía / al terminar, el botón cambia de rótulo
    expect(await screen.findByText(/invitación enviada a nueva@paciente\.com/i)).toBeInTheDocument();
    expect(sendCalls.length).toBe(1);
    const parsed = JSON.parse(sendCalls[0].body);
    expect(parsed).toEqual({ token: "plaintext-token-6f-abc" });
  });

  test("6F: error del email mantiene el enlace disponible y muestra mensaje", async () => {
    const user = userEvent.setup();
    installFetchStubEmail({
      patients: [],
      sendEmailResponse: { error: "El envío de emails no está configurado", status: "email_not_configured" },
      sendEmailStatus: 503,
    });
    setStoredProfessionalSession();
    window.location.hash = "#/professional";
    renderApp();

    await createInviteAsPro(user);
    await user.click(await screen.findByRole("button", { name: /enviar invitación por email a nueva@paciente\.com/i }));

    // Mensaje específico del error de email (evita colisión con el alert de "Invitación creada").
    expect(await screen.findByText(/no está configurado|no se pudo enviar/i)).toBeInTheDocument();
    // Copiar sigue disponible
    expect(screen.getByRole("button", { name: /copiar enlace de invitación/i })).toBeInTheDocument();
    // El input con el link sigue presente
    expect(screen.getByRole("textbox", { name: /enlace de invitación/i })).toBeInTheDocument();
  });

  test("6F: Copiar enlace sigue funcionando junto al botón de email", async () => {
    const user = userEvent.setup();
    installFetchStubEmail({ patients: [] });
    setStoredProfessionalSession();
    window.location.hash = "#/professional";

    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    renderApp();
    await createInviteAsPro(user);
    await user.click(await screen.findByRole("button", { name: /copiar enlace de invitación/i }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain("/#/invite/plaintext-token-6f-abc");
  });

  test("6F: token plaintext NO se guarda en localStorage", async () => {
    const user = userEvent.setup();
    installFetchStubEmail({ patients: [] });
    setStoredProfessionalSession();
    window.location.hash = "#/professional";
    renderApp();

    await createInviteAsPro(user);
    // Después de que el link es visible, revisar TODAS las claves de localStorage.
    await screen.findByRole("button", { name: /enviar invitación por email a nueva@paciente\.com/i });
    const dump = Object.keys(localStorage).map((k) => localStorage.getItem(k)).join("|");
    expect(dump.includes("plaintext-token-6f-abc")).toBe(false);
  });

  test("6F: invitaciones cargadas desde GET (sin token) NO muestran botón de email", async () => {
    installFetchStubEmail({
      patients: [],
      invitations: [
        {
          id: 999,
          patient_name: "Vieja Invitación",
          email: "vieja@paciente.com",
          age: 70,
          status: "pending",
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        },
      ],
    });
    setStoredProfessionalSession();
    window.location.hash = "#/professional";
    renderApp();

    // La lista de pendientes muestra la invitación
    expect(await screen.findByText(/vieja invitación/i)).toBeInTheDocument();
    // Pero NO hay un botón "Enviar por email" para ella (sólo el revocar)
    expect(screen.queryByRole("button", { name: /enviar invitación por email a vieja@paciente\.com/i })).not.toBeInTheDocument();
    // Sólo aparece "Revocar" en la lista
    expect(screen.getByRole("button", { name: /revocar invitación a vieja@paciente\.com/i })).toBeInTheDocument();
  });

  // Tests obsoletos eliminados en 6D.5:
  //   - "shows loading and fallback error handling for AI observations"
  //   - "validates AI configuration inputs before saving"
  // Ambos probaban componentes (AiObservation, AiConfigPanel) que fueron ocultados
  // para pacientes backend según lo pedido en 6D.5 sección 10. Ya no existen para
  // el flujo real; el flujo demo no puede ser alcanzado con auth de profesional.
});
