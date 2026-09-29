// 7F: tabla session_analyses.
//
// - Historial de intentos IA por sesión (ok o failed). NO se aplica
//   UNIQUE(session_id) ni UNIQUE parcial WHERE status='ok': queremos
//   preservar regeneraciones con distinto model/prompt_version/schema_version.
// - session_id ON DELETE CASCADE: mismo criterio que session_results
//   (los análisis pertenecen a la sesión y no tienen sentido sin ella).
// - CHECK constraint (chk_session_analyses_ok_shape) enforcea las
//   invariantes ok/failed a nivel PostgreSQL, siguiendo el estilo de
//   chk_requested_count y chk_response_time_positive.

export async function up(knex) {
  await knex.schema.createTable("session_analyses", (table) => {
    table.increments("id").primary();
    table
      .integer("session_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("sessions")
      .onDelete("CASCADE");
    table
      .string("status", 20)
      .notNullable()
      .checkIn(["ok", "failed"]);
    table.string("error_code", 60);
    table.string("model", 120);
    table.string("schema_version", 20);
    table.string("prompt_version", 20);
    table.jsonb("analysis");
    table.integer("latency_ms");
    table.text("error_message");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
  });

  // Invariantes ok/failed a nivel base de datos (7F §4).
  //   status='ok'     -> analysis NOT NULL, error_code NULL, error_message NULL
  //   status='failed' -> analysis NULL,     error_code NOT NULL
  await knex.schema.raw(
    "ALTER TABLE session_analyses ADD CONSTRAINT chk_session_analyses_ok_shape CHECK (" +
      "(status = 'ok' AND analysis IS NOT NULL AND error_code IS NULL AND error_message IS NULL) " +
      "OR " +
      "(status = 'failed' AND analysis IS NULL AND error_code IS NOT NULL)" +
    ")"
  );

  await knex.schema.raw(
    "ALTER TABLE session_analyses ADD CONSTRAINT chk_session_analyses_latency_nonneg CHECK (latency_ms IS NULL OR latency_ms >= 0)"
  );

  // Índice para historial ordenado por sesión (consulta típica de 7G/7H).
  await knex.schema.raw(
    "CREATE INDEX idx_session_analyses_session_created ON session_analyses (session_id, created_at DESC)"
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists("session_analyses");
}
