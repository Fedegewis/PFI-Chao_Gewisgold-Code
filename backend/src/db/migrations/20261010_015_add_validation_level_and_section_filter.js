// F1 (validación técnica) + F2 (filtro por actividades/secciones).
//
// Cambios NO destructivos:
//   - questions.validation_level TEXT NULL
//     ∈ {NULL, 'technical', 'clinical'}
//     - NULL = pendiente (comportamiento previo cuando is_validated=false).
//     - 'technical' = revisión técnica automatizada superada.
//     - 'clinical'  = validación clínica profesional (reservado; no se asigna
//        automáticamente en este cambio).
//     is_validated se preserva tal cual (no se toca ninguna fila). El selector
//     considera elegibles las preguntas con is_validated=true O
//     validation_level IS NOT NULL (ver questionEligibility).
//
//   - users.active_section_slugs jsonb NULL
//     Subset opcional de section_slugs que el paciente puede iniciar. Un
//     paciente sin configurar queda con NULL = todas las secciones habilitadas
//     (fallback compatible con el estado previo).
//
// Ninguna columna existente se altera, ningún registro se modifica.
export async function up(knex) {
  await knex.schema.alterTable("questions", (table) => {
    table.text("validation_level");
  });

  await knex.schema.raw(
    "ALTER TABLE questions ADD CONSTRAINT chk_questions_validation_level " +
    "CHECK (validation_level IS NULL OR validation_level IN ('technical','clinical'))"
  );

  await knex.schema.alterTable("users", (table) => {
    table.jsonb("active_section_slugs");
  });
}

export async function down(knex) {
  await knex.schema.alterTable("users", (table) => {
    table.dropColumn("active_section_slugs");
  });
  await knex.schema.raw(
    "ALTER TABLE questions DROP CONSTRAINT IF EXISTS chk_questions_validation_level"
  );
  await knex.schema.alterTable("questions", (table) => {
    table.dropColumn("validation_level");
  });
}
