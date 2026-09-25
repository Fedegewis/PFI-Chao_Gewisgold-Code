import { AlertTriangle, CheckCircle2, Copy, Search, Send, Trash2, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MAX_PATIENT_AGE } from "../../constants/appConfig.js";
import { cx } from "../../lib/cx.js";
import {
  buildInviteLink,
  createInvitationApi,
  fetchInvitationsApi,
  revokeInvitationApi,
} from "../../services/invitationsApi.js";
import { PatientCard } from "./PatientCard.jsx";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function statusLabel(status) {
  switch (status) {
    case "pending": return "Pendiente";
    case "accepted": return "Aceptada";
    case "revoked": return "Revocada";
    case "expired": return "Expirada";
    default: return status;
  }
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "—";
  }
}

export function PatientGrid({
  patients,
  professionalId,
  selectedPatient,
  onSelectPatient,
  useBackendScope = false,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAge, setNewAge] = useState("70");
  const [newEmail, setNewEmail] = useState("");
  const [feedback, setFeedback] = useState({ text: "", type: "" });
  const [submitting, setSubmitting] = useState(false);
  const [inviteLink, setInviteLink] = useState("");
  const [copied, setCopied] = useState(false);

  const [pendingInvites, setPendingInvites] = useState([]);
  const [loadingInvites, setLoadingInvites] = useState(false);
  const [invitesError, setInvitesError] = useState("");

  const professionalPatients = useMemo(
    () => (useBackendScope ? patients : patients.filter((p) => p.professionalId === professionalId)),
    [patients, professionalId, useBackendScope]
  );
  const filteredPatients = useMemo(
    () => professionalPatients.filter((p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase().trim())
    ),
    [professionalPatients, searchQuery]
  );

  const activeCount = professionalPatients.filter((p) => (p.completed?.length ?? 0) > 0 || p.answers > 0).length;

  const refreshInvites = useCallback(async () => {
    if (!useBackendScope) return;
    setLoadingInvites(true);
    setInvitesError("");
    try {
      const rows = await fetchInvitationsApi();
      setPendingInvites(Array.isArray(rows) ? rows.filter((r) => r.status === "pending") : []);
    } catch (err) {
      setInvitesError(err?.message || "No se pudieron cargar las invitaciones.");
    } finally {
      setLoadingInvites(false);
    }
  }, [useBackendScope]);

  useEffect(() => {
    refreshInvites();
  }, [refreshInvites]);

  function resetForm() {
    setNewName("");
    setNewAge("70");
    setNewEmail("");
    setFeedback({ text: "", type: "" });
    setInviteLink("");
    setCopied(false);
  }

  async function handleCreateInvite() {
    if (!useBackendScope) {
      setFeedback({ text: "Invitaciones sólo disponibles para profesionales autenticados.", type: "error" });
      return;
    }
    const trimmedName = newName.trim();
    const normalizedEmail = newEmail.trim().toLowerCase();
    if (!trimmedName) {
      setFeedback({ text: "Ingresá un nombre para el paciente.", type: "error" });
      return;
    }
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      setFeedback({ text: "Ingresá un email válido.", type: "error" });
      return;
    }
    const parsedAge = Number(newAge);
    if (!Number.isInteger(parsedAge) || parsedAge < 1 || parsedAge > MAX_PATIENT_AGE) {
      setFeedback({ text: `La edad debe ser un número entero entre 1 y ${MAX_PATIENT_AGE}.`, type: "error" });
      return;
    }
    setSubmitting(true);
    setFeedback({ text: "", type: "" });
    try {
      const invite = await createInvitationApi({
        name: trimmedName,
        age: parsedAge,
        email: normalizedEmail,
      });
      const link = buildInviteLink(invite.token);
      setInviteLink(link);
      setFeedback({
        text: "Invitación creada. Copiá el enlace y enviáselo al paciente. Aparecerá en tu lista cuando la acepte.",
        type: "success",
      });
      setCopied(false);
      refreshInvites();
    } catch (err) {
      setFeedback({ text: err?.message || "No se pudo crear la invitación.", type: "error" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopyLink() {
    if (!inviteLink) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteLink);
      }
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function handleRevoke(inviteId) {
    try {
      await revokeInvitationApi(inviteId);
      setPendingInvites((current) => current.filter((i) => i.id !== inviteId));
    } catch (err) {
      setInvitesError(err?.message || "No se pudo revocar la invitación.");
    }
  }

  return (
    <section className="panel patient-grid-panel" aria-label="Panel de pacientes">
      <div className="patient-grid-head">
        <div>
          <p className="eyebrow">Panel de pacientes</p>
          <h1>Seguimiento</h1>
          <small className="patient-grid-count">
            {professionalPatients.length} usuarios · {activeCount} con actividad
          </small>
        </div>
        <div className="patient-grid-search">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            placeholder="Buscar por nombre..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Buscar paciente por nombre"
          />
        </div>
      </div>

      {!creating ? (
        <button
          type="button"
          className="new-patient-inline"
          onClick={() => { setCreating(true); resetForm(); }}
          aria-label="Abrir formulario para invitar paciente"
        >
          <UserPlus size={18} aria-hidden="true" /> Invitar paciente
        </button>
      ) : (
        <form
          className="new-patient-form"
          onSubmit={(e) => { e.preventDefault(); handleCreateInvite(); }}
          aria-label="Formulario de invitación de paciente"
          noValidate
        >
          <div className="new-patient-form-head">
            <strong>Nueva invitación</strong>
            <button
              type="button"
              className="icon-action"
              aria-label="Cerrar formulario de invitación"
              onClick={() => { setCreating(false); resetForm(); }}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <p className="ai-hint">
            Se generará un enlace único para que el paciente cree su acceso. Aparecerá en tu lista cuando acepte la invitación.
          </p>
          <div className="new-patient-form-fields">
            <div>
              <label htmlFor="invite-name">Nombre del paciente</label>
              <input
                id="invite-name"
                value={newName}
                onChange={(e) => { setNewName(e.target.value); setFeedback({ text: "", type: "" }); }}
                placeholder="Nombre completo"
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="invite-age">Edad</label>
              <input
                id="invite-age"
                type="number"
                min="1"
                max={MAX_PATIENT_AGE}
                value={newAge}
                onChange={(e) => { setNewAge(e.target.value); setFeedback({ text: "", type: "" }); }}
                placeholder="Edad"
              />
            </div>
            <div>
              <label htmlFor="invite-email">Email del paciente</label>
              <input
                id="invite-email"
                type="email"
                value={newEmail}
                onChange={(e) => { setNewEmail(e.target.value); setFeedback({ text: "", type: "" }); }}
                placeholder="email@ejemplo.com"
                autoComplete="off"
              />
            </div>
            <button className="primary" type="submit" disabled={submitting}>
              <Send size={18} aria-hidden="true" /> {submitting ? "Creando..." : "Crear invitación"}
            </button>
          </div>
          {feedback.text && (
            <p
              className={cx("form-feedback", feedback.type === "success" ? "form-feedback-success" : "form-feedback-error")}
              role="alert"
            >
              {feedback.type === "success" ? <CheckCircle2 size={14} aria-hidden="true" /> : <AlertTriangle size={14} aria-hidden="true" />}
              {" "}{feedback.text}
            </p>
          )}
          {inviteLink && (
            <div className="invite-link-box">
              <label htmlFor="invite-link-input">Enlace de invitación</label>
              <div className="invite-link-row">
                <input
                  id="invite-link-input"
                  readOnly
                  value={inviteLink}
                  onFocus={(e) => e.target.select()}
                />
                <button
                  type="button"
                  className="secondary-action"
                  onClick={handleCopyLink}
                  aria-label="Copiar enlace de invitación"
                >
                  <Copy size={16} aria-hidden="true" /> {copied ? "Copiado" : "Copiar"}
                </button>
              </div>
              <small className="ai-hint">
                Este enlace sólo se muestra ahora. Si lo perdés, generá una nueva invitación para ese email (la anterior se revocará).
              </small>
            </div>
          )}
        </form>
      )}

      <div className="patient-grid" role="list" aria-label="Lista de pacientes">
        {filteredPatients.map((patient) => (
          <div role="listitem" key={patient.id}>
            <PatientCard
              patient={patient}
              selected={selectedPatient ? patient.id === selectedPatient.id : false}
              onSelect={onSelectPatient}
              isBackend={useBackendScope}
            />
          </div>
        ))}
      </div>

      {professionalPatients.length === 0 && !searchQuery && (
        <div className="empty-chart">
          Todavía no tenés pacientes cargados. Usá &quot;Invitar paciente&quot; para enviar la primera invitación.
        </div>
      )}
      {filteredPatients.length === 0 && searchQuery && (
        <div className="empty-chart">No hay pacientes que coincidan con &quot;{searchQuery}&quot;.</div>
      )}

      {useBackendScope && (
        <div className="pending-invitations" aria-label="Invitaciones pendientes">
          <div className="section-head compact">
            <div>
              <p className="eyebrow">Invitaciones pendientes</p>
              <h3>Pendientes de aceptación</h3>
            </div>
          </div>
          {invitesError && (
            <p className="form-feedback form-feedback-error" role="alert">
              <AlertTriangle size={14} aria-hidden="true" /> {invitesError}
            </p>
          )}
          {loadingInvites ? (
            <p className="ai-hint">Cargando invitaciones...</p>
          ) : pendingInvites.length === 0 ? (
            <p className="ai-hint">No hay invitaciones pendientes.</p>
          ) : (
            <ul className="pending-invites-list" role="list">
              {pendingInvites.map((inv) => (
                <li key={inv.id} role="listitem" className="pending-invite-row">
                  <div>
                    <strong>{inv.patient_name}</strong>
                    <small> · {inv.email}</small>
                    <div>
                      <small>{statusLabel(inv.status)} · vence {formatDate(inv.expires_at)}</small>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => handleRevoke(inv.id)}
                    aria-label={`Revocar invitación a ${inv.email}`}
                  >
                    <Trash2 size={14} aria-hidden="true" /> Revocar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
