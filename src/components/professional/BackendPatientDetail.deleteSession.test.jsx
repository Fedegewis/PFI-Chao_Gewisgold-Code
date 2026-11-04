import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { BackendPatientDetail } from "./BackendPatientDetail.jsx";

const PATIENT = { id: 1, name: "Paciente Test", age: 70 };

function completed(id, day, accuracy = 0.75) {
  return {
    id,
    status: "completed",
    created_at: `2026-11-0${day}T10:00:00Z`,
    started_at: `2026-11-0${day}T10:00:00Z`,
    completed_at: `2026-11-0${day}T10:05:00Z`,
    abandoned_at: null,
    patient_reported_mood: null,
    summary: {
      total_questions: 4, answered_questions: 4, correct_count: 3, incorrect_count: 1,
      accuracy, completion_rate: 1, mean_latency_ms: 3300,
    },
    adaptive: null,
  };
}

function unfinished(id, status, day) {
  return {
    id,
    status,
    created_at: `2026-11-0${day}T09:00:00Z`,
    started_at: status === "created" ? null : `2026-11-0${day}T09:00:00Z`,
    completed_at: null,
    abandoned_at: status === "abandoned" ? `2026-11-0${day}T09:03:00Z` : null,
    patient_reported_mood: null,
    adaptive: { level: 2, version: "1", decision: { level: 2, change: "initial", rule: "initial_level", evidence: null } },
  };
}

// Harness con estado real: `onDeleteSession` simula el DELETE y el refetch
// del historial (lo que hace useAppController.deleteSessionForProfessional).
function Harness({ initial, deleteImpl }) {
  const [list, setList] = useState(initial);
  async function onDeleteSession(id) {
    await deleteImpl(id);
    setList((current) => current.filter((s) => s.id !== id));
  }
  return (
    <BackendPatientDetail
      selectedPatient={PATIENT}
      sessionsState={{ patientId: 1, list, loading: false, error: "" }}
      onDeletePatient={null}
      onDeleteSession={onDeleteSession}
    />
  );
}

function rows() {
  const table = screen.getByRole("table", { name: "Historial de sesiones" });
  return within(table).getAllByRole("row").slice(1);
}

function selectRow(statusLabel) {
  const row = rows().find((r) => within(r).queryByText(statusLabel));
  fireEvent.click(row);
}

beforeEach(() => {
  // AnalysisAsistidoPanel consulta la API al seleccionar una sesión.
  globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("BackendPatientDetail — eliminar sesión", () => {
  test("no ofrece eliminar sesiones completadas", () => {
    render(<Harness initial={[completed(10, 4)]} deleteImpl={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Eliminar sesión/ })).toBeNull();
  });

  test.each([
    ["created", "Iniciada"],
    ["in_progress", "En progreso"],
    ["abandoned", "Abandonada"],
  ])("ofrece eliminar una sesión %s", (status, label) => {
    render(<Harness initial={[unfinished(20, status, 3), completed(10, 2)]} deleteImpl={vi.fn()} />);
    selectRow(label);
    expect(screen.getByRole("button", { name: new RegExp(`Eliminar sesión .*${label}`) })).toBeTruthy();
    // El bloque de ajuste de dificultad también aparece en sesiones no completadas.
    expect(screen.getByTestId("adaptive-decision")).toBeTruthy();
  });

  test("cancelar cierra el diálogo, no llama al backend y devuelve el foco", () => {
    const deleteImpl = vi.fn();
    render(<Harness initial={[unfinished(20, "abandoned", 3)]} deleteImpl={deleteImpl} />);
    selectRow("Abandonada");
    const trigger = screen.getByRole("button", { name: /Eliminar sesión/ });
    fireEvent.click(trigger);

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/no se puede deshacer/)).toBeTruthy();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const cancel = within(dialog).getByRole("button", { name: "Cancelar" });
    expect(document.activeElement).toBe(cancel);

    fireEvent.click(cancel);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(deleteImpl).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  test("Escape cierra el diálogo sin eliminar", () => {
    const deleteImpl = vi.fn();
    render(<Harness initial={[unfinished(20, "abandoned", 3)]} deleteImpl={deleteImpl} />);
    selectRow("Abandonada");
    fireEvent.click(screen.getByRole("button", { name: /Eliminar sesión/ }));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(deleteImpl).not.toHaveBeenCalled();
  });

  test("confirmar: estado de carga, sin doble envío, refresca historial y limpia el detalle", async () => {
    let resolveDelete;
    const deleteImpl = vi.fn(() => new Promise((r) => { resolveDelete = r; }));
    render(<Harness initial={[unfinished(20, "in_progress", 3), completed(10, 2)]} deleteImpl={deleteImpl} />);
    expect(rows()).toHaveLength(2);
    selectRow("En progreso");
    fireEvent.click(screen.getByRole("button", { name: /Eliminar sesión/ }));

    const dialog = screen.getByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Sí, eliminar sesión" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(deleteImpl).toHaveBeenCalledTimes(1);
    expect(deleteImpl).toHaveBeenCalledWith(20);
    expect(within(dialog).getByRole("button", { name: "Eliminando..." }).disabled).toBe(true);
    expect(within(dialog).getByRole("button", { name: "Cancelar" }).disabled).toBe(true);

    await act(async () => { resolveDelete(); });

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(rows()).toHaveLength(1);
    expect(screen.queryByText("En progreso")).toBeNull();
    const feedback = screen.getByText("La sesión se eliminó correctamente.");
    expect(feedback.getAttribute("role")).toBe("status");
    await waitFor(() => expect(document.activeElement).toBe(feedback));
    // El detalle vuelve a la última completada (la eliminada ya no está seleccionada).
    expect(screen.getAllByText("Correctas").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Eliminar sesión/ })).toBeNull();
  });

  test("error del backend: muestra el error, mantiene la sesión y permite reintentar", async () => {
    const err = Object.assign(new Error("conflicto"), { status: 409 });
    const deleteImpl = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce(null);
    render(<Harness initial={[unfinished(20, "abandoned", 3)]} deleteImpl={deleteImpl} />);
    selectRow("Abandonada");
    fireEvent.click(screen.getByRole("button", { name: /Eliminar sesión/ }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, eliminar sesión" }));

    const alert = await screen.findByText(/cambió de estado/);
    expect(alert.getAttribute("role")).toBe("alert");
    expect(rows()).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Sí, eliminar sesión" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(deleteImpl).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Todavía no hay actividades registradas.")).toBeTruthy();
  });

  test("sin onDeleteSession (modo local) no se ofrece la acción", () => {
    render(
      <BackendPatientDetail
        selectedPatient={PATIENT}
        sessionsState={{ patientId: 1, list: [unfinished(20, "abandoned", 3)], loading: false, error: "" }}
        onDeletePatient={null}
      />
    );
    selectRow("Abandonada");
    expect(screen.queryByRole("button", { name: /Eliminar sesión/ })).toBeNull();
  });
});
