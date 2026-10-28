// Regresiones de los scripts PowerShell de autoinicio (sólo Windows).
// Nunca ejecuta start/stop/install/uninstall: carga WorkerCommon.ps1 por
// dot-sourcing (sólo define funciones) y, para B1, lanza un index.js FALSO
// dentro de un directorio temporal.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_DIR = path.resolve(__dirname, "..");
const SCRIPTS_DIR = path.join(WORKER_DIR, "scripts");
const COMMON = path.join(SCRIPTS_DIR, "WorkerCommon.ps1");
const SCRIPT_FILES = [
  "WorkerCommon.ps1",
  "start-worker.ps1",
  "stop-worker.ps1",
  "install-autostart.ps1",
  "uninstall-autostart.ps1",
];

const isWindows = process.platform === "win32";
const winOnly = { skip: isWindows ? false : "requiere Windows PowerShell" };

function psQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function runPs(command) {
  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
    { encoding: "utf8", timeout: 60_000 }
  );
  if (r.status !== 0) {
    throw new Error(`powershell exit ${r.status}\nstdout:${r.stdout}\nstderr:${r.stderr}`);
  }
  return r.stdout.trim();
}

function runCommon(body) {
  return runPs(`$ErrorActionPreference='Stop'; . ${psQuote(COMMON)}; ${body}`);
}

function tmpWorkerDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ma-ps-"));
}

const FAKE_TOKEN = "SECRET-TOKEN-" + "z".repeat(40);

describe("scripts PowerShell — sintaxis", () => {
  it("scripts con caracteres no ASCII llevan BOM UTF-8 (PS 5.1 los leería como ANSI)", () => {
    for (const f of SCRIPT_FILES) {
      const buf = fs.readFileSync(path.join(SCRIPTS_DIR, f));
      const hasBom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
      const isAscii = buf.every((b) => b < 0x80);
      assert.ok(hasBom || isAscii, `${f} tiene caracteres no ASCII sin BOM`);
    }
  });

  it("todos los scripts parsean sin errores en Windows PowerShell", winOnly, () => {
    for (const f of SCRIPT_FILES) {
      const out = runPs(
        `$e=$null; $t=$null; [void][System.Management.Automation.Language.Parser]::ParseFile(${psQuote(path.join(SCRIPTS_DIR, f))}, [ref]$t, [ref]$e); $e.Count`
      );
      assert.equal(out, "0", `errores de parseo en ${f}`);
    }
  });

  it("el wrapper corre en Windows PowerShell 5.1 (sin sintaxis de PS 7)", winOnly, () => {
    for (const f of SCRIPT_FILES) {
      const src = fs.readFileSync(path.join(SCRIPTS_DIR, f), "utf8");
      assert.doesNotMatch(src, /\?\?|\?\.|&&|\|\|/, `${f} usa operadores de PowerShell 7`);
    }
  });
});

describe("WorkerCommon — perfiles (B2)", () => {
  it("lee lockfile y stop-flag del perfil de producción de la plantilla", winOnly, () => {
    const dir = tmpWorkerDir();
    try {
      const tpl = fs.readFileSync(path.join(WORKER_DIR, ".env.production.example"), "utf8");
      fs.writeFileSync(path.join(dir, ".env.production"), tpl.replace(/^WORKER_TOKEN=.*$/m, `WORKER_TOKEN=${FAKE_TOKEN}`));
      const out = JSON.parse(runCommon(
        `Get-WorkerProfilePaths -WorkerDir ${psQuote(dir)} -EnvFile '.env.production' | ConvertTo-Json -Compress`
      ));
      assert.equal(out.LockFile, path.join(dir, ".worker.production.lock"));
      assert.equal(out.StopFlag, path.join(dir, ".worker.production.stop"));
      assert.equal(JSON.stringify(out).includes(FAKE_TOKEN), false, "el token no debe aparecer");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("usa los defaults de config.js si el perfil no define las claves", winOnly, () => {
    const dir = tmpWorkerDir();
    try {
      fs.writeFileSync(path.join(dir, ".env.local"), `WORKER_TOKEN=${FAKE_TOKEN}\n`);
      const out = JSON.parse(runCommon(
        `Get-WorkerProfilePaths -WorkerDir ${psQuote(dir)} -EnvFile '.env.local' | ConvertTo-Json -Compress`
      ));
      assert.equal(out.LockFile, path.join(dir, ".worker.lock"));
      assert.equal(out.StopFlag, path.join(dir, ".worker.stop"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("acepta comillas y comentarios en línea como dotenv", winOnly, () => {
    const dir = tmpWorkerDir();
    try {
      fs.writeFileSync(path.join(dir, ".env.local"), [
        `WORKER_LOCK_FILE="./a b.lock"`,
        `WORKER_STOP_FLAG=./x.stop   # comentario`,
      ].join("\n"));
      const out = JSON.parse(runCommon(
        `Get-WorkerProfilePaths -WorkerDir ${psQuote(dir)} -EnvFile '.env.local' | ConvertTo-Json -Compress`
      ));
      assert.equal(out.LockFile, path.join(dir, "a b.lock"));
      assert.equal(out.StopFlag, path.join(dir, "x.stop"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falla si el perfil no existe", winOnly, () => {
    const dir = tmpWorkerDir();
    try {
      assert.throws(() => runCommon(`Get-WorkerProfilePaths -WorkerDir ${psQuote(dir)} -EnvFile '.env.production'`));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detecta perfiles que comparten lockfile o stop-flag", winOnly, () => {
    const dir = tmpWorkerDir();
    try {
      fs.writeFileSync(path.join(dir, ".env.production"), "WORKER_LOCK_FILE=./p.lock\nWORKER_STOP_FLAG=./same.stop\n");
      fs.writeFileSync(path.join(dir, ".env.local"), "WORKER_LOCK_FILE=./l.lock\nWORKER_STOP_FLAG=./same.stop\n");
      const out = runCommon(
        `(Get-WorkerProfileCollisions -WorkerDir ${psQuote(dir)} -EnvFile '.env.production') -join ','`
      );
      assert.equal(out, ".env.local");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("no reporta colisión con perfiles separados (plantillas)", winOnly, () => {
    const dir = tmpWorkerDir();
    try {
      fs.copyFileSync(path.join(WORKER_DIR, ".env.production.example"), path.join(dir, ".env.production"));
      fs.copyFileSync(path.join(WORKER_DIR, ".env.local.example"), path.join(dir, ".env.local"));
      const out = runCommon(
        `(Get-WorkerProfileCollisions -WorkerDir ${psQuote(dir)} -EnvFile '.env.production').Count`
      );
      assert.equal(out, "0");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lockfile del wrapper registra PID y perfil", winOnly, () => {
    const dir = tmpWorkerDir();
    try {
      const lock = path.join(dir, ".worker-wrapper.lock");
      fs.writeFileSync(lock, "1234\r\n.env.production\r\n");
      const out = JSON.parse(runCommon(`Read-WrapperLock -Path ${psQuote(lock)} | ConvertTo-Json -Compress`));
      assert.equal(out.Pid, 1234);
      assert.equal(out.EnvFile, ".env.production");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("WorkerCommon — lanzamiento de Node (B1)", () => {
  it("captura stdout y stderr, agrega sin sobrescribir y propaga el exit code", winOnly, () => {
    const dir = tmpWorkerDir();
    try {
      fs.mkdirSync(path.join(dir, "src"));
      fs.mkdirSync(path.join(dir, "logs"));
      fs.writeFileSync(path.join(dir, "src", "index.js"), [
        "const n = process.env.RUN_N;",
        "process.stdout.write(`OUT-${n}\\n`);",
        "process.stderr.write(`ERR-${n}\\n`);",
        "process.exit(7);",
      ].join("\n"));
      const log = path.join(dir, "logs", "worker-test.log");
      const nodeExe = process.execPath;
      const codes = [];
      for (const n of [1, 2]) {
        codes.push(runCommon(
          `$env:RUN_N='${n}'; Invoke-WorkerNode -WorkerDir ${psQuote(dir)} -LogFile ${psQuote(log)} -NodeExe ${psQuote(nodeExe)}`
        ));
      }
      assert.deepEqual(codes, ["7", "7"]);
      const content = fs.readFileSync(log, "utf8");
      for (const line of ["OUT-1", "ERR-1", "OUT-2", "ERR-2"]) {
        assert.match(content, new RegExp(line), `falta ${line} en el log`);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("scripts — regresiones estáticas", () => {
  it("B1: el wrapper no usa Start-Process con redirecciones al mismo archivo", () => {
    const src = fs.readFileSync(path.join(SCRIPTS_DIR, "start-worker.ps1"), "utf8");
    assert.doesNotMatch(src, /RedirectStandard(Output|Error)/);
  });

  it("B2: stop-worker resuelve rutas desde el perfil, sin stop-flag fijo", () => {
    const src = fs.readFileSync(path.join(SCRIPTS_DIR, "stop-worker.ps1"), "utf8");
    assert.match(src, /Get-WorkerProfilePaths/);
    assert.doesNotMatch(src, /\$StopFlag\s*=\s*"/);
    const un = fs.readFileSync(path.join(SCRIPTS_DIR, "uninstall-autostart.ps1"), "utf8");
    assert.match(un, /-EnvFile "\.env\.production"/);
    // El stop cooperativo debe ocurrir antes del Stop-ScheduledTask.
    assert.ok(un.indexOf("& $stop") < un.indexOf("Stop-ScheduledTask -TaskName"));
  });

  it("B3: Delay en ISO 8601, perfil fijo y sin secretos en argumentos", () => {
    const src = fs.readFileSync(path.join(SCRIPTS_DIR, "install-autostart.ps1"), "utf8");
    assert.match(src, /\$trigger\.Delay = "PT\{0\}S" -f \$StartDelaySec/);
    assert.match(src, /\$EnvFile = "\.env\.production"/);
    assert.doesNotMatch(src, /\[string\]\$EnvFile/);
    const argLine = src.match(/\$argLine = (.*)/)[1];
    assert.doesNotMatch(argLine, /TOKEN|WORKER_BACKEND_URL/i);
  });
});
