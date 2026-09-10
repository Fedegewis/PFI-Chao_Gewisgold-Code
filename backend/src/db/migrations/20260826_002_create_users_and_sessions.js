export async function up(knex) {
  await knex.schema.createTable("users", (table) => {
    table.increments("id").primary();
    table
      .string("role", 20)
      .notNullable()
      .checkIn(["patient", "professional"]);
    table.string("name", 200).notNullable();
    table.string("email", 254).notNullable().unique();
    table.smallint("age");
    table
      .integer("professional_id")
      .unsigned()
      .references("id")
      .inTable("users")
      .onDelete("SET NULL");
    table.boolean("is_active").notNullable().defaultTo(true);
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.raw(
    "CREATE INDEX idx_users_professional ON users (professional_id) WHERE role = 'patient'"
  );

  await knex.schema.createTable("sessions", (table) => {
    table.increments("id").primary();
    table
      .integer("patient_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("RESTRICT");
    table
      .integer("professional_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("users")
      .onDelete("RESTRICT");
    table
      .string("status", 20)
      .notNullable()
      .defaultTo("created")
      .checkIn(["created", "in_progress", "completed", "abandoned"]);
    table.timestamp("started_at");
    table.timestamp("completed_at");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.raw(
    "CREATE INDEX idx_sessions_patient ON sessions (patient_id)"
  );
  await knex.schema.raw(
    "CREATE INDEX idx_sessions_status ON sessions (status) WHERE status NOT IN ('abandoned')"
  );

  await knex.schema.createTable("session_sections", (table) => {
    table.increments("id").primary();
    table
      .integer("session_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("sessions")
      .onDelete("CASCADE");
    table
      .integer("section_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("sections")
      .onDelete("RESTRICT");
    table.smallint("requested_count").notNullable();
    table.smallint("display_order").notNullable().defaultTo(1);
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.unique(["session_id", "section_id"]);
  });

  await knex.schema.raw(
    "ALTER TABLE session_sections ADD CONSTRAINT chk_requested_count CHECK (requested_count > 0)"
  );

  await knex.schema.createTable("session_questions", (table) => {
    table.increments("id").primary();
    table
      .integer("session_section_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("session_sections")
      .onDelete("CASCADE");
    table
      .integer("question_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("questions")
      .onDelete("RESTRICT");
    table.smallint("display_order").notNullable();
    table.text("prompt_snapshot").notNullable();
    table.jsonb("options_snapshot");
    table.smallint("correct_answer_snapshot");
    table.string("response_type", 30).notNullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.unique(["session_section_id", "question_id"]);
  });

  await knex.schema.raw(
    "CREATE INDEX idx_session_questions_section ON session_questions (session_section_id)"
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists("session_questions");
  await knex.schema.dropTableIfExists("session_sections");
  await knex.schema.dropTableIfExists("sessions");
  await knex.schema.dropTableIfExists("users");
}
