// Mobile (≤ 760 px): el estado de ánimo se muestra antes de las actividades,
// con una sola instancia de MoodPanel (sin estados ni IDs duplicados), y el
// aviso médico usa la variante compacta. En escritorio nada cambia.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MEDICAL_DISCLAIMER_COMPACT, MEDICAL_DISCLAIMER_SHORT } from "../constants/legal.js";
import { activities } from "../data/activities.js";
import { MOBILE_LAYOUT_QUERY } from "../hooks/useMediaQuery.js";
import { createPatient } from "../services/patientService.js";
import { PatientScreen } from "./PatientScreen.jsx";

const PATIENT = createPatient({ id: "p1", name: "Elena Gómez", age: 74, aiInstructions: "" });

function mockMatchMedia(matches) {
  window.matchMedia = vi.fn((query) => ({
    matches: query === MOBILE_LAYOUT_QUERY ? matches : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function renderScreen(props = {}) {
  return render(
    <PatientScreen
      activities={activities}
      motivationMessage="Hoy es un buen día."
      onOpenActivity={vi.fn()}
      onUpdatePatient={vi.fn()}
      patient={PATIENT}
      {...props}
    />
  );
}

afterEach(() => {
  delete window.matchMedia;
});

describe("PatientScreen — layout mobile", () => {
  test("mobile: el estado de ánimo aparece dentro de la sección principal y antes de las actividades", () => {
    mockMatchMedia(true);
    renderScreen();
    const main = screen.getByRole("region", { name: "Actividades del paciente" });
    const moodGroup = within(main).getByRole("group", { name: "¿Cómo te sentís hoy?" });
    const list = within(main).getByRole("list", { name: "Lista de actividades" });
    // DOCUMENT_POSITION_FOLLOWING: la lista viene después del grupo de ánimo.
    expect(moodGroup.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Una sola instancia: no hay otro selector de ánimo en el aside.
    expect(screen.getAllByRole("group", { name: "¿Cómo te sentís hoy?" })).toHaveLength(1);
    const aside = screen.getByRole("complementary", { name: "Panel del paciente" });
    expect(within(aside).queryByRole("group", { name: "¿Cómo te sentís hoy?" })).toBeNull();
  });

  test("mobile: saludo breve y aviso médico compacto con acceso al texto completo", () => {
    mockMatchMedia(true);
    renderScreen();
    expect(screen.getByText("Hola, Elena.")).toBeInTheDocument();
    expect(screen.queryByText(/Hoy es un buen día/)).toBeNull();
    expect(screen.getByText(new RegExp(MEDICAL_DISCLAIMER_COMPACT.slice(0, 40)))).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(MEDICAL_DISCLAIMER_SHORT.slice(0, 40)))).toBeNull();
    expect(screen.getByRole("button", { name: "Ver aviso legal completo" })).toBeInTheDocument();
  });

  test("escritorio: se conserva el layout original (ánimo en el aside, aviso y saludo completos)", () => {
    mockMatchMedia(false);
    renderScreen();
    const aside = screen.getByRole("complementary", { name: "Panel del paciente" });
    expect(within(aside).getByRole("group", { name: "¿Cómo te sentís hoy?" })).toBeInTheDocument();
    expect(screen.getAllByRole("group", { name: "¿Cómo te sentís hoy?" })).toHaveLength(1);
    expect(screen.getByText("Hola, Elena. Hoy es un buen día.")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(MEDICAL_DISCLAIMER_SHORT.slice(0, 40)))).toBeInTheDocument();
  });

  test("sin matchMedia (entornos sin soporte) se usa el layout de escritorio", () => {
    renderScreen();
    const aside = screen.getByRole("complementary", { name: "Panel del paciente" });
    expect(within(aside).getByRole("group", { name: "¿Cómo te sentís hoy?" })).toBeInTheDocument();
  });

  test("mobile: elegir un estado de ánimo usa el mismo onUpdatePatient (estado único)", async () => {
    mockMatchMedia(true);
    const user = userEvent.setup();
    const onUpdatePatient = vi.fn();
    renderScreen({ onUpdatePatient });
    await user.click(screen.getByRole("button", { name: /^Calma\./ }));
    expect(onUpdatePatient).toHaveBeenCalledTimes(1);
    const [id, patch] = onUpdatePatient.mock.calls[0];
    expect(id).toBe("p1");
    expect(patch.mood).toBe("calma");
  });
});
