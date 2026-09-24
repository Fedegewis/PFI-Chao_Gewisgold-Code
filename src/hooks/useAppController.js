import { useEffect, useMemo, useState } from "react";
import { DEFAULT_PROFESSIONAL_ID, MOTIVATION_MESSAGES, PATIENT_LOGINS, SCREEN_NAMES } from "../constants/appConfig.js";
import { activities, getActivityById } from "../data/activities.js";
import { buildHash, readHashState } from "../services/navigationService.js";
import {
  DEMO_PROFILES,
  buildInitialPatients,
  normalizePatient,
  patientFromBackendUser,
  refreshDailyPatientState
} from "../services/patientService.js";
import { createPatientApi, deletePatientApi, fetchPatients } from "../services/patientsApi.js";
import { buildCompletedActivityState, buildInitialSessions } from "../services/sessionService.js";
import {
  clearActivityDraft,
  clearAppSession,
  clearStorage,
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
  loginProfessional,
  loginWithGoogle,
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
    // Profesionales autenticados: los pacientes vienen del backend, no de localStorage.
    // Modo demo/paciente: se conservan los pacientes hardcodeados existentes.
    const patients = isAuthenticatedProfessional ? [] : loadAppPatients();
    return { session, hash, patients, savedUser, hasToken, isAuthenticatedProfessional };
  });
  const [role, setRole] = useState(() => {
    if (init.hasToken && init.savedUser?.role === "professional") return "professional";
    return init.session?.role || "patient";
  });
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    if (init.hasToken && init.savedUser) return true;
    return Boolean(init.session?.role);
  });
  const [authUser, setAuthUser] = useState(() => init.savedUser);
  const [screen, setScreen] = useState(() => {
    const { session, hash } = init;
    if (!session?.role) return SCREEN_NAMES.login;
    if (hash.screen === SCREEN_NAMES.professional && session.role !== SCREEN_NAMES.professional) {
      return SCREEN_NAMES.patient;
    }
    if ([SCREEN_NAMES.patient, SCREEN_NAMES.professional, SCREEN_NAMES.activity].includes(hash.screen)) {
      return hash.screen;
    }
    return session.role === SCREEN_NAMES.professional ? SCREEN_NAMES.professional : SCREEN_NAMES.patient;
  });
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

  const selectedPatient = useMemo(
    () =>
      selectedPatientId
        ? patients.find((patient) => patient.id === selectedPatientId) ?? null
        : null,
    [patients, selectedPatientId]
  );
  const motivationMessage = useMemo(() => MOTIVATION_MESSAGES[new Date().getDay() % MOTIVATION_MESSAGES.length], []);

  const isBackendProfessional = role === "professional" && Boolean(authUser?.id);

  useEffect(() => {
    // Solo se persisten pacientes en localStorage para modo demo/paciente.
    // Los profesionales autenticados tienen a Postgres como fuente de verdad.
    if (isBackendProfessional) return;
    savePatients(patients);
  }, [patients, isBackendProfessional]);

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
      if (event.key === "ma_patients_v1" && event.newValue && !isBackendProfessional) {
        try {
          const parsed = JSON.parse(event.newValue);
          if (Array.isArray(parsed)) setPatients(parsed.map(normalizePatient));
        } catch { /* payload inválido, se ignora */ }
      }
      if (event.key === "ma_sessions_v1" && event.newValue) {
        try {
          const parsed = JSON.parse(event.newValue);
          if (Array.isArray(parsed)) setSessions(parsed);
        } catch { /* payload inválido, se ignora */ }
      }
    }
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [isBackendProfessional]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const nextHash = buildHash(isAuthenticated ? screen : SCREEN_NAMES.login, selectedActivity.id);
    if (window.location.hash !== nextHash) window.location.hash = nextHash;
  }, [isAuthenticated, screen, selectedActivity.id]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    function syncFromHash() {
      const hashState = readHashState();
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
    if (nextRole === SCREEN_NAMES.patient) {
      const match = PATIENT_LOGINS.find((p) => p.email === email && p.password === password);
      if (match) {
        setRole(nextRole);
        setIsAuthenticated(true);
        setSelectedPatientId(match.patientId);
        if (typeof window !== "undefined") {
          window.history.replaceState(null, "", buildHash(SCREEN_NAMES.patient, selectedActivity.id));
        }
        setScreen(SCREEN_NAMES.patient);
        setLoginError("");
        return;
      }
      setLoginError(LOGIN_ERROR_MESSAGE);
      return;
    }

    try {
      const data = await loginProfessional({ email, password });
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

  async function googleLogin(credential) {
    try {
      const data = await loginWithGoogle(credential);
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
      setLoginError(err.message || "Error al iniciar sesión con Google");
    }
  }

  async function createPatientForProfessional({ name, age, email }) {
    const user = await createPatientApi({ name, age, email });
    const nextPatient = patientFromBackendUser(user);
    setPatients((current) => [...current, nextPatient]);
    setSelectedPatientId(nextPatient.id);
    return nextPatient;
  }

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

  function logout() {
    setIsAuthenticated(false);
    setAuthUser(null);
    clearAuth();
    clearActivityDraft();
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

  function openActivity(activity) {
    if (!selectedPatient) return;
    if (selectedPatient.completed.includes(activity.id)) return;
    setSelectedActivity(activity);
    setScreen(SCREEN_NAMES.activity);
  }

  function completeActivity(summary) {
    if (!selectedPatient) return;
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

  function resetDemo() {
    clearActivityDraft();
    clearStorage();
    const initialPatients = buildInitialPatients();
    setPatients(initialPatients);
    setSessions(buildInitialSessions());
    setSelectedPatientId(initialPatients[0].id);
  }

  return {
    activities,
    authUser,
    createPatientForProfessional,
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
    resetDemo,
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
    completeActivity
  };
}
