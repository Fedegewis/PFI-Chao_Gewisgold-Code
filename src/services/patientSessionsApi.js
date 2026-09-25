import { getToken } from "./authService.js";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";

async function authRequest(path, options = {}) {
  const token = getToken();
  if (!token) {
    const err = new Error("No hay sesión activa");
    err.status = 401;
    throw err;
  }
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  const data = res.status === 204 ? null : await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data && data.error) || "Error del servidor");
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function createPatientSession({ sectionSlug, questionCount }) {
  return authRequest("/patient/sessions", {
    method: "POST",
    body: JSON.stringify({
      sections: [{ section_slug: sectionSlug, question_count: questionCount }],
    }),
  });
}
