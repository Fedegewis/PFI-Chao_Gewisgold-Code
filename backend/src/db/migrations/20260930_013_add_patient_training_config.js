// Configuración de entrenamiento por paciente (Etapa question-bank / IA integration).
// Ambas columnas nullable → pacientes existentes conservan comportamiento previo
// (fallback: max_questions=4, sin filtro de dominios). NO se hace UPDATE masivo.
export async function up(knex) {
  await knex.schema.alterTable("users", (table) => {
    table.smallint("max_questions");
    table.jsonb("active_domain_slugs");
  });

  await knex.schema.raw(
    "ALTER TABLE users ADD CONSTRAINT chk_users_max_questions " +
    "CHECK (max_questions IS NULL OR (max_questions BETWEEN 1 AND 10))"
  );
}

export async function down(knex) {
  await knex.schema.raw(
    "ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_max_questions"
  );
  await knex.schema.alterTable("users", (table) => {
    table.dropColumn("active_domain_slugs");
    table.dropColumn("max_questions");
  });
}
