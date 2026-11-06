// Opción A (profesional) y B (paciente): crear/cambiar contraseña.
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PatientPasswordPanel } from "./PatientPasswordPanel.jsx";
import { PatientAccessPanel } from "../professional/PatientAccessPanel.jsx";

function jsonRes(body, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
}

function stubFetch(handler) {
  const fetchMock = vi.fn((url, opts = {}) => handler(String(url), opts.method || "GET", opts.body ? JSON.parse(opts.body) : null));
  globalThis.fetch = fetchMock;
  return fetchMock;
}

beforeEach(() => {
  localStorage.setItem("ma_auth_token", "fake-token");
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("PatientPasswordPanel (paciente)", () => {
  test("sin contraseña: la crea y no envía current_password", async () => {
    const fetchMock = stubFetch((url, method) => {
      if (method === "PUT") return jsonRes({ has_password: true, password_action: "created" });
      return jsonRes({ has_password: false });
    });
    render(<PatientPasswordPanel />);
    await userEvent.click(await screen.findByRole("button", { name: "Crear contraseña" }));
    expect(screen.queryByLabelText("Contraseña actual")).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Contraseña"), "nueva-123");
    await userEvent.type(screen.getByLabelText("Repetir contraseña"), "nueva-123");
    await userEvent.click(screen.getByRole("button", { name: "Guardar contraseña" }));

    expect(await screen.findByText(/próxima vez podés ingresar/i)).toBeInTheDocument();
    const put = fetchMock.mock.calls.find(([, o]) => o?.method === "PUT");
    expect(put[0]).toMatch(/\/patient\/password$/);
    expect(JSON.parse(put[1].body)).toEqual({ password: "nueva-123" });
    expect(screen.getByRole("button", { name: "Cambiar contraseña" })).toBeInTheDocument();
  });

  test("valida en el formulario: no coinciden / muy corta, sin llamar al backend", async () => {
    const fetchMock = stubFetch(() => jsonRes({ has_password: false }));
    render(<PatientPasswordPanel />);
    await userEvent.click(await screen.findByRole("button", { name: "Crear contraseña" }));
    await userEvent.type(screen.getByLabelText("Contraseña"), "abc");
    await userEvent.type(screen.getByLabelText("Repetir contraseña"), "abc");
    await userEvent.click(screen.getByRole("button", { name: "Guardar contraseña" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/al menos 6/i);

    await userEvent.type(screen.getByLabelText("Contraseña"), "defgh");
    await userEvent.click(screen.getByRole("button", { name: "Guardar contraseña" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/no coinciden/i);
    expect(fetchMock.mock.calls.some(([, o]) => o?.method === "PUT")).toBe(false);
  });

  test("con contraseña: pide la actual y muestra el error del backend", async () => {
    const fetchMock = stubFetch((url, method) => {
      if (method === "PUT") return jsonRes({ error: "La contraseña actual no es correcta.", status: "current_password_invalid" }, 403);
      return jsonRes({ has_password: true });
    });
    render(<PatientPasswordPanel />);
    await userEvent.click(await screen.findByRole("button", { name: "Cambiar contraseña" }));
    await userEvent.type(screen.getByLabelText("Contraseña actual"), "vieja-123");
    await userEvent.type(screen.getByLabelText("Nueva contraseña"), "nueva-123");
    await userEvent.type(screen.getByLabelText("Repetir contraseña"), "nueva-123");
    await userEvent.click(screen.getByRole("button", { name: "Guardar contraseña" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/actual no es correcta/i);
    const put = fetchMock.mock.calls.find(([, o]) => o?.method === "PUT");
    expect(JSON.parse(put[1].body)).toEqual({ password: "nueva-123", current_password: "vieja-123" });
  });

  test("si no se puede consultar el estado no muestra nada", async () => {
    stubFetch(() => jsonRes({ error: "x" }, 500));
    const { container } = render(<PatientPasswordPanel />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });
});

describe("PatientAccessPanel – contraseña (profesional)", () => {
  const access = (o = {}) => ({
    patient_id: 7,
    allow_passwordless: true,
    has_password: false,
    active_sessions: 0,
    passwordless_login_available: true,
    ...o,
  });

  test("crea la contraseña de un paciente que sólo tenía enlace", async () => {
    const fetchMock = stubFetch((url, method) => {
      if (method === "PUT") return jsonRes({ ...access({ has_password: true }), password_action: "created" });
      return jsonRes(access());
    });
    render(<PatientAccessPanel patientId={7} />);
    expect(await screen.findByText(/todavía no tiene contraseña/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Crear contraseña" }));
    await userEvent.type(screen.getByLabelText("Nueva contraseña"), "clave-123");
    await userEvent.type(screen.getByLabelText("Repetir contraseña"), "clave-123");
    await userEvent.click(screen.getByRole("button", { name: "Guardar contraseña" }));

    expect(await screen.findByText(/Contraseña creada/i)).toBeInTheDocument();
    const put = fetchMock.mock.calls.find(([, o]) => o?.method === "PUT");
    expect(put[0]).toMatch(/\/patients\/7\/password$/);
    expect(JSON.parse(put[1].body)).toEqual({ password: "clave-123" });
    // Ya no es el único método: el permiso de enlace se puede desactivar.
    expect(screen.getByRole("checkbox", { name: /permitir acceso sin contraseña/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cambiar contraseña" })).toBeInTheDocument();
  });
});
