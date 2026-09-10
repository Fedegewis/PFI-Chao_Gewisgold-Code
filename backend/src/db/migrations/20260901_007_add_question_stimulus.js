export async function up(knex) {
  await knex.schema.alterTable("questions", (table) => {
    table.text("stimulus");
  });

  await knex.schema.alterTable("session_questions", (table) => {
    table.text("stimulus_snapshot");
  });
}

export async function down(knex) {
  await knex.schema.alterTable("session_questions", (table) => {
    table.dropColumn("stimulus_snapshot");
  });

  await knex.schema.alterTable("questions", (table) => {
    table.dropColumn("stimulus");
  });
}
