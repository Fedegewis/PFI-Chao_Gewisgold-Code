import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { LoginLinkScreen } from "./LoginLinkScreen.jsx";
import { takeLoginLinkTokenFromUrl, clearCapturedLoginLinkToken } from "../services/navigationService.js";
import * as authService from "../services/authService.js";

const TOKEN = "B".repeat(43);
const PATIENT = { id: 9, role: "patient", name: "Ana", email: "ana@example.test" };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  clearCapturedLoginLinkToken();
  window.history.replaceState(null, "", "/");
});

describe("navigationService – token del enlace", () => {
  test("se lee una vez, se quita de la URL y del historial y queda sólo en memoria", () => {
    window.history.replaceState(null, "", `/#/enlace/${TOKEN}`);
    const lengthBefore = window.history.length;
    expect(takeLoginLinkTokenFromUrl()).toBe(TOKEN);
    expect(window.location.hash).toBe("#/enlace");
    expect(window.location.href).not.toContain(TOKEN);
    expect(window.history.length).toBe(lengthBefore); // replaceState, no pushState
    // Llamadas siguientes devuelven el valor en memoria aunque la URL ya no lo tenga.
    expect(takeLoginLinkTokenFromUrl()).toBe(TOKEN);
    clearCapturedLoginLinkToken();
    expect(takeLoginLinkTokenFromUrl()).toBeNull();
  });
});

describe("LoginLinkScreen", () => {
  test("no canjea el enlace automáticamente: espera que la persona toque Ingresar", async () => {
    const consume = vi.spyOn(authService, "consumePatientLoginLink").mockResolvedValue({ user: PATIENT, csrf_token: "c" });
    const onSuccess = vi.fn();
    render(<LoginLinkScreen token={TOKEN} onSuccess={onSuccess} onGoToLogin={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /ingresar a menteactiva/i })).toHaveFocus();
    expect(consume).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /^ingresar$/i }));
    expect(consume).toHaveBeenCalledWith(TOKEN);
    expect(onSuccess).toHaveBeenCalledWith({ user: PATIENT, csrf_token: "c" });
  });

  test("enlace vencido o usado: pantalla clara con opción de pedir otro", async () => {
    vi.spyOn(authService, "consumePatientLoginLink").mockRejectedValue(Object.assign(new Error("x"), { status: 410 }));
    const onGoToLogin = vi.fn();
    render(<LoginLinkScreen token={TOKEN} onSuccess={vi.fn()} onGoToLogin={onGoToLogin} />);
    await userEvent.click(screen.getByRole("button", { name: /^ingresar$/i }));

    const heading = await screen.findByRole("heading", { name: /este enlace ya no sirve/i });
    expect(heading).toHaveFocus();
    expect(screen.getByText(/vencen a los 30 minutos/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /pedir un enlace nuevo/i }));
    expect(onGoToLogin).toHaveBeenCalledWith({ passwordless: true });
    await userEvent.click(screen.getByRole("button", { name: /ingresar con mi contraseña/i }));
    expect(onGoToLogin).toHaveBeenCalledWith({ passwordless: false });
  });

  test("sin token (p. ej. recargó la página): muestra enlace no válido", () => {
    render(<LoginLinkScreen token={null} onSuccess={vi.fn()} onGoToLogin={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /este enlace ya no sirve/i })).toBeInTheDocument();
  });

  test("error de red: permite reintentar con el mismo enlace", async () => {
    const consume = vi
      .spyOn(authService, "consumePatientLoginLink")
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ user: PATIENT, csrf_token: "c" });
    const onSuccess = vi.fn();
    render(<LoginLinkScreen token={TOKEN} onSuccess={onSuccess} onGoToLogin={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /^ingresar$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/no pudimos conectar/i);
    await userEvent.click(screen.getByRole("button", { name: /intentar de nuevo/i }));
    expect(consume).toHaveBeenCalledTimes(2);
    expect(onSuccess).toHaveBeenCalled();
  });

  test("muchos intentos: mensaje de espera", async () => {
    vi.spyOn(authService, "consumePatientLoginLink").mockRejectedValue(Object.assign(new Error("x"), { status: 429 }));
    render(<LoginLinkScreen token={TOKEN} onSuccess={vi.fn()} onGoToLogin={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /^ingresar$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/esperá unos minutos/i);
  });
});
