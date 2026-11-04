// Mobile (≤ 760 px): el estado de ánimo se muestra antes de las actividades,
// con una sola instancia de MoodPanel (sin estados ni IDs duplicados), y el
// aviso médico usa la variante compacta. En escritorio nada cambia.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  MEDICAL_DISCLAIMER_COMPACT,
  MEDICAL_DISCLAIMER_FULL_TEXT,
  MEDICAL_DISCLAIMER_SHORT,
  MEDICAL_DISCLAIMER_TITLE,
} from "../constants/legal.js";
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

  test("mobile: el aviso legal completo se abre desde el aviso compacto", async () => {
    mockMatchMedia(true);
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole("button", { name: "Ver aviso legal completo" }));
    const dialog = screen.getByRole("dialog", { name: MEDICAL_DISCLAIMER_TITLE });
    expect(within(dialog).getByText(MEDICAL_DISCLAIMER_FULL_TEXT)).toBeInTheDocument();
  });

  test("mobile: con teclado, 'Prefiero no indicar' recibe el foco DESPUÉS de las opciones", async () => {
    mockMatchMedia(true);
    const user = userEvent.setup();
    const patient = { ...PATIENT, mood: "bien", moodSelectedAt: new Date().toISOString() };
    renderScreen({ patient });
    const group = screen.getByRole("group", { name: "¿Cómo te sentís hoy?" });
    const chips = within(group).getAllByRole("button");
    const clear = screen.getByRole("button", { name: /Prefiero no indicar/ });
    expect(clear).toBeEnabled();
    chips[0].focus();
    for (let i = 1; i < chips.length; i += 1) {
      await user.tab();
      expect(chips[i]).toHaveFocus();
    }
    await user.tab();
    expect(clear).toHaveFocus();
    // Sin tabIndex positivos en el panel.
    const panel = group.closest(".patient-mood-mobile");
    const positive = [...panel.querySelectorAll("[tabindex]")].filter((el) => Number(el.getAttribute("tabindex")) > 0);
    expect(positive).toHaveLength(0);
  });

  test("CSS mobile: 'Prefiero no indicar' se ubica visualmente después de las opciones (mismo orden que el DOM)", () => {
    // jsdom no aplica CSS: se verifica la regla en la hoja de estilos para que
    // el orden visual no vuelva a adelantarse al orden de foco.
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const orderOf = (selector) => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\border:\\s*(-?\\d+)`));
      return match ? Number(match[1]) : 0;
    };
    expect(orderOf(".patient-mood-mobile .mood-clear")).toBeGreaterThan(orderOf(".patient-mood-mobile .mood-grid"));
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
