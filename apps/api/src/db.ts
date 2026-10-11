import { createDb, type Db } from "@spark/db";

export function buildDb(databaseUrl: string): Db {
  return createDb(databaseUrl).db;
}