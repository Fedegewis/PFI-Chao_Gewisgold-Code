import { Router } from "express";
import db from "../db/connection.js";

const router = Router();

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

export default router;
