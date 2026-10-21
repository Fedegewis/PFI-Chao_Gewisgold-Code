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
  // v3.4: por defecto el endpoint determinístico no está mockeado — lo
  // simulamos como falla silenciosa para no afectar tests que no lo cubren.
  vi.spyOn(analysisApi, "getAnalysisContext").mockRejectedValue(new Error("no mocked"));
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
    expect(screen.queryByRole("button", { name: /Generar síntesis IA/i })).not.toBeInTheDocument();
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
    expect(await screen.findByText(/Todavía no hay síntesis del asistente IA/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generar síntesis IA/i })).toBeEnabled();
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
    const btn = await screen.findByRole("button", { name: /Generar síntesis IA/i });
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
    const btn = await screen.findByRole("button", { name: /Generar síntesis IA/i });
    await userEvent.click(btn);
    expect(screen.getByRole("button", { name: /Generando/i })).toBeDisabled();
    expect(screen.getByText(/puede demorar algunos segundos/i)).toBeInTheDocument();
    resolveGen({ source: "generated", analysis: SAMPLE_ANALYSIS });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Regenerar análisis/i })).toBeInTheDocument();
    });
  });

  test("W-3: 202 deferred_pending muestra mensaje de cola, NO error, y mantiene el panel navegable", async () => {
    // Primer GET: no_analysis (todavía).
    const nope = new Error("No hay análisis");
    nope.status = 404;
    nope.data = { status: "no_analysis" };
    vi.spyOn(analysisApi, "getAnalysis").mockRejectedValue(nope);
    // POST manual: 202 deferred_pending (sin analysis).
    vi.spyOn(analysisApi, "generateAnalysis").mockResolvedValue({
      status: "deferred_pending",
      message: "El análisis se procesará por un worker externo. Consultar GET /analysis en unos segundos.",
    });
    render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
    const btn = await screen.findByRole("button", { name: /Generar síntesis IA/i });
    await userEvent.click(btn);
    // Mensaje de cola visible.
    const hint = await screen.findByTestId("analysis-generating-hint");
    expect(hint).toHaveTextContent(/quedó en cola|worker local/i);
    // No se muestra el error-box (role=alert) por un falso error.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // El panel NO vuelve al estado "no_analysis" ni muestra el botón "Generar".
    expect(screen.queryByRole("button", { name: /^Generar síntesis IA$/i })).not.toBeInTheDocument();
  });

  test("error ai_unavailable muestra mensaje específico", async () => {
    const err = new Error("No se pudo generar el análisis");
    err.status = 502;
    err.data = { status: "ai_unavailable" };
    vi.spyOn(analysisApi, "getAnalysis").mockRejectedValue(err);
    render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
    expect(await screen.findByText(/no está disponible en este momento/i)).toBeInTheDocument();
  });

  test("error ai_invalid_output al regenerar conserva análisis previo y muestra aviso", async () => {
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
    expect(
      await screen.findByText(/No se pudo actualizar el análisis\. Se conserva la última versión disponible\./i)
    ).toBeInTheDocument();
    // El análisis anterior sigue visible (no se pierde al fallar la regeneración).
    expect(screen.getByText(SAMPLE_ANALYSIS.content.summary)).toBeInTheDocument();
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
    expect(await screen.findByText(/Todavía no hay síntesis del asistente IA/i)).toBeInTheDocument();
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

  // v2: nuevos campos opcionales.
  test("renderiza el bloque 'Comparación con sesiones recientes' cuando comparison viene", async () => {
    const v2Analysis = {
      ...SAMPLE_ANALYSIS,
      schema_version: "2",
      prompt_version: "2.0",
      content: {
        ...SAMPLE_ANALYSIS.content,
        schema_version: "2",
        comparison: "La precisión actual es menor que en las dos sesiones previas comparables.",
      },
    };
    vi.spyOn(analysisApi, "getAnalysis").mockResolvedValue({ source: "stored", analysis: v2Analysis });
    render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
    expect(await screen.findByText(/Comparación con sesiones recientes/i)).toBeInTheDocument();
    expect(screen.getByText(/La precisión actual es menor/i)).toBeInTheDocument();
  });

  test("omite el bloque de comparación cuando comparison no viene (v2 sin historial)", async () => {
    const v2NoComparison = {
      ...SAMPLE_ANALYSIS,
      schema_version: "2",
      prompt_version: "2.0",
      content: {
        schema_version: "2",
        summary: SAMPLE_ANALYSIS.content.summary,
        observations_by_section: SAMPLE_ANALYSIS.content.observations_by_section,
        aspects_to_review: [],
        evidence: SAMPLE_ANALYSIS.content.evidence,
        // sin comparison
      },
    };
    vi.spyOn(analysisApi, "getAnalysis").mockResolvedValue({ source: "stored", analysis: v2NoComparison });
    render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
    await screen.findByText(v2NoComparison.content.summary);
    expect(screen.queryByText(/Comparación con sesiones recientes/i)).not.toBeInTheDocument();
  });

  test("omite el bloque 'Aspectos a revisar' cuando aspects_to_review está vacío", async () => {
    const v2NoAspects = {
      ...SAMPLE_ANALYSIS,
      schema_version: "2",
      prompt_version: "2.0",
      content: {
        ...SAMPLE_ANALYSIS.content,
        schema_version: "2",
        aspects_to_review: [],
      },
    };
    vi.spyOn(analysisApi, "getAnalysis").mockResolvedValue({ source: "stored", analysis: v2NoAspects });
    render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
    await screen.findByText(v2NoAspects.content.summary);
    expect(screen.queryByText(/Aspectos a revisar/i)).not.toBeInTheDocument();
  });

  // v2.1 — exposición del código de causa en estados failed.
  test("muestra la causa del último failed cuando el backend devuelve error_code", async () => {
    const err = new Error("No hay análisis");
    err.status = 200;
    // Simulamos la nueva forma del GET: devuelve el status + error_code.
    // El API wrapper lanza un error con .data cuando status<400 — en realidad
    // last_failed es status=200 → no lanza. Ajustamos: mockeamos resolved.
    vi.spyOn(analysisApi, "getAnalysis").mockResolvedValue({
      status: "last_failed",
      error_code: "ANALYSIS_SCHEMA_INVALID",
    });
    render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
    expect(await screen.findByText(/No se pudo generar la síntesis del asistente IA/i)).toBeInTheDocument();
    expect(screen.getByText(/Causa del último intento/i)).toBeInTheDocument();
    expect(screen.getByText(/El modelo omitió o excedió un campo del contrato/i)).toBeInTheDocument();
  });

  test("muestra la causa de validación cuando el POST falla con validation_code", async () => {
    const err = new Error("No hay análisis");
    err.status = 404;
    err.data = { status: "no_analysis" };
    vi.spyOn(analysisApi, "getAnalysis").mockRejectedValue(err);
    const genErr = new Error("502");
    genErr.status = 502;
    genErr.data = { status: "ai_invalid_output", validation_code: "SECTIONS_MISMATCH" };
    vi.spyOn(analysisApi, "generateAnalysis").mockRejectedValue(genErr);
    render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
    const btn = await screen.findByRole("button", { name: /Generar síntesis IA/i });
    await userEvent.click(btn);
    expect(await screen.findByText(/no cumple el contrato esperado/i)).toBeInTheDocument();
    expect(screen.getByText(/nombró secciones que no estaban en la sesión/i)).toBeInTheDocument();
  });

  // ------------- Contrato v3 -------------
  const V3_ANALYSIS = {
    id: 2,
    session_id: 4333,
    model: "llama3.2:3b",
    schema_version: "3",
    prompt_version: "3.0",
    latency_ms: 4200,
    created_at: "2026-10-13T12:00:00.000Z",
    content: {
      schema_version: "3",
      summary: "Se trabajó una actividad de orientación temporal durante la sesión.",
      aspects_to_review: ["Observar continuidad de la actividad trabajada."],
      activities: [
        { slug: "orientacion_temporal", name: "Agenda de turnos", cognitive_domain_slugs: ["orientacion"] },
      ],
      evidence: [
        { scope: "session", metric: "duration_seconds", value: 69 },
        { scope: "session", metric: "patient_reported_mood", value: "cansancio" },
        { scope: "global", metric: "total_questions", value: 4 },
        { scope: "global", metric: "correct_answers", value: 2 },
        { scope: "global", metric: "incorrect_answers", value: 2 },
        { scope: "global", metric: "accuracy", value: 0.5 },
        { scope: "global", metric: "completion_rate", value: 1 },
        { scope: "global", metric: "mean_latency_ms", value: 1500 },
      ],
      comparison_metrics: {
        reference: { days_before: 2 },
        accuracy: { current: 0.5, previous: 0.4, delta_percentage_points: 10, direction: "subió" },
      },
    },
  };

  test("v3: renderiza actividades, dominios y métricas desde el backend", async () => {
    vi.spyOn(analysisApi, "getAnalysis").mockResolvedValue({ source: "stored", analysis: V3_ANALYSIS });
    render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
    await screen.findByText(V3_ANALYSIS.content.summary);
    expect(screen.getByText("Agenda de turnos")).toBeInTheDocument();
    expect(screen.getByText("Orientación")).toBeInTheDocument();
    expect(screen.getByText("Cansancio")).toBeInTheDocument();
    // "Precisión" aparece dos veces: en Métricas de la sesión y en el bloque
    // de Comparación histórica (viene en comparison_metrics).
    expect(screen.getAllByText("Precisión").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("50 %")).toBeInTheDocument();
    expect(screen.getByText("Preguntas totales")).toBeInTheDocument();
    expect(screen.getByText(/Observar continuidad/)).toBeInTheDocument();
  });

  test("v3: estado de ánimo 'No registrado' cuando no se autorreportó", async () => {
    const analysis = {
      ...V3_ANALYSIS,
      content: {
        ...V3_ANALYSIS.content,
        evidence: V3_ANALYSIS.content.evidence.map((e) =>
          e.metric === "patient_reported_mood" ? { ...e, value: null } : e
        ),
      },
    };
    vi.spyOn(analysisApi, "getAnalysis").mockResolvedValue({ source: "stored", analysis });
    render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
    await screen.findByText(V3_ANALYSIS.content.summary);
    expect(screen.getByText("No registrado")).toBeInTheDocument();
  });

  test("v3: comparación histórica se oculta cuando no viene comparison_metrics", async () => {
    const analysis = {
      ...V3_ANALYSIS,
      content: { ...V3_ANALYSIS.content, comparison_metrics: null },
    };
    vi.spyOn(analysisApi, "getAnalysis").mockResolvedValue({ source: "stored", analysis });
    render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
    await screen.findByText(V3_ANALYSIS.content.summary);
    expect(screen.queryByText(/Comparación con la sesión anterior/i)).not.toBeInTheDocument();
  });

  test("v3: NO muestra observations_by_section (bloque v2)", async () => {
    vi.spyOn(analysisApi, "getAnalysis").mockResolvedValue({ source: "stored", analysis: V3_ANALYSIS });
    render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
    await screen.findByText(V3_ANALYSIS.content.summary);
    expect(screen.queryByText(/Observaciones por sección/i)).not.toBeInTheDocument();
  });

  test("v3: botón regenerar envía force=true", async () => {
    vi.spyOn(analysisApi, "getAnalysis").mockResolvedValue({ source: "stored", analysis: V3_ANALYSIS });
    const gen = vi.spyOn(analysisApi, "generateAnalysis").mockResolvedValue({
      source: "generated",
      analysis: { ...V3_ANALYSIS, id: 3 },
    });
    render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
    await screen.findByRole("button", { name: /Regenerar análisis/i });
    await userEvent.click(screen.getByRole("button", { name: /Regenerar análisis/i }));
    await waitFor(() => {
      expect(gen).toHaveBeenCalledWith(4333, { force: true });
    });
  });

  // ------------- Contrato v3.4 (fallback determinístico + observaciones) -------------
  const DETERMINISTIC_CONTEXT = {
    source: "deterministic",
    activities: [
      { slug: "memoria_de_trabajo", name: "Lista del supermercado", cognitive_domain_slugs: ["memoria"] },
    ],
    evidence: [
      { scope: "session", metric: "duration_seconds", value: 70 },
      { scope: "session", metric: "patient_reported_mood", value: null },
      { scope: "global", metric: "total_questions", value: 9 },
      { scope: "global", metric: "correct_answers", value: 4 },
      { scope: "global", metric: "incorrect_answers", value: 5 },
      { scope: "global", metric: "accuracy", value: 0.4444 },
      { scope: "global", metric: "completion_rate", value: 1 },
      { scope: "global", metric: "mean_latency_ms", value: 7800 },
    ],
    comparison_metrics: null,
    observations: [
      "La sesión fue completada en su totalidad.",
      "Se registraron más respuestas incorrectas que correctas.",
      "No existen todavía sesiones comparables para describir una tendencia.",
    ],
    follow_up: [
      "Observar si esta distribución de respuestas se mantiene en próximas sesiones de la misma actividad.",
    ],
  };

  test("v3.4: sin análisis previo, muestra bloques determinísticos desde el endpoint", async () => {
    const err = new Error("no_analysis");
    err.status = 404;
    err.data = { status: "no_analysis" };
    vi.spyOn(analysisApi, "getAnalysis").mockRejectedValue(err);
    vi.spyOn(analysisApi, "getAnalysisContext").mockResolvedValue(DETERMINISTIC_CONTEXT);
    render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
    expect(await screen.findByText("Lista del supermercado")).toBeInTheDocument();
    expect(screen.getByText("No registrado")).toBeInTheDocument();
    expect(screen.getByText(/Se registraron más respuestas incorrectas que correctas/i)).toBeInTheDocument();
    expect(screen.getByText(/Observar si esta distribución de respuestas se mantiene/i)).toBeInTheDocument();
    // Y sigue estando el botón para generar la síntesis IA.
    expect(screen.getByRole("button", { name: /Generar síntesis IA/i })).toBeInTheDocument();
  });

  test("v3.4: tras un fallo de regeneración y análisis vigente, se mantiene el banner y los bloques", async () => {
    const V34_ANALYSIS = {
      id: 10, session_id: 4333, model: "llama3.2:3b",
      schema_version: "3", prompt_version: "3.4", latency_ms: 4000,
      created_at: "2026-10-14T12:00:00.000Z",
      content: {
        schema_version: "3",
        summary: "Durante la actividad lista del supermercado, se registraron más respuestas incorrectas que correctas.",
        aspects_to_review: [],
        activities: DETERMINISTIC_CONTEXT.activities,
        evidence: DETERMINISTIC_CONTEXT.evidence,
        comparison_metrics: null,
        observations: DETERMINISTIC_CONTEXT.observations,
        follow_up: DETERMINISTIC_CONTEXT.follow_up,
      },
    };
    vi.spyOn(analysisApi, "getAnalysis").mockResolvedValue({ source: "stored", analysis: V34_ANALYSIS });
    const err = new Error("502");
    err.status = 502;
    err.data = { status: "ai_invalid_output" };
    vi.spyOn(analysisApi, "generateAnalysis").mockRejectedValue(err);
    render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
    await screen.findByText(V34_ANALYSIS.content.summary);
    await userEvent.click(screen.getByRole("button", { name: /Regenerar análisis/i }));
    expect(
      await screen.findByText(/No se pudo actualizar el análisis\. Se conserva la última versión disponible/i)
    ).toBeInTheDocument();
    // Los bloques determinísticos siguen visibles.
    expect(screen.getByText(V34_ANALYSIS.content.summary)).toBeInTheDocument();
    expect(screen.getByText(/Observaciones para seguimiento \(automáticas\)/i)).toBeInTheDocument();
  });

  test("v3.4: Ollama apagado (last_failed) muestra bloques determinísticos + aviso", async () => {
    vi.spyOn(analysisApi, "getAnalysis").mockResolvedValue({
      status: "last_failed",
      error_code: "OLLAMA_OFFLINE",
    });
    vi.spyOn(analysisApi, "getAnalysisContext").mockResolvedValue(DETERMINISTIC_CONTEXT);
    render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
    expect(await screen.findByText("Lista del supermercado")).toBeInTheDocument();
    expect(
      screen.getByText(/No se pudo generar la síntesis del asistente IA/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Ollama no respondió/i)).toBeInTheDocument();
    expect(screen.getByText(/Se registraron más respuestas incorrectas que correctas/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reintentar síntesis IA/i })).toBeInTheDocument();
  });

  test("v3.4: diferencia visualmente datos objetivos, observaciones automáticas y síntesis IA", async () => {
    const V34_ANALYSIS = {
      id: 11, session_id: 4333, model: "llama3.2:3b",
      schema_version: "3", prompt_version: "3.4", latency_ms: 4000,
      created_at: "2026-10-14T12:00:00.000Z",
      content: {
        schema_version: "3",
        summary: "Síntesis IA generada.",
        aspects_to_review: [],
        activities: DETERMINISTIC_CONTEXT.activities,
        evidence: DETERMINISTIC_CONTEXT.evidence,
        comparison_metrics: null,
        observations: DETERMINISTIC_CONTEXT.observations,
        follow_up: DETERMINISTIC_CONTEXT.follow_up,
      },
    };
    vi.spyOn(analysisApi, "getAnalysis").mockResolvedValue({ source: "stored", analysis: V34_ANALYSIS });
    render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
    await screen.findByText("Síntesis IA generada.");
    // 3 regiones distinguibles por data-testid.
    expect(screen.getByTestId("block-resumen")).toBeInTheDocument();
    expect(screen.getByTestId("block-indicadores")).toBeInTheDocument();
    expect(screen.getByTestId("block-observaciones")).toBeInTheDocument();
    expect(screen.getByTestId("block-sintesis-ia")).toBeInTheDocument();
    // Etiqueta explícita "automáticas" para el bloque de observaciones.
    expect(screen.getByText(/Observaciones para seguimiento \(automáticas\)/i)).toBeInTheDocument();
    // Etiqueta explícita "Síntesis del asistente IA".
    expect(screen.getByText(/Síntesis del asistente IA/i)).toBeInTheDocument();
  });

  test("compat lectura v1: análisis viejo (schema v1) sigue renderizándose completo", async () => {
    // SAMPLE_ANALYSIS tiene schema_version "1" en el content: no debe romper
    // la UI aunque el campo `comparison` no exista en v1.
    vi.spyOn(analysisApi, "getAnalysis").mockResolvedValue({ source: "stored", analysis: SAMPLE_ANALYSIS });
    render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
    await screen.findByText(SAMPLE_ANALYSIS.content.summary);
    expect(screen.queryByText(/Comparación con sesiones recientes/i)).not.toBeInTheDocument();
    // El bloque de síntesis y datos relevantes se mantienen. Nota: "Síntesis
    // de la sesión" aparece tanto en el heading del panel como en la eyebrow
    // del bloque; alcanza con asegurar que haya al menos uno.
    expect(screen.getAllByText(/Síntesis de la sesión/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Datos relevantes/i)).toBeInTheDocument();
  });
});
