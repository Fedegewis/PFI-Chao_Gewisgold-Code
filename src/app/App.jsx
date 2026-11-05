import { useEffect } from "react";
import { SCREEN_NAMES } from "../constants/appConfig.js";
import { ErrorBoundary } from "../components/common/ErrorBoundary.jsx";
import { Footer } from "../components/common/Footer.jsx";
import { GlobalHeader } from "../components/common/GlobalHeader.jsx";
import { useAppController } from "../hooks/useAppController.js";
import { ActivityScreen } from "../screens/ActivityScreen.jsx";
import { InviteAcceptScreen } from "../screens/InviteAcceptScreen.jsx";
import { LoginLinkScreen } from "../screens/LoginLinkScreen.jsx";
import { LoginScreen } from "../screens/LoginScreen.jsx";
import { PatientScreen } from "../screens/PatientScreen.jsx";
import { ProfessionalScreen } from "../screens/ProfessionalScreen.jsx";

export function App() {
  const {
    activities,
    authUser,
    completeActivity,
    deletePatientForProfessional,
    deleteSessionForProfessional,
    isAuthenticated,
    isBackendProfessional,
    googleLogin,
    login,
    loginError,
    logout,
    register,
    motivationMessage,
    openActivity,
    patients,
    professionalId,
    role,
    screen,
    selectedActivity,
    selectedPatient,
    sessions,
    setScreen,
    setSelectedPatientId,
    updatePatient,
    inviteToken,
    acceptInvitationSession,
    goToLogin,
    activityStartError,
    activeSession,
    backendPatientSessions,
    patientAvailableSections,
    patientAvailableSectionsError,
    isBackendPatient,
    loginLinkToken,
    completeLoginLink,
    goToLoginFromLink,
    loginStartMode,
    restoringSession,
  } = useAppController();

  useEffect(() => {
    const titles = {
      [SCREEN_NAMES.login]: "Login — MenteActiva",
      [SCREEN_NAMES.loginLink]: "Ingresar con enlace — MenteActiva",
      [SCREEN_NAMES.patient]: "Actividades — MenteActiva",
      [SCREEN_NAMES.professional]: "Panel Profesional — MenteActiva",
    };
    document.title = screen === SCREEN_NAMES.activity
      ? `${selectedActivity.title} — MenteActiva`
      : titles[screen] || "MenteActiva";
  }, [screen, selectedActivity]);

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">Saltar al contenido principal</a>
      <div className="app-inner">
        <GlobalHeader screen={screen} role={role} onLogout={logout} onNavigate={setScreen} />
        <ErrorBoundary>
          <main id="main-content">
            {screen === SCREEN_NAMES.invite && (
              <InviteAcceptScreen
                token={inviteToken}
                onAccepted={acceptInvitationSession}
                onGoToLogin={goToLogin}
              />
            )}
            {screen === SCREEN_NAMES.loginLink && (
              <LoginLinkScreen
                token={loginLinkToken}
                onSuccess={completeLoginLink}
                onGoToLogin={goToLoginFromLink}
              />
            )}
            {restoringSession && (
              <section className="login-layout" aria-label="Recuperando sesión">
                <div className="panel login-panel" role="status" aria-live="polite">
                  <h2>Recuperando tu sesión…</h2>
                </div>
              </section>
            )}
            {!restoringSession && screen === SCREEN_NAMES.login && <LoginScreen loginError={loginError} onLogin={login} onRegister={register} onGoogleLogin={googleLogin} initialMode={loginStartMode} />}
            {screen === SCREEN_NAMES.patient && isAuthenticated && role === "patient" && selectedPatient && <PatientScreen activities={activities} motivationMessage={motivationMessage} onOpenActivity={openActivity} onUpdatePatient={updatePatient} patient={selectedPatient} activityStartError={activityStartError} availableSections={patientAvailableSections} availableSectionsError={patientAvailableSectionsError} isBackendPatient={isBackendPatient} />}
            {screen === SCREEN_NAMES.activity && isAuthenticated && role === "patient" && selectedPatient && <ActivityScreen activity={selectedActivity} onBack={() => setScreen(SCREEN_NAMES.patient)} onComplete={completeActivity} patient={selectedPatient} activeSession={activeSession} />}
            {screen === SCREEN_NAMES.professional && isAuthenticated && role === "professional" && (
              <ProfessionalScreen
                professionalName={authUser?.name}
                patients={patients}
                professionalId={professionalId}
                selectedPatient={selectedPatient}
                sessions={sessions}
                setSelectedPatientId={setSelectedPatientId}
                updatePatient={updatePatient}
                isBackendProfessional={isBackendProfessional}
                deletePatientForProfessional={deletePatientForProfessional}
                deleteSessionForProfessional={deleteSessionForProfessional}
                backendPatientSessions={backendPatientSessions}
              />
            )}
          </main>
        </ErrorBoundary>
        <Footer />
      </div>
    </div>
  );
}
