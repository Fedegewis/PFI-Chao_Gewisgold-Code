import { ArrowLeft, Bot, CheckCircle2, Clock3, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { heuristicDifficulty } from "../ai.js";
import { COMPLETION_MESSAGES } from "../constants/appConfig.js";
import { ACTIVITY_DRAFT_MESSAGE } from "../constants/content.js";
import { clearActivityDraft, loadActivityDraft, saveActivityDraft } from "../storage/appStorage.js";
import { summarizeAnswers } from "../services/sessionService.js";
import { StatusChip } from "../components/common/StatusChip.jsx";
import { cx } from "../lib/cx.js";

function nearestAvailable(level, used, length) {
  let best = -1;
  let bestDistance = Infinity;
  for (let index = 0; index < length; index += 1) {
    if (used.includes(index)) continue;
    const distance = Math.abs(index - level);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

function extractBackendPool(activeSession) {
  if (!activeSession || !Array.isArray(activeSession.sections)) return null;
  const sqs = [];
  for (const s of activeSession.sections) {
    if (Array.isArray(s.questions)) sqs.push(...s.questions);
  }
  if (sqs.length === 0) return null;
  const ordered = [...sqs].sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
  return ordered.map((sq) => ({
    prompt: sq.prompt_snapshot,
    stimulus: sq.stimulus_snapshot || null,
    options: Array.isArray(sq.options_snapshot)
      ? sq.options_snapshot
      : (typeof sq.options_snapshot === "string" ? JSON.parse(sq.options_snapshot) : []),
    responseType: sq.response_type,
  }));
}

export function ActivityScreen({ activity, onBack, onComplete, patient, activeSession }) {
  const backendPool = extractBackendPool(activeSession);
  const usingBackend = Boolean(backendPool);
  const pool = usingBackend ? backendPool : activity.questions;
  const sessionLength = usingBackend ? backendPool.length : Math.min(patient.maxQuestions, pool.length);
  const [initialState] = useState(() => {
    if (usingBackend) {
      return { sequence: [0], answers: [], level: 0 };
    }
    const draft = loadActivityDraft();
    const canRestore =
      draft &&
      draft.patientId === patient.id &&
      draft.activityId === activity.id &&
      Array.isArray(draft.sequence) &&
      Array.isArray(draft.answers);
    return canRestore
      ? { sequence: draft.sequence, answers: draft.answers, level: draft.level }
      : { sequence: [nearestAvailable(0, [], pool.length)], answers: [], level: 0 };
  });
  const [sequence, setSequence] = useState(initialState.sequence);
  const [answers, setAnswers] = useState(initialState.answers);
  const [level, setLevel] = useState(initialState.level);
  const [showingStimulus, setShowingStimulus] = useState(false);
  const shownAt = useRef(typeof performance !== "undefined" ? performance.now() : Date.now());

  const step = sequence.length - 1;
  const current = pool[sequence[step]];
  const hasStimulus = Boolean(current.stimulus);
  const selectedEntry = answers[step];
  const selected = selectedEntry ? selectedEntry.option : undefined;
  const isCorrect = selectedEntry ? selectedEntry.correct : false;
  const answeredCount = answers.filter(Boolean).length;
  const isLast = step >= sessionLength - 1;

  useEffect(() => {
    if (hasStimulus) {
      setShowingStimulus(true);
    } else {
      setShowingStimulus(false);
      shownAt.current = typeof performance !== "undefined" ? performance.now() : Date.now();
    }
  }, [step, hasStimulus]);

  function dismissStimulus() {
    setShowingStimulus(false);
    shownAt.current = typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  useEffect(() => {
    if (usingBackend) return;
    saveActivityDraft({
      patientId: patient.id,
      activityId: activity.id,
      sequence,
      answers,
      level
    });
  }, [activity.id, answers, level, patient.id, sequence, usingBackend]);

  function chooseAnswer(optionIndex) {
    setAnswers((prev) => {
      const next = [...prev];
      const previous = next[step];
      const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
      const latencyMs = previous ? previous.latencyMs : Math.round(nowMs - shownAt.current);
      const correct = usingBackend ? null : optionIndex === current.correct;
      next[step] = { option: optionIndex, correct, latencyMs };
      return next;
    });
  }

  function goNext() {
    if (isLast) {
      if (usingBackend) {
        onComplete({ backend: true, total: answers.length });
        return;
      }
      clearActivityDraft();
      onComplete(summarizeAnswers(answers));
      return;
    }
    if (usingBackend) {
      // Modo backend: orden lineal según display_order del backend, sin adaptación.
      setSequence((prev) => [...prev, prev.length]);
      return;
    }
    const action = heuristicDifficulty({ correct: selectedEntry.correct, latencyMs: selectedEntry.latencyMs });
    let nextLevel = level;
    if (action === "up") nextLevel = Math.min(pool.length - 1, level + 1);
    else if (action === "down") nextLevel = Math.max(0, level - 1);
    const nextIndex = nearestAvailable(nextLevel, sequence, pool.length);
    setLevel(nextLevel);
    setSequence((prev) => [...prev, nextIndex < 0 ? prev[prev.length - 1] : nextIndex]);
  }

  return (
    <section className="panel activity-panel" aria-labelledby="activity-title">
      <button type="button" onClick={onBack} className="back-link"><ArrowLeft size={22} aria-hidden="true" /> Volver a actividades</button>
      <div className="activity-layout">
        <div className="activity-prompt">
          <p>{activity.skill}</p>
          <h1 id="activity-title">{activity.title}</h1>
          <div className="session-progress">
            <span>Pregunta {step + 1} de {sessionLength}</span>
            <div role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={sessionLength} aria-label="Progreso de la sesión"><span className="progress-fill" style={{ width: `${((step + 1) / sessionLength) * 100}%` }} /></div>
          </div>
          <p className="prompt-copy">{activity.intro}</p>
          <div className="chip-row">
            <StatusChip icon={Clock3} text="Sin límite estricto" />
            <StatusChip icon={Bot} text="Dificultad adaptativa" />
          </div>
          <div className="session-card">
            <p>{ACTIVITY_DRAFT_MESSAGE}</p>
            <span>Respondidas: {answeredCount}/{sessionLength}</span>
            <span>Cada actividad completada se suma a tu progreso.</span>
          </div>
        </div>
        <div className="question-panel">
          <div className="question-header"><h2>Pregunta {step + 1}</h2><span aria-hidden="true">{answeredCount}/{sessionLength}</span></div>
          {showingStimulus ? (
            <div className="stimulus-phase">
              <p className="stimulus-instruction">Leé la siguiente información con atención.</p>
              <p className="question-text">{current.stimulus}</p>
              <div className="activity-actions single">
                <button type="button" onClick={dismissStimulus} className="primary">Continuar</button>
              </div>
            </div>
          ) : (
            <>
              <p className="question-text" id="current-question">{current.prompt}</p>
              <div className="answer-grid" role="group" aria-labelledby="current-question">
                {current.options.map((answer, index) => (
                  <button key={answer} type="button" aria-pressed={selected === index} onClick={() => chooseAnswer(index)} className={cx("answer-button", selected === index && !usingBackend && (isCorrect ? "answer-good" : "answer-review"), selected === index && usingBackend && "answer-selected")}>
                    <span aria-hidden="true">{String.fromCharCode(65 + index)}</span>{answer}{selected === index && <CheckCircle2 size={24} aria-hidden="true" />}
                  </button>
                ))}
              </div>
              <div aria-live="polite" aria-atomic="true">
                {!usingBackend && selectedEntry && (
                  <div className={cx("feedback-box", !isCorrect && "feedback-encourage")}>
                    {isCorrect ? <CheckCircle2 size={24} aria-hidden="true" /> : <RefreshCw size={24} aria-hidden="true" />}
                    <p>{isCorrect ? current.patientGood : current.patientTry}</p>
                  </div>
                )}
                {isLast && selectedEntry && (
                  <div className="feedback-box completion-message">
                    <CheckCircle2 size={24} aria-hidden="true" />
                    <p>{COMPLETION_MESSAGES[new Date().getDay() % COMPLETION_MESSAGES.length]}</p>
                  </div>
                )}
              </div>
              <div className="activity-actions single">
                <button type="button" onClick={goNext} className="primary" disabled={selected === undefined}>
                  {isLast ? "Finalizar sesión" : "Siguiente"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
