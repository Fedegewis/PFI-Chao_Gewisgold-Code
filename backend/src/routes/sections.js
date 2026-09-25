import { Router } from "express";
import db from "../db/connection.js";
import { requireAuth } from "../middleware/auth.js";

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

// 6E.1 (H2): requiere auth. NUNCA devuelve correct_answer ni campos que permitan
// inferirlo. El scoring server-side sigue haciéndose contra `questions.correct_answer`
// (no expuesto) o `session_questions.correct_answer_snapshot` durante la sesión real.
router.get("/sections/:id/questions", requireAuth, async (req, res, next) => {
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
        "stimulus",
        "response_type",
        "options",
        "difficulty",
        "subdimension",
        "source",
        "is_validated"
      );

    res.json({ section: { id: section.id, slug: section.slug, name: section.name }, questions });
  } catch (err) {
    next(err);
  }
});

export default router;
