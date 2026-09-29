// Wrapper cross-platform: fija NODE_ENV=test antes de spawnear node --test.
// Necesario porque PowerShell/cmd de Windows no soportan la sintaxis
// `NODE_ENV=test node ...` que funciona en bash/zsh.
import { spawn } from "node:child_process";

process.env.NODE_ENV = "test";

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
