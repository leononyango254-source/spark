import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";
import { createDb, type Db } from "../src/client";

export interface Harness {
  container: StartedPostgreSqlContainer;
  pool: Pool;
  db: Db;
  stop(): Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  const container = await new PostgreSqlContainer("postgres:17").start();
  const { db, pool } = createDb(container.getConnectionUri());
  await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
  return {
    container,
    pool,
    db,
    async stop() {
      await pool.end();
      await container.stop();
    },
  };
}