// W-1: autenticación exclusiva del worker local.
//
// NO reutiliza JWT_SECRET. El worker usa un secreto compartido independiente
// (WORKER_TOKEN) de longitud ≥ 32 chars. Esto garantiza:
//   - Compromiso del JWT_SECRET no habilita acceso al worker (y viceversa).
//   - Rotación independiente.
//   - Autorización no vinculada a identidades de profesional/paciente —
//     el worker es un sistema, no un usuario.
//
// Comparación en tiempo constante (timingSafeEqual) para evitar
// side-channel que permita adivinar prefijos del token.
//
// Carga el token desde process.env en cada request para que:
//   - los tests puedan setearlo/removerlo por caso sin reimportar;
//   - una rotación del secreto en Render no requiera redeploy inmediato
//     siempre que el proceso recargue el env (reinicio del servicio).

import { timingSafeEqual, randomBytes } from "node:crypto";

const MIN_TOKEN_LENGTH = 32;

function readConfiguredToken() {
  const raw = process.env.WORKER_TOKEN;
  if (typeof raw !== "string") return null;
  if (raw.length < MIN_TOKEN_LENGTH) return null;
  return raw;
}

function extractBearer(headerValue) {
  if (typeof headerValue !== "string") return null;
  if (!headerValue.startsWith("Bearer ")) return null;
  const token = headerValue.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

// Comparación en tiempo constante tolerante a longitudes distintas.
// timingSafeEqual exige buffers del mismo largo; para evitar early-return
// según el tamaño del header, siempre comparamos buffers de longitud fija
// (la del token configurado, con el presentado paddeado o truncado a esa
// longitud). El resultado es "equal" solo si los contenidos coinciden Y
// las longitudes originales coinciden.
function constantTimeStringEqual(a, b) {
  const bufA = Buffer.from(String(a), "utf8");
  const bufB = Buffer.from(String(b), "utf8");
  const len = Math.max(bufA.length, bufB.length, 1);
  const padA = Buffer.alloc(len);
  const padB = Buffer.alloc(len);
  bufA.copy(padA);
  bufB.copy(padB);
  const bytesEqual = timingSafeEqual(padA, padB);
  const lengthsEqual = bufA.length === bufB.length;
  return bytesEqual && lengthsEqual;
}

/**
 * Middleware Express. Si pasa, deja req.worker = { authenticated: true }.
 * Nunca loggea el token (ni el presentado ni el configurado).
 */
export function requireWorkerToken(req, res, next) {
  const configured = readConfiguredToken();
  if (!configured) {
    // El servidor no fue iniciado con un WORKER_TOKEN válido. Rechazar
    // en lugar de fallar abierto: la cola queda inoperable hasta setearlo.
    return res.status(503).json({
      error: "El worker de análisis no está configurado en este servidor",
      status: "worker_disabled",
    });
  }
  const presented = extractBearer(req.headers?.authorization);
  if (!presented) {
    return res.status(401).json({ error: "Token requerido" });
  }
  if (!constantTimeStringEqual(presented, configured)) {
    return res.status(401).json({ error: "Token inválido" });
  }
  req.worker = { authenticated: true };
  return next();
}

/**
 * Utilidad para tests y para el instalador del worker: genera un token
 * aleatorio recomendado (48 bytes, 64 chars hex). No se loggea; el caller
 * decide dónde guardarlo.
 */
export function generateWorkerToken() {
  return randomBytes(48).toString("hex");
}

export const WORKER_TOKEN_MIN_LENGTH = MIN_TOKEN_LENGTH;
