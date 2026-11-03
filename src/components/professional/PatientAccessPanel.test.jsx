import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PatientAccessPanel } from "./PatientAccessPanel.jsx";

function jsonRes(body, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
}

function access(allow, available = false) {
  return { patient_id: 7, allow_passwordless: allow, passwordless_login_available: available };
}

function installFetch({ get = () => jsonRes(access(false)), patch } = {}) {
  const fetchMock = vi.fn((url, opts = {}) => {
    if (!url.endsWith("/patients/7/access")) return jsonRes({ error: "unexpected" }, 500);
    if (opts.method === "PATCH") {
      if (patch) return patch(JSON.parse(opts.body));
      return jsonRes(access(JSON.parse(opts.body).allow_passwordless));
    }
    return get();
  });
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

describe("PatientAccessPanel", () => {
  test("muestra el estado actual desactivado, con 'Próximamente' y la aclaración", async () => {
    installFetch();
    render(<PatientAccessPanel patientId={7} />);

    const checkbox = await screen.findByRole("checkbox", { name: /permitir acceso sin contraseña/i });
    expect(checkbox).not.toBeChecked();
    expect(screen.getByText("Próximamente")).toBeInTheDocument();
    expect(checkbox).toHaveAccessibleDescription(/enlace seguro enviado a su correo electrónico/i);
    expect(checkbox).toHaveAccessibleDescription(/sigue ingresando con su contraseña/i);
  });

  test("refleja un permiso ya activado al cargar (persistencia tras recargar)", async () => {
    installFetch({ get: () => jsonRes(access(true)) });
    render(<PatientAccessPanel patientId={7} />);
    expect(await screen.findByRole("checkbox", { name: /permitir acceso sin contraseña/i })).toBeChecked();
  });

  test("activar envía PATCH con booleano estricto y confirma el guardado", async () => {
    const fetchMock = installFetch();
    const user = userEvent.setup();
    render(<PatientAccessPanel patientId={7} />);

    await user.click(await screen.findByRole("checkbox", { name: /permitir acceso sin contraseña/i }));

    expect(await screen.findByText("Permiso activado y guardado.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /permitir acceso sin contraseña/i })).toBeChecked();
    const patchCall = fetchMock.mock.calls.find(([, o]) => o?.method === "PATCH");
    expect(JSON.parse(patchCall[1].body)).toEqual({ allow_passwordless: true });
    expect(patchCall[1].headers.Authorization).toBe("Bearer fake-token");
  });

  test("desactivar confirma el guardado", async () => {
    installFetch({ get: () => jsonRes(access(true)) });
    const user = userEvent.setup();
    render(<PatientAccessPanel patientId={7} />);

    await user.click(await screen.findByRole("checkbox", { name: /permitir acceso sin contraseña/i }));
    expect(await screen.findByText("Permiso desactivado y guardado.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /permitir acceso sin contraseña/i })).not.toBeChecked();
  });

  test("si falla el guardado muestra un error comprensible y conserva el estado anterior", async () => {
    installFetch({ patch: () => jsonRes({ error: "Paciente no encontrado" }, 404) });
    const user = userEvent.setup();
    render(<PatientAccessPanel patientId={7} />);

    const checkbox = await screen.findByRole("checkbox", { name: /permitir acceso sin contraseña/i });
    await user.click(checkbox);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo guardar el cambio. Paciente no encontrado"
    );
    expect(checkbox).not.toBeChecked();
    expect(screen.queryByText(/guardado\./)).not.toBeInTheDocument();
  });

  test("si falla la carga muestra el error y permite reintentar", async () => {
    let fail = true;
    installFetch({
      get: () => (fail ? jsonRes({ error: "Error del servidor" }, 500) : jsonRes(access(false))),
    });
    const user = userEvent.setup();
    render(<PatientAccessPanel patientId={7} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Error del servidor");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    fail = false;
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: /permitir acceso sin contraseña/i })).toBeInTheDocument()
    );
  });

  test("sin 'Próximamente' cuando el backend informa el flujo como disponible", async () => {
    installFetch({ get: () => jsonRes(access(false, true)) });
    render(<PatientAccessPanel patientId={7} />);
    await screen.findByRole("checkbox", { name: /permitir acceso sin contraseña/i });
    expect(screen.queryByText("Próximamente")).not.toBeInTheDocument();
    expect(screen.queryByText(/sigue ingresando con su contraseña/)).not.toBeInTheDocument();
  });
});
