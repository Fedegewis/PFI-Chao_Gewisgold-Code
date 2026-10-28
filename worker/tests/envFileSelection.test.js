// Verifica el mecanismo de selección de archivo .env mediante
// WORKER_ENV_FILE. Testeamos el loader del index.js corriéndolo en un
// subproceso: no queremos reimportar módulos, y la carga de dotenv es
// un side effect del arranque.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INDEX = path.resolve(__dirname, "..", "src", "index.js");

function runWorker({ cwd, env, timeoutMs = 3000 }) {
  // Lockfile dentro del cwd efímero para no colisionar con otros tests.
  const envWithLock = {
    WORKER_LOCK_FILE: path.join(cwd, ".worker.lock"),
    ...env,
  };
  return spawnSync(process.execPath, [INDEX], {
    cwd,
    env: { ...process.env, ...envWithLock, PATH: process.env.PATH },
    encoding: "utf8",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ma-worker-env-"));
}

describe("index.js — selección de archivo .env", () => {
  it("falla con exit 2 cuando WORKER_ENV_FILE apunta a un archivo inexistente", () => {
    const dir = tmpDir();
    try {
      const r = runWorker({
        cwd: dir,
        env: {
          WORKER_ENV_FILE: ".env.no-existe",
          WORKER_BACKEND_URL: "https://api.example.com",
          WORKER_TOKEN: "a".repeat(64),
        },
      });
      assert.equal(r.status, 2);
      assert.match(r.stdout, /WORKER_ENV_FILE apunta a un archivo inexistente/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("carga el archivo indicado por WORKER_ENV_FILE y usa sus valores", () => {
    const dir = tmpDir();
    const envPath = path.join(dir, ".env.custom");
    fs.writeFileSync(
      envPath,
      [
        "WORKER_BACKEND_URL=https://api.custom.example.com",
        `WORKER_TOKEN=${"c".repeat(64)}`,
        "WORKER_CONCURRENCY=1",
      ].join("\n")
    );
    try {
      // El proceso debería pasar config, adquirir lock y empezar a correr.
      // No queremos esperarlo entero: lo matamos por timeout. Lo relevante
      // es que al imprimir "worker arrancado" aparezca la URL del .env.custom.
      const r = runWorker({
        cwd: dir,
        env: {
          WORKER_ENV_FILE: ".env.custom",
          // Ninguna var sombra: forzamos a que vengan del archivo.
          WORKER_BACKEND_URL: undefined,
          WORKER_TOKEN: undefined,
        },
      });
      // Esperamos que termine por timeout (señal null, code null) tras loguear arranque.
      assert.match(r.stdout, /worker arrancado/);
      assert.match(r.stdout, /api\.custom\.example\.com/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sin WORKER_ENV_FILE cae al .env del cwd (comportamiento legado)", () => {
    const dir = tmpDir();
    const envPath = path.join(dir, ".env");
    fs.writeFileSync(
      envPath,
      [
        "WORKER_BACKEND_URL=https://api.legacy.example.com",
        `WORKER_TOKEN=${"d".repeat(64)}`,
      ].join("\n")
    );
    try {
      const r = runWorker({
        cwd: dir,
        env: {
          WORKER_ENV_FILE: undefined,
          WORKER_BACKEND_URL: undefined,
          WORKER_TOKEN: undefined,
        },
      });
      assert.match(r.stdout, /api\.legacy\.example\.com/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rechaza config inválida con exit 2 (URL vacía)", () => {
    const dir = tmpDir();
    try {
      const r = runWorker({
        cwd: dir,
        env: {
          WORKER_ENV_FILE: undefined,
          WORKER_BACKEND_URL: "",
          WORKER_TOKEN: "x".repeat(64),
        },
      });
      assert.equal(r.status, 2);
      assert.match(r.stdout, /worker config inv[aá]lida/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
