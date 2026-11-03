// F3: el paciente sólo ve las actividades iniciables según la configuración
// del backend (availableSections). Sin availableSections se muestran todas.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ACTIVITY_TO_SECTION_SLUG } from "../constants/appConfig.js";
import { activities } from "../data/activities.js";
import { createPatient } from "../services/patientService.js";
import { PatientScreen } from "./PatientScreen.jsx";

const PATIENT = createPatient({ id: "p1", name: "Elena Gómez", age: 74, aiInstructions: "" });

function sectionsFor(startableIds) {
  return {
    requested: 4,
    sections: activities.map((a) => ({
      section_slug: ACTIVITY_TO_SECTION_SLUG[a.id],
      startable: startableIds.includes(a.id)
    }))
  };
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

function activityButtons() {
  return within(screen.getByRole("list", { name: "Lista de actividades" })).getAllByRole("button");
}

describe("PatientScreen", () => {
  test("sin availableSections muestra todas las actividades y abre la elegida", () => {
    const onOpenActivity = vi.fn();
    renderScreen({ onOpenActivity });
    expect(screen.getByText(/Hola, Elena\./)).toBeInTheDocument();
    expect(screen.getByText(/Continuidad: 0 días/)).toBeInTheDocument();
    expect(activityButtons()).toHaveLength(activities.length);
    fireEvent.click(activityButtons()[0]);
    expect(onOpenActivity).toHaveBeenCalledWith(activities[0]);
  });

  test("oculta las actividades no iniciables y lo informa", () => {
    renderScreen({ availableSections: sectionsFor(["market"]), isBackendPatient: true });
    const titles = activityButtons().map((b) => b.getAttribute("aria-label"));
    expect(titles.some((t) => t.startsWith("Lista del supermercado"))).toBe(true);
    expect(titles.some((t) => t.startsWith("Pagar el boleto"))).toBe(false);
    expect(screen.getByText(/actividades ocultas porque no cumplen/)).toBeInTheDocument();
  });

  test("con una sola oculta usa el singular", () => {
    const startable = activities.map((a) => a.id).filter((id) => id !== "bus");
    renderScreen({ availableSections: sectionsFor(startable), isBackendPatient: true });
    expect(screen.getByText("Hay 1 actividad oculta porque no cumple con la configuración vigente.")).toBeInTheDocument();
  });

  test("sin actividades iniciables muestra aviso para hablar con el profesional", () => {
    renderScreen({ availableSections: sectionsFor([]), isBackendPatient: true });
    expect(screen.getByText(/No hay actividades disponibles/)).toBeInTheDocument();
    expect(screen.queryByText(/ocultas/)).toBeNull();
  });

  test("muestra el error de inicio de actividad y la racha de días", () => {
    const weeklyProgress = [0, 0, 0, 0, 0, 0, 0];
    weeklyProgress[new Date().getDay()] = 20;
    renderScreen({
      activityStartError: "No se pudo iniciar la actividad.",
      patient: { ...PATIENT, weeklyProgress }
    });
    expect(screen.getByText("No se pudo iniciar la actividad.")).toBeInTheDocument();
    expect(screen.getByText(/Continuidad: 1 día$/)).toBeInTheDocument();
  });
});

