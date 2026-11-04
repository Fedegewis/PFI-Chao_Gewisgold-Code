// F2 — contadores de rate limiting para solicitudes de enlace de acceso.
//
// Ventana fija por (scope, key_hash, window_start). Se persiste en PostgreSQL
// (no en memoria) para que el límite valga aunque Render reinicie o escale el
// proceso. key_hash es SHA-256 con un pepper del servidor: no se guardan
// emails (que podrían no corresponder a ningún usuario) ni IPs en claro.
// Las filas viejas se purgan de forma oportunista desde el backend.
export async function up(knex) {
  await knex.schema.createTable("auth_rate_limits", (table) => {
    table.string("scope", 40).notNullable();
    table.string("key_hash", 64).notNullable();
    table.timestamp("window_start").notNullable();
    table.integer("count").notNullable().defaultTo(0);
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    table.primary(["scope", "key_hash", "window_start"]);
  });
  await knex.schema.raw(
    "ALTER TABLE auth_rate_limits ADD CONSTRAINT chk_auth_rate_limits_count CHECK (count >= 0)"
  );
  await knex.schema.raw(
    "CREATE INDEX idx_auth_rate_limits_window ON auth_rate_limits (window_start)"
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists("auth_rate_limits");
}
