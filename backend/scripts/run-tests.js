// Wrapper cross-platform: fija NODE_ENV=test antes de spawnear node --test.
// Necesario porque PowerShell/cmd de Windows no soportan la sintaxis
// `NODE_ENV=test node ...` que funciona en bash/zsh.
import { spawn } from "node:child_process";

process.env.NODE_ENV = "test";

// Aislamiento de la suite frente a `.env` local del dev.
//
// Motivo: desde W-3 el analysisService hace short-circuit con AiDeferredError
// cuando AI_PROVIDER=deferred. Los tests clásicos de ai-analysis-concurrency,
// ai-analysis-retry y analysis-endpoint esperan el flujo in-process Ollama
// (default). Si el dev tiene AI_PROVIDER=deferred en su `.env` para operar el
// worker local, los tests heredan ese valor via dotenv y fallan.
//
// Fix: inyectamos nuestro módulo de pre-carga via NODE_OPTIONS para que se
// propague a los workers de `node --test`. El módulo carga `.env` (igual que
// knexfile y app.js) y luego anula AI_PROVIDER. Los tests que SÍ requieren
// modo deferred (worker-deferred-mode) lo setean explícitamente en su propio
// archivo tras este reset — esos siguen funcionando.
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const setupPath = resolve(__dirname, "test-setup.mjs");
// `--import` exige una URL con esquema file:// en Windows (no un path con
// letra de unidad). pathToFileURL hace el escape correcto por plataforma.
const setupUrl = pathToFileURL(setupPath).href;
process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS || "", `--import ${setupUrl}`]
  .filter(Boolean)
  .join(" ");

const args = ["--test", "--test-concurrency=1", "tests/**/*.test.js"];

const child = spawn(process.execPath, args, {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
