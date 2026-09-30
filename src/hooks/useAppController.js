import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACTIVITY_TO_SECTION_SLUG, DEFAULT_PROFESSIONAL_ID, MOTIVATION_MESSAGES, SCREEN_NAMES } from "../constants/appConfig.js";
import { createPatientSession, fetchMySessionsApi } from "../services/patientSessionsApi.js";
import { deriveCompletedTodayFromSessions, latestCompletedAt } from "../services/patientProgress.js";
import { activities, getActivityById } from "../data/activities.js";
import { buildHash, readHashState } from "../services/navigationService.js";
import {
  DEMO_PROFILES,
  buildInitialPatients,
  normalizePatient,
  patientFromBackendUser,
  refreshDailyPatientState
} from "../services/patientService.js";
import { deletePatientApi, fetchPatients, fetchPatientSessionsApi } from "../services/patientsApi.js";
import { buildCompletedActivityState, buildInitialSessions } from "../services/sessionService.js";
import {
  clearActivityDraft,
  clearAppSession,
  loadAppSession,
  loadPatients,
  loadSessions,
  saveAppSession,
  savePatients,
  saveSessions
} from "../storage/appStorage.js";
import { LOGIN_ERROR_MESSAGE } from "../constants/content.js";
import {
  clearAuth,
  getSavedUser,
  getToken,
  loginWithPassword,
  loginWithGoogle,
  persistAuthSession,
  registerProfessional,
} from "../services/authService.js";

function loadAppPatients() {
  const initialPatients = buildInitialPatients();
  const stored = loadPatients(initialPatients, normalizePatient);
  const storedIds = new Set(stored.map((p) => p.id));

  // Enriquecer pacientes demo cuyos datos quedaron sin perfil (score 0 y sin actividad).
  const enriched = stored.map((patient) => {
    const profile = DEMO_PROFILES[patient.id];
    const looksEmpty = (patient.score ?? 0) === 0 && (patient.completed?.length ?? 0) === 0;
    return profile && looksEmpty ? { ...patient, ...profile } : patient;
  });

  // Sumar pacientes iniciales que faltan en storage (demo nuevos).
  const missing = initialPatients.filter((p) => !storedIds.has(p.id));
  return [...enriched, ...missing].map((patient) => refreshDailyPatientState(patient));
}

export function useAppController() {
  const [init] = useState(() => {
    const session = loadAppSession();
    const hash = readHashState();
    const savedUser = getSavedUser();
    const hasToken = Boolean(getToken());
    const isAuthenticatedProfessional = hasToken && savedUser?.role === "professional";
    const isAuthenticatedPatient = hasToken && savedUser?.role === "patient";
    // Autenticados: los datos vienen del backend, no de localStorage.
    // Paciente autenticado: sembramos el propio user como único paciente en la lista.
    // Modo demo/legacy: se conservan los pacientes hardcodeados existentes.
    let patients;
    if (isAuthenticatedProfessional) {
      patients = [];
    } else if (isAuthenticatedPatient) {
      patients = [patientFromBackendUser(savedUser)];
    } else {
      patients = loadAppPatients();
    }
    return { session, hash, patients, savedUser, hasToken, isAuthenticatedProfessional, isAuthenticatedPatient };
  });
  const [role, setRole] = useState(() => {
    if (init.hasToken && init.savedUser?.role === "professional") return "professional";
    if (init.hasToken && init.savedUser?.role === "patient") return "patient";
    return init.session?.role || "patient";
  });
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    if (init.hasToken && init.savedUser) return true;
    return Boolean(init.session?.role);
  });
  const [authUser, setAuthUser] = useState(() => init.savedUser);
  const [screen, setScreen] = useState(() => {
    const { session, hash } = init;
    if (hash.screen === SCREEN_NAMES.invite) return SCREEN_NAMES.invite;
    if (!session?.role) return SCREEN_NAMES.login;
    if (hash.screen === SCREEN_NAMES.professional && session.role !== SCREEN_NAMES.professional) {
      return SCREEN_NAMES.patient;
    }
    if ([SCREEN_NAMES.patient, SCREEN_NAMES.professional, SCREEN_NAMES.activity].includes(hash.screen)) {
      return hash.screen;
    }
    return session.role === SCREEN_NAMES.professional ? SCREEN_NAMES.professional : SCREEN_NAMES.patient;
  });
  const [inviteToken, setInviteToken] = useState(() => init.hash.inviteToken);
  const [professionalId, setProfessionalId] = useState(() => {
    if (init.savedUser?.role === "professional") return init.savedUser.id;
    return init.session?.professionalId || DEFAULT_PROFESSIONAL_ID;
  });
  const [patients, setPatients] = useState(() => init.patients);
  const [sessions, setSessions] = useState(() => {
    const stored = loadSessions();
    return stored.length ? stored : buildInitialSessions();
  });
  const [selectedPatientId, setSelectedPatientId] = useState(() =>
    init.patients.length > 0 ? init.patients[0].id : null
  );
  const [selectedActivity, setSelectedActivity] = useState(() => getActivityById(init.hash.activityId));
  const [loginError, setLoginError] = useState("");
  const [activeSession, setActiveSession] = useState(null);
  const [activityStartError, setActivityStartError] = useState("");
  const [backendPatientSessions, setBackendPatientSessions] = useState({ patientId: null, list: null, loading: false, error: "" });

  const selectedPatient = useMemo(
    () =>
      selectedPatientId
        ? patients.find((patient) => patient.id === selectedPatientId) ?? null
        : null,
    [patients, selectedPatientId]
  );
  const motivationMessage = useMemo(() => MOTIVATION_MESSAGES[new Date().getDay() % MOTIVATION_MESSAGES.length], []);

  const isBackendProfessional = role === "professional" && Boolean(authUser?.id);
  const isBackendPatient = role === "patient" && Boolean(authUser?.id);
  const isBackendAuthenticated = isBackendProfessional || isBackendPatient;

  useEffect(() => {
    // Solo se persisten pacientes en localStorage para modo demo/legacy.
    // Los usuarios autenticados tienen a Postgres como fuente de verdad.
    if (isBackendAuthenticated) return;
    savePatients(patients);
  }, [patients, isBackendAuthenticated]);

  useEffect(() => {
    if (!isBackendProfessional) {
      setBackendPatientSessions({ patientId: null, list: null, loading: false, error: "" });
      return undefined;
    }
    if (selectedPatientId == null) {
      setBackendPatientSessions({ patientId: null, list: null, loading: false, error: "" });
      return undefined;
    }
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const requestedId = selectedPatientId;
    setBackendPatientSessions({ patientId: requestedId, list: null, loading: true, error: "" });
    fetchPatientSessionsApi(requestedId, controller ? { signal: controller.signal } : {})
      .then((rows) => {
        setBackendPatientSessions((prev) => {
          if (prev.patientId !== requestedId) return prev;
          return { patientId: requestedId, list: Array.isArray(rows) ? rows : [], loading: false, error: "" };
        });
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setBackendPatientSessions((prev) => {
          if (prev.patientId !== requestedId) return prev;
          return { patientId: requestedId, list: null, loading: false, error: err?.message || "No se pudieron cargar las sesiones." };
        });
      });
    return () => { if (controller) controller.abort(); };
  }, [isBackendProfessional, selectedPatientId]);

  useEffect(() => {
    if (!isBackendProfessional) return;
    let cancelled = false;
    fetchPatients()
      .then((rows) => {
        if (cancelled) return;
        const mapped = Array.isArray(rows) ? rows.map(patientFromBackendUser) : [];
        setPatients(mapped);
        setSelectedPatientId((current) => {
          if (mapped.length === 0) return null;
          if (current && mapped.some((p) => p.id === current)) return current;
          return mapped[0].id;
        });
      })
      .catch(() => {
        if (cancelled) return;
        setPatients([]);
        setSelectedPatientId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isBackendProfessional, authUser?.id]);

  // 7H.2: paciente backend autenticado — sincronizar progreso "hecho hoy"
  // desde PostgreSQL. Se dispara al montar y luego se refetchea después de
  // completar una actividad (ver refreshBackendPatientProgress).
  async function refreshBackendPatientProgress() {
    if (!isBackendPatient || !authUser?.id) return;
    try {
      const rows = await fetchMySessionsApi();
      const list = Array.isArray(rows) ? rows : [];
      const completed = deriveCompletedTodayFromSessions(list);
      const lastSessionAt = latestCompletedAt(list);
      setPatients((current) =>
        current.map((p) =>
          p.id === authUser.id
            ? { ...p, completed, lastSessionAt: lastSessionAt || p.lastSessionAt }
            : p
        )
      );
    } catch {
      // Falla silenciosa: la sesión ya está persistida en PostgreSQL. No
      // reintentamos aquí ni volvemos a llamar /complete. La UI seguirá
      // mostrando lo último que pudo derivarse; F5 vuelve a intentar.
    }
  }

  useEffect(() => {
    if (!isBackendPatient) return undefined;
    if (!authUser?.id) return undefined;
    let cancelled = false;
    fetchMySessionsApi()
      .then((rows) => {
        if (cancelled) return;
        const list = Array.isArray(rows) ? rows : [];
        const completed = deriveCompletedTodayFromSessions(list);
        const lastSessionAt = latestCompletedAt(list);
        setPatients((current) =>
          current.map((p) =>
            p.id === authUser.id
              ? { ...p, completed, lastSessionAt: lastSessionAt || p.lastSessionAt }
              : p
          )
        );
      })
      .catch(() => { /* fallback silencioso: patient.completed queda [] */ });
    return () => { cancelled = true; };
  }, [isBackendPatient, authUser?.id]);

  useEffect(() => {
    saveSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    if (isAuthenticated) saveAppSession({ role, professionalId });
    else clearAppSession();
  }, [isAuthenticated, professionalId, role]);

  // Live-sync entre pestañas: si otra pestaña actualiza patients o sessions
  // en localStorage (ej: el paciente completa una actividad), esta pestaña
  // (ej: el psicólogo) refleja el cambio sin recargar.
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    function handleStorage(event) {
      if (event.key === "ma_patients_v1" && event.newValue && !isBackendAuthenticated) {
        try {
          const parsed = JSON.parse(event.newValue);
          if (Array.isArray(parsed)) setPatients(parsed.map(normalizePatient));
        } catch { /* payload inválido, se ignora */ }
      }
      if (event.key === "ma_sessions_v1" && event.newValue && !isBackendAuthenticated) {
        try {
          const parsed = JSON.parse(event.newValue);
          if (Array.isArray(parsed)) setSessions(parsed);
        } catch { /* payload inválido, se ignora */ }
      }
    }
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [isBackendAuthenticated]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (screen === SCREEN_NAMES.invite) return;
    const nextHash = buildHash(isAuthenticated ? screen : SCREEN_NAMES.login, selectedActivity.id);
    if (window.location.hash !== nextHash) window.location.hash = nextHash;
  }, [isAuthenticated, screen, selectedActivity.id]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    function syncFromHash() {
      const hashState = readHashState();
      if (hashState.screen === SCREEN_NAMES.invite) {
        setInviteToken(hashState.inviteToken);
        setScreen(SCREEN_NAMES.invite);
        return;
      }
      if (!isAuthenticated) {
        setScreen(SCREEN_NAMES.login);
        return;
      }
      if (hashState.screen === SCREEN_NAMES.login) {
        setScreen(role === SCREEN_NAMES.professional ? SCREEN_NAMES.professional : SCREEN_NAMES.patient);
        return;
      }
      if (hashState.screen === SCREEN_NAMES.professional && role !== SCREEN_NAMES.professional) {
        setScreen(SCREEN_NAMES.patient);
        return;
      }
      if (hashState.screen === SCREEN_NAMES.activity) {
        setSelectedActivity(getActivityById(hashState.activityId));
      }
      setScreen(hashState.screen);
    }

    window.addEventListener("hashchange", syncFromHash);
    syncFromHash();
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, [isAuthenticated, role]);

  async function login(nextRole, email, password) {
    try {
      const data = await loginWithPassword({ email, password });
      if (data.user.role !== nextRole) {
        clearAuth();
        setLoginError(
          nextRole === SCREEN_NAMES.patient
            ? "Esa cuenta no corresponde a un paciente."
            : "Esa cuenta no corresponde a un profesional."
        );
        return;
      }

      setAuthUser(data.user);
      setRole(data.user.role);
      setIsAuthenticated(true);
      setLoginError("");

      if (data.user.role === "professional") {
        setPatients([]);
        setSelectedPatientId(null);
        setProfessionalId(data.user.id);
        if (typeof window !== "undefined") {
          window.history.replaceState(null, "", buildHash(SCREEN_NAMES.professional, selectedActivity.id));
        }
        setScreen(SCREEN_NAMES.professional);
      } else {
        const patientObj = patientFromBackendUser(data.user);
        setPatients([patientObj]);
        setSelectedPatientId(patientObj.id);
        if (typeof window !== "undefined") {
          window.history.replaceState(null, "", buildHash(SCREEN_NAMES.patient, selectedActivity.id));
        }
        setScreen(SCREEN_NAMES.patient);
      }
    } catch (err) {
      setLoginError(err.message || LOGIN_ERROR_MESSAGE);
    }
  }

  async function register(name, email, password) {
    try {
      const data = await registerProfessional({ name, email, password });
      setPatients([]);
      setSelectedPatientId(null);
      setAuthUser(data.user);
      setRole("professional");
      setProfessionalId(data.user.id);
      setIsAuthenticated(true);
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", buildHash(SCREEN_NAMES.professional, selectedActivity.id));
      }
      setScreen(SCREEN_NAMES.professional);
      setLoginError("");
    } catch (err) {
      setLoginError(err.message || "Error al registrarse");
    }
  }

  const googleLoginInFlightRef = useRef(false);
  const googleLogin = useCallback(async (credential) => {
    // [DEBUG-TEMP google-auth] instrumentación para diagnosticar "Failed to fetch" en primer intento.
    // Retirar cuando se cierre el bug.
    const attempt = typeof window !== "undefined" ? (window.__gAuthAttempt ?? "?") : "?";
    const tag = `[google-auth][attempt-${attempt}]`;
    // eslint-disable-next-line no-console
    console.debug(`${tag} googleLogin START inFlight=${googleLoginInFlightRef.current}`);
    // Guard: un único credential no debe producir dos POST concurrentes
    // aunque el SDK de Google dispare el callback más de una vez.
    if (googleLoginInFlightRef.current) {
      // eslint-disable-next-line no-console
      console.debug(`${tag} googleLogin SKIPPED (concurrent)`);
      return;
    }
    googleLoginInFlightRef.current = true;
    try {
      const data = await loginWithGoogle(credential);
      // eslint-disable-next-line no-console
      console.debug(`${tag} googleLogin loginWithGoogle resolved, setting auth state`);
      setPatients([]);
      setSelectedPatientId(null);
      setAuthUser(data.user);
      setRole("professional");
      setProfessionalId(data.user.id);
      setIsAuthenticated(true);
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", buildHash(SCREEN_NAMES.professional, selectedActivity.id));
      }
      setScreen(SCREEN_NAMES.professional);
      setLoginError("");
      // eslint-disable-next-line no-console
      console.debug(`${tag} googleLogin AUTH STATE UPDATED (screen -> professional)`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.debug(`${tag} googleLogin CAUGHT err.name=${err?.name} err.status=${err?.status} err.message=${err?.message}`);
      setLoginError(err.message || "Error al iniciar sesión con Google");
    } finally {
      googleLoginInFlightRef.current = false;
      // eslint-disable-next-line no-console
      console.debug(`${tag} googleLogin END`);
    }
  }, [selectedActivity.id]);

  async function deletePatientForProfessional(patientId) {
    await deletePatientApi(patientId);
    setPatients((current) => {
      const next = current.filter((p) => p.id !== patientId);
      setSelectedPatientId((currentId) => {
        if (currentId !== patientId) return currentId;
        return next.length > 0 ? next[0].id : null;
      });
      return next;
    });
  }

  function acceptInvitationSession({ user, token }) {
    if (!user || user.role !== "patient" || !token) {
      clearAuth();
      return false;
    }
    persistAuthSession({ user, token });
    const patientObj = patientFromBackendUser(user);
    setPatients([patientObj]);
    setSelectedPatientId(patientObj.id);
    setAuthUser(user);
    setRole("patient");
    setIsAuthenticated(true);
    setInviteToken(null);
    setLoginError("");
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", buildHash(SCREEN_NAMES.patient, selectedActivity.id));
    }
    setScreen(SCREEN_NAMES.patient);
    return true;
  }

  function goToLogin() {
    setInviteToken(null);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", buildHash(SCREEN_NAMES.login, selectedActivity.id));
    }
    setScreen(SCREEN_NAMES.login);
  }

  function logout() {
    setIsAuthenticated(false);
    setAuthUser(null);
    clearAuth();
    clearActivityDraft();
    // 6D.6: al cerrar sesión limpiamos estado en memoria del usuario anterior
    // para que el próximo login no vea patients/sesiones del anterior antes del fetch.
    setPatients([]);
    setSelectedPatientId(null);
    setActiveSession(null);
    setActivityStartError("");
    setBackendPatientSessions({ patientId: null, list: null, loading: false, error: "" });
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", buildHash(SCREEN_NAMES.login, selectedActivity.id));
    }
    setScreen(SCREEN_NAMES.login);
    setRole("patient");
    setLoginError("");
  }

  function updatePatient(patientId, patch) {
    setPatients((current) => current.map((patient) => (patient.id === patientId ? { ...patient, ...patch } : patient)));
  }

  async function openActivity(activity) {
    if (!selectedPatient) return;
    if (selectedPatient.completed.includes(activity.id)) return;
    setActivityStartError("");

    if (isBackendPatient) {
      const sectionSlug = ACTIVITY_TO_SECTION_SLUG[activity.id];
      if (!sectionSlug) {
        setActivityStartError("Esta actividad no está disponible todavía en tu banco.");
        return;
      }
      try {
        const session = await createPatientSession({
          sectionSlug,
          questionCount: selectedPatient.maxQuestions || 4,
        });
        setActiveSession(session);
      } catch (err) {
        setActivityStartError(err?.message || "No se pudo iniciar la actividad. Reintentá más tarde.");
        return;
      }
    } else {
      setActiveSession(null);
    }

    setSelectedActivity(activity);
    setScreen(SCREEN_NAMES.activity);
  }

  function completeActivity(summary) {
    if (!selectedPatient) return;
    if (summary && summary.backend) {
      // 7H.2: sesión backend ya persistida. Refrescar el historial propio
      // para reconstruir "completadas hoy" desde PostgreSQL antes de volver
      // al dashboard. No re-emite /complete; si el refetch falla, la sesión
      // sigue guardada y F5 volverá a intentar.
      setActiveSession(null);
      refreshBackendPatientProgress();
      setScreen(SCREEN_NAMES.patient);
      return;
    }
    const { nextSessions, patientPatch } = buildCompletedActivityState({
      patient: selectedPatient,
      sessions,
      activity: selectedActivity,
      summary,
      totalActivities: activities.length
    });
    setSessions(nextSessions);
    updatePatient(selectedPatient.id, patientPatch);
    setScreen(SCREEN_NAMES.patient);
  }

  return {
    activities,
    authUser,
    deletePatientForProfessional,
    isBackendProfessional,
    isAuthenticated,
    loginError,
    login,
    logout,
    googleLogin,
    register,
    motivationMessage,
    openActivity,
    professionalId,
    role,
    screen,
    selectedActivity,
    selectedPatient,
    selectedPatientId,
    sessions,
    setPatients,
    setScreen,
    setSelectedPatientId,
    updatePatient,
    patients,
    completeActivity,
    inviteToken,
    acceptInvitationSession,
    goToLogin,
    activeSession,
    activityStartError,
    backendPatientSessions
  };
}
