// Apartado 9.3 — tests del disclaimer médico.
import { describe, test, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MedicalDisclaimerBanner,
  MedicalDisclaimerNote,
  MedicalDisclaimerLink,
} from "./MedicalDisclaimer.jsx";
import {
  MEDICAL_DISCLAIMER_COMPACT,
  MEDICAL_DISCLAIMER_FULL_TEXT,
  MEDICAL_DISCLAIMER_NOTE,
  MEDICAL_DISCLAIMER_SHORT,
  MEDICAL_DISCLAIMER_TITLE,
} from "../../constants/legal.js";

describe("MedicalDisclaimer — constantes", () => {
  test("el texto legal completo coincide EXACTAMENTE con la cláusula del apartado 9.3", () => {
    // Firma literal del texto aprobado. Cualquier alteración debe disparar
    // una revisión manual explícita antes del commit.
    const APROBADO =
      "El presente software y sus algoritmos asociados constituyen una herramienta digital de entretenimiento y estimulación orientada al bienestar cognitivo activo y la ejercitación. Las puntuaciones, métricas evolutivas, niveles asignados, gráficos e índices de desempeño generados por el sistema representan variables exclusivamente operativas e indicadores de desempeño dentro del entorno del software, y carecen de validez médica, clínica, psicométrica, diagnóstica o pronóstica. La plataforma no diagnostica el deterioro cognitivo leve, ni patología neurodegenerativa alguna, ni sustituye la evaluación, juicio clínico o tratamiento dictaminado por un médico especialista. Ante cualquier inquietud, sospecha de pérdida de memoria, alteración de la atención o trastorno de la salud neurológica y del estado de ánimo, consulte ineludiblemente a un profesional de la salud calificado y matriculado.";
    expect(MEDICAL_DISCLAIMER_FULL_TEXT).toBe(APROBADO);
  });

  test("el título usa 'Aviso legal y limitaciones de uso' (no 'Términos y Condiciones')", () => {
    expect(MEDICAL_DISCLAIMER_TITLE).toBe("Aviso legal y limitaciones de uso");
  });
});

describe("MedicalDisclaimerBanner", () => {
  test("renderiza el texto resumido y el enlace 'Ver aviso legal completo'", () => {
    render(<MedicalDisclaimerBanner />);
    expect(screen.getByText(MEDICAL_DISCLAIMER_SHORT, { exact: false })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /ver aviso legal completo/i })
    ).toBeInTheDocument();
  });

  test("abre el modal al hacer click en el enlace (mouse)", async () => {
    const user = userEvent.setup();
    render(<MedicalDisclaimerBanner />);
    await user.click(screen.getByRole("button", { name: /ver aviso legal completo/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const titleId = dialog.getAttribute("aria-labelledby");
    expect(titleId).toBeTruthy();
    expect(document.getElementById(titleId)).toHaveTextContent(MEDICAL_DISCLAIMER_TITLE);
    expect(within(dialog).getByText(MEDICAL_DISCLAIMER_FULL_TEXT)).toBeInTheDocument();
  });

  test("abre el modal con teclado (Enter)", async () => {
    const user = userEvent.setup();
    render(<MedicalDisclaimerBanner />);
    const trigger = screen.getByRole("button", { name: /ver aviso legal completo/i });
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("cierra el modal con Escape y restaura el foco al disparador", async () => {
    const user = userEvent.setup();
    render(<MedicalDisclaimerBanner />);
    const trigger = screen.getByRole("button", { name: /ver aviso legal completo/i });
    await user.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  test("cierra el modal con el botón de cerrar", async () => {
    const user = userEvent.setup();
    render(<MedicalDisclaimerBanner />);
    await user.click(screen.getByRole("button", { name: /ver aviso legal completo/i }));
    const closeBtn = screen.getByRole("button", { name: /cerrar aviso legal/i });
    await user.click(closeBtn);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("focus trap: tab cíclico queda dentro del modal", async () => {
    const user = userEvent.setup();
    render(<MedicalDisclaimerBanner />);
    await user.click(screen.getByRole("button", { name: /ver aviso legal completo/i }));
    const closeBtn = screen.getByRole("button", { name: /cerrar aviso legal/i });
    // Foco inicial al botón de cerrar.
    expect(closeBtn).toHaveFocus();
    // Único elemento focusable → Tab debe mantener el foco en el mismo botón.
    await user.tab();
    expect(closeBtn).toHaveFocus();
    await user.tab({ shift: true });
    expect(closeBtn).toHaveFocus();
  });
});

describe("MedicalDisclaimerBanner — variante compacta (mobile)", () => {
  test("el texto compacto conserva las tres ideas núcleo del aviso resumido", () => {
    // 1) carácter operativo de entrenamiento cognitivo, 2) sin validez
    // médica/diagnóstica, 3) remisión a un profesional de la salud.
    expect(MEDICAL_DISCLAIMER_COMPACT).toMatch(/métricas operativas de entrenamiento cognitivo/);
    expect(MEDICAL_DISCLAIMER_COMPACT).toMatch(/sin validez médica ni diagnóstica/);
    expect(MEDICAL_DISCLAIMER_COMPACT).toMatch(/consultá a un profesional de la salud/);
    // Misma frase final que el aviso resumido aprobado.
    expect(MEDICAL_DISCLAIMER_SHORT).toContain("Ante cualquier inquietud, consultá a un profesional de la salud.");
    expect(MEDICAL_DISCLAIMER_COMPACT).toContain("Ante cualquier inquietud, consultá a un profesional de la salud.");
    // Es más breve que el resumido (objetivo: ocupar menos espacio en mobile).
    expect(MEDICAL_DISCLAIMER_COMPACT.length).toBeLessThan(MEDICAL_DISCLAIMER_SHORT.length);
  });

  test("compact muestra el texto compacto (no el resumido) dentro de un role=note", () => {
    render(<MedicalDisclaimerBanner compact />);
    const note = screen.getByRole("note", { name: /aviso legal y limitaciones de uso/i });
    expect(note).toHaveClass("medical-disclaimer--compact");
    expect(within(note).getByText(MEDICAL_DISCLAIMER_COMPACT, { exact: false })).toBeInTheDocument();
    expect(within(note).queryByText(MEDICAL_DISCLAIMER_SHORT, { exact: false })).not.toBeInTheDocument();
  });

  test("compact mantiene accesible el aviso legal completo (teclado) y restaura el foco", async () => {
    const user = userEvent.setup();
    render(<MedicalDisclaimerBanner compact />);
    const trigger = screen.getByRole("button", { name: /ver aviso legal completo/i });
    trigger.focus();
    await user.keyboard("{Enter}");
    const dialog = screen.getByRole("dialog", { name: MEDICAL_DISCLAIMER_TITLE });
    expect(within(dialog).getByText(MEDICAL_DISCLAIMER_FULL_TEXT)).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe("MedicalDisclaimerNote", () => {
  test("renderiza la nota contextual aprobada", () => {
    render(<MedicalDisclaimerNote />);
    expect(screen.getByText(MEDICAL_DISCLAIMER_NOTE)).toBeInTheDocument();
  });

  test('role="note" para asistencia tecnológica', () => {
    render(<MedicalDisclaimerNote />);
    const notes = screen.getAllByRole("note");
    expect(notes.length).toBeGreaterThan(0);
  });
});

describe("MedicalDisclaimerLink", () => {
  test("renderiza un botón que abre el modal", async () => {
    const user = userEvent.setup();
    render(<MedicalDisclaimerLink />);
    const link = screen.getByRole("button", { name: /ver aviso legal completo/i });
    await user.click(link);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("acepta label custom", () => {
    render(<MedicalDisclaimerLink label="Aviso legal y limitaciones de uso" />);
    expect(
      screen.getByRole("button", { name: /aviso legal y limitaciones de uso/i })
    ).toBeInTheDocument();
  });
});
