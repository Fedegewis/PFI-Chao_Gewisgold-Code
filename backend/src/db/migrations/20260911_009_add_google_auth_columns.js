export async function up(knex) {
  await knex.schema.alterTable("users", (table) => {
    table.string("google_id", 255).unique();
    table.string("auth_provider", 50).defaultTo("local");
  });
}

export async function down(knex) {
  await knex.schema.alterTable("users", (table) => {
    table.dropColumn("google_id");
    table.dropColumn("auth_provider");
  });
}
