export async function up(knex) {
  await knex.schema.alterTable("users", (table) => {
    table.string("password_hash", 255);
  });
}

export async function down(knex) {
  await knex.schema.alterTable("users", (table) => {
    table.dropColumn("password_hash");
  });
}
