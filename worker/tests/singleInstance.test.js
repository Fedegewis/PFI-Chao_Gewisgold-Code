import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireLock, SingleInstanceError, isPidAlive } from "../src/singleInstance.js";

function tmpLockFile(suffix) {
  return path.join(os.tmpdir(), `menteactiva-worker-test-${process.pid}-${Date.now()}-${suffix}.lock`);
}

describe("singleInstance.acquireLock", () => {
  it("crea el lockfile cuando no existe y escribe el PID", () => {
    const lf = tmpLockFile("new");
    try {
      const lock = acquireLock({ lockFile: lf });
      assert.ok(fs.existsSync(lock.lockFile));
      const pid = Number(fs.readFileSync(lock.lockFile, "utf8").trim());
      assert.equal(pid, process.pid);
      lock.release();
      assert.equal(fs.existsSync(lock.lockFile), false);
    } finally {
      try { fs.unlinkSync(lf); } catch { /* no-op */ }
    }
  });

  it("rechaza si existe un lockfile con un PID vivo", () => {
    const lf = tmpLockFile("vivo");
    try {
      // Simular otro proceso vivo: nuestro propio PID como "otro".
      // acquireLock llama con pid=process.pid por default. Pasamos un pid
      // distinto para simular que "nosotros" somos otro proceso.
      fs.writeFileSync(lf, String(process.pid));
      assert.throws(
        () => acquireLock({ lockFile: lf, pid: process.pid + 1_000_000 }),
        (err) => err instanceof SingleInstanceError && err.otherPid === process.pid
      );
    } finally {
      try { fs.unlinkSync(lf); } catch { /* no-op */ }
    }
  });

  it("recicla lockfile huérfano (PID muerto)", () => {
    const lf = tmpLockFile("huerfano");
    try {
      // PID garantizado inexistente en el rango de PIDs del OS: usamos 1
      // sólo si no es nuestro parent — más seguro: usar 2_147_483_000 que
      // excede PID máximo típico pero cabe en int32.
      fs.writeFileSync(lf, "2147483000");
      const lock = acquireLock({ lockFile: lf });
      const pid = Number(fs.readFileSync(lock.lockFile, "utf8").trim());
      assert.equal(pid, process.pid, "el lockfile se recicló con nuestro PID");
      lock.release();
    } finally {
      try { fs.unlinkSync(lf); } catch { /* no-op */ }
    }
  });

  it("recicla lockfile con contenido corrupto", () => {
    const lf = tmpLockFile("corrupto");
    try {
      fs.writeFileSync(lf, "no es un pid");
      const lock = acquireLock({ lockFile: lf });
      lock.release();
    } finally {
      try { fs.unlinkSync(lf); } catch { /* no-op */ }
    }
  });

  it("release es idempotente (no explota si ya fue liberado)", () => {
    const lf = tmpLockFile("idempot");
    try {
      const lock = acquireLock({ lockFile: lf });
      lock.release();
      // Segunda release no debe lanzar.
      lock.release();
    } finally {
      try { fs.unlinkSync(lf); } catch { /* no-op */ }
    }
  });

  it("isPidAlive true para el proceso actual", () => {
    assert.equal(isPidAlive(process.pid), true);
  });

  it("isPidAlive false para PID muy alto inexistente", () => {
    assert.equal(isPidAlive(2147483000), false);
  });
});
