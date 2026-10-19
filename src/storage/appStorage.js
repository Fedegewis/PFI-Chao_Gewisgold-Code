const STORAGE_KEYS = {
  patients: "ma_patients_v1",
  sessions: "ma_sessions_v1",
  appSession: "ma_app_session_v1",
  activityDraft: "ma_activity_draft_v1",
  // H-S2 — mood del paciente autenticado (solo mood + fecha). Separado del
  // storage de patients demo para no mezclar responsabilidades y para poder
  // asociarlo estrictamente al userId autenticado actual.
  patientMood: "ma_patient_mood_v1",
};

function hasStorage() {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

function safeParse(raw, fallback) {
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function readStorage(key, fallback) {
  if (!hasStorage()) return fallback;
  return safeParse(localStorage.getItem(key), fallback);
}

function writeStorage(key, value) {
  if (!hasStorage()) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // almacenamiento lleno o bloqueado: se ignora sin romper la app
  }
}

function removeStorage(key) {
  if (!hasStorage()) return;
  try {
    localStorage.removeItem(key);
  } catch {
    // idem
  }
}

export function loadPatients(fallback, normalizePatient) {
  const parsed = readStorage(STORAGE_KEYS.patients, null);
  if (!Array.isArray(parsed) || parsed.length === 0) return fallback;
  return parsed.map(normalizePatient);
}

export function savePatients(patients) {
  writeStorage(STORAGE_KEYS.patients, patients);
}

export function loadSessions() {
  const parsed = readStorage(STORAGE_KEYS.sessions, []);
  return Array.isArray(parsed) ? parsed : [];
}

export function saveSessions(sessions) {
  writeStorage(STORAGE_KEYS.sessions, sessions);
}

export function clearStorage() {
  removeStorage(STORAGE_KEYS.patients);
  removeStorage(STORAGE_KEYS.sessions);
}

export function loadAppSession() {
  const parsed = readStorage(STORAGE_KEYS.appSession, null);
  return parsed && typeof parsed === "object" ? parsed : null;
}

export function saveAppSession(session) {
  writeStorage(STORAGE_KEYS.appSession, session);
}

export function clearAppSession() {
  removeStorage(STORAGE_KEYS.appSession);
}

export function loadActivityDraft() {
  const parsed = readStorage(STORAGE_KEYS.activityDraft, null);
  return parsed && typeof parsed === "object" ? parsed : null;
}

export function saveActivityDraft(draft) {
  writeStorage(STORAGE_KEYS.activityDraft, draft);
}

export function clearActivityDraft() {
  removeStorage(STORAGE_KEYS.activityDraft);
}

// H-S2 — Persistencia específica del mood autoreportado por el paciente
// autenticado. El payload es { userId, mood, moodSelectedAt }. La lectura
// filtra estrictamente por userId para evitar que la selección de un
// paciente anterior se asigne por error a otro.
export function savePatientMood({ userId, mood, moodSelectedAt }) {
  if (userId == null) return;
  writeStorage(STORAGE_KEYS.patientMood, { userId, mood, moodSelectedAt });
}

export function loadPatientMood(userId) {
  if (userId == null) return null;
  const parsed = readStorage(STORAGE_KEYS.patientMood, null);
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.userId !== userId) return null;
  return { mood: parsed.mood ?? null, moodSelectedAt: parsed.moodSelectedAt ?? null };
}

export function clearPatientMood() {
  removeStorage(STORAGE_KEYS.patientMood);
}
