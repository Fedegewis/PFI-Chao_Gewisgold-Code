// Prepara la DB de tests (menteactiva_test por default):
//   1. Fija NODE_ENV=test para que knexfile resuelva DB_NAME_TEST.
//   2. Se conecta al servidor Postgres apuntando a la DB administrativa
//      "postgres" y ejecuta CREATE DATABASE si no existe.
//   3. Corre migraciones sobre la DB de tests.
//   4. Corre seeds sobre la DB de tests.
//
// La DB local de desarrollo (`menteactiva`) nunca se toca.
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import knex from "knex";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

process.env.NODE_ENV = "test";

const targetDb = process.env.DB_NAME_TEST || "menteactiva_test";
if (!/_test$/.test(targetDb)) {
  console.error(`Refusing to prepare non-test database: "${targetDb}" (must end in "_test").`);
  process.exit(1);
}

const adminConn = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  database: "postgres",
};

async function ensureDatabase() {
  const admin = new pg.Client(adminConn);
  await admin.connect();
  try {
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [targetDb]);
    if (exists.rowCount === 0) {
      // pg_database names cannot be parameterized in CREATE DATABASE; escapamos comillas.
      const safeName = targetDb.replace(/"/g, '""');
      await admin.query(`CREATE DATABASE "${safeName}"`);
      console.log(`Created database "${targetDb}".`);
    } else {
      console.log(`Database "${targetDb}" already exists.`);
    }
  } finally {
    await admin.end();
  }
}

async function runMigrationsAndSeeds() {
  // Importa el knexfile DESPUÉS de haber puesto NODE_ENV=test.
  const { default: knexConfig } = await import("../src/db/knexfile.js");
  const db = knex(knexConfig);
  try {
    await db.migrate.latest();
    console.log("Migrations applied.");
    await db.seed.run();
    console.log("Seeds applied.");
  } finally {
    await db.destroy();
  }
}

(async () => {
  try {
    await ensureDatabase();
    await runMigrationsAndSeeds();
    console.log("Test DB ready.");
  } catch (err) {
    console.error("Failed to prepare test DB:", err.message);
    process.exit(1);
  }
})();
