import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://spark:spark@localhost:5433/spark",
  },
});
