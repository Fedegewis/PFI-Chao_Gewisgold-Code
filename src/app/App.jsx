import { useEffect } from "react";
import { SCREEN_NAMES } from "../constants/appConfig.js";
import { ErrorBoundary } from "../components/common/ErrorBoundary.jsx";
import { Footer } from "../components/common/Footer.jsx";
import { GlobalHeader } from "../components/common/GlobalHeader.jsx";
import { useAppController } from "../hooks/useAppController.js";
import { ActivityScreen } from "../screens/ActivityScreen.jsx";
import { LoginScreen } from "../screens/LoginScreen.jsx";
import { PatientScreen } from "../screens/PatientScreen.jsx";
import { ProfessionalScreen } from "../screens/ProfessionalScreen.jsx";

export function App() {
  const {
    activities,
    completeActivity,
    isAuthenticated,
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
    setPatients,
    setScreen,
    setSelectedPatientId,
    updatePatient
  } = useAppController();

  useEffect(() => {
    const titles = {
      [SCREEN_NAMES.login]: "Login — MenteActiva",
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
            {screen === SCREEN_NAMES.login && <LoginScreen loginError={loginError} onLogin={login} onRegister={register} onGoogleLogin={googleLogin} />}
            {screen === SCREEN_NAMES.patient && isAuthenticated && <PatientScreen activities={activities} motivationMessage={motivationMessage} onOpenActivity={openActivity} onUpdatePatient={updatePatient} patient={selectedPatient} />}
            {screen === SCREEN_NAMES.activity && isAuthenticated && <ActivityScreen activity={selectedActivity} onBack={() => setScreen(SCREEN_NAMES.patient)} onComplete={completeActivity} patient={selectedPatient} />}
            {screen === SCREEN_NAMES.professional && isAuthenticated && role === "professional" && (
              <ProfessionalScreen
                patients={patients}
                professionalId={professionalId}
                selectedPatient={selectedPatient}
                sessions={sessions}
                setPatients={setPatients}
                setSelectedPatientId={setSelectedPatientId}
                updatePatient={updatePatient}
              />
            )}
          </main>
        </ErrorBoundary>
        <Footer />
      </div>
    </div>
  );
}
