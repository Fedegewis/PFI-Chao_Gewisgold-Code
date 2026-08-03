import { useEffect, useMemo, useState } from "react";
import { DEFAULT_PROFESSIONAL_ID, LOGIN_CREDENTIALS, MOTIVATION_MESSAGES, SCREEN_NAMES } from "../constants/appConfig.js";
import { activities, getActivityById } from "../data/activities.js";
import { buildHash, readHashState } from "../services/navigationService.js";
import {
  buildInitialPatients,
  normalizePatient,
  refreshDailyPatientState
} from "../services/patientService.js";
import { buildCompletedActivityState } from "../services/sessionService.js";
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

function loadAppPatients() {
  const initialPatients = buildInitialPatients();
  return loadPatients(initialPatients, normalizePatient).map((patient) => refreshDailyPatientState(patient));
}

export function useAppController() {
  const initialSession = loadAppSession();
  const initialHash = readHashState();
  const [role, setRole] = useState(() => initialSession?.role || "patient");
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(initialSession?.role));
  const [screen, setScreen] = useState(() => {
    if (!initialSession?.role) return SCREEN_NAMES.login;
    if (initialHash.screen === SCREEN_NAMES.professional && initialSession.role !== SCREEN_NAMES.professional) {
      return SCREEN_NAMES.patient;
    }
    if ([SCREEN_NAMES.patient, SCREEN_NAMES.professional, SCREEN_NAMES.activity].includes(initialHash.screen)) {
      return initialHash.screen;
    }
    return initialSession.role === SCREEN_NAMES.professional ? SCREEN_NAMES.professional : SCREEN_NAMES.patient;
  });
  const [professionalId, setProfessionalId] = useState(() => initialSession?.professionalId || DEFAULT_PROFESSIONAL_ID);
  const [patients, setPatients] = useState(loadAppPatients);
  const [sessions, setSessions] = useState(loadSessions);
  const [selectedPatientId, setSelectedPatientId] = useState(() => loadAppPatients()[0].id);
  const [selectedActivity, setSelectedActivity] = useState(() => getActivityById(initialHash.activityId));
  const [loginError, setLoginError] = useState("");

  const selectedPatient = useMemo(
    () => patients.find((patient) => patient.id === selectedPatientId) ?? patients[0],
    [patients, selectedPatientId]
  );
  const motivationMessage = useMemo(() => MOTIVATION_MESSAGES[new Date().getDay() % MOTIVATION_MESSAGES.length], []);

  useEffect(() => {
    savePatients(patients);
  }, [patients]);

  useEffect(() => {
    saveSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    if (isAuthenticated) saveAppSession({ role, professionalId });
    else clearAppSession();
  }, [isAuthenticated, professionalId, role]);

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

  function login(nextRole, email, password) {
    if (email === LOGIN_CREDENTIALS[nextRole].email && password === LOGIN_CREDENTIALS[nextRole].password) {
      setRole(nextRole);
      setIsAuthenticated(true);
      if (nextRole === SCREEN_NAMES.professional) setProfessionalId(LOGIN_CREDENTIALS.professional.id);
      const nextScreen = nextRole === SCREEN_NAMES.professional ? SCREEN_NAMES.professional : SCREEN_NAMES.patient;
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", buildHash(nextScreen, selectedActivity.id));
      }
      setScreen(nextScreen);
      setLoginError("");
      return;
    }
    setLoginError(LOGIN_ERROR_MESSAGE);
  }

  function logout() {
    setIsAuthenticated(false);
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
    if (selectedPatient.completed.includes(activity.id)) return;
    setSelectedActivity(activity);
    setScreen(SCREEN_NAMES.activity);
  }

  function completeActivity(summary) {
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
    setSessions([]);
    setSelectedPatientId(initialPatients[0].id);
  }

  return {
    activities,
    isAuthenticated,
    loginError,
    login,
    logout,
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
