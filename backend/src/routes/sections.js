import { Router } from "express";
import db from "../db/connection.js";

const router = Router();

router.get("/sections", async (_req, res, next) => {
  try {
    const sections = await db("sections")
      .where("is_active", true)
      .orderBy("display_order")
      .select("id", "slug", "name", "description", "display_order");

    res.json(sections);
  } catch (err) {
    next(err);
  }
});

router.get("/sections/:id/questions", async (req, res, next) => {
  try {
    const sectionId = Number(req.params.id);
    if (!Number.isFinite(sectionId) || sectionId < 1) {
      return res.status(400).json({ error: "ID de sección inválido" });
    }

    const section = await db("sections").where("id", sectionId).first();
    if (!section) {
      return res.status(404).json({ error: "Sección no encontrada" });
    }

    const questions = await db("questions")
      .where({ section_id: sectionId, is_active: true })
      .orderBy("id")
      .select(
        "id",
        "prompt",
        "response_type",
        "options",
        "correct_answer",
        "scoring_value",
        "difficulty",
        "feedback_correct",
        "feedback_incorrect",
        "clinician_note",
        "source",
        "is_validated"
      );

    res.json({ section: { id: section.id, slug: section.slug, name: section.name }, questions });
  } catch (err) {
    next(err);
  }
});

export default router;
