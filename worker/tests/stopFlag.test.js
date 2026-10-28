// Verifica el shutdown cooperativo por archivo-centinela
// (WORKER_STOP_FLAG). Al escribir ese archivo, el worker debe cerrar
// de forma ordenada: liberar el lockfile, loguear "señal de shutdown
// recibida" con signal=STOP_FLAG, y salir con exit code 0.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INDEX = path.resolve(__dirname, "..", "src", "index.js");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ma-worker-stop-"));
}

async function waitFor(predicate, { timeoutMs = 5000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

describe("worker — shutdown por archivo-centinela", () => {
  it("stop-flag dispara shutdown ordenado y limpia el lockfile", async () => {
    const dir = tmpDir();
    const lockFile = path.join(dir, ".worker.test.lock");
    const stopFlag = path.join(dir, ".worker.stop");

    const env = {
      ...process.env,
      WORKER_ENV_FILE: undefined,
      WORKER_BACKEND_URL: "http://127.0.0.1:1", // no responde — backend_error con backoff
      WORKER_TOKEN: "a".repeat(64),
      WORKER_LOCK_FILE: lockFile,
      WORKER_STOP_FLAG: stopFlag,
      WORKER_IDLE_POLL_MS: "500",
    };

    const proc = spawn(process.execPath, [INDEX], {
      cwd: dir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    proc.stdout.on("data", (b) => { stdout += b.toString(); });

    try {
      // Esperar a que el worker haya arrancado y tenga el lockfile vivo.
      const started = await waitFor(() => fs.existsSync(lockFile) && stdout.includes("worker arrancado"));
      assert.ok(started, "worker no arrancó a tiempo");

      // Pedir shutdown cooperativo.
      fs.writeFileSync(stopFlag, "");

      // El worker debe salir con exit 0.
      const exitCode = await new Promise((resolve) => proc.once("exit", (c) => resolve(c)));
      assert.equal(exitCode, 0, `exit code inesperado; stdout tail:\n${stdout.slice(-400)}`);

      // Lockfile liberado.
      assert.equal(fs.existsSync(lockFile), false, "lockfile no fue liberado");

      // Centinela debe haber sido eliminado por el worker.
      assert.equal(fs.existsSync(stopFlag), false, "stop flag no fue eliminado");

      // Logs: evidenciar el camino STOP_FLAG.
      assert.match(stdout, /señal de shutdown recibida.*STOP_FLAG|STOP_FLAG.*señal de shutdown/s);
    } finally {
      if (!proc.killed) proc.kill("SIGKILL");
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
