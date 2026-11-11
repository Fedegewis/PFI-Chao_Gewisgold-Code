import { authHeaders, SERVER_UNAVAILABLE_MESSAGE } from "./authService.js";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

// Evento global: la sesión guardada en este navegador ya no sirve (JWT
// vencido a las 24 h, usuario desactivado o sesión por enlace revocada).
// useAppController lo escucha y vuelve al login con un mensaje claro, en
// lugar de dejar al paciente en una pantalla que sólo muestra errores.
export const AUTH_EXPIRED_EVENT = "ma:auth-expired";

export function notifyAuthExpired() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
}

// Cliente común de los endpoints autenticados. JWT (Authorization) o, para
// pacientes con sesión por enlace, sólo el header anti-CSRF: la cookie
// HttpOnly la adjunta el navegador (same-origin).
export async function authRequest(path, options = {}) {
  const auth = authHeaders();
  if (!auth) {
    const err = new Error("No hay sesión activa");
    err.status = 401;
    throw err;
  }
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...auth,
        ...options.headers,
      },
    });
  } catch (cause) {
    // Sin conexión o servidor despertando: el navegador sólo da mensajes en
    // inglés ("Failed to fetch", "Load failed"). Un abort se propaga tal cual.
    if (cause?.name === "AbortError") throw cause;
    const err = new Error(SERVER_UNAVAILABLE_MESSAGE);
    err.status = 0;
    err.network = true;
    throw err;
  }
  if (res.status === 204) return null;
  const parsed = await res.json().catch(() => undefined);
  if (!res.ok) {
    if (res.status === 401) notifyAuthExpired();
    // Sin JSON = página de error del proxy (502/504 de Vercel o Render).
    const fallback = parsed ? "Error del servidor" : SERVER_UNAVAILABLE_MESSAGE;
    const err = new Error((parsed && parsed.error) || fallback);
    err.status = res.status;
    err.data = parsed || {};
    throw err;
  }
  return parsed === undefined ? {} : parsed;
}
