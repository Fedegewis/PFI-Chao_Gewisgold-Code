export async function up(knex) {
  await knex.schema.createTable("cognitive_domains", (table) => {
    table.increments("id").primary();
    table.string("slug", 60).notNullable().unique();
    table.string("name", 120).notNullable();
  });

  await knex("cognitive_domains").insert([
    { slug: "memoria", name: "Memoria" },
    { slug: "atencion", name: "Atención" },
    { slug: "funciones_ejecutivas", name: "Funciones ejecutivas" },
    { slug: "orientacion", name: "Orientación" },
    { slug: "comprension_lenguaje", name: "Comprensión y lenguaje" },
  ]);

  await knex.schema.createTable("question_cognitive_domains", (table) => {
    table
      .integer("question_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("questions")
      .onDelete("CASCADE");
    table
      .integer("cognitive_domain_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("cognitive_domains")
      .onDelete("RESTRICT");
    table.primary(["question_id", "cognitive_domain_id"]);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists("question_cognitive_domains");
  await knex.schema.dropTableIfExists("cognitive_domains");
}
