// Regresiones de los scripts PowerShell de autoinicio (sólo Windows).
// Nunca ejecuta start/stop/install/uninstall: carga WorkerCommon.ps1 por
// dot-sourcing (sólo define funciones) y, para B1, lanza un index.js FALSO
// dentro de un directorio temporal.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
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

// --- Supervisión del worker (fix/worker-autostart) ---------------------------

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

// Worker falso que queda vivo hasta que se lo mata. Su línea de comandos
// coincide con la del worker real (`node src\index.js --profile ...`).
function spawnFakeWorker(dir, profile) {
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "index.js"), "setInterval(() => {}, 1000);\n");
  const args = ["src\\index.js"];
  if (profile) args.push("--profile", profile);
  return spawn(process.execPath, args, { cwd: dir, stdio: "ignore", windowsHide: true });
}

function killQuiet(child) {
  try { child.kill(); } catch { /* no-op */ }
}

describe("WorkerCommon — decisiones de supervisión", () => {
  it("clasifica exit codes: 0 stop, 1/2 fatal, resto retry", winOnly, () => {
    const out = runCommon(
      `(@(0,1,2,3,7,-1073741510,3221225786) | ForEach-Object { Get-WorkerExitAction -ExitCode $_ }) -join ','`
    );
    assert.equal(out, "stop,fatal,fatal,retry,retry,retry,retry");
  });

  it("contador de fallos: suma si la ejecución fue corta y reinicia tras un período estable", winOnly, () => {
    const out = runCommon([
      "$a = Step-WorkerFailureCount -Failures 0 -RunSeconds 5 -StableRunSec 600",
      "$b = Step-WorkerFailureCount -Failures 4 -RunSeconds 5 -StableRunSec 600",
      "$c = Step-WorkerFailureCount -Failures 4 -RunSeconds 600 -StableRunSec 600",
      "$d = Step-WorkerFailureCount -Failures 5 -RunSeconds 86400 -StableRunSec 600",
      "\"$a,$b,$c,$d\"",
    ].join("; "));
    assert.equal(out, "1,5,1,1");
  });

  it("lee el perfil declarado con --profile en la línea de comandos", winOnly, () => {
    const out = runCommon([
      `$a = Get-WorkerProfileTag -CommandLine '"C:\\node.exe" "src\\index.js" --profile ".env.production"'`,
      `$b = Get-WorkerProfileTag -CommandLine '"C:\\node.exe"  "src\\index.js"'`,
      `$c = Get-WorkerProfileTag -CommandLine 'node src\\index.js --profile .env.local'`,
      "\"$a|$b|$c\"",
    ].join("; "));
    assert.equal(out, ".env.production||.env.local");
  });
});

describe("WorkerCommon — estado del lockfile del worker", () => {
  function lockState(lock, profile = ".env.production") {
    return JSON.parse(runCommon(
      `Get-WorkerLockState -LockFile ${psQuote(lock)} -EnvFile '${profile}' | Select-Object Status,Pid,Reason | ConvertTo-Json -Compress`
    ));
  }

  it("sin lockfile → none; ilegible o PID inexistente → stale", winOnly, () => {
    const dir = tmpWorkerDir();
    try {
      const lock = path.join(dir, ".worker.production.lock");
      assert.equal(lockState(lock).Status, "none");
      fs.writeFileSync(lock, "no-es-un-pid");
      assert.equal(lockState(lock).Status, "stale");
      fs.writeFileSync(lock, "4194300");
      const s = lockState(lock);
      assert.equal(s.Status, "stale");
      assert.match(s.Reason, /inexistente/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("PID reutilizado por otro programa → stale (caso típico tras reiniciar)", winOnly, () => {
    const dir = tmpWorkerDir();
    try {
      const lock = path.join(dir, ".worker.production.lock");
      // El node que corre estos tests: vivo, pero no es `src\index.js`.
      fs.writeFileSync(lock, String(process.pid));
      const s = lockState(lock);
      assert.equal(s.Status, "stale");
      assert.match(s.Reason, /otro programa node/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("worker vivo del mismo perfil → alive; de otro perfil → mismatch; sin --profile → alive", winOnly, async () => {
    const dir = tmpWorkerDir();
    const tagged = spawnFakeWorker(dir, ".env.production");
    const untagged = spawnFakeWorker(dir, null);
    try {
      await sleepMs(300);
      const lock = path.join(dir, ".worker.production.lock");
      fs.writeFileSync(lock, String(tagged.pid));
      assert.equal(lockState(lock).Status, "alive");
      assert.equal(lockState(lock, ".env.local").Status, "mismatch");
      fs.writeFileSync(lock, String(untagged.pid));
      assert.equal(lockState(lock).Status, "alive");
    } finally {
      killQuiet(tagged);
      killQuiet(untagged);
      await sleepMs(200);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("worker creado después de escribirse el lock (PID reasignado) → stale", winOnly, async () => {
    const dir = tmpWorkerDir();
    const child = spawnFakeWorker(dir, ".env.production");
    try {
      await sleepMs(300);
      const lock = path.join(dir, ".worker.production.lock");
      fs.writeFileSync(lock, String(child.pid));
      const past = new Date(Date.now() - 3600_000);
      fs.utimesSync(lock, past, past);
      const s = lockState(lock);
      assert.equal(s.Status, "stale");
      assert.match(s.Reason, /posterior/);
    } finally {
      killQuiet(child);
      await sleepMs(200);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("Remove-StaleWorkerLock borra sólo locks vencidos y nunca el de un worker vivo", winOnly, async () => {
    const dir = tmpWorkerDir();
    const child = spawnFakeWorker(dir, ".env.production");
    try {
      await sleepMs(300);
      const lock = path.join(dir, ".worker.production.lock");
      fs.writeFileSync(lock, String(child.pid));
      assert.equal(runCommon(
        `Remove-StaleWorkerLock -LockFile ${psQuote(lock)} -EnvFile '.env.production' -ExpectedPid ${child.pid}`
      ), "False");
      assert.ok(fs.existsSync(lock), "el lock de un worker vivo no se toca");

      fs.writeFileSync(lock, "4194300");
      // PID esperado distinto del actual → no se borra (cambió entre evaluación y borrado).
      assert.equal(runCommon(
        `Remove-StaleWorkerLock -LockFile ${psQuote(lock)} -EnvFile '.env.production' -ExpectedPid 123`
      ), "False");
      assert.ok(fs.existsSync(lock));
      assert.equal(runCommon(
        `Remove-StaleWorkerLock -LockFile ${psQuote(lock)} -EnvFile '.env.production' -ExpectedPid 4194300`
      ), "True");
      assert.equal(fs.existsSync(lock), false);
    } finally {
      killQuiet(child);
      await sleepMs(200);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("Invoke-WorkerNode agrega --profile a la línea de comandos de Node", winOnly, () => {
    const dir = tmpWorkerDir();
    try {
      fs.mkdirSync(path.join(dir, "src"));
      fs.mkdirSync(path.join(dir, "logs"));
      fs.writeFileSync(path.join(dir, "src", "index.js"), "console.log(JSON.stringify(process.argv.slice(2)));\n");
      const log = path.join(dir, "logs", "worker-test.log");
      const code = runCommon(
        `Invoke-WorkerNode -WorkerDir ${psQuote(dir)} -LogFile ${psQuote(log)} -NodeExe ${psQuote(process.execPath)} -ProfileTag '.env.production'`
      );
      assert.equal(code, "0");
      assert.match(fs.readFileSync(log, "utf8"), /\["--profile",".env.production"\]/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Copia los scripts a un worker/ temporal con un perfil sin token real.
// Nunca usa el worker/ del repo, sus .env ni sus lockfiles.
function makeSandboxWorker() {
  const dir = tmpWorkerDir();
  fs.mkdirSync(path.join(dir, "scripts"));
  for (const f of ["WorkerCommon.ps1", "start-worker.ps1"]) {
    fs.copyFileSync(path.join(SCRIPTS_DIR, f), path.join(dir, "scripts", f));
  }
  fs.writeFileSync(path.join(dir, ".env.production"), [
    `WORKER_TOKEN=${FAKE_TOKEN}`,
    "WORKER_LOCK_FILE=./.worker.production.lock",
    "WORKER_STOP_FLAG=./.worker.production.stop",
  ].join("\n"));
  return dir;
}

// Ollama falso: /api/version y /api/tags con el modelo pedido.
async function startFakeOllama() {
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/version") return res.end(JSON.stringify({ version: "test" }));
    if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "llama3.2:3b" }] }));
    res.statusCode = 404;
    return res.end("{}");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

function runWrapperAsync(dir, extraArgs) {
  const child = spawn("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", path.join(dir, "scripts", "start-worker.ps1"),
    "-EnvFile", ".env.production",
    ...extraArgs,
  ], { stdio: "ignore", windowsHide: true });
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  return { child, exited };
}

function wrapperLog(dir) {
  const logs = path.join(dir, "logs");
  if (!fs.existsSync(logs)) return "";
  return fs.readdirSync(logs).filter((f) => f.startsWith("wrapper-"))
    .map((f) => fs.readFileSync(path.join(logs, f), "utf8")).join("");
}

async function waitFor(pred, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await sleepMs(200);
  }
  throw new Error(`timeout esperando: ${what}`);
}

describe("start-worker.ps1 — sandbox temporal (sin Ollama ni backend reales)", () => {
  it("lock vencido + fallos rápidos → limpia el lock, reintenta y sale con 15", winOnly, async () => {
    const dir = makeSandboxWorker();
    const ollama = await startFakeOllama();
    try {
      fs.mkdirSync(path.join(dir, "src"));
      fs.writeFileSync(path.join(dir, "src", "index.js"), "process.exit(7);\n");
      fs.writeFileSync(path.join(dir, ".worker.production.lock"), "4194300");
      const { exited } = runWrapperAsync(dir, [
        "-OllamaUrl", ollama.url, "-MaxRestarts", "1", "-RestartDelaySec", "0", "-StableRunSec", "600",
      ]);
      const code = await Promise.race([exited, sleepMs(45_000).then(() => "timeout")]);
      const log = wrapperLog(dir);
      assert.equal(code, 15, log);
      assert.match(log, /lockfile del worker vencido pid=4194300/);
      assert.equal((log.match(/lanzando node src\/index\.js/g) || []).length, 2);
      assert.match(log, /exit_code=7/);
      assert.match(log, /wrapper finalizado exit_code=15/);
      assert.equal(fs.existsSync(path.join(dir, ".worker-wrapper.lock")), false);
    } finally {
      ollama.server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exit 2 del worker → no reintenta y sale con 16", winOnly, async () => {
    const dir = makeSandboxWorker();
    const ollama = await startFakeOllama();
    try {
      fs.mkdirSync(path.join(dir, "src"));
      fs.writeFileSync(path.join(dir, "src", "index.js"), "process.exit(2);\n");
      const { exited } = runWrapperAsync(dir, ["-OllamaUrl", ollama.url, "-RestartDelaySec", "0"]);
      const code = await Promise.race([exited, sleepMs(45_000).then(() => "timeout")]);
      const log = wrapperLog(dir);
      assert.equal(code, 16, log);
      assert.equal((log.match(/lanzando node/g) || []).length, 1);
    } finally {
      ollama.server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("adopta un worker vivo sin lanzar otro y respeta la detención cooperativa", winOnly, async () => {
    const dir = makeSandboxWorker();
    const fake = spawnFakeWorker(dir, ".env.production");
    try {
      await sleepMs(300);
      fs.writeFileSync(path.join(dir, ".worker.production.lock"), String(fake.pid));
      // Ollama inalcanzable: si el wrapper intentara lanzar, se quedaría esperándolo.
      const { exited } = runWrapperAsync(dir, [
        "-OllamaUrl", "http://127.0.0.1:9", "-OllamaPollSec", "1", "-AdoptPollSec", "1", "-RestartDelaySec", "1",
      ]);
      await waitFor(() => /adoptando worker existente pid=/.test(wrapperLog(dir)), 30_000, "adopción");

      // El worker adoptado termina: el wrapper lo detecta y vuelve a esperar a Ollama.
      killQuiet(fake);
      await waitFor(() => /worker adoptado pid=\d+ termino/.test(wrapperLog(dir)), 30_000, "fin del adoptado");
      await waitFor(() => /Ollama no responde/.test(wrapperLog(dir)), 30_000, "espera de Ollama");

      // Detención cooperativa: stop-worker.ps1 borra el lock del wrapper.
      fs.rmSync(path.join(dir, ".worker-wrapper.lock"), { force: true });
      const code = await Promise.race([exited, sleepMs(30_000).then(() => "timeout")]);
      const log = wrapperLog(dir);
      assert.equal(code, 0, log);
      assert.doesNotMatch(log, /lanzando node/, "nunca lanzó un segundo worker");
      assert.match(log, /espera cancelada/);
    } finally {
      killQuiet(fake);
      await sleepMs(200);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("WorkerCommon — log del wrapper con lectores concurrentes", () => {
  // Regresión: con Add-Content, leer el log mientras el wrapper escribía
  // producía EBUSY en el lector y líneas perdidas en silencio en el wrapper.
  it("no pierde líneas ni bloquea a quien lee el log al mismo tiempo", winOnly, async () => {
    const dir = tmpWorkerDir();
    try {
      const log = path.join(dir, "wrapper-test.log");
      fs.writeFileSync(log, "");
      const N = 400;
      const writer = spawn("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
        `. ${psQuote(COMMON)}; $e=0; for($i=0;$i -lt ${N};$i++){ if (-not (Add-WorkerLogLine -Path ${psQuote(log)} -Line "linea $i")) { $e++ } }; "errores=$e"`,
      ], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
      let out = "";
      writer.stdout.on("data", (b) => { out += b; });
      let done = false;
      writer.on("exit", () => { done = true; });
      let ebusy = 0;
      while (!done) {
        try { fs.readFileSync(log, "utf8"); } catch (err) { if (err.code === "EBUSY") ebusy++; else throw err; }
        await sleepMs(1);
      }
      assert.equal(out.trim(), "errores=0");
      assert.equal(ebusy, 0, "el lector no debe recibir EBUSY");
      const lines = fs.readFileSync(log, "utf8").split(/\r?\n/).filter(Boolean);
      assert.equal(lines.length, N);
      assert.equal(lines[N - 1], `linea ${N - 1}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("scripts — regresiones estáticas del autoinicio", () => {
  it("el wrapper no escribe su log con Add-Content", () => {
    const src = fs.readFileSync(path.join(SCRIPTS_DIR, "start-worker.ps1"), "utf8");
    assert.doesNotMatch(src, /Add-Content/);
    assert.match(src, /Add-WorkerLogLine/);
  });

  it("la tarea ejecuta el wrapper bajo conhost --headless, sin ventana visible", () => {
    const src = fs.readFileSync(path.join(SCRIPTS_DIR, "install-autostart.ps1"), "utf8");
    assert.match(src, /System32\\conhost\.exe/);
    assert.match(src, /New-ScheduledTaskAction -Execute \$conhostExe/);
    const argLine = src.match(/\$argLine = (.*)/)[1];
    assert.match(argLine, /^"--headless /);
    assert.doesNotMatch(argLine, /-WindowStyle/);
  });

  it("el wrapper evalúa el lockfile antes de lanzar y etiqueta el perfil", () => {
    const src = fs.readFileSync(path.join(SCRIPTS_DIR, "start-worker.ps1"), "utf8");
    assert.ok(src.indexOf("Get-WorkerLockState") < src.indexOf("Invoke-WorkerNode -WorkerDir"));
    assert.match(src, /Invoke-WorkerNode [^\n]*-ProfileTag \$EnvFile/);
    // `continue` dentro de un switch no avanza el while en PowerShell.
    assert.doesNotMatch(src, /switch \(\$state\.Status\)/);
  });
});
