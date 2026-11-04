import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { LoginScreen } from "./LoginScreen.jsx";
import * as authService from "../services/authService.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderLogin(props = {}) {
  return render(<LoginScreen loginError="" onLogin={vi.fn()} onRegister={vi.fn()} onGoogleLogin={vi.fn()} {...props} />);
}

describe("LoginScreen – ingresar con un enlace a mi correo (F2)", () => {
  test("el botón aparece sólo si el backend habilita el flujo, y sólo para pacientes", async () => {
    vi.spyOn(authService, "fetchPasswordlessConfig").mockResolvedValue({ enabled: true });
    renderLogin();
    const entry = await screen.findByRole("button", { name: /ingresar con un enlace a mi correo/i });
    expect(entry).toBeInTheDocument();
    // El login tradicional sigue disponible.
    expect(screen.getByLabelText("Clave")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /psicólogo/i }));
    expect(screen.queryByRole("button", { name: /ingresar con un enlace a mi correo/i })).not.toBeInTheDocument();
  });

  test("flujo deshabilitado: no se muestra la opción", async () => {
    const config = vi.spyOn(authService, "fetchPasswordlessConfig").mockResolvedValue({ enabled: false });
    renderLogin();
    await vi.waitFor(() => expect(config).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /ingresar con un enlace a mi correo/i })).not.toBeInTheDocument();
  });

  test("pedido válido: confirmación genérica, sin revelar si la cuenta existe", async () => {
    vi.spyOn(authService, "fetchPasswordlessConfig").mockResolvedValue({ enabled: true });
    const request = vi.spyOn(authService, "requestPatientLoginLink").mockResolvedValue({ ok: true });
    renderLogin();
    await userEvent.click(await screen.findByRole("button", { name: /ingresar con un enlace a mi correo/i }));

    const emailInput = screen.getByLabelText(/tu correo electrónico/i);
    expect(emailInput).toHaveFocus();
    await userEvent.type(emailInput, " ana@example.test ");
    await userEvent.click(screen.getByRole("button", { name: /enviarme el enlace/i }));

    expect(request).toHaveBeenCalledWith("ana@example.test");
    const heading = await screen.findByRole("heading", { name: /revisá tu correo/i });
    expect(heading).toHaveFocus();
    expect(screen.getByText(/si el correo/i)).toHaveTextContent(/corresponde a una cuenta habilitada/i);
    expect(screen.getByText(/vence en 30 minutos/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /podés pedir otro enlace en \d+ segundos/i })).toBeDisabled();
  });

  test("email inválido: aviso claro sin llamar al backend", async () => {
    vi.spyOn(authService, "fetchPasswordlessConfig").mockResolvedValue({ enabled: true });
    const request = vi.spyOn(authService, "requestPatientLoginLink");
    renderLogin({ initialMode: "passwordless" });
    await userEvent.type(screen.getByLabelText(/tu correo electrónico/i), "ana");
    await userEvent.click(screen.getByRole("button", { name: /enviarme el enlace/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/correo electrónico completo/i);
    expect(screen.getByLabelText(/tu correo electrónico/i)).toHaveAttribute("aria-invalid", "true");
    expect(request).not.toHaveBeenCalled();
  });

  test("demasiados pedidos (429): mensaje de espera y se puede reintentar", async () => {
    vi.spyOn(authService, "fetchPasswordlessConfig").mockResolvedValue({ enabled: true });
    vi.spyOn(authService, "requestPatientLoginLink").mockRejectedValue(Object.assign(new Error("x"), { status: 429 }));
    renderLogin({ initialMode: "passwordless" });
    await userEvent.type(screen.getByLabelText(/tu correo electrónico/i), "ana@example.test");
    await userEvent.click(screen.getByRole("button", { name: /enviarme el enlace/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/esperá unos minutos/i);
    expect(screen.getByRole("button", { name: /enviarme el enlace/i })).toBeEnabled();
  });

  test("sin conexión: mensaje y reintento", async () => {
    vi.spyOn(authService, "fetchPasswordlessConfig").mockResolvedValue({ enabled: true });
    vi.spyOn(authService, "requestPatientLoginLink").mockRejectedValue(new TypeError("Failed to fetch"));
    renderLogin({ initialMode: "passwordless" });
    await userEvent.type(screen.getByLabelText(/tu correo electrónico/i), "ana@example.test");
    await userEvent.click(screen.getByRole("button", { name: /enviarme el enlace/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/no pudimos conectar/i);
  });

  test("Volver regresa al ingreso con contraseña", async () => {
    vi.spyOn(authService, "fetchPasswordlessConfig").mockResolvedValue({ enabled: true });
    renderLogin({ initialMode: "passwordless" });
    await userEvent.click(screen.getByRole("button", { name: /volver a ingresar con contraseña/i }));
    expect(screen.getByLabelText("Clave")).toBeInTheDocument();
  });
});
