// Ficha del paciente en modo demo local (PatientDetail) y sus paneles:
// gráfico de evolución, tabla y línea de tiempo de sesiones, observación
// local y configuración de dominios.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AiConfigPanel } from "./AiConfigPanel.jsx";
import { AiObservation } from "./AiObservation.jsx";
import { EvolutionChart } from "./EvolutionChart.jsx";
import { PatientDetail } from "./PatientDetail.jsx";
import { SessionTable } from "./SessionTable.jsx";
import { SessionTimeline } from "./SessionTimeline.jsx";

const PATIENT = {
  id: "p1",
  name: "Elena Gómez",
  age: 74,
  note: "Sin observaciones",
  score: 0,
  responseTime: "-",
  trend: "0%",
  risk: "Bajo",
  aiInstructions: "Preguntas cortas",
  maxQuestions: 5,
  activeDomains: ["Memoria", "Atención"]
};

function session(i, accuracy, avgLatencyMs = 3000) {
  return {
    id: `s${i}`,
    patientId: "p1",
    activityTitle: `Actividad ${i}`,
    skill: "Memoria de trabajo",
    date: new Date(2026, 9, i).toISOString(),
    accuracy,
    avgLatencyMs
  };
}

const EMPTY_STATS = { count: 0, weekCount: 0, avgAccuracy: 0, avgLatencySec: "-" };

class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderDetail(props = {}) {
  return render(
    <PatientDetail
      selectedPatient={PATIENT}
      patientSessions={[]}
      sessions={[]}
      stats={EMPTY_STATS}
      questionSample={<p>Muestra</p>}
      onSaveAiConfig={vi.fn()}
      {...props}
    />
  );
}

describe("PatientDetail", () => {
  test("sin sesiones ni score muestra 'Sin datos' y estados vacíos", () => {
    renderDetail();
    expect(screen.getByRole("heading", { level: 2, name: "Elena Gómez" })).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(screen.getAllByText("Sin datos")).toHaveLength(2);
    expect(screen.getByText(/vas a ver acá la línea de tiempo/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Eliminar paciente/ })).toBeNull();
  });

  test("con score previo usa score, tiempo y tendencia del paciente", () => {
    renderDetail({ selectedPatient: { ...PATIENT, score: 68, responseTime: "4.2 s", trend: "+3%" } });
    expect(screen.getByText("68%")).toBeInTheDocument();
    expect(screen.getByText("4.2 s")).toBeInTheDocument();
    expect(screen.getByText("+3%")).toBeInTheDocument();
    expect(screen.getByText("Bajo")).toBeInTheDocument();
  });

  test("con sesiones usa las estadísticas calculadas", () => {
    const sessions = [session(1, 80), session(2, 40)];
    renderDetail({
      patientSessions: sessions,
      sessions,
      stats: { count: 2, weekCount: 1, avgAccuracy: 60, avgLatencySec: "4.5" }
    });
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("4.5 s")).toBeInTheDocument();
    expect(screen.getByText("1 esta semana")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Sesiones recientes" })).toBeInTheDocument();
  });

  test("eliminar: cancelar cierra el diálogo", () => {
    renderDetail({ onDeletePatient: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: /Eliminar paciente/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("eliminar: click en el fondo cierra el diálogo, pero no dentro", () => {
    renderDetail({ onDeletePatient: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: /Eliminar paciente/ }));
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(document.querySelector(".ai-modal-backdrop"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("eliminar: confirmación exitosa cierra el diálogo", async () => {
    const onDeletePatient = vi.fn().mockResolvedValue(undefined);
    renderDetail({ onDeletePatient });
    fireEvent.click(screen.getByRole("button", { name: /Eliminar paciente/ }));
    fireEvent.click(screen.getByRole("button", { name: /Sí, eliminar definitivamente/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onDeletePatient).toHaveBeenCalledTimes(1);
  });

  test("eliminar: un error se muestra y el diálogo sigue abierto", async () => {
    renderDetail({ onDeletePatient: vi.fn().mockRejectedValue(new Error("Fallo de red")) });
    fireEvent.click(screen.getByRole("button", { name: /Eliminar paciente/ }));
    fireEvent.click(screen.getByRole("button", { name: /Sí, eliminar definitivamente/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Fallo de red");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("eliminar: error sin mensaje usa texto genérico", async () => {
    renderDetail({ onDeletePatient: vi.fn().mockRejectedValue({}) });
    fireEvent.click(screen.getByRole("button", { name: /Eliminar paciente/ }));
    fireEvent.click(screen.getByRole("button", { name: /Sí, eliminar definitivamente/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo eliminar el paciente.");
  });
});

describe("EvolutionChart", () => {
  test("sin sesiones muestra el mensaje vacío", () => {
    const { container } = render(<EvolutionChart sessions={[]} />);
    expect(container.querySelector(".empty-chart")).toBeInTheDocument();
  });

  test("muestra hasta 8 barras con su tono según precisión", () => {
    const sessions = Array.from({ length: 10 }, (_, i) => session(i + 1, [90, 60, 20][i % 3]));
    const { container } = render(<EvolutionChart sessions={sessions} />);
    expect(container.querySelectorAll(".evolution-slot")).toHaveLength(8);
    expect(container.querySelector(".bar-high")).toBeInTheDocument();
    expect(container.querySelector(".bar-mid")).toBeInTheDocument();
    expect(container.querySelector(".bar-low")).toBeInTheDocument();
    expect(container.querySelector(".scroll-hint")).toBeNull();
  });

  test("muestra la pista de scroll cuando las barras desbordan", () => {
    const widths = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(500);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
    const { container, unmount } = render(<EvolutionChart sessions={[session(1, 80)]} />);
    expect(container.querySelector(".scroll-hint")).toBeInTheDocument();
    unmount();
    expect(widths).toHaveBeenCalled();
  });
});

describe("SessionTable", () => {
  test("sin sesiones no renderiza nada", () => {
    const { container } = render(<SessionTable sessions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("muestra las últimas 5, la más reciente primero", () => {
    const sessions = Array.from({ length: 7 }, (_, i) => session(i + 1, 70));
    render(<SessionTable sessions={sessions} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(5);
    expect(within(rows[0]).getByText("Actividad 7")).toBeInTheDocument();
    expect(within(rows[4]).getByText("Actividad 3")).toBeInTheDocument();
  });
});

describe("SessionTimeline", () => {
  test("ordena de más reciente a más antigua y marca el tono", () => {
    const { container } = render(<SessionTimeline sessions={[session(1, 80), session(3, 40), session(2, 60)]} />);
    const titles = [...container.querySelectorAll(".timeline-head strong")].map((n) => n.textContent);
    expect(titles).toEqual(["Actividad 3", "Actividad 2", "Actividad 1"]);
    expect(container.querySelector(".timeline-score--good")).toBeInTheDocument();
    expect(container.querySelector(".timeline-score--mid")).toBeInTheDocument();
    expect(container.querySelector(".timeline-score--low")).toBeInTheDocument();
    expect(screen.getAllByText("3.0 s")).toHaveLength(3);
  });
});

describe("AiConfigPanel", () => {
  function renderPanel(patient = PATIENT, onSave = vi.fn()) {
    const utils = render(<AiConfigPanel selectedPatient={patient} onSave={onSave} />);
    return { ...utils, onSave };
  }

  test("guarda instrucciones recortadas, cantidad y dominios", () => {
    const { onSave } = renderPanel();
    fireEvent.change(screen.getByLabelText(/Cómo se mide/), { target: { value: "  Pocas preguntas  " } });
    fireEvent.change(screen.getByLabelText(/Cantidad máxima/), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Orientación" }));
    fireEvent.click(screen.getByRole("button", { name: /Guardar criterio/ }));
    expect(onSave).toHaveBeenCalledWith("Pocas preguntas", 7, ["Memoria", "Atención", "Orientación"]);
    expect(screen.getByRole("button", { name: /Guardado/ })).toBeInTheDocument();
  });

  test("instrucciones vacías → error", () => {
    const { onSave } = renderPanel();
    fireEvent.change(screen.getByLabelText(/Cómo se mide/), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar criterio/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("Describí al menos una indicación.");
    expect(onSave).not.toHaveBeenCalled();
  });

  test("cantidad fuera de rango → error", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText(/Cantidad máxima/), { target: { value: "11" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar criterio/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("entre 1 y 10");
  });

  test("sin dominios activos → error", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Memoria" }));
    fireEvent.click(screen.getByRole("button", { name: "Atención" }));
    fireEvent.click(screen.getByRole("button", { name: /Guardar criterio/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("al menos un dominio");
  });

  test("dominios guardados inválidos o vacíos → todos activos", () => {
    for (const activeDomains of [undefined, ["Memoria", "Inexistente"]]) {
      const { unmount } = renderPanel({ ...PATIENT, activeDomains });
      const pressed = screen.getAllByRole("button", { pressed: true });
      expect(pressed).toHaveLength(5);
      unmount();
    }
  });

  test("al cambiar de paciente recarga sus datos", () => {
    const { rerender } = renderPanel();
    rerender(
      <AiConfigPanel
        selectedPatient={{ ...PATIENT, id: "p2", name: "Otro", aiInstructions: "Nuevo criterio", activeDomains: ["Orientación"] }}
        onSave={vi.fn()}
      />
    );
    expect(screen.getByLabelText(/Cómo se mide/)).toHaveValue("Nuevo criterio");
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
  });
});

describe("AiObservation", () => {
  test("genera la observación local, la muestra en modal y permite reabrirla", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<AiObservation patient={PATIENT} sessions={[session(1, 80)]} />);
    fireEvent.click(screen.getByRole("button", { name: /Generar observación/ }));
    const dialog = await screen.findByRole("dialog", { name: "Observación clínica" });
    expect(within(dialog).getByText("Resumen")).toBeInTheDocument();
    expect(within(dialog).getByText("Tendencia")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ver observación generada" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(document.querySelector(".ai-modal-backdrop"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /Regenerar observación/ })).toBeInTheDocument();
  });

  test("texto de Ollama sin secciones se muestra como párrafo", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ response: "Texto libre." }) }));
    render(<AiObservation patient={PATIENT} sessions={[session(1, 80)]} />);
    fireEvent.click(screen.getByRole("button", { name: /Generar observación/ }));
    expect(await screen.findByText("Texto libre.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("si la generación falla muestra un mensaje de error", async () => {
    const ai = await import("../../ai.js");
    vi.spyOn(ai, "generateObservation").mockRejectedValue(new Error("boom"));
    render(<AiObservation patient={PATIENT} sessions={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /Generar observación/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Regenerar observación/ })).toBeInTheDocument());
  });
});
