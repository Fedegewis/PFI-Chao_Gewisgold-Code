export async function up(knex) {
  await knex.schema.createTable("sections", (table) => {
    table.increments("id").primary();
    table.string("slug", 60).notNullable().unique();
    table.string("name", 120).notNullable();
    table.text("description");
    table.string("cognitive_domain", 120);
    table.boolean("is_active").notNullable().defaultTo(true);
    table.integer("display_order").notNullable().defaultTo(0);
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("questions", (table) => {
    table.increments("id").primary();
    table
      .integer("section_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("sections")
      .onDelete("RESTRICT");
    table.text("prompt").notNullable();
    table
      .enum("response_type", ["multiple_choice", "likert", "open_short"])
      .notNullable()
      .defaultTo("multiple_choice");
    table.jsonb("options");
    table.smallint("correct_answer");
    table.smallint("scoring_value");
    table.smallint("difficulty").defaultTo(1);
    table.text("feedback_correct");
    table.text("feedback_incorrect");
    table.text("clinician_note");
    table.string("source", 120);
    table.boolean("is_active").notNullable().defaultTo(false);
    table.boolean("is_validated").notNullable().defaultTo(false);
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.raw(
    "CREATE INDEX idx_questions_section_active ON questions (section_id) WHERE is_active = true"
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists("questions");
  await knex.schema.dropTableIfExists("sections");
}
