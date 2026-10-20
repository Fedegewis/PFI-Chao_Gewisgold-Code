import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { GlobalHeader } from "./GlobalHeader.jsx";
import { SCREEN_NAMES } from "../../constants/appConfig.js";

afterEach(() => { cleanup(); });

describe("GlobalHeader — cambio de rol con confirmación", () => {
  test("profesional ve botón Paciente y presionarlo abre confirmación (no cambia pantalla)", () => {
    const onLogout = vi.fn();
    const onNavigate = vi.fn();
    render(
      <GlobalHeader
        screen={SCREEN_NAMES.professional}
        role="professional"
        onLogout={onLogout}
        onNavigate={onNavigate}
      />
    );
    const switchBtn = screen.getByRole("button", { name: /Cambiar a cuenta de Paciente/i });
    fireEvent.click(switchBtn);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/Ingresar como Paciente/i)).toBeTruthy();
    expect(onLogout).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalledWith(SCREEN_NAMES.patient);
  });

  test("cancelar el cambio conserva la sesión actual", () => {
    const onLogout = vi.fn();
    render(
      <GlobalHeader
        screen={SCREEN_NAMES.professional}
        role="professional"
        onLogout={onLogout}
        onNavigate={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Cambiar a cuenta de Paciente/i }));
    fireEvent.click(screen.getByRole("button", { name: /Cancelar/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onLogout).not.toHaveBeenCalled();
  });

  test("confirmar el cambio dispara logout", () => {
    const onLogout = vi.fn();
    render(
      <GlobalHeader
        screen={SCREEN_NAMES.professional}
        role="professional"
        onLogout={onLogout}
        onNavigate={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Cambiar a cuenta de Paciente/i }));
    fireEvent.click(screen.getByRole("button", { name: /Cerrar sesión e ir al login/i }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  test("paciente ve botón Psicólogo y abre confirmación al presionarlo", () => {
    const onLogout = vi.fn();
    render(
      <GlobalHeader
        screen={SCREEN_NAMES.patient}
        role="patient"
        onLogout={onLogout}
        onNavigate={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Cambiar a cuenta de Psicólogo/i }));
    expect(screen.getByText(/Ingresar como Psicólogo/i)).toBeTruthy();
    expect(onLogout).not.toHaveBeenCalled();
  });

  test("en login no se muestra la navegación de roles", () => {
    render(
      <GlobalHeader
        screen={SCREEN_NAMES.login}
        role="patient"
        onLogout={() => {}}
        onNavigate={() => {}}
      />
    );
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});
