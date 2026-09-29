import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { AnalysisAsistidoPanel } from "./AnalysisAsistidoPanel.jsx";
import * as analysisApi from "../../services/analysisApi.js";

const COMPLETED_SESSION = { id: 4333, status: "completed" };
const IN_PROGRESS_SESSION = { id: 5000, status: "in_progress" };

const SAMPLE_ANALYSIS = {
  id: 1,
  session_id: 4333,
  model: "llama3.2:3b",
  schema_version: "1",
  prompt_version: "1.0",
  latency_ms: 4200,
  created_at: "2026-09-28T22:07:24.672Z",
  content: {
    schema_version: "1",
    summary: "Sesión completa con precisión baja y latencias uniformes.",
    observations_by_section: [
      { section_slug: "memoria_de_trabajo", observation: "Respondió las 4 preguntas con latencias entre 890 y 1143 ms." },
    ],
    aspects_to_review: ["Revisar retención de listas cortas."],
    evidence: [
      { scope: "global", metric: "accuracy", value: 0 },
      { scope: "section", metric: "mean_latency_ms", value: 1015.5, section_slug: "memoria_de_trabajo" },
    ],
  },
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("AnalysisAsistidoPanel", () => {
  test("sin sesión seleccionada muestra hint", () => {
    render(<AnalysisAsistidoPanel session={null} />);
    expect(screen.getByText(/Seleccioná una sesión del historial/i)).toBeInTheDocument();
  });

  test("sesión no completada no permite generar", () => {
    const getSpy = vi.spyOn(analysisApi, "getAnalysis");
    render(<AnalysisAsistidoPanel session={IN_PROGRESS_SESSION} />);
    expect(screen.getByText(/solo está disponible para sesiones completadas/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Generar análisis/i })).not.toBeInTheDocument();
    expect(getSpy).not.toHaveBeenCalled();
  });

  test("GET con análisis existente lo renderiza", async () => {
    vi.spyOn(analysisApi, "getAnalysis").mockResolvedValue({
      source: "stored",
      analysis: SAMPLE_ANALYSIS,
    });
    render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
    expect(await screen.findByText(SAMPLE_ANALYSIS.content.summary)).toBeInTheDocument();
    // 7J.3: el slug crudo NO debe aparecer en pantalla — se traduce a nombre humano.
    expect(screen.queryByText("memoria_de_trabajo")).not.toBeInTheDocument();
    // El nombre humano de la sección sí aparece (observation + evidence group).
    expect(screen.getAllByText("Memoria de trabajo").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Respondió las 4 preguntas/)).toBeInTheDocument();
    expect(screen.getByText(/Revisar retención de listas cortas/)).toBeInTheDocument();
    // Etiquetas humanas y valores formateados (no identificadores técnicos).
    expect(screen.getByText("Precisión")).toBeInTheDocument();
    // accuracy 0 → "0 %"
    expect(screen.getByText("0 %")).toBeInTheDocument();
    expect(screen.getByText("Tiempo medio de respuesta")).toBeInTheDocument();
    // 1015.5 ms → 1,02 s
    expect(screen.getByText("1,02 s")).toBeInTheDocument();
    // No debe aparecer el nombre técnico de la métrica ni el string "accuracy" o "mean_latency_ms" crudo.
    expect(screen.queryByText("accuracy")).not.toBeInTheDocument();
    expect(screen.queryByText("mean_latency_ms")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Regenerar análisis/i })).toBeInTheDocument();
  });

  test("GET sin análisis muestra botón generar", async () => {
    const err = new Error("No hay análisis");
    err.status = 404;
    err.data = { status: "no_analysis" };
    vi.spyOn(analysisApi, "getAnalysis").mockRejectedValue(err);
    render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
    expect(await screen.findByText(/Todavía no hay análisis generado/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generar análisis/i })).toBeEnabled();
  });

  test("generación exitosa muestra análisis y reemplaza el botón por Regenerar", async () => {
    const err = new Error("No hay análisis");
    err.status = 404;
    err.data = { status: "no_analysis" };
    vi.spyOn(analysisApi, "getAnalysis").mockRejectedValue(err);
    const genSpy = vi.spyOn(analysisApi, "generateAnalysis").mockResolvedValue({
      source: "generated",
      analysis: SAMPLE_ANALYSIS,
    });
    render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
    const btn = await screen.findByRole("button", { name: /Generar análisis/i });
    await userEvent.click(btn);
    expect(await screen.findByText(SAMPLE_ANALYSIS.content.summary)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Regenerar análisis/i })).toBeInTheDocument();
    expect(genSpy).toHaveBeenCalledWith(4333, { force: false });
  });

  test("estado de loading durante generación deshabilita botón y muestra hint", async () => {
    const err = new Error("No hay análisis");
    err.status = 404;
    err.data = { status: "no_analysis" };
    vi.spyOn(analysisApi, "getAnalysis").mockRejectedValue(err);
    let resolveGen;
    vi.spyOn(analysisApi, "generateAnalysis").mockImplementation(
      () => new Promise((resolve) => { resolveGen = resolve; })
    );
    render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
    const btn = await screen.findByRole("button", { name: /Generar análisis/i });
    await userEvent.click(btn);
    expect(screen.getByRole("button", { name: /Generando/i })).toBeDisabled();
    expect(screen.getByText(/puede demorar algunos segundos/i)).toBeInTheDocument();
    resolveGen({ source: "generated", analysis: SAMPLE_ANALYSIS });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Regenerar análisis/i })).toBeInTheDocument();
    });
  });

  test("error ai_unavailable muestra mensaje específico", async () => {
    const err = new Error("No se pudo generar el análisis");
    err.status = 502;
    err.data = { status: "ai_unavailable" };
    vi.spyOn(analysisApi, "getAnalysis").mockRejectedValue(err);
    render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
    expect(await screen.findByText(/no está disponible en este momento/i)).toBeInTheDocument();
  });

  test("error ai_invalid_output muestra mensaje específico", async () => {
    vi.spyOn(analysisApi, "getAnalysis").mockResolvedValue({
      source: "stored",
      analysis: SAMPLE_ANALYSIS,
    });
    const err = new Error("El modelo devolvió una respuesta que no cumple el contrato");
    err.status = 502;
    err.data = { status: "ai_invalid_output" };
    vi.spyOn(analysisApi, "generateAnalysis").mockRejectedValue(err);
    render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
    await screen.findByText(SAMPLE_ANALYSIS.content.summary);
    await userEvent.click(screen.getByRole("button", { name: /Regenerar análisis/i }));
    expect(await screen.findByText(/no cumple el contrato esperado/i)).toBeInTheDocument();
  });

  test("regeneración envía force=true", async () => {
    vi.spyOn(analysisApi, "getAnalysis").mockResolvedValue({
      source: "stored",
      analysis: SAMPLE_ANALYSIS,
    });
    const genSpy = vi.spyOn(analysisApi, "generateAnalysis").mockResolvedValue({
      source: "generated",
      analysis: { ...SAMPLE_ANALYSIS, id: 2 },
    });
    render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
    await screen.findByRole("button", { name: /Regenerar análisis/i });
    await userEvent.click(screen.getByRole("button", { name: /Regenerar análisis/i }));
    await waitFor(() => {
      expect(genSpy).toHaveBeenCalledWith(4333, { force: true });
    });
  });

  test("cambio de sesión recarga el análisis correspondiente", async () => {
    const getSpy = vi.spyOn(analysisApi, "getAnalysis").mockImplementation((id) => {
      if (id === 4333) {
        return Promise.resolve({ source: "stored", analysis: SAMPLE_ANALYSIS });
      }
      const err = new Error("no");
      err.status = 404;
      err.data = { status: "no_analysis" };
      return Promise.reject(err);
    });
    const { rerender } = render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
    await screen.findByText(SAMPLE_ANALYSIS.content.summary);
    rerender(<AnalysisAsistidoPanel session={{ id: 5555, status: "completed" }} />);
    expect(await screen.findByText(/Todavía no hay análisis generado/i)).toBeInTheDocument();
    // 7J.2: para no_analysis el panel reintenta hasta 2 veces antes de mostrar el estado final.
    // Total esperado: 1 llamada por la primera sesión + 3 por la segunda (initial + 2 retries).
    expect(getSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(getSpy).toHaveBeenNthCalledWith(1, 4333);
    // Cualquier llamada de la segunda sesión debe ser con id=5555.
    for (const call of getSpy.mock.calls.slice(1)) {
      expect(call[0]).toBe(5555);
    }
  });

  test("no llama a generate para sesiones no completadas", async () => {
    const getSpy = vi.spyOn(analysisApi, "getAnalysis");
    const genSpy = vi.spyOn(analysisApi, "generateAnalysis");
    render(<AnalysisAsistidoPanel session={IN_PROGRESS_SESSION} />);
    expect(getSpy).not.toHaveBeenCalled();
    expect(genSpy).not.toHaveBeenCalled();
  });
});
