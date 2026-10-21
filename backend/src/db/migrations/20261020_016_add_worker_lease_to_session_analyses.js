// W-1/W-2: campos de lease + reintentos para el worker local de Ollama.
//
// Motivo (ver auditoría W-1/W-2):
//
// El worker local toma trabajos de "cola" (sesiones completed sin análisis
// ok para la triple actual model+schema+prompt). Para que:
//   - dos workers no procesen la misma sesión al mismo tiempo;
//   - un worker que se cae no deje la sesión bloqueada indefinidamente;
//   - un worker viejo no pueda sobrescribir el resultado de uno nuevo;
//   - no haya bucles infinitos de intentos que agoten CPU en Ollama;
// necesitamos un lease con expiración y un token de propiedad del claim,
// más un contador observacional de intentos.
//
// Campos agregados a session_analyses:
//   - lease_expires_at (TIMESTAMPTZ, nullable). Sólo tiene sentido cuando
//     status='generating'. El worker renueva o entrega resultado antes de
//     esta fecha. Pasado ese instante, la fila es "huérfana" y la queue
//     puede volver a reclamar la sesión.
//   - claim_token (VARCHAR 64, nullable). UUID aleatorio emitido en /claim.
//     El worker lo devuelve en /result y /failed. El UPDATE server-side
//     exige el token exacto; evita que un worker viejo "pise" al nuevo.
//   - attempt_count (INTEGER NOT NULL DEFAULT 0). Cuántos intentos previos
//     tuvo este análisis para la misma sesión y triple. Observacional: el
//     corte real de reintentos se calcula en runtime via COUNT(failed).
//
// Compatibilidad:
//   - Las filas existentes (ok/failed/generating históricas) tienen
//     lease_expires_at=NULL, claim_token=NULL, attempt_count=0 — valores
//     perfectamente válidos. Ninguna fila se modifica.
//   - El CHECK constraint de la migración 012 (ok/failed/generating shape)
//     no menciona estos campos, por lo que no requiere ajuste.
//   - El pipeline in-process actual (analysisService.generateSessionAnalysis
//     + ollamaClient) sigue funcionando sin cambios: ignora estos campos.
//
// Índices:
//   - idx_session_analyses_queue_lookup: acelera la query de pendientes
//     que filtra por status y model+schema+prompt. Es parcial sobre
//     status IN ('ok','generating','failed') (que es cualquier fila
//     persistida; equivale a un índice regular pero deja explícito el uso).

export async function up(knex) {
  await knex.schema.alterTable("session_analyses", (table) => {
    table.timestamp("lease_expires_at", { useTz: true });
    table.string("claim_token", 64);
    table.integer("attempt_count").notNullable().defaultTo(0);
  });

  // Índice compuesto para que el WHERE del queue descubra rápido
  // qué filas vigentes existen para una (session_id, model, schema, prompt).
  await knex.schema.raw(
    "CREATE INDEX idx_session_analyses_queue_lookup " +
    "ON session_analyses (session_id, model, schema_version, prompt_version, status)"
  );

  // Índice para localizar leases activos/vencidos sin recorrer la tabla.
  await knex.schema.raw(
    "CREATE INDEX idx_session_analyses_lease_expires " +
    "ON session_analyses (lease_expires_at) WHERE lease_expires_at IS NOT NULL"
  );
}

export async function down(knex) {
  await knex.schema.raw("DROP INDEX IF EXISTS idx_session_analyses_lease_expires");
  await knex.schema.raw("DROP INDEX IF EXISTS idx_session_analyses_queue_lookup");
  await knex.schema.alterTable("session_analyses", (table) => {
    table.dropColumn("attempt_count");
    table.dropColumn("claim_token");
    table.dropColumn("lease_expires_at");
  });
}
