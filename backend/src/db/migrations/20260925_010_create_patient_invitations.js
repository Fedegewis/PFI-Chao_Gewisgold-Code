export async function up(knex) {
  await knex.schema.createTable("patient_invitations", (table) => {
    table.increments("id").primary();
    table
      .integer("professional_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("CASCADE");
    table.string("email", 254).notNullable();
    table.string("patient_name", 200).notNullable();
    table.smallint("age");
    table.string("token_hash", 64).notNullable().unique();
    table.timestamp("expires_at").notNullable();
    table.timestamp("accepted_at");
    table
      .integer("accepted_user_id")
      .unsigned()
      .references("id")
      .inTable("users")
      .onDelete("SET NULL");
    table.timestamp("revoked_at");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.raw(
    "CREATE INDEX idx_patient_invitations_professional ON patient_invitations (professional_id)"
  );
  await knex.schema.raw(
    "CREATE UNIQUE INDEX idx_patient_invitations_active_email " +
      "ON patient_invitations (professional_id, email) " +
      "WHERE accepted_at IS NULL AND revoked_at IS NULL"
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists("patient_invitations");
}
