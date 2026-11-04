// Ayuda junto a "Siguiente": cuando todavía no se eligió una respuesta, el
// botón está deshabilitado y describe el motivo ("Elegí una opción para
// continuar."). La visibilidad la controla CSS (sólo mobile); el vínculo
// aria-describedby existe en todos los tamaños.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { activities } from "../data/activities.js";
import { createPatient } from "../services/patientService.js";
import { ActivityScreen } from "./ActivityScreen.jsx";

const PATIENT = createPatient({ id: "p1", name: "Elena Gómez", age: 74, aiInstructions: "" });
const MARKET = activities.find((a) => a.id === "market");

function renderActivity(props = {}) {
  return render(
    <ActivityScreen activity={MARKET} onBack={vi.fn()} onComplete={vi.fn()} patient={PATIENT} activeSession={null} {...props} />
  );
}

describe("ActivityScreen — ayuda de 'Siguiente' deshabilitado", () => {
  test("sin respuesta elegida: botón deshabilitado y descripto por la ayuda", () => {
    renderActivity();
    const next = screen.getByRole("button", { name: "Siguiente" });
    expect(next).toBeDisabled();
    expect(next).toHaveAccessibleDescription("Elegí una opción para continuar.");
    expect(screen.getByText("Elegí una opción para continuar.")).toBeInTheDocument();
  });

  test("al elegir una respuesta la ayuda desaparece y el botón se habilita", async () => {
    const user = userEvent.setup();
    renderActivity();
    const [first] = screen.getAllByRole("button", { pressed: false });
    await user.click(first);
    const next = screen.getByRole("button", { name: "Siguiente" });
    expect(next).toBeEnabled();
    expect(next).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText("Elegí una opción para continuar.")).toBeNull();
  });

  test("la respuesta elegida queda marcada con aria-pressed", async () => {
    const user = userEvent.setup();
    renderActivity();
    const options = screen.getAllByRole("button", { pressed: false });
    await user.click(options[1]);
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
  });
});
