// Si el inicio automático de la sesión falla (servidor despertando, corte de
// red), "Siguiente" reintenta el inicio antes de guardar la respuesta: el
// paciente no queda trabado con un error que no puede resolver.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { activities } from "../data/activities.js";
import { createPatient } from "../services/patientService.js";
import * as api from "../services/patientSessionsApi.js";
import { ActivityScreen } from "./ActivityScreen.jsx";

const PATIENT = createPatient({ id: "p1", name: "Elena Gómez", age: 74, aiInstructions: "" });
const MARKET = activities.find((a) => a.id === "market");

const SESSION = {
  id: 77,
  status: "created",
  sections: [
    {
      questions: [
        { id: 1, display_order: 1, prompt_snapshot: "¿Pregunta uno?", options_snapshot: ["A", "B", "C", "D"], response_type: "multiple_choice" },
        { id: 2, display_order: 2, prompt_snapshot: "¿Pregunta dos?", options_snapshot: ["E", "F", "G", "H"], response_type: "multiple_choice" },
      ],
    },
  ],
};

afterEach(() => vi.restoreAllMocks());

function networkError() {
  const err = new Error("No se pudo conectar con el servidor. Intentá nuevamente en unos minutos.");
  err.status = 0;
  return err;
}

describe("ActivityScreen — reintento del inicio de sesión", () => {
  test("si el inicio falló, 'Siguiente' lo reintenta y después guarda la respuesta", async () => {
    const start = vi.spyOn(api, "startSessionApi")
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce({ id: 77, status: "in_progress" });
    const submit = vi.spyOn(api, "submitAnswerApi").mockResolvedValue({});
    const user = userEvent.setup();

    render(<ActivityScreen activity={MARKET} onBack={vi.fn()} onComplete={vi.fn()} patient={PATIENT} activeSession={SESSION} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo conectar con el servidor");
    await user.click(screen.getByRole("button", { name: /^A/ }));
    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(start).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(await screen.findByText("¿Pregunta dos?")).toBeInTheDocument();
  });

  test("si el reintento indica que ya estaba iniciada, continúa igual", async () => {
    const conflict = Object.assign(new Error("La sesión no está en estado created"), { status: 409, data: { status: "in_progress" } });
    vi.spyOn(api, "startSessionApi").mockRejectedValueOnce(networkError()).mockRejectedValueOnce(conflict);
    const submit = vi.spyOn(api, "submitAnswerApi").mockResolvedValue({});
    const user = userEvent.setup();

    render(<ActivityScreen activity={MARKET} onBack={vi.fn()} onComplete={vi.fn()} patient={PATIENT} activeSession={SESSION} />);

    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: /^A/ }));
    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  });

  test("si el reintento vuelve a fallar, no envía la respuesta y muestra el error", async () => {
    vi.spyOn(api, "startSessionApi").mockRejectedValue(networkError());
    const submit = vi.spyOn(api, "submitAnswerApi").mockResolvedValue({});
    const user = userEvent.setup();

    render(<ActivityScreen activity={MARKET} onBack={vi.fn()} onComplete={vi.fn()} patient={PATIENT} activeSession={SESSION} />);

    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: /^A/ }));
    await user.click(screen.getByRole("button", { name: "Siguiente" }));

    await waitFor(() => expect(api.startSessionApi).toHaveBeenCalledTimes(2));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo conectar con el servidor");
  });
});
