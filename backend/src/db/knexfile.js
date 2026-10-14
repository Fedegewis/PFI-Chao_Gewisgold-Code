import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env") });

const isTest = process.env.NODE_ENV === "test";

// En tests IGNORAMOS DATABASE_URL: la suite jamás debe tocar una DB remota o
// productiva. Sólo conexión local a una DB cuyo nombre esté claramente marcado
// como de test (ver validación fail-closed abajo).
const dbName = isTest
  ? (process.env.DB_NAME_TEST || "menteactiva_test")
  : (process.env.DB_NAME || "menteactiva");

// Fail-closed: si NODE_ENV=test y la DB resuelta no termina en "_test",
// abortar antes de exponer el pool a cualquier tests. Evita configuraciones
// erróneas que destruirían datos reales de desarrollo.
if (isTest && !/_test$/.test(dbName)) {
  throw new Error(
    `Refusing to run backend tests against non-test database: "${dbName}". ` +
    `Set NODE_ENV=test and DB_NAME_TEST to a name ending in "_test".`
  );
}

const useConnectionString = !isTest && !!process.env.DATABASE_URL;

const connection = useConnectionString
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false },
    }
  : {
      host: process.env.DB_HOST || "localhost",
      port: Number(process.env.DB_PORT) || 5432,
      database: dbName,
      user: process.env.DB_USER || "postgres",
      password: process.env.DB_PASSWORD || "postgres",
    };

export default {
  client: "pg",
  connection,
  migrations: {
    directory: resolve(__dirname, "./migrations"),
  },
  seeds: {
    directory: resolve(__dirname, "./seeds"),
  },
};
