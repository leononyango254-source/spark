import cookie from "@fastify/cookie";
import type { Db } from "@spark/db";
import Fastify, { type FastifyInstance } from "fastify";
import { registerAuthRoutes } from "./routes/auth";
import { registerMeRoutes } from "./routes/me";

export interface ApiDeps {
  db: Db;
  telegramBotToken: string | undefined;
  sessionTtlSeconds: number;
  nodeEnv: "development" | "test" | "production";
}

export function buildServer(deps: ApiDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(cookie);

  app.get("/health", async () => ({ status: "ok", service: "spark-api" }));

  app.register(async (instance) => {
    registerAuthRoutes(instance, deps);
    registerMeRoutes(instance, deps);
  });

  return app;
}
