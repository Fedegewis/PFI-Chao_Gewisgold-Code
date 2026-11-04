// F2 — enlaces de acceso de un solo uso para pacientes (acceso sin contraseña).
//
// Migración ADITIVA: crea una tabla nueva, no modifica `users` ni ninguna
// tabla existente. Pacientes y sesiones históricas no se tocan.
//
// - token_hash: SHA-256 (hex, 64 chars) del token aleatorio de 32 bytes. El
//   token en texto plano sólo existe en el correo enviado; nunca se persiste.
// - expires_at: el backend lo fija en created_at + 30 minutos. El CHECK impide
//   que un bug futuro emita enlaces de vida más larga.
// - consumed_at: se marca dentro de un UPDATE condicional (un solo statement)
//   → un token sólo puede consumirse una vez aunque lleguen dos requests a la vez.
// - invalidated_at: un enlace pendiente se invalida al pedir uno nuevo o al
//   desactivar allow_passwordless (E2).
// - ON DELETE CASCADE: al eliminar un paciente se eliminan sus enlaces.
export async function up(knex) {
  await knex.schema.createTable("patient_login_links", (table) => {
    table.bigIncrements("id").primary();
    table
      .integer("user_id")
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table.string("token_hash", 64).notNullable().unique();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("expires_at").notNullable();
    table.timestamp("consumed_at");
    table.timestamp("invalidated_at");
  });
  await knex.schema.raw(
    "ALTER TABLE patient_login_links ADD CONSTRAINT chk_patient_login_links_ttl " +
    "CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 minutes')"
  );
  await knex.schema.raw(
    "ALTER TABLE patient_login_links ADD CONSTRAINT chk_patient_login_links_token_hash " +
    "CHECK (token_hash ~ '^[0-9a-f]{64}$')"
  );
  // Enlaces pendientes por paciente (invalidación al emitir uno nuevo).
  await knex.schema.raw(
    "CREATE INDEX idx_patient_login_links_pending ON patient_login_links (user_id) " +
    "WHERE consumed_at IS NULL AND invalidated_at IS NULL"
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists("patient_login_links");
}
