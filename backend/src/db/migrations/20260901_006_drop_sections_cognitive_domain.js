export async function up(knex) {
  await knex.schema.alterTable("sections", (table) => {
    table.dropColumn("cognitive_domain");
  });
}

export async function down(knex) {
  await knex.schema.alterTable("sections", (table) => {
    table.string("cognitive_domain", 120);
  });
}
