// F1 (acceso sin contraseña para pacientes): permiso individual que el
// profesional otorga a cada paciente.
//
// - BOOLEAN NOT NULL DEFAULT false: en PostgreSQL 11+ agregar una columna con
//   default constante es una operación de metadatos (no reescribe la tabla) y
//   todas las filas existentes quedan en false → los pacientes actuales
//   conservan exactamente su comportamiento (sólo contraseña).
// - Vive en `users` porque es un atributo del paciente, igual que
//   max_questions / active_domain_slugs (migración 013).
// - No toca password_hash ni ningún otro campo.
// - Por sí mismo NO habilita ningún método de autenticación: el flujo de
//   enlaces (F2) será el único consumidor de este flag.
// - Sólo tiene sentido para role='patient'. No se agrega CHECK por rol para
//   no condicionar a profesionales existentes; la API sólo lo expone/modifica
//   para pacientes propios del profesional autenticado.
export async function up(knex) {
  await knex.schema.alterTable("users", (table) => {
    table.boolean("allow_passwordless").notNullable().defaultTo(false);
  });
}

export async function down(knex) {
  await knex.schema.alterTable("users", (table) => {
    table.dropColumn("allow_passwordless");
  });
}
