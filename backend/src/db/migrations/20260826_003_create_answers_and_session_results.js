export async function up(knex) {
  await knex.schema.createTable("answers", (table) => {
    table.increments("id").primary();
    table
      .integer("session_question_id")
      .unsigned()
      .notNullable()
      .unique()
      .references("id")
      .inTable("session_questions")
      .onDelete("CASCADE");
    table.smallint("selected_answer").notNullable();
    table.boolean("is_correct");
    table.integer("response_time_ms").notNullable();
    table.timestamp("answered_at").notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.raw(
    "ALTER TABLE answers ADD CONSTRAINT chk_response_time_positive CHECK (response_time_ms > 0)"
  );

  await knex.schema.createTable("session_results", (table) => {
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
      .references("id")
      .inTable("sections")
      .onDelete("RESTRICT");
    table.smallint("total_questions").notNullable();
    table.smallint("answered_questions").notNullable();
    table.smallint("correct_count").notNullable();
    table.smallint("incorrect_count").notNullable();
    table.smallint("unanswered_count").notNullable();
    table.decimal("accuracy", 5, 4);
    table.decimal("completion_rate", 5, 4).notNullable();
    table.decimal("mean_latency_ms", 10, 2);
    table.integer("min_latency_ms");
    table.integer("max_latency_ms");
    table.decimal("latency_std_ms", 10, 2);
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.raw(
    "CREATE UNIQUE INDEX idx_session_results_global ON session_results (session_id) WHERE section_id IS NULL"
  );
  await knex.schema.raw(
    "CREATE UNIQUE INDEX idx_session_results_section ON session_results (session_id, section_id) WHERE section_id IS NOT NULL"
  );

  await knex.schema.alterTable("sessions", (table) => {
    table.timestamp("abandoned_at");
  });
}

export async function down(knex) {
  await knex.schema.alterTable("sessions", (table) => {
    table.dropColumn("abandoned_at");
  });
  await knex.schema.dropTableIfExists("session_results");
  await knex.schema.dropTableIfExists("answers");
}
