// Exclusión de instancias duplicadas por lockfile.
//
// En Windows no tenemos named mutexes nativos sin addons. Usamos un
// lockfile con el PID del worker vivo. Al arrancar:
//   1) Intentar crear el lockfile exclusivamente (fs.openSync 'wx').
//   2) Si falla porque existe, leer el PID. Si está vivo, abortar.
//   3) Si el PID está muerto, el archivo quedó huérfano tras un crash:
//      reciclarlo (sobreescribir con nuestro PID).
//   4) Al salir (SIGINT/SIGTERM/exit), remover el lockfile.

import fs from "node:fs";
import path from "node:path";

export class SingleInstanceError extends Error {
  constructor(message, { lockFile, otherPid } = {}) {
    super(message);
    this.name = "SingleInstanceError";
    this.code = "WORKER_ALREADY_RUNNING";
    if (lockFile) this.lockFile = lockFile;
    if (otherPid) this.otherPid = otherPid;
  }
}

// Chequea si un PID está vivo en este sistema. Hace process.kill(pid, 0),
// que no mata nada; sólo retorna sin error si el proceso existe.
export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH: no existe. EPERM: existe pero no tenemos permisos — lo
    // consideramos vivo para no pisar un proceso ajeno.
    if (err.code === "EPERM") return true;
    return false;
  }
}

function readLockPid(lockPath) {
  try {
    const contents = fs.readFileSync(lockPath, "utf8").trim();
    const n = Number.parseInt(contents, 10);
    return Number.isInteger(n) ? n : null;
  } catch {
    return null;
  }
}

export function acquireLock({ lockFile, pid = process.pid, fsImpl = fs } = {}) {
  if (typeof lockFile !== "string" || lockFile.length === 0) {
    throw new TypeError("lockFile obligatorio");
  }
  const abs = path.resolve(lockFile);
  // Asegurar directorio padre.
  const parent = path.dirname(abs);
  try {
    fsImpl.mkdirSync(parent, { recursive: true });
  } catch { /* no-op */ }

  try {
    const fd = fsImpl.openSync(abs, "wx");
    fsImpl.writeSync(fd, String(pid));
    fsImpl.closeSync(fd);
    return { release: () => safeUnlink(abs, fsImpl), lockFile: abs };
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    // Lockfile existe. Chequear si el PID adentro está vivo.
    const otherPid = readLockPid(abs);
    if (otherPid !== null && isPidAlive(otherPid) && otherPid !== pid) {
      throw new SingleInstanceError(
        `Ya hay un worker vivo (pid=${otherPid}). Abortando para evitar inferencias paralelas en Ollama.`,
        { lockFile: abs, otherPid }
      );
    }
    // Lock huérfano — reciclar.
    fsImpl.writeFileSync(abs, String(pid));
    return { release: () => safeUnlink(abs, fsImpl), lockFile: abs };
  }
}

function safeUnlink(abs, fsImpl) {
  try {
    fsImpl.unlinkSync(abs);
  } catch { /* no-op */ }
}
