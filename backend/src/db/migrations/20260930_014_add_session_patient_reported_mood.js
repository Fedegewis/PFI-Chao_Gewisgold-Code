// Snapshot inmutable del estado de ánimo autorreportado por el paciente al
// momento de iniciar la sesión. Nullable → sesiones históricas quedan en NULL
// sin backfill. CHECK constraint a nivel DB para rechazar valores inesperados
// aunque algún camino alternativo bypasee la validación de la capa de app.
export async function up(knex) {
  await knex.schema.alterTable("sessions", (table) => {
    table.string("patient_reported_mood", 20);
  });
  await knex.schema.raw(
    "ALTER TABLE sessions ADD CONSTRAINT chk_sessions_patient_reported_mood " +
    "CHECK (patient_reported_mood IS NULL OR patient_reported_mood IN " +
    "('alegria','bien','calma','cansancio','tristeza'))"
  );
}

export async function down(knex) {
  await knex.schema.raw(
    "ALTER TABLE sessions DROP CONSTRAINT IF EXISTS chk_sessions_patient_reported_mood"
  );
  await knex.schema.alterTable("sessions", (table) => {
    table.dropColumn("patient_reported_mood");
  });
}
