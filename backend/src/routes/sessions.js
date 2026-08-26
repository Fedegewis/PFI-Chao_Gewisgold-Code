import { Router } from "express";
import db from "../db/connection.js";

const router = Router();

function calculateMetrics(sessionQuestions, answers) {
  const totalQuestions = sessionQuestions.length;
  const answeredQuestions = answers.length;
  const unansweredCount = totalQuestions - answeredQuestions;

  const scoredAnswers = answers.filter((a) => a.is_correct !== null);
  const correctCount = scoredAnswers.filter((a) => a.is_correct === true).length;
  const incorrectCount = scoredAnswers.filter((a) => a.is_correct === false).length;

  const accuracy =
    scoredAnswers.length > 0 ? correctCount / scoredAnswers.length : null;

  const completionRate =
    totalQuestions > 0 ? answeredQuestions / totalQuestions : null;

  const latencies = answers.map((a) => a.response_time_ms);
  let meanLatencyMs = null;
  let minLatencyMs = null;
  let maxLatencyMs = null;
  let latencyStdMs = null;

  if (latencies.length > 0) {
    const sum = latencies.reduce((s, v) => s + v, 0);
    meanLatencyMs = sum / latencies.length;
    minLatencyMs = Math.min(...latencies);
    maxLatencyMs = Math.max(...latencies);

    if (latencies.length === 1) {
      latencyStdMs = 0;
    } else {
      const sumSquaredDiffs = latencies.reduce(
        (s, v) => s + (v - meanLatencyMs) ** 2,
        0
      );
      latencyStdMs = Math.sqrt(sumSquaredDiffs / latencies.length);
    }
  }

  return {
    total_questions: totalQuestions,
    answered_questions: answeredQuestions,
    correct_count: correctCount,
    incorrect_count: incorrectCount,
    unanswered_count: unansweredCount,
    accuracy,
    completion_rate: completionRate,
    mean_latency_ms: meanLatencyMs,
    min_latency_ms: minLatencyMs,
    max_latency_ms: maxLatencyMs,
    latency_std_ms: latencyStdMs,
  };
}

function parseNumericFields(row) {
  if (!row) return null;
  return {
    ...row,
    accuracy: row.accuracy !== null ? Number(row.accuracy) : null,
    completion_rate: Number(row.completion_rate),
    mean_latency_ms:
      row.mean_latency_ms !== null ? Number(row.mean_latency_ms) : null,
    latency_std_ms:
      row.latency_std_ms !== null ? Number(row.latency_std_ms) : null,
  };
}

router.post("/sessions", async (req, res, next) => {
  try {
    const { patient_id, professional_id, sections } = req.body;

    if (!patient_id || !professional_id || !Array.isArray(sections) || sections.length === 0) {
      return res.status(400).json({
        error: "patient_id, professional_id y sections (array no vacío) son obligatorios",
      });
    }

    const patient = await db("users")
      .where({ id: patient_id, role: "patient" })
      .first();
    if (!patient) {
      return res.status(404).json({ error: "Paciente no encontrado" });
    }

    const professional = await db("users")
      .where({ id: professional_id, role: "professional" })
      .first();
    if (!professional) {
      return res.status(404).json({ error: "Profesional no encontrado" });
    }

    for (const entry of sections) {
      if (!entry.section_id || !entry.question_count || entry.question_count < 1) {
        return res.status(400).json({
          error: "Cada sección requiere section_id y question_count >= 1",
        });
      }

      const section = await db("sections").where("id", entry.section_id).first();
      if (!section) {
        return res.status(404).json({
          error: `Sección ${entry.section_id} no encontrada`,
        });
      }

      const availableCount = await db("questions")
        .where({ section_id: entry.section_id, is_active: true, is_validated: true })
        .count("id as count")
        .first();

      const available = Number(availableCount.count);
      if (available < entry.question_count) {
        return res.status(400).json({
          error: `Sección '${section.name}' tiene ${available} pregunta(s) disponible(s) (active + validated), pero se solicitaron ${entry.question_count}`,
        });
      }
    }

    const [session] = await db("sessions")
      .insert({ patient_id, professional_id })
      .returning("*");

    const sessionSectionsData = [];
    const sessionQuestionsData = [];

    for (let i = 0; i < sections.length; i++) {
      const entry = sections[i];

      const [sessionSection] = await db("session_sections")
        .insert({
          session_id: session.id,
          section_id: entry.section_id,
          requested_count: entry.question_count,
          display_order: i + 1,
        })
        .returning("*");

      const questions = await db("questions")
        .where({ section_id: entry.section_id, is_active: true, is_validated: true })
        .orderBy("id")
        .limit(entry.question_count)
        .select("id", "prompt", "response_type", "options", "correct_answer");

      for (let j = 0; j < questions.length; j++) {
        const q = questions[j];
        const [sq] = await db("session_questions")
          .insert({
            session_section_id: sessionSection.id,
            question_id: q.id,
            display_order: j + 1,
            prompt_snapshot: q.prompt,
            options_snapshot: JSON.stringify(q.options),
            correct_answer_snapshot: q.correct_answer,
            response_type: q.response_type,
          })
          .returning("*");
        sessionQuestionsData.push(sq);
      }

      sessionSectionsData.push({
        ...sessionSection,
        questions: sessionQuestionsData.filter(
          (sq) => sq.session_section_id === sessionSection.id
        ),
      });
    }

    res.status(201).json({
      ...session,
      sections: sessionSectionsData,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/sessions/:id", async (req, res, next) => {
  try {
    const sessionId = Number(req.params.id);
    if (!Number.isFinite(sessionId) || sessionId < 1) {
      return res.status(400).json({ error: "ID de sesión inválido" });
    }

    const session = await db("sessions").where("id", sessionId).first();
    if (!session) {
      return res.status(404).json({ error: "Sesión no encontrada" });
    }

    const sessionSections = await db("session_sections")
      .where("session_id", sessionId)
      .orderBy("display_order")
      .select("*");

    for (const ss of sessionSections) {
      ss.questions = await db("session_questions")
        .where("session_section_id", ss.id)
        .orderBy("display_order")
        .select("*");
    }

    res.json({ ...session, sections: sessionSections });
  } catch (err) {
    next(err);
  }
});

router.post("/sessions/:id/start", async (req, res, next) => {
  try {
    const sessionId = Number(req.params.id);
    if (!Number.isFinite(sessionId) || sessionId < 1) {
      return res.status(400).json({ error: "ID de sesión inválido" });
    }

    const session = await db("sessions").where("id", sessionId).first();
    if (!session) {
      return res.status(404).json({ error: "Sesión no encontrada" });
    }

    if (session.status !== "created") {
      return res.status(400).json({
        error: `No se puede iniciar una sesión en estado '${session.status}'`,
      });
    }

    const [updated] = await db("sessions")
      .where("id", sessionId)
      .update({ status: "in_progress", started_at: db.fn.now() })
      .returning("*");

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.post("/sessions/:id/answers", async (req, res, next) => {
  try {
    const sessionId = Number(req.params.id);
    if (!Number.isFinite(sessionId) || sessionId < 1) {
      return res.status(400).json({ error: "ID de sesión inválido" });
    }

    const session = await db("sessions").where("id", sessionId).first();
    if (!session) {
      return res.status(404).json({ error: "Sesión no encontrada" });
    }

    if (session.status !== "in_progress") {
      return res.status(400).json({
        error: `No se puede responder en una sesión en estado '${session.status}'`,
      });
    }

    const { session_question_id, selected_answer, response_time_ms } = req.body;

    if (session_question_id == null || selected_answer == null || response_time_ms == null) {
      return res.status(400).json({
        error: "session_question_id, selected_answer y response_time_ms son obligatorios",
      });
    }

    if (!Number.isInteger(response_time_ms) || response_time_ms <= 0) {
      return res.status(400).json({
        error: "response_time_ms debe ser un entero positivo",
      });
    }

    const sq = await db("session_questions as sq")
      .join("session_sections as ss", "sq.session_section_id", "ss.id")
      .where("sq.id", session_question_id)
      .where("ss.session_id", sessionId)
      .select("sq.*")
      .first();

    if (!sq) {
      return res.status(404).json({
        error: "Pregunta no encontrada en esta sesión",
      });
    }

    const existingAnswer = await db("answers")
      .where("session_question_id", session_question_id)
      .first();

    if (existingAnswer) {
      return res.status(409).json({
        error: "Esta pregunta ya fue respondida",
      });
    }

    const options = sq.options_snapshot;
    if (!Number.isInteger(selected_answer) || selected_answer < 0 || selected_answer >= options.length) {
      return res.status(400).json({
        error: `selected_answer debe ser un índice válido (0-${options.length - 1})`,
      });
    }

    const isCorrect = selected_answer === sq.correct_answer_snapshot;

    const [answer] = await db("answers")
      .insert({
        session_question_id,
        selected_answer,
        is_correct: isCorrect,
        response_time_ms,
      })
      .returning("*");

    res.status(201).json(answer);
  } catch (err) {
    next(err);
  }
});

router.post("/sessions/:id/complete", async (req, res, next) => {
  try {
    const sessionId = Number(req.params.id);
    if (!Number.isFinite(sessionId) || sessionId < 1) {
      return res.status(400).json({ error: "ID de sesión inválido" });
    }

    const session = await db("sessions").where("id", sessionId).first();
    if (!session) {
      return res.status(404).json({ error: "Sesión no encontrada" });
    }

    if (session.status !== "in_progress") {
      return res.status(400).json({
        error: `No se puede completar una sesión en estado '${session.status}'`,
      });
    }

    const updated = await db.transaction(async (trx) => {
      const sessionSections = await trx("session_sections")
        .where("session_id", sessionId)
        .select("id", "section_id");

      const allSessionQuestions = [];
      const allAnswers = [];

      for (const ss of sessionSections) {
        const sqs = await trx("session_questions")
          .where("session_section_id", ss.id)
          .select("id");

        const sqIds = sqs.map((s) => s.id);

        const answers =
          sqIds.length > 0
            ? await trx("answers")
                .whereIn("session_question_id", sqIds)
                .select("is_correct", "response_time_ms")
            : [];

        allSessionQuestions.push(...sqs);
        allAnswers.push(...answers);

        const sectionMetrics = calculateMetrics(sqs, answers);
        await trx("session_results").insert({
          session_id: sessionId,
          section_id: ss.section_id,
          ...sectionMetrics,
        });
      }

      const globalMetrics = calculateMetrics(allSessionQuestions, allAnswers);
      await trx("session_results").insert({
        session_id: sessionId,
        section_id: null,
        ...globalMetrics,
      });

      const [updatedSession] = await trx("sessions")
        .where("id", sessionId)
        .update({ status: "completed", completed_at: trx.fn.now() })
        .returning("*");

      return updatedSession;
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.post("/sessions/:id/abandon", async (req, res, next) => {
  try {
    const sessionId = Number(req.params.id);
    if (!Number.isFinite(sessionId) || sessionId < 1) {
      return res.status(400).json({ error: "ID de sesión inválido" });
    }

    const session = await db("sessions").where("id", sessionId).first();
    if (!session) {
      return res.status(404).json({ error: "Sesión no encontrada" });
    }

    if (session.status !== "created" && session.status !== "in_progress") {
      return res.status(400).json({
        error: `No se puede abandonar una sesión en estado '${session.status}'`,
      });
    }

    const [updated] = await db("sessions")
      .where("id", sessionId)
      .update({ status: "abandoned", abandoned_at: db.fn.now() })
      .returning("*");

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.get("/sessions/:id/results", async (req, res, next) => {
  try {
    const sessionId = Number(req.params.id);
    if (!Number.isFinite(sessionId) || sessionId < 1) {
      return res.status(400).json({ error: "ID de sesión inválido" });
    }

    const session = await db("sessions").where("id", sessionId).first();
    if (!session) {
      return res.status(404).json({ error: "Sesión no encontrada" });
    }

    if (session.status !== "completed") {
      return res.status(400).json({
        error: "Los resultados solo están disponibles para sesiones completadas",
      });
    }

    const globalResult = await db("session_results")
      .where({ session_id: sessionId })
      .whereNull("section_id")
      .first();

    const sectionResults = await db("session_results as sr")
      .join("sections as s", "sr.section_id", "s.id")
      .where("sr.session_id", sessionId)
      .whereNotNull("sr.section_id")
      .orderBy("s.display_order")
      .select(
        "sr.*",
        "s.name as section_name",
        "s.slug as section_slug"
      );

    res.json({
      session_id: sessionId,
      status: session.status,
      started_at: session.started_at,
      completed_at: session.completed_at,
      global: parseNumericFields(globalResult),
      sections: sectionResults.map(parseNumericFields),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
