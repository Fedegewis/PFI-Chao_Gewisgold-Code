import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { LoginScreen } from "./LoginScreen.jsx";

// Test focalizado para el fix de doble POST /auth/google:
// - initialize() debe llamarse una sola vez ante renders normales
// - un credential debe producir una única llamada a onGoogleLogin,
//   incluso si onGoogleLogin cambia de referencia entre renders.

let capturedCallback;
let initializeCalls;
let renderButtonCalls;

function installGsiStub() {
  capturedCallback = null;
  initializeCalls = 0;
  renderButtonCalls = 0;
  window.google = {
    accounts: {
      id: {
        initialize: ({ callback }) => {
          initializeCalls += 1;
          capturedCallback = callback;
        },
        renderButton: () => {
          renderButtonCalls += 1;
        },
        prompt: () => {},
        cancel: () => {},
      },
    },
  };
}

beforeEach(() => {
  import.meta.env.VITE_GOOGLE_CLIENT_ID = "test-client-id";
  installGsiStub();
});

afterEach(() => {
  cleanup();
  delete window.google;
  vi.restoreAllMocks();
});

function TestHost({ onGoogleLogin }) {
  return (
    <LoginScreen
      loginError=""
      onLogin={() => {}}
      onRegister={() => {}}
      onGoogleLogin={onGoogleLogin}
    />
  );
}

describe("LoginScreen · Google Identity", () => {
  test("google.accounts.id.initialize se llama una sola vez ante renders normales", () => {
    const onGoogleLogin = vi.fn();
    const { rerender } = render(<TestHost onGoogleLogin={onGoogleLogin} />);
    // Re-render varias veces con referencias nuevas de onGoogleLogin
    for (let i = 0; i < 5; i += 1) {
      rerender(<TestHost onGoogleLogin={vi.fn()} />);
    }
    expect(initializeCalls).toBe(1);
  });

  test("un credential produce una única llamada a onGoogleLogin", () => {
    const onGoogleLogin = vi.fn();
    render(<TestHost onGoogleLogin={onGoogleLogin} />);
    expect(typeof capturedCallback).toBe("function");
    capturedCallback({ credential: "fake-jwt" });
    expect(onGoogleLogin).toHaveBeenCalledTimes(1);
    expect(onGoogleLogin).toHaveBeenCalledWith("fake-jwt");
  });

  test("el callback usa la última referencia de onGoogleLogin tras re-render", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<TestHost onGoogleLogin={first} />);
    rerender(<TestHost onGoogleLogin={second} />);
    capturedCallback({ credential: "fake-jwt" });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith("fake-jwt");
    // Y sigue sin re-inicializar
    expect(initializeCalls).toBe(1);
  });

  test("credential sin campo credential no dispara onGoogleLogin", () => {
    const onGoogleLogin = vi.fn();
    render(<TestHost onGoogleLogin={onGoogleLogin} />);
    capturedCallback({});
    expect(onGoogleLogin).not.toHaveBeenCalled();
  });
});
