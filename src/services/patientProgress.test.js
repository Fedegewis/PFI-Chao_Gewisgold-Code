import { describe, expect, test } from "vitest";
import { deriveCompletedTodayFromSessions, latestCompletedAt } from "./patientProgress.js";

function isoAt(hour = 10) {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function isoYesterdayAt(hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

describe("deriveCompletedTodayFromSessions", () => {
  test("mapea section_slug → activity.id correctamente para hoy", () => {
    const sessions = [
      { id: 1, status: "completed", completed_at: isoAt(9), sections: [{ section_slug: "orientacion_temporal", section_name: "Orientación temporal" }] },
    ];
    expect(deriveCompletedTodayFromSessions(sessions)).toEqual(["calendar"]);
  });

  test("sesión completed de otro día NO cuenta como hecha por hoy", () => {
    const sessions = [
      { id: 1, status: "completed", completed_at: isoYesterdayAt(9), sections: [{ section_slug: "orientacion_temporal" }] },
    ];
    expect(deriveCompletedTodayFromSessions(sessions)).toEqual([]);
  });

  test("sesión abandoned de hoy NO cuenta como completada", () => {
    const sessions = [
      { id: 1, status: "abandoned", completed_at: null, abandoned_at: isoAt(9), sections: [{ section_slug: "orientacion_temporal" }] },
    ];
    expect(deriveCompletedTodayFromSessions(sessions)).toEqual([]);
  });

  test("varias sesiones hoy de la misma actividad producen un solo activity.id", () => {
    const sessions = [
      { id: 1, status: "completed", completed_at: isoAt(8), sections: [{ section_slug: "memoria_de_trabajo" }] },
      { id: 2, status: "completed", completed_at: isoAt(9), sections: [{ section_slug: "memoria_de_trabajo" }] },
    ];
    expect(deriveCompletedTodayFromSessions(sessions)).toEqual(["market"]);
  });

  test("varias actividades distintas hoy aparecen ambas", () => {
    const sessions = [
      { id: 1, status: "completed", completed_at: isoAt(8), sections: [{ section_slug: "memoria_de_trabajo" }] },
      { id: 2, status: "completed", completed_at: isoAt(9), sections: [{ section_slug: "atencion_visual" }] },
    ];
    expect(deriveCompletedTodayFromSessions(sessions).sort()).toEqual(["home", "market"]);
  });

  test("section_slug desconocido se ignora sin romper el resultado", () => {
    const sessions = [
      { id: 1, status: "completed", completed_at: isoAt(9), sections: [{ section_slug: "seccion_inexistente" }] },
    ];
    expect(deriveCompletedTodayFromSessions(sessions)).toEqual([]);
  });

  test("input no-array devuelve []", () => {
    expect(deriveCompletedTodayFromSessions(null)).toEqual([]);
    expect(deriveCompletedTodayFromSessions(undefined)).toEqual([]);
    expect(deriveCompletedTodayFromSessions("nope")).toEqual([]);
  });
});

describe("latestCompletedAt", () => {
  test("devuelve el completed_at más reciente", () => {
    const older = isoYesterdayAt(9);
    const newer = isoAt(9);
    const sessions = [
      { status: "completed", completed_at: older },
      { status: "completed", completed_at: newer },
    ];
    expect(latestCompletedAt(sessions)).toBe(new Date(newer).toISOString());
  });

  test("ignora sesiones no completadas", () => {
    const sessions = [
      { status: "abandoned", completed_at: null, abandoned_at: isoAt(9) },
      { status: "in_progress", completed_at: null },
    ];
    expect(latestCompletedAt(sessions)).toBeNull();
  });

  test("input vacío → null", () => {
    expect(latestCompletedAt([])).toBeNull();
    expect(latestCompletedAt(null)).toBeNull();
  });
});
