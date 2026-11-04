// Mecanismo adaptativo de dificultad (v1): snapshots inmutables por sesión.
//
// - session_sections.adaptive_level     nivel (1-3) con el que se armó la
//                                       actividad dentro de la sesión.
// - session_sections.adaptive_decision  traza de la decisión (regla aplicada,
//                                       evidencia usada, cuotas y mezcla real).
// - session_sections.adaptive_version   versión del algoritmo que decidió.
// - session_questions.difficulty_snapshot  dificultad de la pregunta al momento
//                                       de crear la sesión (questions.difficulty
//                                       es editable; el snapshot no).
//
// Todas las columnas son NULLABLE y sin default: en PostgreSQL agregar una
// columna así es una operación de metadatos (no reescribe la tabla). Las
// sesiones históricas quedan en NULL y el mecanismo las ignora como evidencia.
export async function up(knex) {
  await knex.schema.alterTable("session_sections", (table) => {
    table.smallint("adaptive_level");
    table.jsonb("adaptive_decision");
    table.string("adaptive_version", 20);
  });
  await knex.schema.raw(
    "ALTER TABLE session_sections ADD CONSTRAINT chk_session_sections_adaptive_level " +
    "CHECK (adaptive_level IS NULL OR adaptive_level BETWEEN 1 AND 3)"
  );
  await knex.schema.alterTable("session_questions", (table) => {
    table.smallint("difficulty_snapshot");
  });
  await knex.schema.raw(
    "ALTER TABLE session_questions ADD CONSTRAINT chk_session_questions_difficulty_snapshot " +
    "CHECK (difficulty_snapshot IS NULL OR difficulty_snapshot BETWEEN 1 AND 3)"
  );
}

export async function down(knex) {
  await knex.schema.raw(
    "ALTER TABLE session_questions DROP CONSTRAINT IF EXISTS chk_session_questions_difficulty_snapshot"
  );
  await knex.schema.alterTable("session_questions", (table) => {
    table.dropColumn("difficulty_snapshot");
  });
  await knex.schema.raw(
    "ALTER TABLE session_sections DROP CONSTRAINT IF EXISTS chk_session_sections_adaptive_level"
  );
  await knex.schema.alterTable("session_sections", (table) => {
    table.dropColumn("adaptive_version");
    table.dropColumn("adaptive_decision");
    table.dropColumn("adaptive_level");
  });
}
