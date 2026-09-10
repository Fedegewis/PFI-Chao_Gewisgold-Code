import knex from "knex";
import config from "./knexfile.js";

const db = knex(config);

export { config as knexConfig };
export default db;
