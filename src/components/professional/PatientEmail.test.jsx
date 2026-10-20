import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { PatientCard } from "./PatientCard.jsx";
import { BackendPatientDetail } from "./BackendPatientDetail.jsx";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Panel profesional — email del paciente visible", () => {
  test("PatientCard muestra el email del paciente", () => {
    render(
      <PatientCard
        patient={{ id: 1, name: "Ana Pérez", age: 71, email: "ana@example.com" }}
        selected={false}
        onSelect={() => {}}
        isBackend
      />
    );
    expect(screen.getByText("ana@example.com")).toBeTruthy();
  });

  test("PatientCard no renderiza email si no viene del backend", () => {
    render(
      <PatientCard
        patient={{ id: 2, name: "Sin Email", age: 70 }}
        selected={false}
        onSelect={() => {}}
        isBackend
      />
    );
    expect(screen.queryByText(/@/)).toBeNull();
  });

  test("BackendPatientDetail muestra email en la ficha del paciente seleccionado", () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    render(
      <BackendPatientDetail
        selectedPatient={{ id: 1, name: "Juan García", age: 72, email: "juan.garcia@example.com" }}
        sessionsState={{ patientId: 1, list: [], loading: false, error: "" }}
        onDeletePatient={null}
      />
    );
    expect(screen.getByText("juan.garcia@example.com")).toBeTruthy();
  });
});
