import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACTIVITY_TO_SECTION_SLUG, DEFAULT_PROFESSIONAL_ID, MOOD_OPTIONS, MOTIVATION_MESSAGES, SCREEN_NAMES } from "../constants/appConfig.js";

// Reutiliza MOOD_OPTIONS (fuente de verdad del frontend, ya usada por MoodPanel y
// BackendPatientDetail) para evitar enviar al backend valores que no estén en el
// whitelist del CHECK constraint. No es duplicación: MOOD_OPTIONS ya existe por
// otros motivos de UI y sus ids espejean exactamente el enum del backend.
const VALID_MOOD_SLUGS = new Set(MOOD_OPTIONS.map((o) => o.id));
import { createPatientSession, fetchMySessionsApi } from "../services/patientSessionsApi.js";
import { fetchPatientAvailableSections } from "../services/trainingConfigApi.js";
import { deriveCompletedTodayFromSessions, deriveWeeklyProgressFromSessions, latestCompletedAt } from "../services/patientProgress.js";
import { activities, getActivityById } from "../data/activities.js";
import { buildHash, clearCapturedLoginLinkToken, readHashState, takeLoginLinkTokenFromUrl } from "../services/navigationService.js";
import {
  DEMO_PROFILES,
  buildInitialPatients,
  isMoodValidToday,
  normalizePatient,
  patientFromBackendUser,
  refreshDailyPatientState
} from "../services/patientService.js";
import { deletePatientApi, deleteSessionApi, fetchPatients, fetchPatientSessionsApi } from "../services/patientsApi.js";
import { buildCompletedActivityState, buildInitialSessions } from "../services/sessionService.js";
import {
  clearActivityDraft,
  clearAppSession,
  clearPatientMood,
  loadAppSession,
  loadPatientMood,
  loadPatients,
  loadSessions,
  saveAppSession,
  savePatientMood,
  savePatients,
  saveSessions
} from "../storage/appStorage.js";
import { LOGIN_ERROR_MESSAGE } from "../constants/content.js";
import {
  clearAuth,
  getPatientCookieSession,
  getSavedUser,
  getToken,
  hasPatientSessionHint,
  isStoredTokenExpired,
  loginWithPassword,
  logoutPatientSession,
  restorePatientSession,
  loginWithGoogle,
  persistAuthSession,
  registerProfessional,
} from "../services/authService.js";
import { AUTH_EXPIRED_EVENT } from "../services/authRequest.js";

const SESSION_EXPIRED_MESSAGE = "Tu sesión terminó. Volvé a ingresar.";

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
    // JWT vencido (dura 24 h): se descarta junto con la sesión de la app y se
    // arranca en el login con un aviso, en lugar de mostrar una pantalla
    // autenticada donde todas las llamadas fallan.
    const sessionExpired = isStoredTokenExpired();
    if (sessionExpired) {
      clearAuth();
      clearAppSession();
    }
    const session = sessionExpired ? null : loadAppSession();
    const hash = readHashState();
    const savedUser = getSavedUser();
    const hasToken = Boolean(getToken());
    // F2: token del enlace de acceso (ya quitado de la URL; sólo en memoria).
    const loginLinkToken = hash.screen === SCREEN_NAMES.loginLink ? takeLoginLinkTokenFromUrl() : null;
    // F3: sesión de paciente por cookie HttpOnly. El frontend no puede leer la
    // cookie; la marca indica que hay que restaurarla con el backend antes de
    // decidir qué pantalla mostrar. Mientras tanto no se cargan datos demo.
    const restoringPatientSession =
      !hasToken &&
      hash.screen !== SCREEN_NAMES.loginLink &&
      hash.screen !== SCREEN_NAMES.invite &&
      hasPatientSessionHint();
    const isAuthenticatedProfessional = hasToken && savedUser?.role === "professional";
    const isAuthenticatedPatient = hasToken && savedUser?.role === "patient";
    // Autenticados: los datos vienen del backend, no de localStorage.
    // Paciente autenticado: sembramos el propio user como único paciente en la lista.
    // Modo demo/legacy: se conservan los pacientes hardcodeados existentes.
    let patients;
    if (isAuthenticatedProfessional || restoringPatientSession) {
      patients = [];
    } else if (isAuthenticatedPatient) {
      // H-S2: el patient se reconstruye desde savedUser (fuente de verdad =
      // backend), pero recuperamos mood + moodSelectedAt del storage específico
      // filtrado por userId. refreshDailyPatientState descartará la selección
      // si no corresponde al día calendario local actual.
      const base = patientFromBackendUser(savedUser);
      const persistedMood = loadPatientMood(savedUser.id);
      const hydrated = persistedMood
        ? { ...base, mood: persistedMood.mood ?? null, moodSelectedAt: persistedMood.moodSelectedAt ?? null }
        : base;
      patients = [refreshDailyPatientState(hydrated)];
    } else {
      patients = loadAppPatients();
    }
    return { session, hash, patients, savedUser, hasToken, isAuthenticatedProfessional, isAuthenticatedPatient, loginLinkToken, restoringPatientSession, sessionExpired };
  });
  const [role, setRole] = useState(() => {
    if (init.hasToken && init.savedUser?.role === "professional") return "professional";
    if (init.hasToken && init.savedUser?.role === "patient") return "patient";
    return init.session?.role || "patient";
  });
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    if (init.hasToken && init.savedUser) return true;
    if (init.restoringPatientSession || init.hash.screen === SCREEN_NAMES.loginLink) return false;
    return Boolean(init.session?.role);
  });
  const [authUser, setAuthUser] = useState(() => init.savedUser);
  const [screen, setScreen] = useState(() => {
    const { session, hash } = init;
    if (hash.screen === SCREEN_NAMES.invite) return SCREEN_NAMES.invite;
    if (hash.screen === SCREEN_NAMES.loginLink) return SCREEN_NAMES.loginLink;
    if (init.restoringPatientSession) return SCREEN_NAMES.login;
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
  const [loginLinkToken, setLoginLinkToken] = useState(() => init.loginLinkToken);
  const [restoringSession, setRestoringSession] = useState(() => init.restoringPatientSession);
  const restoringSessionRef = useRef(init.restoringPatientSession);
  // Modo inicial del login (p. ej. "Pedir un enlace nuevo" desde un enlace vencido).
  const [loginStartMode, setLoginStartMode] = useState(null);
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
  const [loginError, setLoginError] = useState(() => (init.sessionExpired ? SESSION_EXPIRED_MESSAGE : ""));
  const [activeSession, setActiveSession] = useState(null);
  const [activityStartError, setActivityStartError] = useState("");
  // Evita crear dos sesiones si el paciente toca la actividad de nuevo
  // mientras la primera creación sigue en curso (p. ej. backend despertando).
  // El ref bloquea de forma sincrónica; el estado sólo alimenta la UI.
  const openingActivityRef = useRef(false);
  const [openingActivityId, setOpeningActivityId] = useState(null);
  const [backendPatientSessions, setBackendPatientSessions] = useState({ patientId: null, list: null, loading: false, error: "" });
  // F3: catálogo de secciones iniciables para el paciente autenticado.
  // null = aún no cargado (equivale a "todas" transitoriamente para no bloquear
  // la pantalla al montar); {} = ya cargado pero vacío.
  const [patientAvailableSections, setPatientAvailableSections] = useState(null);
  // BUG-08: error de carga de available-sections. Si existe, la UI muestra
  // un mensaje en vez de un valor hardcodeado para la cantidad de preguntas.
  const [patientAvailableSectionsError, setPatientAvailableSectionsError] = useState(false);

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

  // H-S2: para el paciente autenticado persistimos únicamente mood +
  // moodSelectedAt en un storage específico filtrado por userId. Nunca se
  // persisten otros campos del paciente (son fuente de verdad del backend).
  useEffect(() => {
    if (!isBackendPatient || !authUser?.id) return;
    const own = patients.find((p) => p.id === authUser.id);
    if (!own) return;
    savePatientMood({
      userId: authUser.id,
      mood: own.mood ?? null,
      moodSelectedAt: own.moodSelectedAt ?? null,
    });
  }, [patients, isBackendPatient, authUser?.id]);

  // Fetch en background de las sesiones del paciente seleccionado.
  // Extraído a un callback estable para poder reusarlo desde el effect inicial,
  // desde el visibilitychange y desde el completar-actividad.
  const fetchSelectedPatientSessions = useCallback((requestedId, { showLoading = true, signal } = {}) => {
    if (requestedId == null) return Promise.resolve();
    if (showLoading) {
      setBackendPatientSessions((prev) => ({
        patientId: requestedId,
        list: prev.patientId === requestedId ? prev.list : null,
        loading: true,
        error: "",
      }));
    }
    return fetchPatientSessionsApi(requestedId, signal ? { signal } : {})
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
  }, []);

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
    fetchSelectedPatientSessions(selectedPatientId, {
      showLoading: true,
      signal: controller?.signal,
    });
    return () => { if (controller) controller.abort(); };
  }, [isBackendProfessional, selectedPatientId, fetchSelectedPatientSessions]);

  // Fix de refresco silencioso: cuando la pestaña vuelve a estar visible,
  // el profesional autenticado revalida las sesiones del paciente seleccionado
  // sin loading indicator (evita parpadeo). Sin polling, sin setInterval,
  // sin reload — sólo un refetch puntual disparado por foco/visibilidad.
  useEffect(() => {
    if (!isBackendProfessional || selectedPatientId == null) return undefined;
    if (typeof document === "undefined") return undefined;
    function handleVisibility() {
      if (document.visibilityState === "visible") {
        fetchSelectedPatientSessions(selectedPatientId, { showLoading: false });
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    // También al recuperar foco de ventana (algunos navegadores no disparan
    // visibilitychange en cambios de aplicación/monitor).
    window.addEventListener("focus", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleVisibility);
    };
  }, [isBackendProfessional, selectedPatientId, fetchSelectedPatientSessions]);

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
      const weeklyProgress = deriveWeeklyProgressFromSessions(list);
      setPatients((current) =>
        current.map((p) =>
          p.id === authUser.id
            ? { ...p, completed, weeklyProgress, lastSessionAt: lastSessionAt || p.lastSessionAt }
            : p
        )
      );
    } catch {
      // Falla silenciosa: la sesión ya está persistida en PostgreSQL. No
      // reintentamos aquí ni volvemos a llamar /complete. La UI seguirá
      // mostrando lo último que pudo derivarse; F5 vuelve a intentar.
    }
  }

  // F3: cada vez que el paciente backend se autentica, consulta qué
  // actividades están iniciables bajo su configuración actual.
  useEffect(() => {
    if (!isBackendPatient || !authUser?.id) {
      setPatientAvailableSections(null);
      setPatientAvailableSectionsError(false);
      return undefined;
    }
    let cancelled = false;
    setPatientAvailableSectionsError(false);
    fetchPatientAvailableSections()
      .then((payload) => {
        if (cancelled) return;
        setPatientAvailableSections(payload);
        setPatientAvailableSectionsError(false);
      })
      .catch(() => {
        if (cancelled) return;
        // BUG-08: en vez de dejar null (que la UI podría interpretar como
        // "aún cargando"), marcamos error explícito. Las pantallas que
        // dependan de la cantidad configurada muestran un mensaje en lugar
        // de un valor por defecto incorrecto.
        setPatientAvailableSections(null);
        setPatientAvailableSectionsError(true);
      });
    return () => { cancelled = true; };
  }, [isBackendPatient, authUser?.id]);

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
        const weeklyProgress = deriveWeeklyProgressFromSessions(list);
        setPatients((current) =>
          current.map((p) =>
            p.id === authUser.id
              ? { ...p, completed, weeklyProgress, lastSessionAt: lastSessionAt || p.lastSessionAt }
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
    if (screen === SCREEN_NAMES.invite || screen === SCREEN_NAMES.loginLink) return;
    if (restoringSession) return;
    const nextHash = buildHash(isAuthenticated ? screen : SCREEN_NAMES.login, selectedActivity.id);
    if (window.location.hash !== nextHash) window.location.hash = nextHash;
  }, [isAuthenticated, screen, selectedActivity.id, restoringSession]);

  // Guard de role: un profesional autenticado nunca debe permanecer en pantallas
  // del rol paciente aunque la pantalla haya sido forzada vía state. El router
  // de hash cubre llegadas por URL; este efecto cubre transiciones por state.
  useEffect(() => {
    if (!isAuthenticated) return;
    if (role === SCREEN_NAMES.professional && (screen === SCREEN_NAMES.patient || screen === SCREEN_NAMES.activity)) {
      setScreen(SCREEN_NAMES.professional);
    }
  }, [isAuthenticated, role, screen]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    function syncFromHash() {
      const hashState = readHashState();
      if (hashState.screen === SCREEN_NAMES.invite) {
        setInviteToken(hashState.inviteToken);
        setScreen(SCREEN_NAMES.invite);
        return;
      }
      if (hashState.screen === SCREEN_NAMES.loginLink) {
        // Un enlace abierto en esta misma pestaña: capturarlo y quitarlo de la URL.
        setLoginLinkToken(takeLoginLinkTokenFromUrl());
        setScreen(SCREEN_NAMES.loginLink);
        return;
      }
      // Durante la restauración de la sesión por cookie no se navega.
      if (restoringSessionRef.current) return;
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
      if (
        (hashState.screen === SCREEN_NAMES.patient || hashState.screen === SCREEN_NAMES.activity) &&
        role === SCREEN_NAMES.professional
      ) {
        setScreen(SCREEN_NAMES.professional);
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

  // Estado común de "paciente autenticado" por enlace (F2/F3).
  function enterPatientSession(user) {
    const base = patientFromBackendUser(user);
    const persistedMood = loadPatientMood(user.id);
    const hydrated = persistedMood
      ? { ...base, mood: persistedMood.mood ?? null, moodSelectedAt: persistedMood.moodSelectedAt ?? null }
      : base;
    const patientObj = refreshDailyPatientState(hydrated);
    setPatients([patientObj]);
    setSelectedPatientId(patientObj.id);
    setAuthUser(user);
    setRole("patient");
    setIsAuthenticated(true);
    setLoginError("");
    setScreen(SCREEN_NAMES.patient);
  }

  // F3: restaurar la sesión por cookie al recargar la página.
  useEffect(() => {
    if (!init.restoringPatientSession) return undefined;
    let cancelled = false;
    restorePatientSession()
      .then((user) => {
        if (cancelled) return;
        if (user) {
          // Una actividad en curso no se puede reanudar tras recargar: se vuelve al inicio.
          window.history.replaceState(null, "", buildHash(SCREEN_NAMES.patient, selectedActivity.id));
          enterPatientSession(user);
        } else {
          setScreen(SCREEN_NAMES.login);
          setLoginError("Tu sesión terminó. Volvé a ingresar.");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setScreen(SCREEN_NAMES.login);
        setLoginError("No se pudo conectar con el servidor para recuperar tu sesión. Intentá nuevamente en unos minutos.");
      })
      .finally(() => {
        if (cancelled) return;
        restoringSessionRef.current = false;
        setRestoringSession(false);
      });
    return () => { cancelled = true; };
    // Sólo al montar: la restauración se decide una vez con el estado inicial.
  }, []);

  // F2: el enlace se canjeó y el backend fijó la cookie de sesión.
  function completeLoginLink(data) {
    if (!data?.user || data.user.role !== "patient") return false;
    clearCapturedLoginLinkToken();
    setLoginLinkToken(null);
    clearActivityDraft();
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", buildHash(SCREEN_NAMES.patient, selectedActivity.id));
    }
    enterPatientSession(data.user);
    return true;
  }

  function goToLoginFromLink({ passwordless = false } = {}) {
    clearCapturedLoginLinkToken();
    setLoginLinkToken(null);
    setLoginStartMode(passwordless ? "passwordless" : null);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", buildHash(SCREEN_NAMES.login, selectedActivity.id));
    }
    setScreen(SCREEN_NAMES.login);
  }

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
    console.debug(`${tag} googleLogin START inFlight=${googleLoginInFlightRef.current}`);
    // Guard: un único credential no debe producir dos POST concurrentes
    // aunque el SDK de Google dispare el callback más de una vez.
    if (googleLoginInFlightRef.current) {
      console.debug(`${tag} googleLogin SKIPPED (concurrent)`);
      return;
    }
    googleLoginInFlightRef.current = true;
    try {
      const data = await loginWithGoogle(credential);
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
      console.debug(`${tag} googleLogin AUTH STATE UPDATED (screen -> professional)`);
    } catch (err) {
      console.debug(`${tag} googleLogin CAUGHT err.name=${err?.name} err.status=${err?.status} err.message=${err?.message}`);
      setLoginError(err.message || "Error al iniciar sesión con Google");
    } finally {
      googleLoginInFlightRef.current = false;
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

  // Elimina una sesión no completada y refresca el historial del paciente
  // seleccionado (tabla, gráfico y métricas se derivan de esa lista). Si el
  // DELETE falla, el error se propaga al componente y no se refresca.
  async function deleteSessionForProfessional(sessionId) {
    await deleteSessionApi(sessionId);
    await fetchSelectedPatientSessions(selectedPatientId, { showLoading: false });
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

  // Invitación aceptada sin contraseña: el backend ya abrió la sesión por
  // cookie (authService guardó el CSRF en memoria). Mismo ingreso que el
  // canje de un enlace por correo.
  function acceptInvitationCookieSession(data) {
    if (!data?.user || data.user.role !== "patient") return false;
    setInviteToken(null);
    clearActivityDraft();
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", buildHash(SCREEN_NAMES.patient, selectedActivity.id));
    }
    enterPatientSession(data.user);
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
    // F3: sesión por enlace → revocar en el backend (borra la cookie HttpOnly).
    if (getPatientCookieSession()) logoutPatientSession();
    setIsAuthenticated(false);
    setAuthUser(null);
    clearAuth();
    clearActivityDraft();
    // H-S2: al cerrar sesión, descartar el mood persistido para evitar que
    // el próximo usuario (incluido otro paciente en el mismo dispositivo)
    // vea una selección que no le corresponde.
    clearPatientMood();
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

  // Sesión vencida o revocada durante el uso (cualquier 401 de la API, ver
  // authRequest.js): se cierra la sesión local y se vuelve al login con un
  // aviso, conservando la pestaña (paciente / psicólogo) en la que estaba.
  const expireSessionRef = useRef(null);
  expireSessionRef.current = () => {
    if (!isAuthenticated) return;
    const previousRole = role;
    logout();
    setRole(previousRole);
    setLoginError(SESSION_EXPIRED_MESSAGE);
  };
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onExpired = () => expireSessionRef.current?.();
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  function updatePatient(patientId, patch) {
    setPatients((current) => current.map((patient) => (patient.id === patientId ? { ...patient, ...patch } : patient)));
  }

  async function openActivity(activity) {
    if (!selectedPatient) return;
    if (selectedPatient.completed.includes(activity.id)) return;
    if (openingActivityRef.current) return;
    setActivityStartError("");

    if (isBackendPatient) {
      const sectionSlug = ACTIVITY_TO_SECTION_SLUG[activity.id];
      if (!sectionSlug) {
        setActivityStartError("Esta actividad no está disponible todavía en tu banco.");
        return;
      }
      // F3: segunda línea de defensa (la primera es ocultar/deshabilitar el
      // card en la pantalla del paciente). El backend hace el guard final.
      if (patientAvailableSections) {
        const row = patientAvailableSections.sections?.find((s) => s.section_slug === sectionSlug);
        if (row && !row.startable) {
          setActivityStartError("Esta actividad no está disponible con la configuración actual. Hablá con tu profesional.");
          return;
        }
      }
      openingActivityRef.current = true;
      setOpeningActivityId(activity.id);
      try {
        // Cantidad y dominios los resuelve el backend a partir de la configuración
        // persistida del paciente (users.max_questions / users.active_domain_slugs).
        // Mood: snapshot opcional del estado autorreportado al iniciar la sesión.
        // Si el paciente no seleccionó mood (null) o el valor almacenado no está
        // en el whitelist actual, no se envía (queda NULL en DB).
        // H-S2: segunda línea de defensa. Aun si refreshDailyPatientState no se
        // ejecutó recién (ej. app abierta durante la noche), chequeamos aquí
        // que la selección sea del día calendario local actual. Si está
        // vencida, se envía null al backend y no se persiste snapshot alguno.
        const rawMood = isMoodValidToday(selectedPatient) ? selectedPatient.mood : null;
        const patientReportedMood = VALID_MOOD_SLUGS.has(rawMood) ? rawMood : null;
        const session = await createPatientSession({
          sectionSlug,
          patientReportedMood,
        });
        setActiveSession(session);
      } catch (err) {
        setActivityStartError(err?.message || "No se pudo iniciar la actividad. Reintentá más tarde.");
        return;
      } finally {
        openingActivityRef.current = false;
        setOpeningActivityId(null);
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
    deleteSessionForProfessional,
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
    acceptInvitationCookieSession,
    goToLogin,
    loginLinkToken,
    completeLoginLink,
    goToLoginFromLink,
    loginStartMode,
    restoringSession,
    activeSession,
    activityStartError,
    openingActivityId,
    backendPatientSessions,
    patientAvailableSections,
    patientAvailableSectionsError,
    isBackendPatient,
  };
}
