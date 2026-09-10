export async function up(knex) {
  await knex.schema.alterTable("questions", (table) => {
    table.string("subdimension", 120).nullable();
  });
}

export async function down(knex) {
  await knex.schema.alterTable("questions", (table) => {
    table.dropColumn("subdimension");
  });
}
