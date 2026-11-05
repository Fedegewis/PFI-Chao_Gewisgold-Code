import { generateToken } from "../src/middleware/auth.js";

export function authHeaderFor(user) {
  return `Bearer ${generateToken(user)}`;
}

/**
 * Agrega a un session_section una pregunta real con tipo (subdimension) y su
 * respuesta registrada. Desde el ajuste 3.6, una sesión sin ningún tipo de
 * pregunta con respuestas puntuadas no se envía al modelo (síntesis
 * determinística). Las sesiones reales siempre tienen respuestas y tipos (el
 * selector sólo usa preguntas con validation_level, que exige subdimension).
 */
export async function addAnsweredQuestion(db, { sessionSectionId, sectionId, isCorrect = true, responseTimeMs = 4200, displayOrder = 1 }) {
  const q = await db("questions")
    .where({ section_id: sectionId, is_active: true })
    .whereNotNull("subdimension")
    .orderBy("id")
    .first();
  if (!q) throw new Error(`No hay preguntas con subdimension en la sección ${sectionId}`);
  const [sq] = await db("session_questions")
    .insert({
      session_section_id: sessionSectionId, question_id: q.id, display_order: displayOrder,
      prompt_snapshot: q.prompt, options_snapshot: JSON.stringify(q.options),
      correct_answer_snapshot: q.correct_answer ?? 0, response_type: q.response_type,
    })
    .returning("*");
  const correct = q.correct_answer ?? 0;
  await db("answers").insert({
    session_question_id: sq.id,
    selected_answer: isCorrect ? correct : (correct + 1) % 4,
    is_correct: isCorrect,
    response_time_ms: responseTimeMs,
  });
  return { question: q, sessionQuestion: sq };
}
