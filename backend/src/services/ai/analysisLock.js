// 7J.1B — Serialización de generaciones de análisis concurrentes.
//
// Motivo: dos POST /api/sessions/:id/analysis casi simultáneos podían ambos
// atravesar el cache lookup con miss y disparar dos inferencias Ollama en
// paralelo para la misma (session, model, schema, prompt). En CPU esto
// duplica ~60–120 s de trabajo y puede producir dos filas `status="ok"`
// prácticamente idénticas.
//
// Solución mínima: pg_advisory_lock por (session_id, hash(identity)) sobre
// una conexión dedicada del pool. Sin transacciones abiertas durante la
// inferencia. La liberación está garantizada en `finally`, incluso ante
// excepción del pipeline; si `pg_advisory_unlock` falla, la conexión se
// destruye en lugar de devolverse al pool para evitar arrastrar el lock a
// futuros requests (los advisory locks son session-scoped y se liberan
// automáticamente al cerrar la conexión).
//
// La identidad del lock NO incluye `force`: dos `force=true` simultáneos
// deben serializarse para evitar dos inferencias innecesarias. El re-check
// interno del service decide si reutilizar el resultado del primero.

import crypto from "node:crypto";
import db from "../../db/connection.js";

// Advertencia: pg_advisory_lock acepta int8 o (int4, int4). Elegimos la
// variante (int4, int4). key1 = session_id (encaja en int4 en la práctica);
// key2 = hash SHA-256 de la identidad del análisis, truncado a int32 con
// signo. Distintas identidades colisionan solo por hash colisión — la
// serialización sería innecesariamente amplia entonces, no incorrecta.
export function buildAnalysisLockKey({ sessionId, model, schemaVersion, promptVersion }) {
  if (!Number.isInteger(sessionId) || sessionId < 1) {
    throw new TypeError("sessionId inválido");
  }
  if (typeof model !== "string" || model.length === 0) {
    throw new TypeError("model requerido");
  }
  if (typeof schemaVersion !== "string" || schemaVersion.length === 0) {
    throw new TypeError("schemaVersion requerido");
  }
  if (typeof promptVersion !== "string" || promptVersion.length === 0) {
    throw new TypeError("promptVersion requerido");
  }
  const composite = `model=${model}|schema=${schemaVersion}|prompt=${promptVersion}`;
  const digest = crypto.createHash("sha256").update(composite).digest();
  // readInt32BE devuelve valor con signo en el rango de int4 de PostgreSQL.
  const key2 = digest.readInt32BE(0);
  return { key1: sessionId, key2 };
}

/**
 * Ejecuta `fn` dentro de un pg_advisory_lock exclusivo por identidad de
 * análisis. Bloqueante: si otro request tiene el lock, esta llamada espera
 * hasta que se libere antes de correr `fn`.
 *
 * Contrato:
 * - Adquiere conexión dedicada del pool.
 * - Toma el lock.
 * - Ejecuta `fn()` — el pipeline puede tardar minutos.
 * - Libera el lock en finally.
 * - Devuelve/destruye la conexión al pool.
 *
 * @param {object} identity  Salida de buildAnalysisLockKey pero pasando los
 *                           campos originales (sessionId, model, schemaVersion, promptVersion).
 * @param {() => Promise<T>} fn  Trabajo a serializar bajo el lock.
 * @param {object} [deps]  Inyección para tests (db).
 * @returns {Promise<T>}   Lo que devuelva fn.
 */
export async function withAnalysisLock(identity, fn, deps = {}) {
  const dbHandle = deps.db || db;
  const { key1, key2 } = buildAnalysisLockKey(identity);

  const conn = await dbHandle.client.acquireConnection();
  let connectionDestroyed = false;
  try {
    await conn.query("SELECT pg_advisory_lock($1, $2)", [key1, key2]);
    try {
      return await fn();
    } finally {
      // Liberación explícita del lock. Si `pg_advisory_unlock` falla, la
      // conexión queda con un lock huérfano; forzamos su destrucción para
      // que el pool no la reutilice. Los advisory locks son session-scoped
      // y se liberan al cerrarse la conexión.
      try {
        await conn.query("SELECT pg_advisory_unlock($1, $2)", [key1, key2]);
      } catch (unlockErr) {
        // No re-lanzamos desde este `finally`: si `fn()` ya lanzó una
        // excepción, esa es la que interesa al caller. Marcamos la conexión
        // como rota y forzamos su destrucción para que el pool no la
        // reutilice con un lock huérfano.
        connectionDestroyed = true;
        try {
          await dbHandle.client.releaseConnection(conn, unlockErr);
        } catch {
          /* release con error no propaga; solo asegura no reintroducir la conexión al pool */
        }
      }
    }
  } finally {
    if (!connectionDestroyed) {
      try {
        await dbHandle.client.releaseConnection(conn);
      } catch {
        /* release al pool no debe enmascarar excepciones del pipeline */
      }
    }
  }
}
