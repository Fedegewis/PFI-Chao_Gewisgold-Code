import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TrainingConfigPanel } from "./TrainingConfigPanel.jsx";

function jsonRes(body, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  });
}

const DOMAINS = [
  { id: 1, slug: "memoria", name: "Memoria" },
  { id: 2, slug: "atencion", name: "Atención" },
  { id: 3, slug: "orientacion", name: "Orientación" },
];

function installFetchStub({ config, availability, putResponse } = {}) {
  const fetchMock = vi.fn(async (url, opts = {}) => {
    if (url.endsWith("/cognitive-domains")) return jsonRes(DOMAINS);
    if (url.endsWith("/training-config") && (!opts.method || opts.method === "GET")) {
      return jsonRes(config);
    }
    if (url.endsWith("/training-config") && opts.method === "PUT") {
      const body = JSON.parse(opts.body);
      const updated = putResponse || {
        max_questions: body.max_questions,
        active_domain_slugs: body.active_domain_slugs,
        effective_max_questions: body.max_questions ?? 4,
        effective_active_domain_slugs: body.active_domain_slugs ?? null,
      };
      return jsonRes(updated);
    }
    if (url.endsWith("/training-availability")) return jsonRes(availability);
    return jsonRes({ error: "unexpected" }, 500);
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

describe("TrainingConfigPanel", () => {
  test("carga config y muestra cantidad + dominios reales del backend", async () => {
    installFetchStub({
      config: {
        max_questions: 6,
        active_domain_slugs: ["memoria", "atencion"],
        effective_max_questions: 6,
        effective_active_domain_slugs: ["memoria", "atencion"],
      },
      availability: {
        requested: 6,
        active_domain_slugs: ["memoria", "atencion"],
        sections: [
          { section_id: 1, section_slug: "home", section_name: "Objetos de la casa", available: 20, sufficient: true },
        ],
      },
    });

    render(<TrainingConfigPanel patientId={42} patientName="María" />);
    await waitFor(() => expect(screen.getByLabelText(/^cantidad de preguntas$/i)).toBeTruthy());
    const input = screen.getByLabelText(/^cantidad de preguntas$/i);
    expect(input.value).toBe("6");
    expect(screen.getByRole("button", { name: /Memoria/i, pressed: true })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Atención/i, pressed: true })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Orientación/i, pressed: false })).toBeTruthy();
  });

  test("modifica cantidad y guarda vía API", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetchStub({
      config: {
        max_questions: null,
        active_domain_slugs: null,
        effective_max_questions: 4,
        effective_active_domain_slugs: null,
      },
      availability: { requested: 4, active_domain_slugs: null, sections: [] },
    });

    render(<TrainingConfigPanel patientId={7} patientName="Ana" />);
    await waitFor(() => expect(screen.getByLabelText(/^cantidad de preguntas$/i)).toBeTruthy());

    const plusBtn = screen.getByRole("button", { name: /aumentar cantidad/i });
    await user.click(plusBtn);
    await user.click(plusBtn);
    expect(screen.getByLabelText(/^cantidad de preguntas$/i).value).toBe("6");

    const save = screen.getByRole("button", { name: /Guardar configuración/i });
    await user.click(save);

    // La 4ta llamada (idx 3) es el PUT.
    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(
        ([, opts]) => opts && opts.method === "PUT"
      );
      expect(putCall).toBeTruthy();
      const body = JSON.parse(putCall[1].body);
      expect(body.max_questions).toBe(6);
      expect(body.active_domain_slugs).toBeNull();
    });
  });

  test("selecciona/deselecciona dominios y guarda con array normalizado", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetchStub({
      config: {
        max_questions: 4,
        active_domain_slugs: null,
        effective_max_questions: 4,
        effective_active_domain_slugs: null,
      },
      availability: { requested: 4, active_domain_slugs: null, sections: [] },
    });

    render(<TrainingConfigPanel patientId={7} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Memoria/i })).toBeTruthy());

    await user.click(screen.getByRole("button", { name: /Memoria/i }));
    await user.click(screen.getByRole("button", { name: /Atención/i }));
    await user.click(screen.getByRole("button", { name: /Guardar configuración/i }));

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(([, opts]) => opts?.method === "PUT");
      expect(putCall).toBeTruthy();
      const body = JSON.parse(putCall[1].body);
      expect(body.active_domain_slugs).toEqual(["memoria", "atencion"]);
    });
  });

  test("muestra listado de actividades parcialmente insuficientes cuando al menos una cumple", async () => {
    // Regresión del bug detectado en pruebas pre-tesis: la UI no advertía
    // al profesional cuando una actividad concreta no tenía preguntas
    // suficientes; el paciente recibía el error recién al iniciarla. Ahora
    // el panel surfacea cada sección insuficiente al guardar la configuración.
    installFetchStub({
      config: {
        max_questions: 6,
        active_domain_slugs: ["orientacion"],
        effective_max_questions: 6,
        effective_active_domain_slugs: ["orientacion"],
      },
      availability: {
        requested: 6,
        active_domain_slugs: ["orientacion"],
        any_sufficient: true,
        sections: [
          { section_id: 1, section_slug: "calendar", section_name: "Agenda de turnos", available: 2, sufficient: false },
          { section_id: 2, section_slug: "home", section_name: "Objetos de la casa", available: 20, sufficient: true },
        ],
      },
    });

    render(<TrainingConfigPanel patientId={99} />);
    await waitFor(() => expect(screen.getByLabelText(/^cantidad de preguntas$/i)).toBeTruthy());
    // No se dispara la alerta global de inviabilidad (hay al menos una actividad viable).
    expect(screen.queryByText(/ninguna actividad/i)).toBeNull();
    // Pero sí se enumera la actividad insuficiente con su conteo.
    expect(screen.getByText(/Agenda de turnos \(2\/6\)/i)).toBeTruthy();
  });

  test("muestra advertencia solo cuando NINGUNA actividad puede cumplir la configuración", async () => {
    installFetchStub({
      config: {
        max_questions: 10,
        active_domain_slugs: ["orientacion"],
        effective_max_questions: 10,
        effective_active_domain_slugs: ["orientacion"],
      },
      availability: {
        requested: 10,
        active_domain_slugs: ["orientacion"],
        any_sufficient: false,
        sections: [
          { section_id: 1, section_slug: "calendar", section_name: "Agenda de turnos", available: 6, sufficient: false },
          { section_id: 2, section_slug: "home", section_name: "Objetos de la casa", available: 6, sufficient: false },
        ],
      },
    });

    render(<TrainingConfigPanel patientId={99} />);
    await waitFor(() => expect(screen.getByText(/ninguna actividad/i)).toBeTruthy());
  });

  test("no muestra la advertencia cuando any_sufficient=true", async () => {
    installFetchStub({
      config: {
        max_questions: 4,
        active_domain_slugs: null,
        effective_max_questions: 4,
        effective_active_domain_slugs: null,
      },
      availability: {
        requested: 4,
        active_domain_slugs: null,
        any_sufficient: true,
        sections: [
          { section_id: 2, section_slug: "home", section_name: "Objetos de la casa", available: 20, sufficient: true },
        ],
      },
    });

    render(<TrainingConfigPanel patientId={7} />);
    await waitFor(() => expect(screen.getByLabelText(/^cantidad de preguntas$/i)).toBeTruthy());
    expect(screen.queryByText(/ninguna actividad/i)).toBeNull();
  });

  test("no muestra el nombre del paciente en el bloque de configuración", async () => {
    installFetchStub({
      config: { max_questions: 4, active_domain_slugs: null, effective_max_questions: 4, effective_active_domain_slugs: null },
      availability: { requested: 4, active_domain_slugs: null, sections: [] },
    });
    render(<TrainingConfigPanel patientId={7} />);
    await waitFor(() => expect(screen.getByLabelText(/^cantidad de preguntas$/i)).toBeTruthy());
    // Ya no debería duplicarse el nombre — el detalle del paciente lo muestra arriba.
    expect(screen.queryByText(/María/i)).toBeNull();
  });

  test("muestra error controlado si la API falla al guardar", async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi.fn(async (url, opts = {}) => {
      if (url.endsWith("/cognitive-domains")) return jsonRes(DOMAINS);
      if (url.endsWith("/training-config") && (!opts.method || opts.method === "GET")) {
        return jsonRes({
          max_questions: 4,
          active_domain_slugs: null,
          effective_max_questions: 4,
          effective_active_domain_slugs: null,
        });
      }
      if (url.endsWith("/training-availability")) {
        return jsonRes({ requested: 4, active_domain_slugs: null, sections: [] });
      }
      if (url.endsWith("/training-config") && opts.method === "PUT") {
        return jsonRes({ error: "Boom" }, 400);
      }
      return jsonRes({}, 500);
    });

    render(<TrainingConfigPanel patientId={7} />);
    await waitFor(() => expect(screen.getByLabelText(/^cantidad de preguntas$/i)).toBeTruthy());
    await user.click(screen.getByRole("button", { name: /aumentar cantidad/i }));
    await user.click(screen.getByRole("button", { name: /Guardar configuración/i }));
    await waitFor(() => expect(screen.getByText(/Boom/)).toBeTruthy());
  });
});
