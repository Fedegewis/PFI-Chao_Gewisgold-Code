// BUG-08: la cantidad máxima mostrada debe venir de la configuración real
// del backend (availableSections.requested), no de un default local.

import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { PerformancePanel } from "./PerformancePanel.jsx";

const BASE_PATIENT = { id: "p1", name: "Test", maxQuestions: 4 };

function renderPanel(props = {}) {
  return render(
    <PerformancePanel
      patient={BASE_PATIENT}
      completedCount={0}
      totalActivities={10}
      {...props}
    />
  );
}

afterEach(cleanup);

describe("PerformancePanel — BUG-08 cantidad máxima", () => {
  test("backend patient con availableSections.requested=5 → muestra '5 preguntas'", () => {
    renderPanel({
      isBackendPatient: true,
      availableSections: { requested: 5, sections: [] },
    });
    expect(screen.getByText(/Cantidad máxima definida por el psicólogo: 5 preguntas/i)).toBeTruthy();
  });

  test("backend patient con availableSections.requested=10 → muestra '10 preguntas'", () => {
    renderPanel({
      isBackendPatient: true,
      availableSections: { requested: 10, sections: [] },
    });
    expect(screen.getByText(/Cantidad máxima definida por el psicólogo: 10 preguntas/i)).toBeTruthy();
  });

  test("cambio de availableSections.requested → re-renderiza con el nuevo valor", () => {
    const { rerender } = renderPanel({
      isBackendPatient: true,
      availableSections: { requested: 6, sections: [] },
    });
    expect(screen.getByText(/6 preguntas/i)).toBeTruthy();
    rerender(
      <PerformancePanel
        patient={BASE_PATIENT}
        completedCount={0}
        totalActivities={10}
        isBackendPatient
        availableSections={{ requested: 9, sections: [] }}
      />
    );
    expect(screen.getByText(/9 preguntas/i)).toBeTruthy();
    expect(screen.queryByText(/6 preguntas/i)).toBeNull();
  });

  test("dos pacientes backend con configs distintas: cada uno ve su cantidad", () => {
    const { unmount } = renderPanel({
      isBackendPatient: true,
      availableSections: { requested: 5, sections: [] },
      patient: { ...BASE_PATIENT, id: "A" },
    });
    expect(screen.getByText(/5 preguntas/i)).toBeTruthy();
    unmount();
    renderPanel({
      isBackendPatient: true,
      availableSections: { requested: 10, sections: [] },
      patient: { ...BASE_PATIENT, id: "B" },
    });
    expect(screen.getByText(/10 preguntas/i)).toBeTruthy();
  });

  test("backend patient con error de carga → NO muestra número por defecto", () => {
    renderPanel({
      isBackendPatient: true,
      availableSections: null,
      availableSectionsError: true,
    });
    expect(screen.queryByText(/\d+ preguntas/i)).toBeNull();
    expect(screen.getByText(/No pudimos cargar la cantidad/i)).toBeTruthy();
  });

  test("backend patient cargando → NO muestra el default 4", () => {
    renderPanel({
      isBackendPatient: true,
      availableSections: null,
      availableSectionsError: false,
    });
    expect(screen.queryByText(/4 preguntas/i)).toBeNull();
    expect(screen.getByText(/Cargando/i)).toBeTruthy();
  });

  test("paciente NO backend (demo local): usa patient.maxQuestions", () => {
    renderPanel({
      isBackendPatient: false,
      availableSections: null,
      patient: { ...BASE_PATIENT, maxQuestions: 7 },
    });
    expect(screen.getByText(/7 preguntas/i)).toBeTruthy();
  });
});
