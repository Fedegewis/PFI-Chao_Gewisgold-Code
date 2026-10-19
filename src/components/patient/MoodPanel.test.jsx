// H-S2 — tests para MoodPanel: botón "Prefiero no indicar" y staleness.
import { describe, test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MoodPanel } from "./MoodPanel.jsx";

const TODAY_ISO = new Date().toISOString();

function basePatient(overrides = {}) {
  return {
    id: "p1",
    mood: null,
    moodSelectedAt: null,
    note: null,
    risk: null,
    ...overrides,
  };
}

describe("MoodPanel — H-S2", () => {
  test("chooseMood envía mood + moodSelectedAt ISO al onUpdatePatient", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(<MoodPanel patient={basePatient()} onUpdatePatient={onUpdate} />);

    const bien = screen.getByRole("button", { name: /^Bien\./i });
    await user.click(bien);

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const [id, patch] = onUpdate.mock.calls[0];
    expect(id).toBe("p1");
    expect(patch.mood).toBe("bien");
    expect(typeof patch.moodSelectedAt).toBe("string");
    expect(patch.moodSelectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('"Prefiero no indicar" limpia mood, moodSelectedAt, note y risk', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const patient = basePatient({
      mood: "bien",
      moodSelectedAt: TODAY_ISO,
      note: "Te sentís con energía para seguir.",
      risk: "Bajo",
    });
    render(<MoodPanel patient={patient} onUpdatePatient={onUpdate} />);

    const clearBtn = screen.getByRole("button", { name: /Prefiero no indicar/i });
    expect(clearBtn).toBeEnabled();

    await user.click(clearBtn);

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const [, patch] = onUpdate.mock.calls[0];
    expect(patch).toEqual({
      mood: null,
      moodSelectedAt: null,
      note: null,
      risk: null,
    });
  });

  test('"Prefiero no indicar" aparece deshabilitado si no hay selección vigente', () => {
    render(<MoodPanel patient={basePatient()} onUpdatePatient={() => {}} />);
    const clearBtn = screen.getByRole("button", { name: /Prefiero no indicar/i });
    expect(clearBtn).toBeDisabled();
  });

  test("mood vencido (de ayer) NO se muestra como seleccionado", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const patient = basePatient({
      mood: "cansancio",
      moodSelectedAt: yesterday.toISOString(),
    });
    render(<MoodPanel patient={patient} onUpdatePatient={() => {}} />);

    // Ninguno de los chips debe estar aria-pressed=true
    const chips = screen.queryAllByRole("button", { pressed: true });
    expect(chips).toHaveLength(0);
    // Y el botón "Prefiero no indicar" queda disabled porque no hay mood vigente
    expect(screen.getByRole("button", { name: /Prefiero no indicar/i })).toBeDisabled();
  });

  test("mood seleccionado hoy sí aparece como seleccionado", () => {
    const patient = basePatient({
      mood: "alegria",
      moodSelectedAt: TODAY_ISO,
    });
    render(<MoodPanel patient={patient} onUpdatePatient={() => {}} />);
    const alegria = screen.getByRole("button", { name: /^Alegría\./i });
    expect(alegria).toHaveAttribute("aria-pressed", "true");
  });
});
