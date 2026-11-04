// F2/F3 — reglas D5 y E2 en la pantalla del profesional.
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PatientAccessPanel } from "./PatientAccessPanel.jsx";

function jsonRes(body, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
}

function fullAccess(overrides = {}) {
  return {
    patient_id: 7,
    allow_passwordless: true,
    has_password: true,
    active_sessions: 0,
    passwordless_login_available: true,
    ...overrides,
  };
}

function stubFetch(handler) {
  const fetchMock = vi.fn((url, opts = {}) => handler(String(url), opts.method || "GET"));
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

describe("PatientAccessPanel – D5/E2", () => {
  test("flujo disponible: sin 'Próximamente' y con la descripción real", async () => {
    stubFetch(() => jsonRes(fullAccess()));
    render(<PatientAccessPanel patientId={7} />);
    const checkbox = await screen.findByRole("checkbox", { name: /permitir acceso sin contraseña/i });
    expect(screen.queryByText("Próximamente")).not.toBeInTheDocument();
    expect(checkbox).toHaveAccessibleDescription(/vence en 30 minutos/i);
  });

  test("E2: con sesiones abiertas avisa ANTES de desactivar y sólo confirma con acción explícita", async () => {
    const fetchMock = stubFetch((url, method) => {
      if (method === "PATCH") {
        return jsonRes({ ...fullAccess({ allow_passwordless: false, active_sessions: 0 }), revoked_sessions: 2 });
      }
      return jsonRes(fullAccess({ active_sessions: 2 }));
    });
    render(<PatientAccessPanel patientId={7} />);
    const checkbox = await screen.findByRole("checkbox", { name: /permitir acceso sin contraseña/i });
    expect(screen.getByText(/sesiones abiertas con enlace: 2/i)).toBeInTheDocument();

    await userEvent.click(checkbox);
    expect(fetchMock.mock.calls.some(([, o]) => o?.method === "PATCH")).toBe(false);
    expect(screen.getByRole("alertdialog")).toHaveTextContent(/2 sesiones abiertas/i);

    await userEvent.click(screen.getByRole("button", { name: /cancelar/i }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(checkbox).toBeChecked();

    await userEvent.click(checkbox);
    await userEvent.click(screen.getByRole("button", { name: /desactivar y cerrar sesiones/i }));
    const patch = fetchMock.mock.calls.find(([, o]) => o?.method === "PATCH");
    expect(JSON.parse(patch[1].body)).toEqual({ allow_passwordless: false, confirm_revoke_sessions: true });
    expect(await screen.findByText(/se cerraron 2 sesiones/i)).toBeInTheDocument();
  });

  test("E2: si el backend pide confirmación (carrera), se muestra el aviso", async () => {
    stubFetch((url, method) => {
      if (method === "PATCH") return jsonRes({ error: "x", status: "confirmation_required", active_sessions: 1 }, 409);
      return jsonRes(fullAccess());
    });
    render(<PatientAccessPanel patientId={7} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: /permitir acceso sin contraseña/i }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent(/1 sesión abierta/i);
  });

  test("D5: si el enlace es el único método, no se puede desactivar", async () => {
    stubFetch(() => jsonRes(fullAccess({ has_password: false })));
    render(<PatientAccessPanel patientId={7} />);
    const checkbox = await screen.findByRole("checkbox", { name: /permitir acceso sin contraseña/i });
    expect(checkbox).toBeDisabled();
    expect(checkbox).toHaveAccessibleDescription(/único método de acceso/i);
  });

  test("D5: el rechazo del backend se informa", async () => {
    stubFetch((url, method) => {
      if (method === "PATCH") return jsonRes({ error: "x", status: "last_access_method" }, 409);
      return jsonRes(fullAccess());
    });
    render(<PatientAccessPanel patientId={7} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: /permitir acceso sin contraseña/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/único método de acceso/i);
  });

  test("cerrar sesiones abiertas sin cambiar el permiso", async () => {
    const fetchMock = stubFetch((url, method) => {
      if (method === "POST" && url.endsWith("/access/revoke-sessions")) {
        return jsonRes({ ...fullAccess({ active_sessions: 0 }), revoked_sessions: 1 });
      }
      return jsonRes(fullAccess({ active_sessions: 1 }));
    });
    render(<PatientAccessPanel patientId={7} />);
    await userEvent.click(await screen.findByRole("button", { name: /cerrar sesiones abiertas/i }));
    expect(fetchMock.mock.calls.some(([u, o]) => String(u).endsWith("/access/revoke-sessions") && o.method === "POST")).toBe(true);
    expect(await screen.findByText(/se cerraron las sesiones abiertas/i)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /permitir acceso sin contraseña/i })).toBeChecked();
  });
});
