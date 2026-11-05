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

  // ============================================================
  // Polling automático (fix: no_analysis seguía polleando sólo 2 veces)
  // ============================================================

  function nope404() {
    return Object.assign(new Error("no"), { status: 404, data: { status: "no_analysis" } });
  }

  test("polling automático: no_analysis → ok sin recargar la página", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const getSpy = vi.spyOn(analysisApi, "getAnalysis")
        .mockRejectedValueOnce(nope404())
        .mockRejectedValueOnce(nope404())
        .mockResolvedValue({ source: "stored", analysis: SAMPLE_ANALYSIS });
      render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
      // El panel entra inicialmente en no_analysis.
      await screen.findByText(/Todavía no hay síntesis del asistente IA/i);
      // Avanzar al próximo poll (8s + un poco por el jitter interno).
      await vi.advanceTimersByTimeAsync(8500);
      // El panel sigue en no_analysis (segundo 404).
      expect(screen.getByText(/Todavía no hay síntesis del asistente IA/i)).toBeInTheDocument();
      // Avanzar al tercer poll (otros 8s), donde el GET devuelve ok.
      await vi.advanceTimersByTimeAsync(8500);
      // La síntesis aparece automáticamente, sin ningún click ni reload.
      await screen.findByText(SAMPLE_ANALYSIS.content.summary);
      expect(getSpy.mock.calls.length).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  test("polling se detiene cuando llega ok (no hay 4ta llamada)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const getSpy = vi.spyOn(analysisApi, "getAnalysis")
        .mockRejectedValueOnce(nope404())
        .mockResolvedValue({ source: "stored", analysis: SAMPLE_ANALYSIS });
      render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
      await screen.findByText(/Todavía no hay síntesis del asistente IA/i);
      await vi.advanceTimersByTimeAsync(8500);
      await screen.findByText(SAMPLE_ANALYSIS.content.summary);
      const callsAfterOk = getSpy.mock.calls.length;
      // Avanzar mucho más tiempo: el polling debe estar detenido.
      await vi.advanceTimersByTimeAsync(30_000);
      expect(getSpy.mock.calls.length).toBe(callsAfterOk);
    } finally {
      vi.useRealTimers();
    }
  });

  test("cambio de sesión cancela polling anterior y no mezcla datos", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const getSpy = vi.spyOn(analysisApi, "getAnalysis").mockImplementation((id) => {
        if (id === 4333) return Promise.reject(nope404());
        if (id === 7777) return Promise.resolve({ source: "stored", analysis: { ...SAMPLE_ANALYSIS, id: 2, session_id: 7777, content: { ...SAMPLE_ANALYSIS.content, summary: "resumen de 7777" } } });
        return Promise.reject(nope404());
      });
      const { rerender } = render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
      await screen.findByText(/Todavía no hay síntesis del asistente IA/i);
      const callsBeforeSwitch = getSpy.mock.calls.length;
      rerender(<AnalysisAsistidoPanel session={{ id: 7777, status: "completed" }} />);
      await screen.findByText(/resumen de 7777/);
      // Avanzar tiempo: no debe aparecer summary de 4333 ni haber nuevas calls a 4333.
      await vi.advanceTimersByTimeAsync(20_000);
      expect(screen.queryByText(SAMPLE_ANALYSIS.content.summary)).not.toBeInTheDocument();
      const callsFor4333 = getSpy.mock.calls.filter((c) => c[0] === 4333).length;
      expect(callsFor4333).toBe(callsBeforeSwitch);
    } finally {
      vi.useRealTimers();
    }
  });

  test("desmontaje limpia timers (sin actualizaciones de estado post-unmount)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const getSpy = vi.spyOn(analysisApi, "getAnalysis").mockRejectedValue(nope404());
      const { unmount } = render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
      await screen.findByText(/Todavía no hay síntesis del asistente IA/i);
      const callsBeforeUnmount = getSpy.mock.calls.length;
      unmount();
      await vi.advanceTimersByTimeAsync(30_000);
      // Después del unmount no deberían dispararse nuevos polls.
      expect(getSpy.mock.calls.length).toBe(callsBeforeUnmount);
      // Y React no debería haber reportado warnings de state update post-unmount.
      const stateUpdateWarnings = errSpy.mock.calls.filter((c) =>
        String(c?.[0] ?? "").includes("state update on an unmounted"),
      );
      expect(stateUpdateWarnings.length).toBe(0);
    } finally {
      errSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  test("error temporal de red hace backoff y se recupera cuando el backend responde", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const err500 = Object.assign(new Error("boom"), { status: 500, data: {} });
      const getSpy = vi.spyOn(analysisApi, "getAnalysis")
        .mockRejectedValueOnce(err500)
        .mockResolvedValue({ source: "stored", analysis: SAMPLE_ANALYSIS });
      render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
      // Primer error → el panel muestra errorMessage pero no se rinde.
      await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(1));
      // Avanzar el backoff inicial (10s) + margen.
      await vi.advanceTimersByTimeAsync(10_500);
      await screen.findByText(SAMPLE_ANALYSIS.content.summary);
      expect(getSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("no hace solicitudes duplicadas: inFlightRef previene overlapping", async () => {
    // Dejamos un GET colgado para simular inflight prolongado; mientras tanto
    // nada debe disparar un segundo GET espontáneo.
    let resolveFirst;
    const getSpy = vi.spyOn(analysisApi, "getAnalysis").mockImplementation(
      () => new Promise((resolve) => { resolveFirst = resolve; })
    );
    render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
    // Pequeño yield de microtasks para que el runOnce arranque.
    await Promise.resolve();
    await Promise.resolve();
    expect(getSpy).toHaveBeenCalledTimes(1);
    // Resolver y confirmar que no hay duplicación.
    resolveFirst({ source: "stored", analysis: SAMPLE_ANALYSIS });
    await screen.findByText(SAMPLE_ANALYSIS.content.summary);
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  test("regresión 4812: last_failed → ok automático sin cambiar de sesión", async () => {
    // Reproduce el bug observado: el worker produce un failed transient
    // (ej. OLLAMA_TIMEOUT), el GET devuelve last_failed, el panel muestra
    // el cartel rojo. Luego el worker reintenta y persiste ok. El panel
    // debe actualizarse automáticamente sin que el profesional toque nada.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const getSpy = vi.spyOn(analysisApi, "getAnalysis")
        .mockResolvedValueOnce({ status: "last_failed", error_code: "OLLAMA_TIMEOUT" })
        .mockResolvedValue({ source: "stored", analysis: SAMPLE_ANALYSIS });
      render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
      // Primer poll: panel muestra el estado de fallo.
      await screen.findByText(/No se pudo generar la síntesis del asistente IA/i);
      expect(screen.getByRole("alert")).toBeInTheDocument();
      // Avanzar al próximo poll (PENDING_POLL_INTERVAL_MS = 8s).
      await vi.advanceTimersByTimeAsync(8500);
      // El análisis OK aparece sin ninguna interacción del profesional.
      await screen.findByText(SAMPLE_ANALYSIS.content.summary);
      // El cartel rojo del last_failed desapareció.
      expect(screen.queryByText(/No se pudo generar la síntesis del asistente IA/i)).not.toBeInTheDocument();
      expect(getSpy.mock.calls.length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("last_failed persistente mantiene polling activo (no se detiene)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const getSpy = vi.spyOn(analysisApi, "getAnalysis").mockResolvedValue({
        status: "last_failed",
        error_code: "OLLAMA_TIMEOUT",
      });
      render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
      await screen.findByText(/No se pudo generar la síntesis del asistente IA/i);
      const callsAfterFirst = getSpy.mock.calls.length;
      // Avanzar 2 ciclos de PENDING_POLL_INTERVAL_MS.
      await vi.advanceTimersByTimeAsync(8500);
      await vi.advanceTimersByTimeAsync(8500);
      // Debe haber al menos 1-2 polls más — el loop sigue vivo.
      expect(getSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    } finally {
      vi.useRealTimers();
    }
  });

  test("el botón manual se sigue mostrando y funcionando en estado no_analysis", async () => {
    const getSpy = vi.spyOn(analysisApi, "getAnalysis").mockRejectedValue(nope404());
    const genSpy = vi.spyOn(analysisApi, "generateAnalysis").mockResolvedValue({
      source: "generated",
      analysis: SAMPLE_ANALYSIS,
    });
    render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
    const btn = await screen.findByRole("button", { name: /Generar síntesis IA/i });
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    await screen.findByText(SAMPLE_ANALYSIS.content.summary);
    expect(genSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalled();
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

  test("síntesis IA retenida por el backend: muestra aviso y conserva los bloques determinísticos", async () => {
    const WITHHELD = {
      id: 12, session_id: 4333, model: "llama3.2:3b",
      schema_version: "3", prompt_version: "3.4", latency_ms: 4000,
      created_at: "2026-11-04T15:21:00.000Z",
      ai_text_withheld: true,
      ai_text_withheld_reasons: ["clinical_rule_out"],
      content: {
        schema_version: "3",
        activities: DETERMINISTIC_CONTEXT.activities,
        evidence: DETERMINISTIC_CONTEXT.evidence,
        comparison_metrics: null,
        observations: DETERMINISTIC_CONTEXT.observations,
        follow_up: DETERMINISTIC_CONTEXT.follow_up,
      },
    };
    vi.spyOn(analysisApi, "getAnalysis").mockResolvedValue({ source: "stored", analysis: WITHHELD });
    render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
    const notice = await screen.findByTestId("ai-text-withheld");
    expect(notice).toHaveTextContent(
      "La síntesis de IA de esta sesión está pendiente de actualización. Los indicadores y observaciones automáticas siguen disponibles."
    );
    expect(notice).toHaveTextContent(/Síntesis del asistente IA/);
    expect(screen.queryByTestId("block-sintesis-ia")).not.toBeInTheDocument();
    const observations = screen.getByTestId("block-observaciones");
    // El aviso ocupa el lugar de la síntesis: dentro del cuerpo del informe,
    // después de los bloques determinísticos.
    expect(notice.closest(".analysis-body")).toBe(observations.closest(".analysis-body"));
    expect(observations.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: /Regenerar análisis/i })).toBeInTheDocument();
  });

  test("análisis 3.4 con summary conforme y aspectos descartados: muestra la síntesis sin aspectos ni aviso", async () => {
    const RECOVERED = {
      id: 13, session_id: 4333, model: "llama3.2:3b",
      schema_version: "3", prompt_version: "3.4", latency_ms: 4000,
      created_at: "2026-11-04T15:21:00.000Z",
      ai_text_withheld: false,
      content: {
        schema_version: "3",
        summary: "La sesión fue completada en su totalidad.",
        aspects_to_review: [],
        activities: DETERMINISTIC_CONTEXT.activities,
        evidence: DETERMINISTIC_CONTEXT.evidence,
        comparison_metrics: null,
        observations: DETERMINISTIC_CONTEXT.observations,
        follow_up: DETERMINISTIC_CONTEXT.follow_up,
      },
    };
    vi.spyOn(analysisApi, "getAnalysis").mockResolvedValue({ source: "stored", analysis: RECOVERED });
    render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
    const block = await screen.findByTestId("block-sintesis-ia");
    expect(block).toHaveTextContent("La sesión fue completada en su totalidad.");
    expect(screen.queryByText(/Aspectos a revisar sugeridos por IA/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("ai-text-withheld")).not.toBeInTheDocument();
  });

  test("contrato legacy retenido: muestra el aviso en el cuerpo del informe", async () => {
    vi.spyOn(analysisApi, "getAnalysis").mockResolvedValue({
      source: "stored",
      analysis: {
        ...SAMPLE_ANALYSIS,
        ai_text_withheld: true,
        ai_text_withheld_reasons: ["forbidden_clinical_term"],
        content: { schema_version: "2", evidence: [] },
      },
    });
    render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
    const notice = await screen.findByTestId("ai-text-withheld");
    expect(notice.closest(".analysis-body")).not.toBeNull();
    expect(notice).toHaveTextContent(/pendiente de actualización/);
  });

  test("análisis conforme: no muestra el aviso de síntesis retenida", async () => {
    vi.spyOn(analysisApi, "getAnalysis").mockResolvedValue({ source: "stored", analysis: { ...SAMPLE_ANALYSIS, ai_text_withheld: false } });
    render(<AnalysisAsistidoPanel session={COMPLETED_SESSION} />);
    await screen.findByText(SAMPLE_ANALYSIS.content.summary);
    expect(screen.queryByTestId("ai-text-withheld")).not.toBeInTheDocument();
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
