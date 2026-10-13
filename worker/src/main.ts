import { createDb } from "@spark/db";
import { buildRuntime, start } from "./index";
import { loadWorkerEnv } from "./env";

const env = loadWorkerEnv();
const { db, pool } = createDb(env.DATABASE_URL);
const { deps, intervals } = buildRuntime(env, db);

start(env.DATABASE_URL, deps, intervals)
  .then(() => {
    console.info("spark-worker listening for settlement + reconciliation jobs");
  })
  .catch(async (err: unknown) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });