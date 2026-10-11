import cookie from "@fastify/cookie";
import type { Db } from "@spark/db";
import type { TelegramBotApi } from "@spark/telegram";
import Fastify, { type FastifyInstance } from "fastify";
import type { MembershipCache } from "./cache/membershipCache";
import { registerAuthRoutes } from "./routes/auth";
import { registerMeRoutes } from "./routes/me";
import { registerVerifyRoutes } from "./routes/verify";

export interface ApiDeps {
  db: Db;
  telegram: TelegramBotApi | undefined;
  membershipCache: MembershipCache;
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
    registerVerifyRoutes(instance, deps);
  });

  return app;
}
