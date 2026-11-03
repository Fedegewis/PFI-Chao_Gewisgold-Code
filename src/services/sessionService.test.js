// Cálculos locales de sesiones del modo demo (localStorage).
import { describe, expect, test } from "vitest";
import {
  averageField,
  buildCompletedActivityState,
  buildInitialSessions,
  computeStats,
  countSessionsThisWeek,
  getPatientSessions,
  summarizeAnswers
} from "./sessionService.js";

const NOW = new Date("2026-11-03T12:00:00Z");

describe("averageField / summarizeAnswers", () => {
  test("promedio vacío es 0", () => {
    expect(averageField([], "accuracy")).toBe(0);
  });

  test("resume respuestas con precisión y latencia redondeadas", () => {
    const summary = summarizeAnswers([
      { correct: true, latencyMs: 1000 },
      { correct: false, latencyMs: 2001 },
      { correct: true, latencyMs: 3000 }
    ]);
    expect(summary).toMatchObject({ total: 3, correctCount: 2, accuracy: 67, avgLatencyMs: 2000 });
  });

  test("sin respuestas devuelve ceros", () => {
    expect(summarizeAnswers([])).toMatchObject({ total: 0, accuracy: 0, avgLatencyMs: 0 });
  });
});

describe("getPatientSessions / countSessionsThisWeek", () => {
  test("filtra por paciente y cuenta las de los últimos 7 días", () => {
    const recent = new Date(Date.now() - 2 * 86400000).toISOString();
    const old = new Date(Date.now() - 20 * 86400000).toISOString();
    const sessions = [
      { patientId: "a", date: recent },
      { patientId: "a", date: old },
      { patientId: "b", date: recent }
    ];
    const mine = getPatientSessions(sessions, "a");
    expect(mine).toHaveLength(2);
    expect(countSessionsThisWeek(mine)).toBe(1);
  });
});

describe("buildCompletedActivityState", () => {
  const patient = {
    id: "p1",
    completed: ["market"],
    answers: 10,
    weeklyProgress: [0, 0, 0, 0, 0, 0, 0]
  };
  const activity = { id: "bus", title: "Pagar el boleto", skill: "Atención y cálculo" };

  test("primera sesión con buen desempeño", () => {
    const { nextSessions, patientPatch } = buildCompletedActivityState({
      patient,
      sessions: [],
      activity,
      summary: { correctCount: 4, total: 5, accuracy: 80, avgLatencyMs: 2000 },
      totalActivities: 10,
      now: NOW
    });
    expect(nextSessions).toHaveLength(1);
    expect(nextSessions[0]).toMatchObject({ patientId: "p1", activityId: "bus", accuracy: 80 });
    expect(patientPatch).toMatchObject({
      completed: ["market", "bus"],
      answers: 15,
      score: 80,
      trend: "+0%",
      status: "Rendimiento optimo",
      risk: "Bajo",
      responseTime: "2.0 s"
    });
    expect(patientPatch.weeklyProgress[NOW.getDay()]).toBe(10);
  });

  test("sesión baja respecto de las previas", () => {
    const previous = [{ patientId: "p1", accuracy: 90, avgLatencyMs: 2000 }];
    const { patientPatch } = buildCompletedActivityState({
      patient,
      sessions: previous,
      activity,
      summary: { correctCount: 2, total: 5, accuracy: 40, avgLatencyMs: 9000 },
      totalActivities: 10,
      now: NOW
    });
    expect(patientPatch.trend).toBe("-25%");
    expect(patientPatch.status).toBe("Requiere apoyo");
    expect(patientPatch.risk).toBe("Medio");
  });

  test("desempeño intermedio queda en seguimiento", () => {
    const { patientPatch } = buildCompletedActivityState({
      patient,
      sessions: [],
      activity,
      summary: { correctCount: 3, total: 5, accuracy: 60, avgLatencyMs: 2000 },
      totalActivities: 10,
      now: NOW
    });
    expect(patientPatch.status).toBe("En seguimiento");
  });
});

describe("buildInitialSessions", () => {
  test("genera sesiones sintéticas determinísticas y dentro de rango", () => {
    const a = buildInitialSessions(NOW);
    const b = buildInitialSessions(NOW);
    expect(a).toEqual(b);
    expect(a.length).toBe(61);
    for (const s of a) {
      expect(s.accuracy).toBeGreaterThanOrEqual(20);
      expect(s.accuracy).toBeLessThanOrEqual(100);
      expect(s.avgLatencyMs).toBeGreaterThanOrEqual(1500);
      expect(new Date(s.date).getTime()).toBeLessThan(NOW.getTime());
    }
    expect(new Set(a.map((s) => s.patientId)).size).toBe(8);
  });
});

describe("computeStats", () => {
  test("sin sesiones", () => {
    expect(computeStats([])).toEqual({ count: 0, weekCount: 0, avgAccuracy: 0, avgLatencySec: "-", lastLabel: "sin registro" });
  });

  test("con sesiones", () => {
    const date = new Date().toISOString();
    const stats = computeStats([
      { accuracy: 70, avgLatencyMs: 3000, date },
      { accuracy: 81, avgLatencyMs: 4000, date }
    ]);
    expect(stats).toMatchObject({ count: 2, weekCount: 2, avgAccuracy: 76, avgLatencySec: "3.5" });
    expect(stats.lastLabel).toMatch(/\d{1,2}\/\d{1,2}/);
  });
});
