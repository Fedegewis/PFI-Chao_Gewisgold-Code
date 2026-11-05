import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { InviteAcceptScreen } from "./InviteAcceptScreen.jsx";
import * as authService from "../services/authService.js";
import * as invitationsApi from "../services/invitationsApi.js";

const TOKEN = "inv-token";
const PATIENT = { id: 12, role: "patient", name: "Elsa", email: "elsa@example.test" };
const LOOKUP = {
  status: "pending",
  email: "elsa@example.test",
  patient_name: "Elsa",
  age: 74,
  expires_at: "2026-11-12T12:00:00.000Z",
  professional_name: "Lic. Pérez",
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup({ passwordless = true, sameOrigin = true } = {}) {
  vi.spyOn(invitationsApi, "lookupInvitationApi").mockResolvedValue({ ...LOOKUP, passwordless_available: passwordless });
  vi.spyOn(authService, "isSameOriginApi").mockReturnValue(sameOrigin);
  const onAccepted = vi.fn();
  const onAcceptedWithoutPassword = vi.fn();
  render(
    <InviteAcceptScreen
      token={TOKEN}
      onAccepted={onAccepted}
      onAcceptedWithoutPassword={onAcceptedWithoutPassword}
      onGoToLogin={vi.fn()}
    />
  );
  return { onAccepted, onAcceptedWithoutPassword };
}

describe("InviteAcceptScreen — ingreso sin contraseña", () => {
  test("si está disponible, la persona entra con Ingresar sin crear contraseña", async () => {
    const accept = vi.spyOn(authService, "acceptInvitationWithoutPassword")
      .mockResolvedValue({ user: PATIENT, csrf_token: "c" });
    const { onAcceptedWithoutPassword } = setup();

    const enter = await screen.findByRole("button", { name: /^ingresar$/i });
    expect(screen.queryByLabelText(/crear contraseña/i)).not.toBeInTheDocument();
    expect(accept).not.toHaveBeenCalled(); // no se acepta al abrir el enlace

    await userEvent.click(enter);
    expect(accept).toHaveBeenCalledWith(TOKEN);
    expect(onAcceptedWithoutPassword).toHaveBeenCalledWith({ user: PATIENT, csrf_token: "c" });
  });

  test("puede elegir crear una contraseña y volver", async () => {
    setup();
    await userEvent.click(await screen.findByRole("button", { name: /prefiero crear una contraseña/i }));
    expect(screen.getByLabelText(/^crear contraseña$/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /ingresar sin contraseña/i }));
    expect(screen.getByRole("button", { name: /^ingresar$/i })).toBeInTheDocument();
  });

  test("si el backend no lo ofrece, se mantiene el formulario con contraseña", async () => {
    setup({ passwordless: false });
    expect(await screen.findByLabelText(/^crear contraseña$/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^ingresar$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ingresar sin contraseña/i })).not.toBeInTheDocument();
  });

  test("sin API en el mismo origen (la cookie no viajaría) se pide contraseña", async () => {
    setup({ sameOrigin: false });
    expect(await screen.findByLabelText(/^crear contraseña$/i)).toBeInTheDocument();
  });

  test("si el ingreso directo se apagó, pasa al formulario con un aviso", async () => {
    vi.spyOn(authService, "acceptInvitationWithoutPassword")
      .mockRejectedValue(Object.assign(new Error("x"), { status: 503, code: "passwordless_unavailable" }));
    setup();
    await userEvent.click(await screen.findByRole("button", { name: /^ingresar$/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/creá una contraseña para continuar/i);
    expect(screen.getByLabelText(/^crear contraseña$/i)).toBeInTheDocument();
  });

  test("invitación ya usada: mensaje claro", async () => {
    vi.spyOn(authService, "acceptInvitationWithoutPassword")
      .mockRejectedValue(Object.assign(new Error("x"), { status: 409, code: "accepted", data: { status: "accepted" } }));
    setup();
    await userEvent.click(await screen.findByRole("button", { name: /^ingresar$/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/ya fue utilizada/i);
  });
});
