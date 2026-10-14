import { AlertTriangle, CheckCircle2, Minus, Plus, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cx } from "../../lib/cx.js";
import {
  fetchCognitiveDomains,
  fetchTrainingAvailability,
  fetchTrainingConfig,
  saveTrainingConfig,
} from "../../services/trainingConfigApi.js";

// Bloque de configuración de entrenamiento — se monta DENTRO del panel de
// "Historial de actividades" para no crear una tarjeta extra full-width.
// - Cantidad: stepper compacto 1..10.
// - Dominios: chips multi-toggle (sin selección = todos).
// - Availability: se sigue consultando al backend, pero SOLO se muestra una
//   advertencia agregada cuando la config no es viable en alguna sección.

const MIN_QUESTIONS = 1;
const MAX_QUESTIONS = 10;

export function TrainingConfigPanel({ patientId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [domains, setDomains] = useState([]);
  const [availability, setAvailability] = useState(null);
  const [config, setConfig] = useState(null);
  const [draftCount, setDraftCount] = useState(4);
  const [draftSlugs, setDraftSlugs] = useState([]);
  const [draftSectionSlugs, setDraftSectionSlugs] = useState([]);

  const loadAll = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    setError("");
    try {
      const [cat, cfg, avail] = await Promise.all([
        fetchCognitiveDomains(),
        fetchTrainingConfig(patientId),
        fetchTrainingAvailability(patientId),
      ]);
      setDomains(cat);
      setConfig(cfg);
      setAvailability(avail);
      setDraftCount(cfg.effective_max_questions);
      setDraftSlugs(cfg.active_domain_slugs || []);
      setDraftSectionSlugs(cfg.active_section_slugs || []);
    } catch (err) {
      setError(err?.message || "No se pudo cargar la configuración");
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const dirty = useMemo(() => {
    if (!config) return false;
    const savedCount = config.effective_max_questions;
    const savedSlugs = config.active_domain_slugs || [];
    const savedSections = config.active_section_slugs || [];
    if (draftCount !== savedCount) return true;
    const sameArr = (a, b) => {
      if (a.length !== b.length) return false;
      const sa = [...a].sort();
      const sb = [...b].sort();
      return sa.every((v, i) => v === sb[i]);
    };
    if (!sameArr(draftSlugs, savedSlugs)) return true;
    if (!sameArr(draftSectionSlugs, savedSections)) return true;
    return false;
  }, [config, draftCount, draftSlugs, draftSectionSlugs]);

  function toggleDomain(slug) {
    setSaveOk(false);
    setSaveError("");
    setDraftSlugs((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
  }

  function toggleSection(slug) {
    setSaveOk(false);
    setSaveError("");
    setDraftSectionSlugs((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
  }

  function handleCountChange(delta) {
    setSaveOk(false);
    setSaveError("");
    setDraftCount((prev) => {
      const next = prev + delta;
      if (next < MIN_QUESTIONS) return MIN_QUESTIONS;
      if (next > MAX_QUESTIONS) return MAX_QUESTIONS;
      return next;
    });
  }

  function handleCountInput(value) {
    setSaveOk(false);
    setSaveError("");
    const n = Number(value);
    if (Number.isInteger(n) && n >= MIN_QUESTIONS && n <= MAX_QUESTIONS) {
      setDraftCount(n);
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaveOk(false);
    setSaveError("");
    try {
      const payload = {
        max_questions: draftCount,
        active_domain_slugs: draftSlugs.length > 0 ? draftSlugs : null,
        active_section_slugs: draftSectionSlugs.length > 0 ? draftSectionSlugs : null,
      };
      await saveTrainingConfig(patientId, payload);
      const [cfg, avail] = await Promise.all([
        fetchTrainingConfig(patientId),
        fetchTrainingAvailability(patientId),
      ]);
      setConfig(cfg);
      setAvailability(avail);
      setDraftCount(cfg.effective_max_questions);
      setDraftSlugs(cfg.active_domain_slugs || []);
      setDraftSectionSlugs(cfg.active_section_slugs || []);
      setSaveOk(true);
    } catch (err) {
      setSaveError(err?.message || "No se pudo guardar la configuración");
    } finally {
      setSaving(false);
    }
  }

  // Arquitectura: una sesión = una actividad = una section. La configuración
  // es viable si al menos UNA section puede cumplir max_questions con los
  // dominios activos.
  // - configInviable: NINGUNA sección cumple → inicio imposible en toda la app.
  // - insufficientSections: lista de secciones que no cumplen individualmente.
  //   Importa surfear esto en el momento de guardar, no cuando el paciente
  //   intenta esa actividad concreta (bug reportado en pruebas pre-tesis).
  // Si el profesional restringió las secciones habilitadas, limitamos las
  // advertencias y el any_sufficient a esas secciones; el backend ya lo hace,
  // pero mientras el usuario arma un borrador no persistido mostramos la vista
  // del borrador (draftSectionSlugs) sin reconsultar.
  const draftEnabledSet = draftSectionSlugs.length > 0
    ? new Set(draftSectionSlugs)
    : null;
  const relevantSections = availability
    ? (draftEnabledSet
        ? availability.sections.filter((s) => draftEnabledSet.has(s.section_slug))
        : availability.sections)
    : [];
  // Si no hay información de disponibilidad (lista vacía o aún no cargada) no
  // bloqueamos el guardar: la validación final vive en backend y el flujo del
  // paciente filtra. Sólo marcamos inviable cuando TODAS las secciones
  // relevantes son explícitamente insuficientes.
  const configInviable = availability && relevantSections.length > 0
    ? relevantSections.every((s) => !s.sufficient)
    : false;
  const insufficientSections = relevantSections.filter((s) => !s.sufficient);

  return (
    <section className="training-config-inline" aria-label="Configuración de entrenamiento">
      <header className="training-config-inline__head">
        <div>
          <p className="eyebrow">Configuración de entrenamiento</p>
          <h3>Ajustes de las próximas sesiones</h3>
        </div>
        <SlidersHorizontal size={22} aria-hidden="true" />
      </header>

      {loading && <p className="ai-hint">Cargando configuración…</p>}
      {error && (
        <p className="form-feedback form-feedback-error" role="alert">
          <AlertTriangle size={14} aria-hidden="true" /> {error}
        </p>
      )}

      {!loading && !error && (
        <div className="training-config-inline__body">
          <div className="training-field">
            <label htmlFor="training-question-count">Cantidad de preguntas</label>
            <div className="training-stepper" role="group" aria-label="Selector de cantidad de preguntas">
              <button
                type="button"
                className="training-stepper__btn"
                aria-label="Disminuir cantidad"
                onClick={() => handleCountChange(-1)}
                disabled={draftCount <= MIN_QUESTIONS || saving}
              >
                <Minus size={16} aria-hidden="true" />
              </button>
              <input
                id="training-question-count"
                className="training-stepper__input"
                type="number"
                min={MIN_QUESTIONS}
                max={MAX_QUESTIONS}
                value={draftCount}
                onChange={(e) => handleCountInput(e.target.value)}
                disabled={saving}
              />
              <button
                type="button"
                className="training-stepper__btn"
                aria-label="Aumentar cantidad"
                onClick={() => handleCountChange(+1)}
                disabled={draftCount >= MAX_QUESTIONS || saving}
              >
                <Plus size={16} aria-hidden="true" />
              </button>
            </div>
          </div>

          <fieldset className="domain-fieldset training-field">
            <legend>Dominios cognitivos</legend>
            <p className="training-hint">
              Si no seleccionás ninguno, se incluyen todos los dominios.
            </p>
            <div className="domain-chips">
              {domains.map((d) => (
                <button
                  key={d.slug}
                  type="button"
                  className={cx("domain-chip", draftSlugs.includes(d.slug) && "domain-chip--active")}
                  onClick={() => toggleDomain(d.slug)}
                  aria-pressed={draftSlugs.includes(d.slug)}
                  disabled={saving}
                >
                  {d.name}
                </button>
              ))}
            </div>
          </fieldset>

          {availability && availability.sections.length > 0 && (
            <fieldset className="domain-fieldset training-field">
              <legend>Actividades habilitadas</legend>
              <p className="training-hint">
                Si no seleccionás ninguna, el paciente puede iniciar todas las que tengan preguntas suficientes.
                El número indica cuántas preguntas distintas cumplen la combinación de dominios y cantidad.
              </p>
              <div className="domain-chips">
                {availability.sections.map((s) => {
                  const selected = draftSectionSlugs.includes(s.section_slug);
                  const insuf = !s.sufficient;
                  return (
                    <button
                      key={s.section_slug}
                      type="button"
                      className={cx(
                        "domain-chip",
                        selected && "domain-chip--active",
                        insuf && "domain-chip--insufficient"
                      )}
                      onClick={() => toggleSection(s.section_slug)}
                      aria-pressed={selected}
                      disabled={saving}
                      title={insuf ? `Sólo ${s.available} preguntas disponibles para esta configuración` : undefined}
                    >
                      {s.section_name} · {s.available}/{availability.requested}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

          {configInviable && (
            <p className="form-feedback form-feedback-error training-warning" role="alert">
              <AlertTriangle size={14} aria-hidden="true" />{" "}
              Ninguna actividad tiene suficientes preguntas para esta configuración. Ajustá la cantidad o los dominios.
            </p>
          )}

          {!configInviable && insufficientSections.length > 0 && (
            <p className="form-feedback form-feedback-error training-warning" role="alert">
              <AlertTriangle size={14} aria-hidden="true" />{" "}
              Algunas actividades no tienen preguntas suficientes para esta configuración:{" "}
              {insufficientSections
                .map((s) => `${s.section_name} (${s.available}/${availability.requested})`)
                .join(", ")}
              . El paciente verá un aviso al iniciarlas.
            </p>
          )}

          <div className="training-actions">
            <button
              type="button"
              className={cx("primary training-save", saveOk && !dirty && "primary--saved")}
              onClick={handleSave}
              disabled={saving || !dirty || configInviable}
            >
              <CheckCircle2 size={18} aria-hidden="true" />{" "}
              {saving ? "Guardando…" : saveOk && !dirty ? "Configuración guardada" : "Guardar configuración"}
            </button>
            {saveError && (
              <p className="form-feedback form-feedback-error" role="alert">
                <AlertTriangle size={14} aria-hidden="true" /> {saveError}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
