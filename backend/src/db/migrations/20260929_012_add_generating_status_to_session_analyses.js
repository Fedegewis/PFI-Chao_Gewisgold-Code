// 7J.2: agrega el estado transitorio "generating" a session_analyses.
//
// Motivación: el análisis se dispara automáticamente después de completar
// una sesión (fire-and-forget). Un tercero (el profesional) puede consultar
// GET /api/sessions/:id/analysis mientras el pipeline está corriendo. Antes
// de 7J.2 solo existían ok/failed, sin representación del estado "en curso".
//
// Cambios:
// - Se relajan los CHECK constraints que existían desde 7F para admitir
//   status='generating' con analysis IS NULL, error_code IS NULL,
//   error_message IS NULL y latency_ms IS NULL.
// - Se preserva el shape original de ok y failed.
// - Ninguna fila existente se modifica: las filas históricas 226–231 tienen
//   status ok/failed y siguen cumpliendo el CHECK ampliado.
//
// Los nombres de constraint reutilizan los de 7F para poder volver atrás
// limpiamente.

const COL_CHECK_NAME = "session_analyses_status_check";
const OK_SHAPE_CHECK_NAME = "chk_session_analyses_ok_shape";

export async function up(knex) {
  // El nombre del column-level check que genera .checkIn depende de la
  // versión de knex; probamos ambos nombres razonables y también dropeamos
  // por nombre explícito si existiera. Envolvemos con IF EXISTS.
  await knex.schema.raw(
    `ALTER TABLE session_analyses DROP CONSTRAINT IF EXISTS ${COL_CHECK_NAME}`,
  );
  await knex.schema.raw(
    `ALTER TABLE session_analyses DROP CONSTRAINT IF EXISTS ${OK_SHAPE_CHECK_NAME}`,
  );

  // Nuevo CHECK combinado (columna + shape) que admite generating.
  //   status='ok'         -> analysis NOT NULL, error_code NULL, error_message NULL
  //   status='failed'     -> analysis NULL,     error_code NOT NULL
  //   status='generating' -> analysis NULL,     error_code NULL, error_message NULL, latency_ms NULL
  await knex.schema.raw(
    `ALTER TABLE session_analyses ADD CONSTRAINT ${OK_SHAPE_CHECK_NAME} CHECK (` +
      `(status = 'ok' AND analysis IS NOT NULL AND error_code IS NULL AND error_message IS NULL) ` +
      `OR ` +
      `(status = 'failed' AND analysis IS NULL AND error_code IS NOT NULL) ` +
      `OR ` +
      `(status = 'generating' AND analysis IS NULL AND error_code IS NULL AND error_message IS NULL AND latency_ms IS NULL)` +
      `)`,
  );

  await knex.schema.raw(
    `ALTER TABLE session_analyses ADD CONSTRAINT ${COL_CHECK_NAME} ` +
      `CHECK (status IN ('ok', 'failed', 'generating'))`,
  );
}

export async function down(knex) {
  // Rollback: convierte cualquier fila generating a failed antes de restaurar
  // el CHECK original que no admite generating.
  await knex("session_analyses")
    .where({ status: "generating" })
    .update({
      status: "failed",
      error_code: "ANALYSIS_GENERATING_INTERRUPTED",
      error_message: "Rollback: se cambió una fila generating pendiente a failed",
    });

  await knex.schema.raw(
    `ALTER TABLE session_analyses DROP CONSTRAINT IF EXISTS ${COL_CHECK_NAME}`,
  );
  await knex.schema.raw(
    `ALTER TABLE session_analyses DROP CONSTRAINT IF EXISTS ${OK_SHAPE_CHECK_NAME}`,
  );
  await knex.schema.raw(
    `ALTER TABLE session_analyses ADD CONSTRAINT ${OK_SHAPE_CHECK_NAME} CHECK (` +
      `(status = 'ok' AND analysis IS NOT NULL AND error_code IS NULL AND error_message IS NULL) ` +
      `OR ` +
      `(status = 'failed' AND analysis IS NULL AND error_code IS NOT NULL)` +
      `)`,
  );
  await knex.schema.raw(
    `ALTER TABLE session_analyses ADD CONSTRAINT ${COL_CHECK_NAME} ` +
      `CHECK (status IN ('ok', 'failed'))`,
  );
}
