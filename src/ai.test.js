// Integración legacy con Ollama + heurísticas locales de fallback.
// fetch se mockea siempre: ningún test llama a un Ollama real.
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  generateObservation,
  heuristicDifficulty,
  heuristicObservation,
  recommendDifficulty
} from "./ai.js";

const PATIENT = { id: "p1", name: "Elena Gómez", age: 74, aiInstructions: "" };

function session(i, accuracy, avgLatencyMs = 3000, extra = {}) {
  return {
    id: `s${i}`,
    patientId: "p1",
    activityTitle: "Lista del supermercado",
    skill: "Memoria de trabajo",
    date: new Date(Date.now() - (10 - i) * 86400000).toISOString(),
    accuracy,
    avgLatencyMs,
    ...extra
  };
}

function mockFetchResponse(body, { ok = true, status = 200 } = {}) {
  return vi.fn().mockResolvedValue({ ok, status, json: async () => body });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("heuristicDifficulty", () => {
  test("correcta y rápida → up", () => {
    expect(heuristicDifficulty({ correct: true, latencyMs: 1000 })).toBe("up");
  });
  test("incorrecta → down", () => {
    expect(heuristicDifficulty({ correct: false, latencyMs: 1000 })).toBe("down");
  });
  test("correcta pero lenta → hold", () => {
    expect(heuristicDifficulty({ correct: true, latencyMs: 60000 })).toBe("hold");
  });
});

describe("recommendDifficulty", () => {
  const perf = { correct: true, latencyMs: 1200, level: 0, maxLevel: 2, accuracy: 80 };

  test("usa la acción que devuelve Ollama", async () => {
    vi.stubGlobal("fetch", mockFetchResponse({ response: "  Down " }));
    await expect(recommendDifficulty(perf, "ir despacio")).resolves.toEqual({ action: "down", source: "ollama" });
  });

  test("respuesta sin acción válida → heurística local", async () => {
    vi.stubGlobal("fetch", mockFetchResponse({ response: "no sé" }));
    await expect(recommendDifficulty(perf)).resolves.toEqual({ action: "up", source: "local" });
  });

  test("Ollama con error HTTP → heurística local", async () => {
    vi.stubGlobal("fetch", mockFetchResponse({}, { ok: false, status: 500 }));
    await expect(recommendDifficulty({ ...perf, correct: false })).resolves.toEqual({ action: "down", source: "local" });
  });

  test("Ollama caído → heurística local", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(recommendDifficulty(perf)).resolves.toEqual({ action: "up", source: "local" });
  });
});

describe("heuristicObservation", () => {
  test("sin sesiones → resumen y recomendación de línea de base", () => {
    const { text, sections } = heuristicObservation(PATIENT, []);
    expect(Object.keys(sections)).toEqual(["resumen", "recomendacion"]);
    expect(sections.resumen).toMatch(/Elena/);
    expect(text).toMatch(/5 a 8 minutos/);
  });

  test("una sola sesión → no lee tendencia", () => {
    const { sections } = heuristicObservation(PATIENT, [session(1, 80)]);
    expect(sections.tendencia).toMatch(/una sola sesión/);
    expect(sections.recomendacion).toMatch(/sumar dificultad/);
    expect(sections.recomendacion).toMatch(/Memoria de trabajo/);
  });

  test("mejora entre primeras y últimas sesiones", () => {
    const { sections } = heuristicObservation(PATIENT, [session(1, 40), session(2, 45), session(3, 70), session(4, 75)]);
    expect(sections.tendencia).toMatch(/30 puntos|mejora|progreso/);
    expect(sections.recomendacion).toMatch(/consolidar/);
  });

  test("descenso entre primeras y últimas sesiones", () => {
    const { sections } = heuristicObservation(PATIENT, [session(1, 60), session(2, 60), session(3, 30), session(4, 30)]);
    expect(sections.tendencia).toMatch(/30 puntos/);
    expect(sections.recomendacion).toMatch(/sesiones cortas/);
  });

  test("rendimiento estable", () => {
    const { sections } = heuristicObservation(PATIENT, [session(1, 70), session(2, 72)]);
    expect(sections.tendencia).toMatch(/parejo|estable/);
  });

  test("última sesión lenta → sugiere acortar consignas", () => {
    const { sections } = heuristicObservation(PATIENT, [session(1, 70), session(2, 70, 9000)]);
    expect(sections.latencia).toMatch(/[Ll]atencia elevada|se estiraron/);
  });

  test("ignora sesiones de otros pacientes y sin skill", () => {
    const sessions = [session(1, 70, 3000, { skill: "" }), session(2, 70, 3000, { patientId: "otro" })];
    const { sections } = heuristicObservation(PATIENT, sessions);
    expect(sections.resumen).toMatch(/1 sesión/);
    expect(sections.recomendacion).not.toMatch(/Dominios trabajados/);
  });
});

describe("generateObservation", () => {
  test("sin sesiones no llama a Ollama", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await generateObservation(PATIENT, []);
    expect(result.source).toBe("local");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("usa el texto de Ollama cuando responde", async () => {
    vi.stubGlobal("fetch", mockFetchResponse({ response: "Observación de Ollama." }));
    const result = await generateObservation({ ...PATIENT, aiInstructions: "foco en memoria" }, [session(1, 70)]);
    expect(result).toEqual({ text: "Observación de Ollama.", source: "ollama" });
  });

  test("respuesta vacía de Ollama → fallback local", async () => {
    vi.stubGlobal("fetch", mockFetchResponse({}));
    const result = await generateObservation(PATIENT, [session(1, 70)]);
    expect(result.source).toBe("local");
    expect(result.sections).toBeTruthy();
  });

  test("Ollama caído → fallback local", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const result = await generateObservation(PATIENT, [session(1, 70)]);
    expect(result.source).toBe("local");
  });
});
