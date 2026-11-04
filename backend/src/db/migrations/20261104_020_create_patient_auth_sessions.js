// F3 — sesiones persistentes y revocables de pacientes (cookie HttpOnly).
//
// Migración ADITIVA: tabla nueva. Los JWT existentes (login con contraseña,
// profesionales, Google) no se ven afectados: son stateless y siguen igual.
//
// Datos mínimos: no se guarda IP, user-agent ni el token en claro.
// - token_hash: SHA-256 del token actual de la cookie.
// - previous_token_hash + rotated_at: el token se rota periódicamente; el hash
//   anterior se acepta sólo durante una ventana corta después de rotar (dos
//   pestañas que restauran la sesión a la vez no se desloguean entre sí).
// - expires_at: vencimiento ABSOLUTO (created_at + 30 días). La rotación no lo
//   extiende; el CHECK impide superar 30 días.
// - revoked_at / revoked_reason: logout, logout de todos los dispositivos,
//   revocación por el profesional, o desactivación de allow_passwordless (E2).
export async function up(knex) {
  await knex.schema.createTable("patient_auth_sessions", (table) => {
    table.bigIncrements("id").primary();
    table
      .integer("user_id")
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table.string("token_hash", 64).notNullable().unique();
    table.string("previous_token_hash", 64);
    table.timestamp("rotated_at");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("expires_at").notNullable();
    table.timestamp("last_used_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("revoked_at");
    table.string("revoked_reason", 40);
  });
  await knex.schema.raw(
    "ALTER TABLE patient_auth_sessions ADD CONSTRAINT chk_patient_auth_sessions_ttl " +
    "CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 days')"
  );
  await knex.schema.raw(
    "ALTER TABLE patient_auth_sessions ADD CONSTRAINT chk_patient_auth_sessions_revoked_reason " +
    "CHECK (revoked_reason IS NULL OR revoked_reason IN " +
    "('logout', 'logout_all', 'professional_revoked', 'passwordless_disabled', 'user_inactive'))"
  );
  await knex.schema.raw(
    "CREATE INDEX idx_patient_auth_sessions_previous ON patient_auth_sessions (previous_token_hash) " +
    "WHERE previous_token_hash IS NOT NULL"
  );
  await knex.schema.raw(
    "CREATE INDEX idx_patient_auth_sessions_active ON patient_auth_sessions (user_id) " +
    "WHERE revoked_at IS NULL"
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists("patient_auth_sessions");
}
