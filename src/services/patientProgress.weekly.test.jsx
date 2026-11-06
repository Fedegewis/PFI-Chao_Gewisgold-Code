// Progreso semanal = días con actividad en la semana actual (domingo a sábado).
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { ProgressPanel } from "../components/patient/ProgressPanel.jsx";
import { deriveWeeklyProgressFromSessions } from "./patientProgress.js";
import { refreshDailyPatientState } from "./patientService.js";

// Miércoles 11/11/2026 15:00 hora local; la semana va del dom 8 al sáb 14.
const NOW = new Date(2026, 10, 11, 15, 0, 0);
const at = (day, hour = 10) => new Date(2026, 10, day, hour, 0, 0).toISOString();
const done = (completed_at) => ({ status: "completed", completed_at, sections: [] });

afterEach(cleanup);

describe("deriveWeeklyProgressFromSessions", () => {
  test("cuenta sesiones completadas por día de la semana actual", () => {
    const week = deriveWeeklyProgressFromSessions(
      [done(at(8)), done(at(9, 9)), done(at(9, 18)), done(at(11, 8))],
      NOW
    );
    expect(week).toEqual([1, 2, 0, 1, 0, 0, 0]);
  });

  test("ignora otras semanas, sesiones no completadas y fechas inválidas", () => {
    const week = deriveWeeklyProgressFromSessions(
      [
        done(at(7, 23)), // sábado anterior
        done(at(15, 1)), // domingo siguiente
        { status: "abandoned", completed_at: at(10) },
        { status: "in_progress", completed_at: null },
        done("no-es-fecha"),
        null,
      ],
      NOW
    );
    expect(week).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  test("entrada no válida devuelve la semana vacía", () => {
    expect(deriveWeeklyProgressFromSessions(undefined, NOW)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("ProgressPanel", () => {
  test("muestra los días con actividad, no un porcentaje", () => {
    render(<ProgressPanel patient={{ weeklyProgress: [1, 2, 0, 1, 0, 0, 0] }} completedCount={1} />);
    expect(screen.getByText("3/7")).toBeInTheDocument();
    expect(screen.getByText(/3 días con actividad esta semana/i)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveAccessibleName(/3 de 7 días con actividad.*domingo, lunes, miércoles/i);
  });

  test("semana sin actividad", () => {
    render(<ProgressPanel patient={{ weeklyProgress: [0, 0, 0, 0, 0, 0, 0] }} completedCount={0} />);
    expect(screen.getByText("0/7")).toBeInTheDocument();
    expect(screen.getByText(/todavía no hay días con actividad/i)).toBeInTheDocument();
  });
});

describe("refreshDailyPatientState – reinicio semanal", () => {
  const base = { mood: null, completed: [], weeklyProgress: [0, 1, 1, 0, 0, 0, 0] };

  test("reinicia la semana si la última actividad es de una semana anterior, aunque hoy no haya actividades", () => {
    const next = refreshDailyPatientState({ ...base, lastSessionAt: at(3) }, NOW);
    expect(next.weeklyProgress).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  test("conserva la semana si la última actividad es de esta semana", () => {
    const next = refreshDailyPatientState({ ...base, lastSessionAt: at(9) }, NOW);
    expect(next.weeklyProgress).toEqual(base.weeklyProgress);
  });

  test("sin lastSessionAt (perfiles de demo) no toca la semana", () => {
    const next = refreshDailyPatientState({ ...base, lastSessionAt: null }, NOW);
    expect(next.weeklyProgress).toEqual(base.weeklyProgress);
  });
});
