// Pre-carga de la suite de tests.
//
// Node ejecuta este módulo via `--import` ANTES de cualquier archivo de test.
// Fuerza AI_PROVIDER=ollama para la suite, independientemente del `.env`
// local del dev (que suele tener "deferred" cuando opera el worker).
//
// Por qué SET y no DELETE:
//   knexfile.js llama dotenv.config({path:...}) manualmente al importarse,
//   y re-poblaría AI_PROVIDER=deferred desde `.env` si lo dejamos undefined.
//   Como dotenv por default NO sobreescribe variables ya seteadas, basta con
//   fijar explícitamente "ollama" acá — queda inmutable para toda la suite.
//
// Los tests que requieren modo deferred (worker-deferred-mode.test.js) hacen
// `process.env.AI_PROVIDER = "deferred"` dentro de sus describe/beforeEach,
// sobre un valor ya existente, lo cual es un SET explícito que sí pisa.
/* global process */
process.env.AI_PROVIDER = "ollama";
