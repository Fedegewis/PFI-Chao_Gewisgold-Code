// Saludo del panel profesional: primer nombre del profesional autenticado,
// o "Hola" sin nombre cuando no hay uno disponible (no se inventan datos).
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ProfessionalScreen } from "./ProfessionalScreen.jsx";

function renderWithName(professionalName) {
  render(
    <ProfessionalScreen
      professionalName={professionalName}
      patients={[]}
      professionalId="prof-1"
      selectedPatient={null}
      sessions={[]}
      setSelectedPatientId={() => {}}
      updatePatient={() => {}}
      isBackendProfessional={false}
    />
  );
  return screen.getByTestId("professional-greeting");
}

describe("ProfessionalScreen — saludo", () => {
  test("muestra sólo el primer nombre del profesional", () => {
    expect(renderWithName("Florencia Pérez").textContent).toBe("Hola, Florencia");
  });

  test("usa el nombre de otro profesional cuando cambia la sesión", () => {
    expect(renderWithName("  Martín   Gómez ").textContent).toBe("Hola, Martín");
  });

  test.each([undefined, null, "", "   "])("sin nombre disponible (%j) muestra sólo «Hola»", (name) => {
    expect(renderWithName(name).textContent).toBe("Hola");
  });
});
