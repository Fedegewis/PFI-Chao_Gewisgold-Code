// Pedido explícito de regeneración del análisis IA (modo deferred).
//
// sessions.analysis_regeneration_requested_at: momento en que el profesional
// pidió una síntesis nueva desde el panel ("Regenerar análisis" o
// "Reintentar") mientras el backend corre con AI_PROVIDER=deferred.
//
// La cola del worker (analysisQueue.findNextPendingSessionId) toma una sesión
// con un pedido pendiente aunque ya tenga un análisis ok, siempre que ese ok
// sea ANTERIOR al pedido. El pedido se considera atendido cuando aparece un
// análisis ok posterior; no hace falta limpiarlo. Los topes de intentos
// fallidos se cuentan desde el pedido, así que un pedido nuevo habilita un
// nuevo ciclo acotado de intentos.
//
// Columna NULLABLE sin default: operación de metadatos en PostgreSQL (no
// reescribe la tabla). Las sesiones existentes quedan en NULL y la cola se
// comporta exactamente como antes para ellas.
export async function up(knex) {
  await knex.schema.alterTable("sessions", (table) => {
    table.timestamp("analysis_regeneration_requested_at", { useTz: true });
  });
}

export async function down(knex) {
  await knex.schema.alterTable("sessions", (table) => {
    table.dropColumn("analysis_regeneration_requested_at");
  });
}
