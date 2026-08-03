import { SCREEN_NAMES } from "../constants/appConfig.js";
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
    login,
    loginError,
    logout,
    motivationMessage,
    openActivity,
    patients,
    professionalId,
    resetDemo,
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

  return (
    <main className="app-shell">
      <div className="app-inner">
        <GlobalHeader screen={screen} role={role} onLogout={logout} onNavigate={setScreen} />
        {screen === SCREEN_NAMES.login && <LoginScreen loginError={loginError} onLogin={login} />}
        {screen === SCREEN_NAMES.patient && <PatientScreen activities={activities} motivationMessage={motivationMessage} onOpenActivity={openActivity} onUpdatePatient={updatePatient} patient={selectedPatient} />}
        {screen === SCREEN_NAMES.activity && <ActivityScreen activity={selectedActivity} onBack={() => setScreen(SCREEN_NAMES.patient)} onComplete={completeActivity} patient={selectedPatient} />}
        {screen === SCREEN_NAMES.professional && (
          <ProfessionalScreen
            patients={patients}
            professionalId={professionalId}
            resetDemo={resetDemo}
            selectedPatient={selectedPatient}
            sessions={sessions}
            setPatients={setPatients}
            setSelectedPatientId={setSelectedPatientId}
            updatePatient={updatePatient}
          />
        )}
      </div>
    </main>
  );
}
